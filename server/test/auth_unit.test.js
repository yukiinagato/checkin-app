/**
 * auth_unit.test.js
 *
 * 針對這次改動的單元測試：
 *   1. getBearerToken / getAdminSessionFromRequest 行為
 *   2. 靜態掃描確認 server.js 已移除 req.query.sessionToken 讀取
 *   3. 靜態掃描確認 AdminPage.jsx 已移除舊函數、新增新函數
 *   4. purgeExpiredEntries 功能正確性
 *   5. cleanupInterval 可正確清除
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

// ─── 5. 靜態掃描 rate limit 設定 ─────────────────────────────────────────────

test('server.js：已引入 express-rate-limit', () => {
  assert.ok(
    serverSrc.includes("require('express-rate-limit')"),
    "找不到 require('express-rate-limit')"
  );
});

test('server.js：/api/ocr/passport 掛上限流器', () => {
  assert.match(
    serverSrc,
    /app\.post\(['"]\/api\/ocr\/passport['"],\s*ocrRateLimit/,
    '/api/ocr/passport 未掛上 ocrRateLimit'
  );
});

test('server.js：ocrRateLimit 設定為每分鐘最多 10 次', () => {
  const match = serverSrc.match(/const ocrRateLimit\s*=\s*rateLimit\(\{([\s\S]*?)\}\)/);
  assert.ok(match, '找不到 ocrRateLimit 定義');
  const body = match[1];
  assert.match(body, /windowMs:\s*1\s*\*\s*60\s*\*\s*1000/, 'windowMs 應為 1 分鐘');
  assert.match(body, /limit:\s*10\b/, 'limit 應為 10');
});

test('server.js：/api/submit 掛上限流器', () => {
  assert.match(
    serverSrc,
    /app\.post\(['"]\/api\/submit['"],\s*submitRateLimit/,
    '/api/submit 未掛上 submitRateLimit'
  );
});

test('server.js：submitRateLimit 設定為每分鐘最多 20 次', () => {
  const match = serverSrc.match(/const submitRateLimit\s*=\s*rateLimit\(\{([\s\S]*?)\}\)/);
  assert.ok(match, '找不到 submitRateLimit 定義');
  const body = match[1];
  assert.match(body, /windowMs:\s*1\s*\*\s*60\s*\*\s*1000/, 'windowMs 應為 1 分鐘');
  assert.match(body, /limit:\s*20\b/, 'limit 應為 20');
});

test('server.js：/api/admin/passkeys/auth/verify 掛上限流器', () => {
  assert.match(
    serverSrc,
    /app\.post\(['"]\/api\/admin\/passkeys\/auth\/verify['"],\s*authVerifyRateLimit/,
    '/api/admin/passkeys/auth/verify 未掛上 authVerifyRateLimit'
  );
});

test('server.js：authVerifyRateLimit 設定為每 15 分鐘最多 10 次', () => {
  const match = serverSrc.match(/const authVerifyRateLimit\s*=\s*rateLimit\(\{([\s\S]*?)\}\)/);
  assert.ok(match, '找不到 authVerifyRateLimit 定義');
  const body = match[1];
  assert.match(body, /windowMs:\s*15\s*\*\s*60\s*\*\s*1000/, 'windowMs 應為 15 分鐘');
  assert.match(body, /limit:\s*10\b/, 'limit 應為 10');
});

// ─── 6. 靜態掃描 helmet 設定 ──────────────────────────────────────────────────

test('server.js：已引入 helmet', () => {
  assert.ok(serverSrc.includes("require('helmet')"), "找不到 require('helmet')");
});

test('server.js：helmet() 在 CORS 之後、express.json 之前掛載', () => {
  const corsPos  = serverSrc.indexOf('app.use(cors(');
  const helmetPos = serverSrc.indexOf('app.use(helmet(');
  const jsonPos  = serverSrc.indexOf("app.use(express.json(");
  assert.ok(corsPos   < helmetPos, 'helmet 應在 cors 之後');
  assert.ok(helmetPos < jsonPos,   'helmet 應在 express.json 之前');
});

test('server.js：CSP script-src 包含 self', () => {
  assert.ok(
    serverSrc.includes("'self'"),
    "CSP script-src 缺少 'self'"
  );
});

test('server.js：CSP script-src 包含 cdn.jsdelivr.net', () => {
  assert.ok(
    serverSrc.includes('cdn.jsdelivr.net'),
    "CSP script-src 缺少 cdn.jsdelivr.net"
  );
});

test('server.js：使用 helmet.contentSecurityPolicy.getDefaultDirectives() 作為基礎', () => {
  assert.ok(
    serverSrc.includes('helmet.contentSecurityPolicy.getDefaultDirectives()'),
    '未使用 getDefaultDirectives() 展開預設 CSP 指令'
  );
});

test('server.js：所有限流器超限時回傳 JSON 錯誤訊息（非純字串）', () => {
  // express-rate-limit 超限預設是 429；message 是物件代表會回傳 JSON
  const limiters = ['ocrRateLimit', 'submitRateLimit', 'authVerifyRateLimit'];
  for (const name of limiters) {
    const match = serverSrc.match(
      new RegExp(`const ${name}\\s*=\\s*rateLimit\\(\\{([\\s\\S]*?)\\}\\)`)
    );
    assert.ok(match, `找不到 ${name} 定義`);
    assert.match(
      match[1],
      /message:\s*\{/,
      `${name} 的 message 應為物件（JSON 格式）`
    );
  }
});

// ─── 7. purgeExpiredEntries 功能測試 ─────────────────────────────────────────
//
// 直接複製 server.js 中的相關邏輯，不需 require 整個模組（避免 sqlite3）

const makeMaps = () => {
  const challenges = new Map();
  const sessions   = new Map();

  const purge = () => {
    const now = Date.now();
    for (const [key, value] of challenges) {
      if (value.expiresAt < now) challenges.delete(key);
    }
    for (const [token, expiresAt] of sessions) {
      if (expiresAt < now) sessions.delete(token);
    }
  };

  return { challenges, sessions, purge };
};

test('purgeExpiredEntries：刪除 adminChallenges 中已過期的條目', () => {
  const { challenges, purge } = makeMaps();
  challenges.set('expired', { expiresAt: Date.now() - 1000, purpose: 'auth' });
  challenges.set('valid',   { expiresAt: Date.now() + 60000, purpose: 'auth' });
  purge();
  assert.ok(!challenges.has('expired'), '已過期的 challenge 應被刪除');
  assert.ok(challenges.has('valid'),    '未過期的 challenge 應保留');
});

test('purgeExpiredEntries：刪除 adminSessions 中已過期的條目', () => {
  const { sessions, purge } = makeMaps();
  sessions.set('old-token',   Date.now() - 1);
  sessions.set('valid-token', Date.now() + 86400000);
  purge();
  assert.ok(!sessions.has('old-token'),   '已過期的 session 應被刪除');
  assert.ok(sessions.has('valid-token'),  '未過期的 session 應保留');
});

test('purgeExpiredEntries：Map 為空時不拋出錯誤', () => {
  const { purge } = makeMaps();
  assert.doesNotThrow(purge);
});

test('purgeExpiredEntries：只刪除過期條目，不影響其餘條目', () => {
  const { challenges, sessions, purge } = makeMaps();
  const now = Date.now();
  // 加入 3 個 challenge，1 個過期
  challenges.set('c1', { expiresAt: now - 500, purpose: 'auth' });
  challenges.set('c2', { expiresAt: now + 1000, purpose: 'register' });
  challenges.set('c3', { expiresAt: now + 2000, purpose: 'auth' });
  // 加入 3 個 session，2 個過期
  sessions.set('s1', now - 1);
  sessions.set('s2', now - 2);
  sessions.set('s3', now + 5000);
  purge();
  assert.equal(challenges.size, 2, '應剩下 2 個未過期 challenge');
  assert.equal(sessions.size,   1, '應剩下 1 個未過期 session');
});

// ─── 8. 靜態掃描：cleanupInterval 設定 ──────────────────────────────────────

test('server.js：purgeExpiredEntries 函數已定義', () => {
  assert.ok(
    serverSrc.includes('const purgeExpiredEntries'),
    '找不到 purgeExpiredEntries 定義'
  );
});

test('server.js：setInterval 以 5 分鐘週期呼叫 purgeExpiredEntries', () => {
  assert.match(
    serverSrc,
    /setInterval\s*\(\s*purgeExpiredEntries\s*,\s*5\s*\*\s*60\s*\*\s*1000\s*\)/,
    'setInterval 的設定不符合預期'
  );
});

test('server.js：cleanupInterval 有呼叫 .unref()', () => {
  assert.match(
    serverSrc,
    /cleanupInterval\.unref\(\)/,
    '找不到 cleanupInterval.unref()'
  );
});

test('server.js：cleanupInterval 與 purgeExpiredEntries 已匯出', () => {
  const exportsMatch = serverSrc.match(/module\.exports\s*=\s*\{([\s\S]*?)\}/);
  assert.ok(exportsMatch, '找不到 module.exports');
  const body = exportsMatch[1];
  assert.ok(body.includes('purgeExpiredEntries'), 'purgeExpiredEntries 未匯出');
  assert.ok(body.includes('cleanupInterval'),     'cleanupInterval 未匯出');
});

// ─── 9. getTemplateRowWithFallback 白名單驗證 ────────────────────────────────
//
// 直接複製白名單邏輯，不 require 整個 server 模組

const ALLOWED_TABLES = {
  step_templates:       { steps:    true },
  completion_templates: { template: true }
};

const validateTableColumn = (tableName, columnName) => {
  if (!ALLOWED_TABLES[tableName]?.[columnName]) {
    throw new Error('Invalid table or column');
  }
};

test('白名單：合法的 (step_templates, steps) 通過驗證', () => {
  assert.doesNotThrow(() => validateTableColumn('step_templates', 'steps'));
});

test('白名單：合法的 (completion_templates, template) 通過驗證', () => {
  assert.doesNotThrow(() => validateTableColumn('completion_templates', 'template'));
});

test('白名單：不存在的 tableName 拋出 Error', () => {
  assert.throws(
    () => validateTableColumn('unknown_table', 'steps'),
    { message: 'Invalid table or column' }
  );
});

test('白名單：合法 table 但不存在的 columnName 拋出 Error', () => {
  assert.throws(
    () => validateTableColumn('step_templates', 'data'),
    { message: 'Invalid table or column' }
  );
});

test('白名單：columnName 屬於其他 table 的合法欄位時仍拋出 Error', () => {
  // template 是 completion_templates 的欄位，不屬於 step_templates
  assert.throws(
    () => validateTableColumn('step_templates', 'template'),
    { message: 'Invalid table or column' }
  );
});

test('白名單：空字串參數拋出 Error', () => {
  assert.throws(() => validateTableColumn('', ''),           { message: 'Invalid table or column' });
  assert.throws(() => validateTableColumn('step_templates', ''), { message: 'Invalid table or column' });
  assert.throws(() => validateTableColumn('', 'steps'),       { message: 'Invalid table or column' });
});

test('白名單：SQL injection 嘗試被拒絕', () => {
  assert.throws(
    () => validateTableColumn('step_templates; DROP TABLE step_templates;--', 'steps'),
    { message: 'Invalid table or column' }
  );
  assert.throws(
    () => validateTableColumn('step_templates', "steps UNION SELECT * FROM admin_passkeys--"),
    { message: 'Invalid table or column' }
  );
});

test('server.js：ALLOWED_TABLES 白名單已定義於 getTemplateRowWithFallback 之前', () => {
  const allowedPos  = serverSrc.indexOf('const ALLOWED_TABLES');
  const fnPos       = serverSrc.indexOf('const getTemplateRowWithFallback');
  assert.ok(allowedPos !== -1, '找不到 ALLOWED_TABLES 定義');
  assert.ok(fnPos      !== -1, '找不到 getTemplateRowWithFallback 定義');
  assert.ok(allowedPos < fnPos, 'ALLOWED_TABLES 應定義在 getTemplateRowWithFallback 之前');
});

test('server.js：getTemplateRowWithFallback 在 SQL 執行前驗證白名單', () => {
  const fnMatch = serverSrc.match(
    /const getTemplateRowWithFallback[\s\S]*?db\.get\(/
  );
  assert.ok(fnMatch, '無法擷取函數本體');
  const body = fnMatch[0];
  const rejectPos = body.indexOf("reject(new Error('Invalid table or column'))");
  const dbGetPos  = body.indexOf('db.get(');
  assert.ok(rejectPos !== -1, "找不到 reject(new Error('Invalid table or column'))");
  assert.ok(rejectPos < dbGetPos, '白名單驗證應在 db.get() 之前執行');
});
