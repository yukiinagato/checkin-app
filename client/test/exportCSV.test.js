import test from 'node:test';
import assert from 'node:assert/strict';

// ─── 直接複製 escapeCell 邏輯進行單元測試，不需引入整個 App.jsx ───────────────

const CSV_INJECTION_PREFIXES = /^[=+\-@]/;

const escapeCell = (value) => {
  let str = value == null ? '' : String(value);
  if (CSV_INJECTION_PREFIXES.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
};

const BOM = '﻿';

const buildCSV = (rows) =>
  BOM + rows.map(row => row.map(escapeCell).join(',')).join('\n');

// ─── escapeCell 基本行為 ───────────────────────────────────────────────────────

test('escapeCell：一般字串用雙引號包住', () => {
  assert.equal(escapeCell('hello'), '"hello"');
});

test('escapeCell：null 轉為空字串並用雙引號包住', () => {
  assert.equal(escapeCell(null), '""');
});

test('escapeCell：undefined 轉為空字串並用雙引號包住', () => {
  assert.equal(escapeCell(undefined), '""');
});

test('escapeCell：數字轉字串後用雙引號包住', () => {
  assert.equal(escapeCell(42), '"42"');
});

// ─── 雙引號跳脫 ───────────────────────────────────────────────────────────────

test('escapeCell：內容含雙引號時替換為 ""', () => {
  assert.equal(escapeCell('say "hello"'), '"say ""hello"""');
});

test('escapeCell：多個雙引號全部替換', () => {
  assert.equal(escapeCell('"a" and "b"'), '"""a"" and ""b"""');
});

test('escapeCell：內容含逗號時正確包住（不需額外處理）', () => {
  assert.equal(escapeCell('a,b,c'), '"a,b,c"');
});

test('escapeCell：內容含換行時正確包住', () => {
  assert.equal(escapeCell('line1\nline2'), '"line1\nline2"');
});

// ─── CSV injection 防護 ───────────────────────────────────────────────────────

test('escapeCell：以 = 開頭時前置單引號', () => {
  assert.equal(escapeCell('=SUM(A1:A10)'), `"'=SUM(A1:A10)"`);
});

test('escapeCell：以 + 開頭時前置單引號', () => {
  assert.equal(escapeCell('+1234567890'), `"'+1234567890"`);
});

test('escapeCell：以 - 開頭時前置單引號', () => {
  assert.equal(escapeCell('-1'), `"'-1"`);
});

test('escapeCell：以 @ 開頭時前置單引號', () => {
  assert.equal(escapeCell('@SUM(1+1)'), `"'@SUM(1+1)"`);
});

test('escapeCell：危險前綴後若含雙引號，順序為先前置單引號再跳脫雙引號', () => {
  // 原始值 =HYPERLINK("url")
  // → 前置單引號 → '=HYPERLINK("url")
  // → 雙引號跳脫 → '=HYPERLINK(""url"")
  // → 包覆 → "'=HYPERLINK(""url"")"
  assert.equal(escapeCell('=HYPERLINK("url")'), `"'=HYPERLINK(""url"")"`);
});

test('escapeCell：不以危險字元開頭時不加單引號', () => {
  assert.equal(escapeCell('normal text'), '"normal text"');
  assert.equal(escapeCell('123'),         '"123"');
  assert.equal(escapeCell(' =foo'),       '" =foo"'); // 前置空格不算
});

// ─── BOM ──────────────────────────────────────────────────────────────────────

test('buildCSV：輸出以 BOM（\\uFEFF）開頭', () => {
  const csv = buildCSV([['col1'], ['val1']]);
  assert.equal(csv.codePointAt(0), 0xFEFF, 'CSV 開頭應為 BOM (U+FEFF)');
});

test('buildCSV：BOM 後緊接第一行內容', () => {
  const csv = buildCSV([['Header']]);
  assert.ok(csv.startsWith('﻿"Header"'));
});

// ─── 整體 CSV 結構 ─────────────────────────────────────────────────────────────

test('buildCSV：多欄位以逗號分隔，有雙引號包覆', () => {
  const csv = buildCSV([['a', 'b', 'c']]);
  assert.equal(csv, '﻿"a","b","c"');
});

test('buildCSV：多行以換行符分隔', () => {
  const csv = buildCSV([['h1', 'h2'], ['v1', 'v2']]);
  assert.equal(csv, '﻿"h1","h2"\n"v1","v2"');
});

test('buildCSV：中文內容正確保留', () => {
  const csv = buildCSV([['姓名', '國籍'], ['山田太郎', '日本']]);
  assert.equal(csv, '﻿"姓名","國籍"\n"山田太郎","日本"');
});

// ─── 靜態掃描 App.jsx ─────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(resolve(__dirname, '../src/App.jsx'), 'utf8');

test('App.jsx：escapeCell 函數已定義', () => {
  assert.ok(appSrc.includes('const escapeCell'), '找不到 escapeCell 定義');
});

test('App.jsx：雙引號跳脫邏輯存在', () => {
  assert.ok(appSrc.includes('replace(/"/g, \'""\''), '找不到雙引號跳脫邏輯');
});

test('App.jsx：CSV injection 防護邏輯存在', () => {
  assert.ok(
    appSrc.includes('CSV_INJECTION_PREFIXES'),
    '找不到 CSV_INJECTION_PREFIXES 定義'
  );
});

test('App.jsx：BOM 已加入 CSV 輸出', () => {
  assert.ok(
    appSrc.includes('\\uFEFF') || appSrc.includes('﻿'),
    'CSV 輸出未包含 BOM'
  );
});

test('App.jsx：每個欄位都有套用 escapeCell', () => {
  assert.ok(
    appSrc.includes('row.map(escapeCell)') || appSrc.includes('.map(escapeCell)'),
    '每個欄位應透過 escapeCell 處理'
  );
});
