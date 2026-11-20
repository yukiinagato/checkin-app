'use strict';

// g.hanastay.net 自建入住指南的登记 → checkin-app 同步。
//
// 客人在 g.hanastay.net/{短码} 上传证件照 + 家庭住址，原件存在 hostex-lark-bridge Worker 的
// R2（hanastay-guest-docs）与 KV reg:{订单号}。Worker 已有导出接口（宿泊者名簿 NAS 同步在用）：
//   POST /reg/export {op:'list', full, since_ms}  → {items:[{code}]}
//   POST /reg/export {op:'get', codes:[≤20]}      → {records:[{code, resv, arrival, address, guests, files, at}]}
//   GET  /reg/file?key=…                          → 证件原图
// 鉴权头 X-Auth。
//
// 本模块按订单号（= Hostex reservation_code）把登记落到本库：
//  1. 证件照写入 hostex_id_images（source='hanastay'）并预跑 OCR → 客人到店时自动预填；
//  2. 当每张证件都能识别出完整身份、人数达到订单人数且通过表单校验时，直接生成 checkins 记录
//     并关联订单 → Wi-Fi 门户与门锁把该订单视为已登记。达不到条件时只做预填，客人在
//     checkin-app 补全，绝不猜测。

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { Semaphore } = require('./semaphore');
const { dedupeReservationPhotos } = require('./hostexSync');
const { expectedGuests } = require('./reservationSelection');

const REQUEST_TIMEOUT_MS = 30000;
const RETRY_DELAYS_MS = [1000, 4000, 15000];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DOWNLOAD_ATTEMPTS = 5;
const DOWNLOAD_CONCURRENCY = 2;
const GET_BATCH = 20;
const ACTIVE_PAST_DAYS = 7;
const CODE_RE = /^[A-Za-z0-9_-]{4,64}$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EXT_BY_MIME = {
  'image/jpeg': 'jpeg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif'
};
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif']);

// 按文件头识别图片类型，不信任响应头/文件名。
const sniffImageExt = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  return null;
};

const createHanastayClient = ({ baseUrl, token, userAgent, logger, fetchImpl = fetch }) => {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const headers = (extra = {}) => ({ 'X-Auth': token, 'User-Agent': userAgent, ...extra });

  const request = async (pathname, { method = 'GET', body = null, raw = false } = {}) => {
    let lastError = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetchImpl(`${base}${pathname}`, {
          method,
          headers: headers(body ? { 'Content-Type': 'application/json', accept: 'application/json' } : {}),
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`hanastay HTTP ${res.status}`);
          if (attempt < RETRY_DELAYS_MS.length) {
            logger.warn({ pathname, status: res.status, attempt }, 'hanastay export retryable error, backing off');
            await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          throw lastError;
        }
        if (!res.ok) {
          // 不回显响应体：可能含个人信息
          throw new Error(`hanastay HTTP ${res.status} on ${pathname.split('?')[0]}`);
        }
        if (raw) {
          return { buffer: Buffer.from(await res.arrayBuffer()), contentType: String(res.headers.get('content-type') || '') };
        }
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new Error(`hanastay non-JSON response on ${pathname.split('?')[0]}`);
        }
      } catch (err) {
        lastError = err;
        const retryable = err.name === 'AbortError' || err.cause?.code === 'ECONNRESET' || err.cause?.code === 'ETIMEDOUT';
        if (retryable && attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error('hanastay request failed');
  };

  const listCodes = async ({ full, sinceMs }) => {
    const json = await request('/reg/export', { method: 'POST', body: { op: 'list', full: Boolean(full), since_ms: sinceMs || 0 } });
    return (Array.isArray(json?.items) ? json.items : [])
      .map((item) => (typeof item === 'string' ? item : item?.code))
      .filter((code) => typeof code === 'string' && CODE_RE.test(code));
  };

  const getRecords = async (codes) => {
    const json = await request('/reg/export', { method: 'POST', body: { op: 'get', codes } });
    return Array.isArray(json?.records) ? json.records : [];
  };

  const downloadFile = async (key) => {
    const { buffer, contentType } = await request(`/reg/file?key=${encodeURIComponent(key)}`, { raw: true });
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
      throw new Error(`hanastay file rejected: size ${buffer.length} bytes`);
    }
    const sniffed = sniffImageExt(buffer);
    const mime = contentType.split(';')[0].trim().toLowerCase();
    const ext = sniffed || EXT_BY_MIME[mime];
    if (!ext || !ALLOWED_EXT.has(ext) || !sniffed) {
      throw new Error(`hanastay file rejected: not a supported image (${mime || 'no content-type'})`);
    }
    return { buffer, ext };
  };

  return { listCodes, getRecords, downloadFile };
};

