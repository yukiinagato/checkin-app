'use strict';

class Semaphore {
  constructor(max) {
    if (!Number.isInteger(max) || max <= 0) {
      throw new Error('Semaphore max must be a positive integer');
    }
    this.max = max;
    this.current = 0;
    this.waiters = [];
  }

  acquire(timeoutMs = null) {
    if (this.current < this.max) {
      this.current += 1;
      return Promise.resolve(() => this._release());
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.waiters.indexOf(entry);
          if (idx >= 0) this.waiters.splice(idx, 1);
          reject(new Error('Semaphore acquire timeout'));
        }, timeoutMs);
        entry.timer.unref?.();
      }
      this.waiters.push(entry);
    });
  }

  _release() {
    const next = this.waiters.shift();
    if (next) {
      if (next.timer) clearTimeout(next.timer);
      next.resolve(() => this._release());
    } else {
      this.current = Math.max(0, this.current - 1);
    }
  }

  stats() {
    return { current: this.current, queued: this.waiters.length, max: this.max };
  }
}

module.exports = { Semaphore };
