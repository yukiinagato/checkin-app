'use strict';
module.exports = {
  async up({ db, runAsync, allAsync }) {
    const columns = await allAsync(db, 'PRAGMA table_info(hostex_reservations)');
    for (const [name, type] of [['checkin_link_source', 'TEXT'], ['checkin_linked_at', 'DATETIME']]) {
      if (!columns.some((column) => column.name === name)) {
        await runAsync(db, `ALTER TABLE hostex_reservations ADD COLUMN ${name} ${type}`);
      }
    }
  }
};
