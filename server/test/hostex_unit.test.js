'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const sqlite3 = require('sqlite3');

const { normalizeImageUrl } = require('../src/hostex');
const { createHostexSync, normalizeGuestName, dedupeReservationPhotos } = require('../src/hostexSync');
const { runAsync, allAsync, getAsync } = require('../src/db');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

const openMemoryDb = () => new Promise((resolve, reject) => {
  const db = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(db)));
});

const createSchema = async (db) => {
  const migration = require('../migrations/003_hostex');
  await migration.up({ db, runAsync });
};

test('normalizeImageUrl 剥掉 OSS 水印参数、保留原图 URL', () => {
  const watermarked = 'https://image.myhostex.com/UCO177.jpg?x-oss-process=image/resize,m_mfit,w_500/watermark,text_abc';
  assert.equal(normalizeImageUrl(watermarked), 'https://image.myhostex.com/UCO177.jpg');
  assert.equal(normalizeImageUrl('https://image.myhostex.com/a.jpg'), 'https://image.myhostex.com/a.jpg');
  assert.equal(normalizeImageUrl('not a url'), 'not a url');
});

test('normalizeGuestName 折叠空白并小写化', () => {
  assert.equal(normalizeGuestName('  Daina   LINDEMAN '), 'daina lindeman');
  assert.equal(normalizeGuestName(null), '');
});

test('订单 upsert 保留 checkin_record_id 与 first_synced_at', async () => {
  const db = await openMemoryDb();
  await createSchema(db);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hostex-test-'));
  const sync = createHostexSync({
    db, runAsync, allAsync, getAsync,
    client: { listAllReservations: async () => [], downloadImage: async () => { throw new Error('n/a'); } },
    uploadDir: tmpDir, propertyId: '12479377',
    pastDays: 7, futureDays: 60, intervalMs: 600000,
    logger: silentLogger
  });

  const reservation = {
    reservation_code: 'TEST-001', stay_code: 'TEST-001', property_id: 12479377,
    channel_type: 'airbnb', status: 'accepted',
    check_in_date: '2026-08-10', check_out_date: '2026-08-12',
    guest_name: 'Test Guest', number_of_adults: 2, guests: [], checkin_guide_images: []
  };

  // 借 syncNow 的内部路径太绕，直接测公开行为：两次同步之间人工写入关联
  const fakeClient = { listAllReservations: async () => [reservation], downloadImage: async () => { throw new Error('n/a'); } };
  const sync2 = createHostexSync({
    db, runAsync, allAsync, getAsync, client: fakeClient,
    uploadDir: tmpDir, propertyId: '12479377',
    pastDays: 7, futureDays: 60, intervalMs: 600000, logger: silentLogger
  });

  await sync2.syncNow();
  await runAsync(db, "UPDATE hostex_reservations SET checkin_record_id = 'record-abc' WHERE reservation_code = 'TEST-001'");

  reservation.status = 'cancelled';
  await sync2.syncNow();

  const row = await getAsync(db, "SELECT status, checkin_record_id FROM hostex_reservations WHERE reservation_code = 'TEST-001'");
  assert.equal(row.status, 'cancelled', '同步应更新状态');
  assert.equal(row.checkin_record_id, 'record-abc', '同步不得覆盖已建立的登记关联');

  await fs.remove(tmpDir);
  void sync;
});

test('非本房源的订单被拒收', async () => {
  const db = await openMemoryDb();
  await createSchema(db);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hostex-test-'));

  const foreign = {
    reservation_code: 'OTHER-001', property_id: 99999, status: 'accepted',
    check_in_date: '2026-08-10', guests: [], checkin_guide_images: []
  };
  const sync = createHostexSync({
    db, runAsync, allAsync, getAsync,
    client: { listAllReservations: async () => [foreign], downloadImage: async () => { throw new Error('n/a'); } },
    uploadDir: tmpDir, propertyId: '12479377',
    pastDays: 7, futureDays: 60, intervalMs: 600000, logger: silentLogger
  });
  await sync.syncNow();

  const count = await getAsync(db, 'SELECT COUNT(*) AS c FROM hostex_reservations');
  assert.equal(count.c, 0);
  await fs.remove(tmpDir);
});

