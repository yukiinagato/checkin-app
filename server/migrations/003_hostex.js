'use strict';

module.exports = {
  async up({ db, runAsync }) {
    await runAsync(db, `
      CREATE TABLE IF NOT EXISTS hostex_reservations (
        reservation_code TEXT PRIMARY KEY,
        stay_code TEXT,
        property_id INTEGER,
        channel_type TEXT,
        status TEXT NOT NULL,
        check_in_date TEXT NOT NULL,
        check_out_date TEXT,
        guest_name TEXT,
        guest_name_norm TEXT,
        number_of_adults INTEGER,
        number_of_children INTEGER,
        number_of_pets INTEGER,
        booked_at TEXT,
        raw_json TEXT NOT NULL,
        checkin_record_id TEXT,
        first_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_hostex_res_checkin ON hostex_reservations(check_in_date, status)');
    await runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_hostex_res_name ON hostex_reservations(guest_name_norm)');

    await runAsync(db, `
      CREATE TABLE IF NOT EXISTS hostex_id_images (
        image_id TEXT PRIMARY KEY,
        reservation_code TEXT NOT NULL,
        hostex_guest_id TEXT,
        source_url TEXT NOT NULL,
        filename TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        ocr_json TEXT,
        downloaded_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_hostex_img_res ON hostex_id_images(reservation_code)');
    await runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_hostex_img_status ON hostex_id_images(status)');
  }
};
