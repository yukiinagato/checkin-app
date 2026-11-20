'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const sqlite3 = require('sqlite3');

const { createHanastaySync, createHanastayClient, sniffImageExt, ageFromBirthDate } = require('../src/hanastaySync');
const { runAsync, allAsync, getAsync } = require('../src/db');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
const PROPERTY_ID = '12479377';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const NOW = Date.parse('2026-11-20T03:00:00Z');

const openDb = async () => {
  const db = await new Promise((resolve, reject) => {
    const d = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(d)));
  });
  for (const m of ['001_baseline', '003_hostex', '004_reservation_links', '006_reservation_selections', '008_hanastay']) {
    await require(`../migrations/${m}`).up({ db, runAsync, allAsync });
  }
  return db;
};

const addReservation = (db, code, { adults = 2, propertyId = PROPERTY_ID, checkIn = '2026-11-20', checkOut = '2026-11-22', phone = '+8613800000000' } = {}) =>
  runAsync(db, `INSERT INTO hostex_reservations (reservation_code, property_id, status, check_in_date, check_out_date, guest_name, number_of_adults, number_of_children, raw_json)
    VALUES (?, ?, 'accepted', ?, ?, 'Li Wei', ?, 0, ?)`, [code, propertyId, checkIn, checkOut, adults, JSON.stringify({ guest_phone: phone })]);

const passports = {
  'K1/a.jpg': { isPassport: true, passportNumber: 'E12345678', fullName: 'LI WEI', nationalityCode: 'CN', age: 34, confidence: 0.9 },
  'K1/b.jpg': { isPassport: true, passportNumber: 'E87654321', fullName: 'WANG FANG', nationalityCode: 'CN', birthDate: '1990-01-01', confidence: 0.9 }
};

const makeSync = async ({ records, listed, ocrByKey = passports, validateGuest } = {}) => {
  const db = await openDb();
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hanastay-test-'));
  const calls = { get: [], files: [] };
  const client = {
    listCodes: async () => listed,
    getRecords: async (codes) => { calls.get.push(codes); return records.filter((r) => codes.includes(r.code)); },
    downloadFile: async (key) => { calls.files.push(key); return { buffer: Buffer.concat([JPEG, Buffer.from(key)]), ext: 'jpeg' }; }
  };
  const sync = createHanastaySync({
    db, runAsync, allAsync, getAsync, client, uploadDir, propertyId: PROPERTY_ID, intervalMs: 600000,
    runOcr: async (target) => {
      const rows = await allAsync(db, "SELECT source_url, filename FROM hostex_id_images WHERE source = 'hanastay'");
      const row = rows.find((r) => r.filename && target.endsWith(r.filename));
      return ocrByKey[row?.source_url] || { isPassport: false };
    },
    loadFieldsConfig: async () => ({}),
    validateGuest: validateGuest || ((g) => ({ valid: Boolean(g.name && /_passport\.[a-z]+$/.test(g.passportPhoto)) })),
    logger: silentLogger,
    now: () => NOW
  });
  return { db, sync, calls, uploadDir };
};

