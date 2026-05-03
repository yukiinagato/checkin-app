'use strict';

// Idempotent baseline schema. On a fresh database this creates everything;
// on an existing database (pre-migration era) this is a no-op because every
// CREATE uses IF NOT EXISTS and the legacy ad-hoc ALTER paths covered the
// missing columns. Subsequent schema changes go in their own migration.

module.exports = {
  async up({ db, runAsync, allAsync }) {
    await runAsync(db, `
      CREATE TABLE IF NOT EXISTS checkins (
        id TEXT PRIMARY KEY,
        date TEXT,
        data TEXT,
        check_in TEXT,
        check_out TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(db, `
      CREATE TABLE IF NOT EXISTS step_templates (
        lang TEXT PRIMARY KEY,
        steps TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(db, `
      CREATE TABLE IF NOT EXISTS completion_templates (
        lang TEXT PRIMARY KEY,
        template TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(db, `
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runAsync(db, `
      CREATE TABLE IF NOT EXISTS admin_passkeys (
        credential_id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Backfill columns on legacy DBs created before specific columns existed.
    const ensureColumn = async (table, column, ddl) => {
      const cols = await allAsync(db, `PRAGMA table_info(${table})`);
      const has = cols.some((c) => c.name === column);
      if (!has) {
        await runAsync(db, `ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      }
    };

    await ensureColumn('checkins', 'check_in', 'check_in TEXT');
    await ensureColumn('checkins', 'check_out', 'check_out TEXT');
    await ensureColumn('admin_passkeys', 'public_key', 'public_key TEXT');
    await ensureColumn('admin_passkeys', 'counter', 'counter INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('admin_passkeys', 'transports', 'transports TEXT');
  }
};
