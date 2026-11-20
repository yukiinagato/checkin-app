'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { runAsync, allAsync, getAsync } = require('../src/db');
const { namesMatch, createReservationReconciler, createReservationLinker } = require('../src/reservationLinks');
const logger = { info() {}, warn() {} };
const setup = async (t) => {
  const db = await new Promise((resolve, reject) => { const d = new sqlite3.Database(':memory:', (err) => err ? reject(err) : resolve(d)); });
  t.after(() => new Promise((resolve) => db.close(resolve)));
  for (const m of ['001_baseline', '003_hostex', '004_reservation_links']) await require(`../migrations/${m}`).up({ db, runAsync, allAsync });
  const reservation = (code, name = 'Alice Smith', checkIn = '2026-10-01', checkOut = '2026-10-05') => runAsync(db,
    'INSERT INTO hostex_reservations (reservation_code, guest_name, status, check_in_date, check_out_date, raw_json) VALUES (?, ?, ?, ?, ?, ?)', [code, name, 'accepted', checkIn, checkOut, '{}']);
  const record = (id, name = 'ALICE MARIE SMITH', checkIn = '2026-10-01', checkOut = '2026-10-05', deleted = false) => runAsync(db,
    'INSERT INTO checkins (id, data, check_in, check_out) VALUES (?, ?, ?, ?)', [id, JSON.stringify([{ name, deleted }]), checkIn, checkOut]);
  const state = (code) => getAsync(db, 'SELECT checkin_record_id, checkin_link_source FROM hostex_reservations WHERE reservation_code = ?', [code]);
  return { db, reservation, record, state, reconcile: createReservationReconciler({ db, allAsync, runAsync, logger }) };
};
test('name matching normalizes accents/case/spacing and supports omitted middle names only', () => {
  assert.ok(namesMatch('  Alice  Smith ', 'ALICE MARIE SMITH'));
  assert.ok(namesMatch('José García', 'JOSE GARCIA'));
  assert.ok(namesMatch('山田 太郎', '山田　太郎'));
  assert.equal(namesMatch('Alice Marie Smith', 'Alice Jane Smith'), false);
  assert.equal(namesMatch('Alice', 'Alice Smith'), false);
  assert.equal(namesMatch('', ''), false);
});
test('ordinary and historical registration reconciles without a reservation code, idempotently', async (t) => {
  const c = await setup(t);
  await c.record('record-one'); await c.reservation('RES-ONE');
  assert.equal((await c.reconcile()).linked, 1);
  assert.deepEqual(await c.state('RES-ONE'), { checkin_record_id: 'record-one', checkin_link_source: 'name_and_dates' });
  assert.equal((await c.reconcile()).linked, 0);
});
test('same name with different dates, deleted guests and cancelled bookings do not link', async (t) => {
  const c = await setup(t);
  await c.reservation('RES-ONE'); await c.record('wrong-date', undefined, '2026-10-02');
  await c.record('deleted', undefined, undefined, undefined, true);
  assert.equal((await c.reconcile()).linked, 0);
  await c.record('active');
  await runAsync(c.db, "UPDATE hostex_reservations SET status = 'cancelled'");
  assert.equal((await c.reconcile()).linked, 0);
});
test('multiple records or multiple bookings remain ambiguous, never guessed', async (t) => {
  const c = await setup(t);
  await c.reservation('RES-ONE'); await c.record('record-one'); await c.record('record-two');
  assert.equal((await c.reconcile()).ambiguous['RES-ONE'], 2);
  assert.equal((await c.state('RES-ONE')).checkin_record_id, null);
  await runAsync(c.db, 'DELETE FROM checkins WHERE id = ?', ['record-two']);
  await c.reservation('RES-TWO');
  const result = await c.reconcile();
  assert.deepEqual(result.ambiguous, { 'RES-ONE': 1, 'RES-TWO': 1 });
  assert.equal(result.linked, 0);
});
test('inferred links are removed when the stay changes, explicit links are preserved', async (t) => {
  const c = await setup(t);
  await c.reservation('RES-ONE'); await c.record('record-one'); await c.reconcile();
  await runAsync(c.db, "UPDATE hostex_reservations SET check_out_date = '2026-10-06'");
  assert.equal((await c.reconcile()).cleared, 1);
  assert.equal((await c.state('RES-ONE')).checkin_record_id, null);
  await runAsync(c.db, "UPDATE hostex_reservations SET checkin_record_id = 'record-one', checkin_link_source = 'reservation_code'");
  await c.reconcile();
  assert.equal((await c.state('RES-ONE')).checkin_record_id, 'record-one');
});
test('explicitly owned records are not assigned to another booking', async (t) => {
  const c = await setup(t);
  await c.reservation('RES-OWNER', 'Other Name'); await c.reservation('RES-ONE'); await c.record('record-one');
  await runAsync(c.db, "UPDATE hostex_reservations SET checkin_record_id = 'record-one', checkin_link_source = 'reservation_code' WHERE reservation_code = 'RES-OWNER'");
  const result = await c.reconcile();
  assert.equal(result.linked, 0); assert.equal(result.ambiguous['RES-ONE'], 1);
});
test('explicit code link takes precedence over an inferred link and checks dates', async (t) => {
  const c = await setup(t);
  await c.reservation('RES-ONE'); await c.record('record-one'); await c.reconcile();
  await c.record('record-two', 'Different Guest');
  const link = createReservationLinker({ db: c.db, runAsync, getAsync, logger });
  assert.ok(await link('RES-ONE', 'record-two'));
  assert.equal((await c.state('RES-ONE')).checkin_link_source, 'reservation_code');
  await c.record('wrong-date', 'Different Guest', '2026-11-01');
  assert.equal(await link('RES-ONE', 'wrong-date'), false);
});
