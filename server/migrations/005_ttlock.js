'use strict';
module.exports = { async up({ db, runAsync }) {
  await runAsync(db, `CREATE TABLE IF NOT EXISTS ttlock_tokens (id INTEGER PRIMARY KEY CHECK(id=1), encrypted_payload TEXT NOT NULL)`);
  await runAsync(db, `CREATE TABLE IF NOT EXISTS ttlock_order_codes (
    reservation_code TEXT PRIMARY KEY, lock_id INTEGER NOT NULL, passcode TEXT NOT NULL,
    passcode_name TEXT NOT NULL UNIQUE, start_date INTEGER NOT NULL, end_date INTEGER NOT NULL,
    keyboard_pwd_id INTEGER, status TEXT NOT NULL DEFAULT 'pending', lease_until INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(lock_id, passcode))`);
} };
