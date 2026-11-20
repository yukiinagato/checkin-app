'use strict';

const normalizeName = (value) => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const namesMatch = (a, b) => {
  const left = normalizeName(a), right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const x = left.split(' '), y = right.split(' ');
  // A booking often omits passport middle names. Conflicting middle names do not match.
  return Math.min(x.length, y.length) === 2 && Math.max(x.length, y.length) > 2
    && x[0] === y[0] && x.at(-1) === y.at(-1);
};
const activeGuests = (record) => {
  try {
    const guests = JSON.parse(record.data || '[]');
    return Array.isArray(guests) ? guests.filter((g) => g && !g.deleted) : [];
  } catch { return []; }
};

const createReservationLinker = ({ db, getAsync, runAsync, logger }) => async (code, recordId) => {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(code) || !recordId) return false;
  try {
    const record = await getAsync(db, 'SELECT check_in, check_out, data FROM checkins WHERE id = ?', [recordId]);
    if (!record?.check_in || !record?.check_out || !activeGuests(record).length) return false;
    const result = await runAsync(db, `
      UPDATE hostex_reservations
      SET checkin_record_id = ?, checkin_link_source = 'reservation_code', checkin_linked_at = CURRENT_TIMESTAMP
      WHERE reservation_code = ? AND status = 'accepted'
        AND check_in_date = ? AND check_out_date = ?
        AND (checkin_record_id IS NULL OR checkin_record_id = ? OR checkin_link_source = 'name_and_dates')
    `, [recordId, code, record.check_in, record.check_out, recordId]);
    return result.changes > 0;
  } catch (err) {
    logger.warn({ err: err.message }, 'failed to link hostex reservation');
    return false;
  }
};

const createReservationReconciler = ({ db, allAsync, runAsync, logger }) => {
  let pending = null;
  const reconcile = async () => {
    const reservations = await allAsync(db, 'SELECT reservation_code, status, guest_name, check_in_date, check_out_date, checkin_record_id, checkin_link_source FROM hostex_reservations');
    const records = (await allAsync(db, 'SELECT id, check_in, check_out, data FROM checkins')).map((r) => ({ ...r, guests: activeGuests(r) }));
    const byStay = new Map();
    for (const r of records) {
      if (!r.check_in || !r.check_out || !r.guests.length) continue;
      const key = `${r.check_in}/${r.check_out}`;
      if (!byStay.has(key)) byStay.set(key, []);
      byStay.get(key).push(r);
    }
    const candidates = new Map();
    const reservationsByRecord = new Map();
    const explicitOwners = new Map();
    for (const r of reservations) {
      if (r.checkin_record_id && r.checkin_link_source !== 'name_and_dates') {
        if (!explicitOwners.has(r.checkin_record_id)) explicitOwners.set(r.checkin_record_id, new Set());
        explicitOwners.get(r.checkin_record_id).add(r.reservation_code);
      }
      const matches = r.status === 'accepted' ? (byStay.get(`${r.check_in_date}/${r.check_out_date}`) || [])
        .filter((record) => record.guests.some((g) => namesMatch(r.guest_name, g.name))) : [];
      candidates.set(r.reservation_code, matches);
      for (const record of matches) {
        if (!reservationsByRecord.has(record.id)) reservationsByRecord.set(record.id, new Set());
        reservationsByRecord.get(record.id).add(r.reservation_code);
      }
    }
    let linked = 0, cleared = 0;
    const ambiguous = {};
    for (const r of reservations) {
      // Never replace a link explicitly supplied by a guest or created by older versions.
      if (r.checkin_record_id && r.checkin_link_source !== 'name_and_dates') continue;
      const matches = candidates.get(r.reservation_code);
      const match = matches.length === 1 ? matches[0] : null;
      const owners = match && explicitOwners.get(match.id);
      const unique = match && reservationsByRecord.get(match.id).size === 1
        && (!owners || (owners.size === 1 && owners.has(r.reservation_code)));
      if (!unique && matches.length) ambiguous[r.reservation_code] = matches.length;
      if (unique && r.checkin_record_id === match.id) continue;
      if (r.checkin_link_source === 'name_and_dates' && r.checkin_record_id) {
        const result = await runAsync(db, `UPDATE hostex_reservations SET checkin_record_id = NULL, checkin_link_source = NULL, checkin_linked_at = NULL
          WHERE reservation_code = ? AND checkin_link_source = 'name_and_dates' AND checkin_record_id = ?`, [r.reservation_code, r.checkin_record_id]);
        cleared += result.changes;
      }
      if (unique) {
        const result = await runAsync(db, `UPDATE hostex_reservations SET checkin_record_id = ?, checkin_link_source = 'name_and_dates', checkin_linked_at = CURRENT_TIMESTAMP
          WHERE reservation_code = ? AND checkin_record_id IS NULL`, [match.id, r.reservation_code]);
        linked += result.changes;
      }
    }
    if (linked || cleared) logger.info({ linked, cleared }, 'hostex registration links reconciled');
    return { linked, cleared, ambiguous };
  };
  return () => {
    if (!pending) pending = reconcile().finally(() => { pending = null; });
    return pending;
  };
};
module.exports = { createReservationLinker, createReservationReconciler, namesMatch };