test('checkin_guide_images 与 guests[].id_images 都被收割且带来源前缀', async () => {
  const db = await openMemoryDb();
  await createSchema(db);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hostex-test-'));

  const reservation = {
    reservation_code: 'IMG-001', property_id: 12479377, status: 'accepted',
    check_in_date: '2026-08-10',
    guests: [{ id: 42, id_images: [{ id: 100, url: 'https://image.myhostex.com/a.jpg' }] }],
    checkin_guide_images: [{ id: 200, client_id: null, url: 'https://image.myhostex.com/b.jpg' }]
  };
  // downloadImage 永远失败：只验证收割入库，不验证下载
  const sync = createHostexSync({
    db, runAsync, allAsync, getAsync,
    client: { listAllReservations: async () => [reservation], downloadImage: async () => { throw new Error('offline'); } },
    uploadDir: tmpDir, propertyId: '12479377',
    pastDays: 7, futureDays: 60, intervalMs: 600000, logger: silentLogger
  });
  await sync.syncNow();

  const rows = await allAsync(db, 'SELECT image_id, hostex_guest_id, status FROM hostex_id_images ORDER BY image_id');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].image_id, 'guide:200');
  assert.equal(rows[0].hostex_guest_id, null);
  assert.equal(rows[1].image_id, 'idimg:100');
  assert.equal(rows[1].hostex_guest_id, '42');
  // 下载失败被记录为 failed 且 attempts 递增
  assert.ok(rows.every((r) => r.status === 'failed'));

  await sync.syncNow();
  const attempts = await getAsync(db, "SELECT attempts FROM hostex_id_images WHERE image_id = 'guide:200'");
  assert.equal(attempts.attempts, 2);

  await fs.remove(tmpDir);
});

test('dedupeReservationPhotos：同护照号去重并保留高置信度', () => {
  const rows = [
    { image_id: 'a', filename: 'a.jpg', ocr_json: JSON.stringify({ isPassport: true, passportNumber: 'X1', confidence: 0.8, age: 40 }) },
    { image_id: 'b', filename: 'b.jpg', ocr_json: JSON.stringify({ isPassport: true, passportNumber: 'X1', confidence: 0.99, age: 40 }) },
    { image_id: 'c', filename: 'c.jpg', ocr_json: JSON.stringify({ isPassport: true, passportNumber: 'Y2', confidence: 0.9, age: 5 }) }
  ];
  const { photos, duplicatesRemoved } = dedupeReservationPhotos(rows, '/nonexistent');
  assert.equal(duplicatesRemoved, 1);
  assert.equal(photos.length, 2);
  assert.equal(photos[0].image_id, 'b', '同号保留 confidence 更高的一张');
  assert.equal(photos[0].parsedOcr.passportNumber, 'X1');
});

test('dedupeReservationPhotos：成年人排前、未识别排最后、同MD5去重', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dedupe-test-'));
  await fs.writeFile(path.join(tmpDir, 'dup1.jpg'), Buffer.from('same-bytes'));
  await fs.writeFile(path.join(tmpDir, 'dup2.jpg'), Buffer.from('same-bytes'));
  await fs.writeFile(path.join(tmpDir, 'other.jpg'), Buffer.from('different'));

  const rows = [
    { image_id: 'kid', filename: 'k.jpg', ocr_json: JSON.stringify({ isPassport: true, passportNumber: 'K1', age: 3 }) },
    { image_id: 'blur1', filename: 'dup1.jpg', ocr_json: null },
    { image_id: 'blur2', filename: 'dup2.jpg', ocr_json: null },
    { image_id: 'blur3', filename: 'other.jpg', ocr_json: JSON.stringify({ isPassport: false }) },
    { image_id: 'adult', filename: 'a.jpg', ocr_json: JSON.stringify({ isPassport: true, passportNumber: 'A1', age: 38 }) }
  ];
  const { photos, duplicatesRemoved } = dedupeReservationPhotos(rows, tmpDir);
  assert.equal(duplicatesRemoved, 1, '同 MD5 的未识别照片去掉一张');
  assert.deepEqual(photos.map((p) => p.image_id), ['adult', 'kid', 'blur1', 'blur3']);
  await fs.remove(tmpDir);
});
