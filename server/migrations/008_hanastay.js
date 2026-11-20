'use strict';

// g.hanastay.net（hostex-lark-bridge Worker）登记同步：
// - hostex_id_images 加 source 列，区分 Hostex 原生证件图与 hanastay R2 证件图
// - hanastay_registrations 记录每个订单的登记快照与处理状态
// - hanastay_sync_state 存增量游标
module.exports = {
  async up({ db, runAsync, allAsync }) {
    const columns = await allAsync(db, 'PRAGMA table_info(hostex_id_images)');
    if (!columns.some((column) => column.name === 'source')) {
      await runAsync(db, "ALTER TABLE hostex_id_images ADD COLUMN source TEXT NOT NULL DEFAULT 'hostex'");
    }
    await runAsync(db, `
      CREATE TABLE IF NOT EXISTS hanastay_registrations (
        reservation_code TEXT PRIMARY KEY,
        dirty INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'seen',
        detail TEXT,
        payload_hash TEXT,
        payload_json TEXT,
        checkin_record_id TEXT,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        fetched_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_hanastay_reg_dirty ON hanastay_registrations(dirty)');
    await runAsync(db, `
      CREATE TABLE IF NOT EXISTS hanastay_sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }
};
