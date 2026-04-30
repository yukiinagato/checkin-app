/**
 * auth_unit.test.js
 *
 * 針對這次改動的單元測試：
 *   1. getBearerToken / getAdminSessionFromRequest 行為
 *   2. 靜態掃描確認 server.js 已移除 req.query.sessionToken 讀取
 *   3. 靜態掃描確認 AdminPage.jsx 已移除舊函數、新增新函數
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ─── 把待測函數從 server.js 隔離出來（不 require 整個 server 以免觸發 sqlite3）
const getBearerToken = (req) => {
  const authHeader = req.get('authorization');
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return '';
};

const getAdminSessionFromRequest = (req) => {
  return getBearerToken(req);
};

// 模擬最簡單的 express req 物件
const makeReq = ({ authHeader, querySessionToken } = {}) => ({
  get: (name) => (name === 'authorization' ? authHeader : undefined),
  query: querySessionToken ? { sessionToken: querySessionToken } : {}
});

// ─── 1. getBearerToken ───────────────────────────────────────────────────────

test('getBearerToken：正確解析 Authorization: Bearer header', () => {
  const req = makeReq({ authHeader: 'Bearer my-secret-token' });
  assert.equal(getBearerToken(req), 'my-secret-token');
});

test('getBearerToken：header 不存在時回傳空字串', () => {
  const req = makeReq({});
  assert.equal(getBearerToken(req), '');
});

test('getBearerToken：非 Bearer scheme 回傳空字串', () => {
  const req = makeReq({ authHeader: 'Basic dXNlcjpwYXNz' });
  assert.equal(getBearerToken(req), '');
});

test('getBearerToken：去除 token 前後空白', () => {
  const req = makeReq({ authHeader: 'Bearer   trimmed-token   ' });
  assert.equal(getBearerToken(req), 'trimmed-token');
});

// ─── 2. getAdminSessionFromRequest（改動後只讀 header）────────────────────────

test('getAdminSessionFromRequest：有 Bearer header 時回傳 token', () => {
  const req = makeReq({ authHeader: 'Bearer valid-session' });
  assert.equal(getAdminSessionFromRequest(req), 'valid-session');
});

test('getAdminSessionFromRequest：沒有 header 時回傳空字串', () => {
  const req = makeReq({});
  assert.equal(getAdminSessionFromRequest(req), '');
});

test('getAdminSessionFromRequest：僅有 ?sessionToken query 時回傳空字串（舊路徑已移除）', () => {
  const req = makeReq({ querySessionToken: 'leaked-via-query' });
  assert.equal(getAdminSessionFromRequest(req), '');
});

test('getAdminSessionFromRequest：同時有 header 與 query，只採用 header', () => {
  const req = makeReq({ authHeader: 'Bearer header-token', querySessionToken: 'query-token' });
  assert.equal(getAdminSessionFromRequest(req), 'header-token');
});

// ─── 3. 靜態掃描 server.js ────────────────────────────────────────────────────

const serverSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'server.js'),
  'utf8'
);

test('server.js：getAdminSessionFromRequest 不再讀取 req.query.sessionToken', () => {
  // 抓出函數本體
  const fnMatch = serverSrc.match(
    /const getAdminSessionFromRequest\s*=\s*\(req\)\s*=>\s*\{([\s\S]*?)\n\};/
  );
  assert.ok(fnMatch, '找不到 getAdminSessionFromRequest 函數定義');
  const fnBody = fnMatch[1];
  assert.ok(
    !fnBody.includes('sessionToken'),
    `函數本體不應包含 sessionToken，實際內容：\n${fnBody}`
  );
});

test('server.js：getBearerToken 輔助函數仍存在', () => {
  assert.ok(
    serverSrc.includes('const getBearerToken'),
    '找不到 getBearerToken 定義'
  );
});

// ─── 4. 靜態掃描 AdminPage.jsx ────────────────────────────────────────────────

const adminPageSrc = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'client', 'src', 'AdminPage.jsx'),
  'utf8'
);

test('AdminPage.jsx：appendAdminTokenToPhotoUrl 已刪除', () => {
  assert.ok(
    !adminPageSrc.includes('appendAdminTokenToPhotoUrl'),
    '仍發現 appendAdminTokenToPhotoUrl'
  );
});

test('AdminPage.jsx：hydrateRecordPhotoUrls 已刪除', () => {
  assert.ok(
    !adminPageSrc.includes('hydrateRecordPhotoUrls'),
    '仍發現 hydrateRecordPhotoUrls'
  );
});

test('AdminPage.jsx：不再把 sessionToken 附加到圖片 URL', () => {
  // 允許 onLogin(payload.sessionToken) 這類登入邏輯，
  // 但不應有 searchParams.set('sessionToken', ...) 或 ?sessionToken= 字串
  assert.ok(
    !adminPageSrc.includes("searchParams.set('sessionToken'"),
    "仍發現 searchParams.set('sessionToken', ...)"
  );
  assert.ok(
    !adminPageSrc.includes('?sessionToken='),
    '仍發現 ?sessionToken= 查詢字串'
  );
});

test('AdminPage.jsx：AuthImage 元件已新增', () => {
  assert.ok(
    adminPageSrc.includes('const AuthImage'),
    '找不到 AuthImage 元件定義'
  );
});

test('AdminPage.jsx：openAuthImage 函數已新增', () => {
  assert.ok(
    adminPageSrc.includes('const openAuthImage'),
    '找不到 openAuthImage 函數定義'
  );
});

test('AdminPage.jsx：AuthImage 使用 Authorization: Bearer header fetch 圖片', () => {
  // 找 AuthImage 函數本體
  const fnMatch = adminPageSrc.match(
    /const AuthImage\s*=[\s\S]*?(?=\nconst )/
  );
  assert.ok(fnMatch, '無法擷取 AuthImage 函數本體');
  assert.ok(
    fnMatch[0].includes('Authorization') && fnMatch[0].includes('Bearer'),
    'AuthImage 未使用 Authorization: Bearer header'
  );
});

test('AdminPage.jsx：openAuthImage 使用 Authorization: Bearer header fetch 圖片', () => {
  const fnMatch = adminPageSrc.match(
    /const openAuthImage\s*=[\s\S]*?(?=\nconst |\nfunction |\nexport )/
  );
  assert.ok(fnMatch, '無法擷取 openAuthImage 函數本體');
  assert.ok(
    fnMatch[0].includes('Authorization') && fnMatch[0].includes('Bearer'),
    'openAuthImage 未使用 Authorization: Bearer header'
  );
});

test('AdminPage.jsx：不再有 <img src={...passportPhoto} 直接渲染（應使用 AuthImage）', () => {
  // 舊寫法是 src={g.passportPhoto} 或 src={guest.passportPhoto}
  const directImgSrc = /<img\s[^>]*src=\{[^}]*passportPhoto[^}]*\}/;
  assert.ok(
    !directImgSrc.test(adminPageSrc),
    '仍發現直接用 passportPhoto 作為 <img src>，應改用 <AuthImage>'
  );
});