test('完整登记：只拉本房源订单，证件落盘+建档+关联订单', async () => {
  const records = [{ code: 'K1', resv: { property_id: 12479377 }, address: '上海市 浦东新区', arrival: '16:00', files: ['K1/a.jpg', 'K1/b.jpg'], guests: [{ name: 'Li Wei', nat: 'CN', no: 'E12345678' }] }];
  const { db, sync, calls, uploadDir } = await makeSync({ records, listed: ['K1', 'OTHER1'] });
  await addReservation(db, 'K1');
  await addReservation(db, 'OTHER1', { propertyId: '999' });

  const result = await sync.syncNow();
  assert.equal(result.success, true);
  assert.deepEqual(calls.get, [['K1']], '其他房源的订单绝不请求');
  assert.deepEqual(calls.files.sort(), ['K1/a.jpg', 'K1/b.jpg']);

  const res = await getAsync(db, 'SELECT checkin_record_id, checkin_link_source FROM hostex_reservations WHERE reservation_code = ?', ['K1']);
  assert.equal(res.checkin_link_source, 'hanastay');
  const record = await getAsync(db, 'SELECT * FROM checkins WHERE id = ?', [res.checkin_record_id]);
  assert.equal(record.check_in, '2026-11-20');
  const guests = JSON.parse(record.data);
  assert.equal(guests.length, 2);
  const li = guests.find((g) => g.passportNumber === 'E12345678');
  assert.equal(li.name, 'Li Wei', '员工核录姓名优先于 OCR');
  assert.equal(li.nationality, 'CN');
  assert.equal(li.address, '上海市 浦东新区');
  assert.equal(guests.find((g) => g.passportNumber === 'E87654321').age, '36', '无 age 时按出生日期计算');
  for (const g of guests) assert.ok(await fs.pathExists(path.join(uploadDir, g.passportPhoto)));

  const reg = await getAsync(db, 'SELECT status FROM hanastay_registrations WHERE reservation_code = ?', ['K1']);
  assert.equal(reg.status, 'record_created');

  // 再跑一轮：幂等，不重复建档、不重下图片
  calls.files.length = 0;
  await sync.syncNow();
  assert.equal((await allAsync(db, 'SELECT id FROM checkins')).length, 1);
  assert.equal(calls.files.length, 0);
});

test('人数不足：只做预填，不建档', async () => {
  const records = [{ code: 'K1', files: ['K1/a.jpg'], guests: [] }];
  const { db, sync } = await makeSync({ records, listed: ['K1'] });
  await addReservation(db, 'K1', { adults: 2 });
  await sync.syncNow();
  assert.equal((await allAsync(db, 'SELECT id FROM checkins')).length, 0);
  const reg = await getAsync(db, 'SELECT status, detail FROM hanastay_registrations WHERE reservation_code = ?', ['K1']);
  assert.equal(reg.status, 'prefill_only');
  assert.equal(reg.detail, 'incomplete_1_of_2');
  const img = await getAsync(db, "SELECT status, ocr_json FROM hostex_id_images WHERE source = 'hanastay'");
  assert.equal(img.status, 'downloaded');
  assert.ok(JSON.parse(img.ocr_json).isPassport, '预跑 OCR 供到店预填');
});

test('证件无法识别（如在留卡）：只做预填', async () => {
  const records = [{ code: 'K1', files: ['K1/a.jpg'], guests: [] }];
  const { db, sync } = await makeSync({ records, listed: ['K1'], ocrByKey: {} });
  await addReservation(db, 'K1', { adults: 1 });
  await sync.syncNow();
  const reg = await getAsync(db, 'SELECT status, detail FROM hanastay_registrations WHERE reservation_code = ?', ['K1']);
  assert.deepEqual([reg.status, reg.detail], ['prefill_only', 'document_not_recognized']);
});

test('客人已在 checkin-app 登记：不另建记录', async () => {
  const records = [{ code: 'K1', files: ['K1/a.jpg', 'K1/b.jpg'], guests: [] }];
  const { db, sync } = await makeSync({ records, listed: ['K1'] });
  await addReservation(db, 'K1');
  await runAsync(db, "INSERT INTO checkins (id, data, check_in, check_out) VALUES ('own', '[]', '2026-11-20', '2026-11-22')");
  await runAsync(db, "UPDATE hostex_reservations SET checkin_record_id = 'own', checkin_link_source = 'reservation_code'");
  await sync.syncNow();
  assert.equal((await allAsync(db, 'SELECT id FROM checkins')).length, 1);
  const res = await getAsync(db, 'SELECT checkin_record_id FROM hostex_reservations');
  assert.equal(res.checkin_record_id, 'own');
  assert.equal((await getAsync(db, 'SELECT status FROM hanastay_registrations')).status, 'already_registered');
});

