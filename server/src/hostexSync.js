'use strict';

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { Semaphore } = require('./semaphore');

const DOWNLOAD_CONCURRENCY = 2;
const MAX_DOWNLOAD_ATTEMPTS = 5;

const normalizeGuestName = (name) => String(name || '')
  .toLowerCase()
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim();

// 去重已下载的证件照片行（客人可能把同一本护照传两次）。
// 一级键：OCR 出的护照号（保留 confidence 更高的一张）；
// 二级键：OCR 无护照号时按文件 MD5 精确去重。
// 返回按「有 OCR 者在前、其中按年龄降序（成年人优先）」排序的行。
const dedupeReservationPhotos = (rows, uploadDir) => {
  const crypto = require('crypto');
  const parsed = rows.map((row) => {
    let ocr = null;
    try {
      const data = row.ocr_json ? JSON.parse(row.ocr_json) : null;
      if (data?.isPassport) ocr = data;
    } catch { /* 損壞的 OCR 快取視同未識別 */ }
    return { row, ocr };
  });

  const byPassportNumber = new Map();
  const byMd5 = new Map();
  let duplicatesRemoved = 0;

  const kept = [];
  for (const item of parsed) {
    const passportNumber = item.ocr?.passportNumber || '';
    if (passportNumber) {
      const existing = byPassportNumber.get(passportNumber);
      if (existing) {
        duplicatesRemoved += 1;
        if ((item.ocr.confidence || 0) > (existing.ocr.confidence || 0)) {
          kept[kept.indexOf(existing)] = item;
          byPassportNumber.set(passportNumber, item);
        }
        continue;
      }
      byPassportNumber.set(passportNumber, item);
      kept.push(item);
      continue;
    }

    let md5 = null;
    try {
      const filePath = path.resolve(uploadDir, path.basename(item.row.filename));
      md5 = crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
    } catch { /* 讀不到檔案時不去重，寧可多顯示一張 */ }
    if (md5) {
      if (byMd5.has(md5)) {
        duplicatesRemoved += 1;
        continue;
      }
      byMd5.set(md5, item);
    }
    kept.push(item);
  }

  kept.sort((a, b) => {
    if (Boolean(a.ocr) !== Boolean(b.ocr)) return a.ocr ? -1 : 1;
    return (b.ocr?.age ?? -1) - (a.ocr?.age ?? -1);
  });

  return {
    photos: kept.map((item) => ({ ...item.row, parsedOcr: item.ocr })),
    duplicatesRemoved
  };
};

const toDateString = (date) => date.toISOString().slice(0, 10);

