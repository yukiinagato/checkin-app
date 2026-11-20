'use strict';
module.exports={async up({db,runAsync}) {
 await runAsync(db,`CREATE TABLE IF NOT EXISTS checkin_order_selections (
  record_id TEXT PRIMARY KEY REFERENCES checkins(id), reservation_code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
 await runAsync(db,'CREATE INDEX IF NOT EXISTS idx_order_selections_order ON checkin_order_selections(reservation_code)');
}};
