'use strict';

module.exports = {
  async up({ db, runAsync }) {
    await runAsync(db, `CREATE TABLE IF NOT EXISTS admin_auth_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), epoch TEXT NOT NULL
    )`);
    await runAsync(db, "INSERT OR IGNORE INTO admin_auth_state (id, epoch) VALUES (1, lower(hex(randomblob(32))))");
  }
};
