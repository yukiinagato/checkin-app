'use strict';

module.exports = {
  async up({ db, runAsync }) {
    await runAsync(db, `
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await runAsync(db, 'CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)');
  }
};