test('未成年人用同组成年人+预订人电话作监护人；无电话则只预填', async () => {
  const ocr = { ...passports, 'K1/b.jpg': { ...passports['K1/b.jpg'], birthDate: '2015-05-05' } };
  const records = [{ code: 'K1', files: ['K1/a.jpg', 'K1/b.jpg'], guests: [] }];
  const { db, sync } = await makeSync({ records, listed: ['K1'], ocrByKey: ocr });
  await addReservation(db, 'K1');
  await sync.syncNow();
  const guests = JSON.parse((await getAsync(db, 'SELECT data FROM checkins')).data);
  const minor = guests.find((g) => g.passportNumber === 'E87654321');
  assert.equal(minor.guardianName, 'LI WEI');
  assert.equal(minor.guardianPhone, '+8613800000000');

  const second = await makeSync({ records, listed: ['K1'], ocrByKey: ocr });
  await addReservation(second.db, 'K1', { phone: '' });
  await second.sync.syncNow();
  assert.equal((await getAsync(second.db, 'SELECT detail FROM hanastay_registrations')).detail, 'minor_needs_guardian');
});

test('订单晚于登记同步进来时，下一轮补拉', async () => {
  const records = [{ code: 'K1', files: ['K1/a.jpg'], guests: [] }];
  const { db, sync, calls } = await makeSync({ records, listed: ['K1'] });
  await sync.syncNow();
  assert.equal(calls.get.length, 0);
  await addReservation(db, 'K1', { adults: 1 });
  await sync.syncNow();
  assert.deepEqual(calls.get, [['K1']]);
  assert.equal((await getAsync(db, 'SELECT status FROM hanastay_registrations')).status, 'record_created');
});

test('Worker 侧房源不一致：不落证件', async () => {
  const records = [{ code: 'K1', resv: { property_id: 555 }, files: ['K1/a.jpg'], guests: [] }];
  const { db, sync, calls } = await makeSync({ records, listed: ['K1'] });
  await addReservation(db, 'K1', { adults: 1 });
  await sync.syncNow();
  assert.equal(calls.files.length, 0);
  assert.equal((await getAsync(db, 'SELECT status FROM hanastay_registrations')).status, 'property_mismatch');
});

test('校验不通过：只预填并记录原因', async () => {
  const records = [{ code: 'K1', files: ['K1/a.jpg'], guests: [] }];
  const { db, sync } = await makeSync({ records, listed: ['K1'], validateGuest: () => ({ valid: false, error: 'Custom field "x" is required' }) });
  await addReservation(db, 'K1', { adults: 1 });
  await sync.syncNow();
  const reg = await getAsync(db, 'SELECT status, detail FROM hanastay_registrations');
  assert.equal(reg.status, 'prefill_only');
  assert.match(reg.detail, /^validation:/);
});

test('HTTP 客户端：带 X-Auth，拒绝非图片文件', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.includes('/reg/file')) {
      const body = url.includes('evil') ? Buffer.from('<html>') : JPEG;
      return new Response(body, { status: 200, headers: { 'content-type': url.includes('evil') ? 'image/jpeg' : 'application/octet-stream' } });
    }
    return new Response(JSON.stringify({ items: [{ code: 'K1000' }, { code: '../bad' }, 'K2000'] }), { status: 200 });
  };
  const client = createHanastayClient({ baseUrl: 'https://w.example/', token: 'secret', userAgent: 'ua', logger: silentLogger, fetchImpl });
  assert.deepEqual(await client.listCodes({ full: false, sinceMs: 5 }), ['K1000', 'K2000']);
  assert.equal(seen[0].url, 'https://w.example/reg/export');
  assert.equal(seen[0].init.headers['X-Auth'], 'secret');
  assert.deepEqual(JSON.parse(seen[0].init.body), { op: 'list', full: false, since_ms: 5 });
  assert.equal((await client.downloadFile('K1/a b.jpg')).ext, 'jpeg');
  assert.ok(seen[1].url.endsWith('/reg/file?key=K1%2Fa%20b.jpg'));
  await assert.rejects(client.downloadFile('evil.jpg'), /not a supported image/);
});

test('sniffImageExt / ageFromBirthDate', () => {
  assert.equal(sniffImageExt(JPEG), 'jpeg');
  assert.equal(sniffImageExt(Buffer.from('GIF89a')), null);
  assert.equal(ageFromBirthDate('1990-11-21', '2026-11-20'), 35);
  assert.equal(ageFromBirthDate('1990-11-20', '2026-11-20'), 36);
  assert.equal(ageFromBirthDate('bad', '2026-11-20'), null);
});