const normalizePassportNumber = (value) => String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
const cleanText = (value, max = 200) => String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const ageFromBirthDate = (birthDate, todayIso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate || ''));
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayIso || ''));
  if (!m || !t) return null;
  let age = Number(t[1]) - Number(m[1]);
  if (Number(t[2]) < Number(m[2]) || (t[2] === m[2] && Number(t[3]) < Number(m[3]))) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
};

// 只保留下游真正要用的字段，避免把整份导出（可能日后扩字段）原样落库。
const sanitizeRecord = (rec) => ({
  code: rec.code,
  propertyId: rec.resv?.property_id != null ? String(rec.resv.property_id) : null,
  address: cleanText(rec.address, 300),
  arrival: cleanText(rec.arrival, 20),
  at: cleanText(rec.at, 40),
  files: (Array.isArray(rec.files) ? rec.files : []).filter((key) => typeof key === 'string' && key.length > 0 && key.length <= 512),
  guests: (Array.isArray(rec.guests) ? rec.guests : []).map((g) => ({
    name: cleanText(g?.name),
    nat: cleanText(g?.nat, 40),
    no: cleanText(g?.no, 40)
  })).filter((g) => g.name || g.no)
});

const createHanastaySync = ({
  db,
  runAsync,
  allAsync,
  getAsync,
  client,
  uploadDir,
  propertyId,
  intervalMs,
  runOcr,
  loadFieldsConfig,
  validateGuest,
  autoRegister = true,
  reconcileLinks,
  isEnabled,
  logger,
  now = () => Date.now()
}) => {
  const downloadSemaphore = new Semaphore(DOWNLOAD_CONCURRENCY);
  let timer = null;
  let inFlight = false;
  const status = { lastSyncAt: null, lastError: null, lastResult: null };

  const jstToday = () => new Date(now() + 9 * 3600000).toISOString().slice(0, 10);
  const jstDayOffset = (days) => new Date(now() + 9 * 3600000 + days * 86400000).toISOString().slice(0, 10);

  const getState = async (key) => (await getAsync(db, 'SELECT value FROM hanastay_sync_state WHERE key = ?', [key]))?.value ?? null;
  const setState = (key, value) => runAsync(db, `
    INSERT INTO hanastay_sync_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [key, String(value)]);

  const markSeen = async (codes) => {
    for (const code of codes) {
      await runAsync(db, `
        INSERT INTO hanastay_registrations (reservation_code, dirty) VALUES (?, 1)
        ON CONFLICT(reservation_code) DO UPDATE SET dirty = 1, updated_at = CURRENT_TIMESTAMP
      `, [code]);
    }
  };

  // 只拉本房源、近期在住/将住的订单；其他房源的登记永远不下载（订单号不在本库 hostex_reservations）。
  // 订单晚于登记同步进来时，dirty 仍为 1，下一轮自然补上。
  const dirtyCodesForProperty = async () => {
    const rows = await allAsync(db, `
      SELECT h.reservation_code FROM hanastay_registrations h
      JOIN hostex_reservations r ON r.reservation_code = h.reservation_code
      WHERE h.dirty = 1 AND r.status = 'accepted' AND r.property_id = ?
        AND (r.check_out_date IS NULL OR r.check_out_date >= ?)
    `, [propertyId, jstDayOffset(-ACTIVE_PAST_DAYS)]);
    return rows.map((row) => row.reservation_code);
  };

  const storeRecord = async (rec) => {
    const clean = sanitizeRecord(rec);
    if (clean.propertyId && String(clean.propertyId) !== String(propertyId)) {
      // 防御：Worker 侧订单归属与本库不一致时不落任何证件
      await runAsync(db, "UPDATE hanastay_registrations SET dirty = 0, status = 'property_mismatch', detail = NULL, updated_at = CURRENT_TIMESTAMP WHERE reservation_code = ?", [clean.code]);
      logger.warn({ reservationCode: clean.code }, 'hanastay registration property mismatch, skipped');
      return false;
    }
    const payloadJson = JSON.stringify(clean);
    const hash = crypto.createHash('sha256').update(payloadJson).digest('hex');
    await runAsync(db, `
      UPDATE hanastay_registrations
      SET dirty = 0, payload_hash = ?, payload_json = ?, fetched_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
          status = CASE WHEN status IN ('record_created', 'already_registered') THEN status ELSE 'fetched' END
      WHERE reservation_code = ?
    `, [hash, payloadJson, clean.code]);
    for (const key of clean.files) {
      await runAsync(db, `
        INSERT OR IGNORE INTO hostex_id_images (image_id, reservation_code, hostex_guest_id, source_url, source)
        VALUES (?, ?, NULL, ?, 'hanastay')
      `, [`hanastay:${key}`, clean.code, key]);
    }
    return true;
  };

  const downloadOne = async (row) => {
    const release = await downloadSemaphore.acquire();
    try {
      const { buffer, ext } = await client.downloadFile(row.source_url);
      const filename = `${crypto.randomUUID()}_passport.${ext}`;
      const target = path.resolve(uploadDir, filename);
      if (!target.startsWith(path.resolve(uploadDir) + path.sep)) throw new Error('resolved path escapes upload dir');
      await fs.writeFile(target, buffer, { flag: 'wx' });
      await runAsync(db, `
        UPDATE hostex_id_images SET filename = ?, status = 'downloaded', downloaded_at = CURRENT_TIMESTAMP, last_error = NULL
        WHERE image_id = ?
      `, [filename, row.image_id]);
      return { imageId: row.image_id, target };
    } catch (err) {
      await runAsync(db, `
        UPDATE hostex_id_images SET attempts = attempts + 1, status = 'failed', last_error = ? WHERE image_id = ?
      `, [String(err.message || err).slice(0, 500), row.image_id]);
      logger.warn({ imageId: row.image_id, err: err.message }, 'hanastay passport image download failed');
      return null;
    } finally {
      release();
    }
  };

  const ocrOne = async (downloaded) => {
    if (!runOcr || !downloaded) return;
    try {
      const result = await runOcr(downloaded.target);
      await runAsync(db, 'UPDATE hostex_id_images SET ocr_json = ? WHERE image_id = ?', [JSON.stringify(result || {}), downloaded.imageId]);
    } catch (err) {
      logger.warn({ imageId: downloaded.imageId, err: err.message }, 'hanastay passport pre-OCR failed');
    }
  };

  const setOutcome = (code, outcome, detail = null, recordId = undefined) => runAsync(db, `
    UPDATE hanastay_registrations
    SET status = ?, detail = ?, checkin_record_id = COALESCE(?, checkin_record_id), updated_at = CURRENT_TIMESTAMP
    WHERE reservation_code = ?
  `, [outcome, detail, recordId ?? null, code]);

  // 从证件照（OCR）+ 员工核录（review，按证件号对齐）组装住客。任何一项不完整都返回 reason。
  const buildGuests = (photos, clean, reservation) => {
    const today = jstToday();
    const reviewByNumber = new Map(clean.guests.filter((g) => g.no).map((g) => [normalizePassportNumber(g.no), g]));
    const guests = [];
    for (const photo of photos) {
      const ocr = photo.parsedOcr;
      if (!ocr) return { reason: 'document_not_recognized' };
      const passportNumber = normalizePassportNumber(ocr.passportNumber);
      const review = reviewByNumber.get(passportNumber);
      const name = cleanText(review?.name || ocr.fullName);
      const nationality = cleanText(ocr.nationalityCode, 8).toUpperCase();
      const age = Number.isInteger(ocr.age) ? ocr.age : ageFromBirthDate(ocr.birthDate, today);
      if (!name || !passportNumber || !/^[A-Z]{2}$/.test(nationality) || age == null) {
        return { reason: 'document_incomplete' };
      }
      // 日本国籍旅券：checkin-app 里日本居民需填电话，hanastay 没有 → 交给客人补
      if (nationality === 'JP') return { reason: 'resident_needs_phone' };
      guests.push({
        id: crypto.randomUUID(),
        name,
        isResident: false,
        age: String(age),
        nationality,
        passportNumber,
        passportPhoto: photo.filename,
        address: clean.address,
        phone: '',
        postalCode: '',
        guardianName: '',
        guardianPhone: '',
        customFields: {},
        deleted: false,
        source: 'hanastay'
      });
    }
    // 未成年人：监护人取同组第一位成年人，电话取订单预订人电话；缺任一项交给客人补
    const adult = guests.find((g) => Number(g.age) >= 18);
    let bookerPhone = '';
    try { bookerPhone = cleanText(JSON.parse(reservation.raw_json || '{}').guest_phone, 40); } catch { /* ignore */ }
    for (const guest of guests) {
      if (Number(guest.age) < 18) {
        if (!adult || !bookerPhone) return { reason: 'minor_needs_guardian' };
        guest.guardianName = adult.name;
        guest.guardianPhone = bookerPhone;
      }
    }
    return { guests };
  };

  const loadPhotos = async (code) => {
    const rows = await allAsync(db, `
      SELECT image_id, hostex_guest_id, filename, ocr_json, status, attempts FROM hostex_id_images
      WHERE reservation_code = ? AND source = 'hanastay'
    `, [code]);
    const waiting = rows.some((r) => r.status !== 'downloaded' && r.attempts < MAX_DOWNLOAD_ATTEMPTS);
    const ready = rows.filter((r) => r.status === 'downloaded' && r.filename);
    const { photos } = dedupeReservationPhotos(ready, uploadDir);
    return { waiting, photos, total: rows.length };
  };

  const evaluate = async (code) => {
    const reg = await getAsync(db, 'SELECT * FROM hanastay_registrations WHERE reservation_code = ?', [code]);
    if (!reg?.payload_json) return 'skipped';
    const reservation = await getAsync(db, "SELECT * FROM hostex_reservations WHERE reservation_code = ? AND status = 'accepted' AND property_id = ?", [code, propertyId]);
    if (!reservation) return 'skipped';
    const clean = JSON.parse(reg.payload_json);
    const { waiting, photos, total } = await loadPhotos(code);
    if (waiting) return 'waiting';
    if (!total) { await setOutcome(code, 'prefill_only', 'no_documents'); return 'prefill_only'; }

    const ownRecordId = reg.status === 'record_created' ? reg.checkin_record_id : null;
    if (reservation.checkin_record_id && reservation.checkin_record_id !== ownRecordId && reservation.checkin_link_source !== 'name_and_dates') {
      // 客人已在 checkin-app 登记过：证件照仅作预填补充，不另建记录
      await setOutcome(code, 'already_registered', null);
      return 'already_registered';
    }
    if (!autoRegister) { await setOutcome(code, 'prefill_only', 'auto_register_disabled'); return 'prefill_only'; }

    const built = buildGuests(photos, clean, reservation);
    if (built.reason) { await setOutcome(code, 'prefill_only', built.reason); return 'prefill_only'; }

    if (ownRecordId) {
      // 已由本模块建档：客人后来又在 hanastay 追加了同住人 → 只追加新证件号
      const record = await getAsync(db, 'SELECT data FROM checkins WHERE id = ?', [ownRecordId]);
      let existing = [];
      try { existing = JSON.parse(record?.data || '[]'); } catch { existing = []; }
      const known = new Set(existing.map((g) => normalizePassportNumber(g.passportNumber)));
      const additions = built.guests.filter((g) => !known.has(g.passportNumber));
      if (additions.length) {
        const config = await loadFieldsConfig();
        if (additions.some((g) => !validateGuest(g, config).valid)) return 'record_created';
        await runAsync(db, 'UPDATE checkins SET data = ? WHERE id = ?', [JSON.stringify([...existing, ...additions]), ownRecordId]);
        logger.info({ reservationCode: code, added: additions.length }, 'hanastay registration appended guests');
      }
      return 'record_created';
    }

    const expected = expectedGuests(reservation);
    if (built.guests.length < expected) {
      await setOutcome(code, 'prefill_only', `incomplete_${built.guests.length}_of_${expected}`);
      return 'prefill_only';
    }
    const config = await loadFieldsConfig();
    const invalid = built.guests.map((g) => validateGuest(g, config)).find((v) => !v.valid);
    if (invalid) { await setOutcome(code, 'prefill_only', `validation:${String(invalid.error || '').slice(0, 80)}`); return 'prefill_only'; }

    const recordId = crypto.randomUUID();
    await runAsync(db, 'INSERT INTO checkins (id, date, data, check_in, check_out) VALUES (?, ?, ?, ?, ?)', [
      recordId, jstToday(), JSON.stringify(built.guests), reservation.check_in_date, reservation.check_out_date
    ]);
    const linked = await runAsync(db, `
      UPDATE hostex_reservations
      SET checkin_record_id = ?, checkin_link_source = 'hanastay', checkin_linked_at = CURRENT_TIMESTAMP
      WHERE reservation_code = ? AND status = 'accepted'
        AND (checkin_record_id IS NULL OR checkin_link_source = 'name_and_dates')
    `, [recordId, code]);
    if (!linked.changes) {
      // 并发：期间客人在 checkin-app 自行登记了 → 撤回刚建的记录
      await runAsync(db, 'DELETE FROM checkins WHERE id = ?', [recordId]);
      await setOutcome(code, 'already_registered', null);
      return 'already_registered';
    }
    await setOutcome(code, 'record_created', null, recordId);
    logger.info({ reservationCode: code, recordId, guests: built.guests.length }, 'hanastay registration imported as check-in record');
    return 'record_created';
  };

  const syncNow = async () => {
    if (inFlight) return { skipped: true, reason: 'sync already running' };
    inFlight = true;
    const startedAt = now();
    try {
      const fullDone = (await getState('full_done')) === '1';
      const sinceMs = Number(await getState('since_ms')) || 0;
      const listed = await client.listCodes({ full: !fullDone, sinceMs });
      await markSeen(listed);

      const codes = await dirtyCodesForProperty();
      let fetched = 0;
      for (let i = 0; i < codes.length; i += GET_BATCH) {
        const batch = codes.slice(i, i + GET_BATCH);
        const records = await client.getRecords(batch);
        const returned = new Set();
        for (const rec of records) {
          if (!rec || typeof rec.code !== 'string' || !batch.includes(rec.code)) continue;
          returned.add(rec.code);
          if (rec.missing) {
            await runAsync(db, "UPDATE hanastay_registrations SET dirty = 0, status = 'missing', updated_at = CURRENT_TIMESTAMP WHERE reservation_code = ?", [rec.code]);
            continue;
          }
          if (await storeRecord(rec)) fetched += 1;
        }
        for (const code of batch) {
          if (!returned.has(code)) logger.warn({ reservationCode: code }, 'hanastay export did not return requested registration');
        }
      }

      // 游标只在 list + get 都成功后前移；留 2 分钟重叠，宁可重复也不漏
      await setState('since_ms', startedAt - 120000);
      await setState('full_done', '1');

      const pending = await allAsync(db, `
        SELECT image_id, source_url FROM hostex_id_images
        WHERE source = 'hanastay' AND status IN ('pending', 'failed') AND attempts < ?
      `, [MAX_DOWNLOAD_ATTEMPTS]);
      const downloaded = (await Promise.all(pending.map((row) => downloadOne(row)))).filter(Boolean);
      for (const item of downloaded) await ocrOne(item);

      const toEvaluate = await allAsync(db, `
        SELECT h.reservation_code FROM hanastay_registrations h
        JOIN hostex_reservations r ON r.reservation_code = h.reservation_code
        WHERE h.payload_json IS NOT NULL AND h.status IN ('fetched', 'prefill_only', 'record_created')
          AND r.status = 'accepted' AND r.property_id = ?
          AND (r.check_out_date IS NULL OR r.check_out_date >= ?)
      `, [propertyId, jstDayOffset(-ACTIVE_PAST_DAYS)]);
      const outcomes = {};
      for (const row of toEvaluate) {
        try {
          const outcome = await evaluate(row.reservation_code);
          outcomes[outcome] = (outcomes[outcome] || 0) + 1;
        } catch (err) {
          logger.warn({ reservationCode: row.reservation_code, err: err.message }, 'hanastay registration evaluation failed');
          outcomes.error = (outcomes.error || 0) + 1;
        }
      }
      if (reconcileLinks) await reconcileLinks();

      status.lastSyncAt = new Date(now()).toISOString();
      status.lastError = null;
      status.lastResult = {
        listed: listed.length,
        fetched,
        imagesDownloaded: downloaded.length,
        imagesFailed: pending.length - downloaded.length,
        outcomes,
        durationMs: now() - startedAt
      };
      logger.info(status.lastResult, 'hanastay sync completed');
      return { success: true, ...status.lastResult };
    } catch (err) {
      status.lastError = String(err.message || err);
      status.lastSyncAt = new Date(now()).toISOString();
      logger.error({ err: status.lastError }, 'hanastay sync failed');
      return { success: false, error: status.lastError };
    } finally {
      inFlight = false;
    }
  };

  const start = () => {
    if (timer) return;
    const tick = () => {
      if (typeof isEnabled === 'function' && !isEnabled()) return;
      syncNow().catch(() => {});
    };
    // 首轮稍后再跑，让 Hostex 订单同步先把订单落库
    setTimeout(tick, 30000).unref?.();
    timer = setInterval(tick, intervalMs);
    timer.unref?.();
    logger.info({ intervalMs, propertyId }, 'hanastay sync started');
  };

  const stop = () => {
    if (timer) { clearInterval(timer); timer = null; }
  };

  const getStatus = async () => {
    const byStatus = await allAsync(db, 'SELECT status, COUNT(*) AS c FROM hanastay_registrations GROUP BY status');
    const images = await allAsync(db, "SELECT status, COUNT(*) AS c FROM hostex_id_images WHERE source = 'hanastay' GROUP BY status");
    const recent = await allAsync(db, `
      SELECT h.reservation_code, h.status, h.detail, h.checkin_record_id, h.updated_at, r.check_in_date, r.check_out_date
      FROM hanastay_registrations h
      JOIN hostex_reservations r ON r.reservation_code = h.reservation_code
      WHERE r.property_id = ? AND h.payload_json IS NOT NULL
      ORDER BY r.check_in_date DESC LIMIT 30
    `, [propertyId]);
    return {
      running: inFlight,
      ...status,
      registrations: Object.fromEntries(byStatus.map((row) => [row.status, row.c])),
      images: Object.fromEntries(images.map((row) => [row.status, row.c])),
      recent
    };
  };

  return { start, stop, syncNow, getStatus, evaluate };
};

module.exports = { createHanastayClient, createHanastaySync, sniffImageExt, sanitizeRecord, ageFromBirthDate };
