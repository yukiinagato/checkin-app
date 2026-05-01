#!/usr/bin/env node
/**
 * reset-passkey.js — 清除所有已註冊的 Admin Passkey
 *
 * 用法：
 *   node reset-passkey.js [--env development|production]
 *
 * 說明：
 *   清除資料庫 admin_passkeys 表中的所有記錄，讓管理員可以重新註冊新的 Passkey。
 *   下次訪問管理後台時，系統會要求使用 ADMIN_API_TOKEN（Bootstrap Token）重新綁定裝置。
 */

'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// 解析 --env 參數（預設 development）
const envArgIdx = process.argv.indexOf('--env');
const envName = envArgIdx !== -1 ? process.argv[envArgIdx + 1] : (process.env.NODE_ENV || 'development');

const envFile = envName === 'production' ? '.env.production' : '.env.development';
require('dotenv').config({ path: path.resolve(__dirname, envFile) });

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'hotel.db');

console.log(`\n🔑  Passkey 重置工具`);
console.log(`📂  環境：${envName}`);
console.log(`💾  資料庫：${DB_PATH}`);
console.log('');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌  無法開啟資料庫：', err.message);
    process.exit(1);
  }
});

db.get('SELECT COUNT(*) AS count FROM admin_passkeys', [], (err, row) => {
  if (err) {
    console.error('❌  查詢失敗：', err.message);
    db.close();
    process.exit(1);
  }

  const count = row?.count ?? 0;

  if (count === 0) {
    console.log('ℹ️   目前沒有已註冊的 Passkey，無需清除。');
    db.close();
    process.exit(0);
  }

  console.log(`⚠️   即將刪除 ${count} 個已註冊的 Passkey。`);
  console.log('    刪除後，下次登入管理後台需使用 ADMIN_API_TOKEN（Bootstrap Token）重新綁定裝置。');
  console.log('');

  // 非互動模式（--yes 或 FORCE=1）跳過確認
  const skipConfirm = process.argv.includes('--yes') || process.env.FORCE === '1';

  const doDelete = () => {
    db.run('DELETE FROM admin_passkeys', [], function (deleteErr) {
      if (deleteErr) {
        console.error('❌  刪除失敗：', deleteErr.message);
        db.close();
        process.exit(1);
      }
      console.log(`✅  已清除 ${this.changes} 個 Passkey 記錄。`);
      console.log('    請使用 Bootstrap Token 重新登入並綁定新裝置。');
      db.close();
    });
  };

  if (skipConfirm) {
    doDelete();
    return;
  }

  // 互動式確認
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('    確認刪除？輸入 yes 繼續：', (answer) => {
    rl.close();
    if (answer.trim().toLowerCase() === 'yes') {
      doDelete();
    } else {
      console.log('    已取消。');
      db.close();
    }
  });
});
