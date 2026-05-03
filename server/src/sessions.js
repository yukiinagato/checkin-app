'use strict';

class AdminSessionStore {
  constructor({ db, logger, runAsync, allAsync }) {
    this.db = db;
    this.logger = logger;
    this.runAsync = runAsync;
    this.allAsync = allAsync;
    this.cache = new Map();
  }

  async hydrate() {
    try {
      const rows = await this.allAsync(
        this.db,
        'SELECT token, expires_at FROM admin_sessions WHERE expires_at > ?',
        [Date.now()]
      );
      this.cache.clear();
      for (const row of rows) {
        this.cache.set(row.token, Number(row.expires_at));
      }
      this.logger.info({ count: this.cache.size }, 'admin sessions hydrated');
    } catch (err) {
      this.logger.error({ err: err.message }, 'failed to hydrate admin sessions');
    }
  }

  set(token, expiresAt) {
    this.cache.set(token, expiresAt);
    this.runAsync(
      this.db,
      'INSERT OR REPLACE INTO admin_sessions (token, expires_at) VALUES (?, ?)',
      [token, expiresAt]
    ).catch((err) => {
      this.logger.error({ err: err.message }, 'failed to persist admin session');
    });
    return this;
  }

  get(token) {
    return this.cache.get(token);
  }

  has(token) {
    return this.cache.has(token);
  }

  delete(token) {
    const had = this.cache.delete(token);
    this.runAsync(this.db, 'DELETE FROM admin_sessions WHERE token = ?', [token])
      .catch((err) => this.logger.error({ err: err.message }, 'failed to delete admin session'));
    return had;
  }

  *[Symbol.iterator]() {
    yield* this.cache;
  }

  async purgeExpired() {
    const now = Date.now();
    for (const [token, expiresAt] of this.cache) {
      if (expiresAt < now) this.cache.delete(token);
    }
    try {
      await this.runAsync(this.db, 'DELETE FROM admin_sessions WHERE expires_at < ?', [now]);
    } catch (err) {
      this.logger.error({ err: err.message }, 'failed to purge expired sessions');
    }
  }
}

module.exports = { AdminSessionStore };
