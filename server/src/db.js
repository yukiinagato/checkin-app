'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const runAsync = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const allAsync = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows || []);
  });
});

const getAsync = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const openDatabase = (dbPath, logger) => new Promise((resolve, reject) => {
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      logger.error({ err: err.message, dbPath }, 'failed to open sqlite database');
      reject(err);
      return;
    }
    logger.info({ dbPath }, 'sqlite database connected');
    resolve(db);
  });
});

const applyPragmas = async (db, logger) => {
  // WAL: better concurrency, durable across crashes; synchronous=NORMAL pairs well with WAL.
  // foreign_keys: enforce FK constraints (off by default in sqlite).
  // busy_timeout: avoid SQLITE_BUSY when readers/writers contend.
  const pragmas = [
    'PRAGMA journal_mode = WAL',
    'PRAGMA synchronous = NORMAL',
    'PRAGMA foreign_keys = ON',
    'PRAGMA busy_timeout = 5000'
  ];
  for (const sql of pragmas) {
    try {
      await runAsync(db, sql);
    } catch (err) {
      logger.warn({ pragma: sql, err: err.message }, 'pragma failed');
    }
  }
  const journalMode = await getAsync(db, 'PRAGMA journal_mode');
  logger.info({ journalMode: journalMode?.journal_mode }, 'sqlite pragmas applied');
};

const ensureMigrationsTable = (db) => runAsync(db, `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const loadMigrations = (migrationsDir) => {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.js$/.test(file))
    .sort()
    .map((file) => ({
      version: file.replace(/\.js$/, ''),
      mod: require(path.join(migrationsDir, file))
    }));
};

const runMigrations = async (db, migrationsDir, logger) => {
  await ensureMigrationsTable(db);
  const appliedRows = await allAsync(db, 'SELECT version FROM schema_migrations');
  const applied = new Set(appliedRows.map((row) => row.version));
  const migrations = loadMigrations(migrationsDir);

  for (const { version, mod } of migrations) {
    if (applied.has(version)) continue;
    if (typeof mod.up !== 'function') {
      throw new Error(`Migration ${version} does not export an "up" function`);
    }
    logger.info({ migration: version }, 'applying migration');
    await mod.up({ db, runAsync, allAsync, getAsync });
    await runAsync(db, 'INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    logger.info({ migration: version }, 'migration applied');
  }
};

const closeDatabase = (db) => new Promise((resolve) => {
  if (!db) {
    resolve();
    return;
  }
  db.close((err) => {
    if (err) console.error('failed to close db:', err.message);
    resolve();
  });
});

module.exports = {
  openDatabase,
  applyPragmas,
  runMigrations,
  closeDatabase,
  runAsync,
  allAsync,
  getAsync
};