const createHostexSync = ({
  db,
  runAsync,
  allAsync,
  getAsync,
  client,
  uploadDir,
  propertyId,
  pastDays,
  futureDays,
  intervalMs,
  runOcr,
  isEnabled,
  reconcileLinks,
  logger
}) => {
  const downloadSemaphore = new Semaphore(DOWNLOAD_CONCURRENCY);
  let timer = null;
  let inFlight = false;
  const status = {
    lastSyncAt: null,
    lastError: null,
    lastResult: null
  };

  const upsertReservation = async (r) => {
    await runAsync(db, `
      INSERT INTO hostex_reservations (
        reservation_code, stay_code, property_id, channel_type, status,
        check_in_date, check_out_date, guest_name, guest_name_norm,
        number_of_adults, number_of_children, number_of_pets,
        booked_at, raw_json, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(reservation_code) DO UPDATE SET
        stay_code = excluded.stay_code,
        property_id = excluded.property_id,
        channel_type = excluded.channel_type,
        status = excluded.status,
        check_in_date = excluded.check_in_date,
        check_out_date = excluded.check_out_date,
        guest_name = excluded.guest_name,
        guest_name_norm = excluded.guest_name_norm,
        number_of_adults = excluded.number_of_adults,
        number_of_children = excluded.number_of_children,
        number_of_pets = excluded.number_of_pets,
        booked_at = excluded.booked_at,
        raw_json = excluded.raw_json,
        last_synced_at = CURRENT_TIMESTAMP
    `, [
      r.reservation_code,
      r.stay_code || null,
      r.property_id ?? null,
      r.channel_type || null,
      r.status || 'unknown',
      r.check_in_date,
      r.check_out_date || null,
      r.guest_name || null,
      normalizeGuestName(r.guest_name),
      r.number_of_adults ?? null,
      r.number_of_children ?? null,
      r.number_of_pets ?? null,
      r.booked_at || null,
      JSON.stringify(r)
    ]);
  };

  // 图片两处收割：guests[].id_images（有客人归属）与 checkin_guide_images（订单级）。
  // 实测客人经 Hostex 上传的护照落在后者。
  const harvestImages = async (r) => {
    const rows = [];
    for (const guest of r.guests || []) {
      for (const img of guest.id_images || []) {
        if (img?.id && img?.url) {
          rows.push({ imageId: `idimg:${img.id}`, guestId: String(guest.id ?? ''), url: img.url });
        }
      }
    }
    for (const img of r.checkin_guide_images || []) {
      if (img?.id && img?.url) {
        rows.push({ imageId: `guide:${img.id}`, guestId: null, url: img.url });
      }
    }
    for (const row of rows) {
      await runAsync(db, `
        INSERT OR IGNORE INTO hostex_id_images (image_id, reservation_code, hostex_guest_id, source_url)
        VALUES (?, ?, ?, ?)
      `, [row.imageId, r.reservation_code, row.guestId, row.url]);
    }
  };

  const downloadOne = async (row) => {
    const release = await downloadSemaphore.acquire();
    try {
      const { buffer, ext } = await client.downloadImage(row.source_url);
      const filename = `${crypto.randomUUID()}_passport.${ext}`;
      const target = path.resolve(uploadDir, filename);
      if (!target.startsWith(path.resolve(uploadDir) + path.sep)) {
        throw new Error('resolved path escapes upload dir');
      }
      await fs.writeFile(target, buffer, { flag: 'wx' });
      await runAsync(db, `
        UPDATE hostex_id_images
        SET filename = ?, status = 'downloaded', downloaded_at = CURRENT_TIMESTAMP, last_error = NULL
        WHERE image_id = ?
      `, [filename, row.image_id]);
      logger.info({ imageId: row.image_id, filename }, 'hostex passport image downloaded');
      return { imageId: row.image_id, filename, target };
    } catch (err) {
      await runAsync(db, `
        UPDATE hostex_id_images
        SET attempts = attempts + 1, status = 'failed', last_error = ?
        WHERE image_id = ?
      `, [String(err.message || err).slice(0, 500), row.image_id]);
      logger.warn({ imageId: row.image_id, err: err.message }, 'hostex passport image download failed');
      return null;
    } finally {
      release();
    }
  };

  // 下载完成后在后台预跑 OCR，客人到店选照片时护照号等信息即时可用。
  const ocrOne = async (downloaded) => {
    if (!runOcr || !downloaded) return;
    try {
      const result = await runOcr(downloaded.target);
      await runAsync(db, 'UPDATE hostex_id_images SET ocr_json = ? WHERE image_id = ?', [
        JSON.stringify(result || {}),
        downloaded.imageId
      ]);
    } catch (err) {
      logger.warn({ imageId: downloaded.imageId, err: err.message }, 'hostex passport pre-OCR failed');
    }
  };

  const syncNow = async () => {
    if (inFlight) return { skipped: true, reason: 'sync already running' };
    inFlight = true;
    const startedAt = Date.now();
    try {
      const now = new Date();
      const from = toDateString(new Date(now.getTime() - pastDays * 86400000));
      const to = toDateString(new Date(now.getTime() + futureDays * 86400000));

      const reservations = await client.listAllReservations({
        property_id: String(propertyId),
        start_check_in_date: from,
        end_check_in_date: to
      });

      let upserted = 0;
      for (const r of reservations) {
        if (!r?.reservation_code || !r?.check_in_date) continue;
        // 防御：即使 API 侧过滤失效也绝不混入其他房源
        if (String(r.property_id) !== String(propertyId)) continue;
        await upsertReservation(r);
        await harvestImages(r);
        upserted += 1;
      }

      if (reconcileLinks) await reconcileLinks();

      const pending = await allAsync(db, `
        SELECT image_id, reservation_code, source_url FROM hostex_id_images
        WHERE status IN ('pending', 'failed') AND attempts < ?
          AND COALESCE(source, 'hostex') = 'hostex'
      `, [MAX_DOWNLOAD_ATTEMPTS]);

      const downloaded = (await Promise.all(pending.map((row) => downloadOne(row)))).filter(Boolean);

      // OCR 串行跑（其内部有自己的并发闸），避免与到店客人的实时 OCR 抢资源
      for (const item of downloaded) {
        await ocrOne(item);
      }

      status.lastSyncAt = new Date().toISOString();
      status.lastError = null;
      status.lastResult = {
        reservations: upserted,
        imagesDownloaded: downloaded.length,
        imagesPending: pending.length - downloaded.length,
        durationMs: Date.now() - startedAt
      };
      logger.info({ ...status.lastResult }, 'hostex sync completed');
      return { success: true, ...status.lastResult };
    } catch (err) {
      status.lastError = String(err.message || err);
      status.lastSyncAt = new Date().toISOString();
      logger.error({ err: status.lastError }, 'hostex sync failed');
      return { success: false, error: status.lastError };
    } finally {
      inFlight = false;
    }
  };

  const start = () => {
    if (timer) return;
    if (typeof isEnabled === 'function' && !isEnabled()) {
      logger.info('hostex sync disabled by settings, not starting');
      return;
    }
    // 启动先跑一次，之后按间隔轮询
    syncNow().catch(() => {});
    timer = setInterval(() => {
      if (typeof isEnabled === 'function' && !isEnabled()) return;
      syncNow().catch(() => {});
    }, intervalMs);
    timer.unref?.();
    logger.info({ intervalMs, propertyId }, 'hostex sync started');
  };

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const getStatus = async () => {
    const resCount = await getAsync(db, 'SELECT COUNT(*) AS c FROM hostex_reservations');
    const imgStats = await allAsync(db, 'SELECT status, COUNT(*) AS c FROM hostex_id_images GROUP BY status');
    return {
      running: inFlight,
      lastSyncAt: status.lastSyncAt,
      lastError: status.lastError,
      lastResult: status.lastResult,
      reservationCount: resCount?.c ?? 0,
      images: Object.fromEntries(imgStats.map((row) => [row.status, row.c]))
    };
  };

  return { start, stop, syncNow, getStatus, normalizeGuestName };
};

module.exports = { createHostexSync, normalizeGuestName, dedupeReservationPhotos };
