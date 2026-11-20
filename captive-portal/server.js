'use strict';

/**
 * Minimal remote FAS for openNDS security level 4.
 *
 * The portal receives a base64-encoded FAS request from openNDS.  After the
 * guest accepts the house rules, it places the derived response token in a
 * small, private queue.  openNDS' authmon daemon polls that queue over HTTPS
 * and authorises the matching device.  The router control socket is never
 * exposed to this server or to the guest's browser.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number.parseInt(process.env.PORT || '3012', 10);
const HOST = process.env.HOST || '127.0.0.1';
const AUTH_DIR = process.env.AUTH_DIR || '/var/lib/checkin-captive-portal/auth';
const FAS_KEY = process.env.FAS_KEY || '';
const AUTHMON_TOKEN = process.env.AUTHMON_TOKEN || '';
const CHECKIN_DB_PATH = process.env.CHECKIN_DB_PATH || path.resolve(__dirname, '..', 'server', 'data', 'hotel.db');
const SESSION_TTL_MS = 15 * 60 * 1000;
const APPROVAL_TTL_MS = 5 * 60 * 1000;
const AUTH_ENTRY_TTL_MS = 30 * 60 * 1000;
const AUTH_RECEIPT_TTL_MS = 5 * 60 * 1000;
const sessions = new Map();
let checkinDatabase = null;
let checkinDatabaseUnavailable = false;

if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

if (!/^[A-Za-z0-9_-]{32,256}$/.test(FAS_KEY)) {
  throw new Error('FAS_KEY must be a 32–256 character secret without whitespace.');
}

if (!/^[A-Za-z0-9_-]{32,256}$/.test(AUTHMON_TOKEN) || AUTHMON_TOKEN === FAS_KEY) {
  throw new Error('AUTHMON_TOKEN must be a separate 32–256 character secret.');
}

fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
fs.chmodSync(AUTH_DIR, 0o700);

const COPY = {
  ja: {
    title: 'インターネット接続',
    subtitle: 'ご利用前に、滞在ルールをご確認ください。',
    rulesTitle: '滞在ルール',
    rules: [
      '管理者が巡回のため共用部に入る場合があります。その際は事前にお知らせします。',
      '22:00以降は、室内外ともに静かにお過ごしください。',
      '近隣の方への配慮と、設備の丁寧なご利用をお願いします。',
      'チェックアウト時刻を守り、室内をきれいな状態でお戻しください。'
    ],
    confirm: '上記の滞在ルールを読み、同意しました。',
    connect: '同意してインターネットに接続',
    waiting: '接続を有効にしています…',
    waitingDetail: 'この画面は自動的に完了します。',
    done: '接続を確認しています…',
    retry: 'Wi-Fiに接続したままお待ちください。プライベートアドレスが変わった場合は、現在の端末情報で認証画面が開き直します。',
    checkinTitle: '宿泊者情報をご登録ください',
    checkinDetail: 'インターネットに接続しました。ご予約の宿泊人数分の情報がまだ揃っていません。続けてチェックインを完了してください。',
    checkinButton: 'チェックインを開始',
    timeout: 'ルーターから接続許可を確認できませんでした。Wi-Fiを切断せず、この画面をもう一度開いてください。',
    invalid: 'この接続リンクは無効か、期限切れです。画面を閉じ、認証画面が開き直すまでお待ちください。'
  },
  en: {
    title: 'Internet access',
    subtitle: 'Please review the house rules before going online.',
    rulesTitle: 'House rules',
    rules: [
      'Management may enter common areas for inspections after giving notice.',
      'Please keep noise to a minimum indoors and outdoors after 10:00 PM.',
      'Please respect neighbours and take good care of the facilities.',
      'Check out on time and leave the room tidy.'
    ],
    confirm: 'I have read and agree to the house rules above.',
    connect: 'Agree and connect to the internet',
    waiting: 'Enabling your connection…',
    waitingDetail: 'This page will complete automatically.',
    done: 'Verifying the connection…',
    retry: 'Keep Wi-Fi connected. If the private address changed, the portal will reopen for the current device identity.',
    checkinTitle: 'Please register all guests',
    checkinDetail: 'You are now connected to the internet. Guest details are still missing for one or more people on the reservation. Please continue to complete check-in.',
    checkinButton: 'Start check-in',
    timeout: 'The router did not confirm access. Keep Wi-Fi connected and reopen this page.',
    invalid: 'This connection link is invalid or expired. Close this window and wait for the portal to reopen.'
  },
  'zh-Hans': {
    title: '连接互联网',
    subtitle: '上网前请阅读房间规则说明。',
    rulesTitle: '房间规则',
    rules: [
      '管理人员巡查时可能会进入公共区域，并会提前告知。',
      '22:00 后请保持室内外安静，避免打扰邻居。',
      '请爱护房屋设施，并尊重邻里。',
      '请按时退房，并保持房间整洁。'
    ],
    confirm: '我已阅读并同意遵守上述房间规则。',
    connect: '同意并连接互联网',
    waiting: '正在开通网络…',
    waitingDetail: '此页面会自动完成。',
    done: '正在验证当前网络身份…',
    retry: '请保持 Wi-Fi 连接；如果私有地址发生变化，认证页会按当前设备身份自动重新打开。',
    checkinTitle: '请完成入住信息登记',
    checkinDetail: '网络已连接。预订中仍有入住人的信息未登记完整，请继续完成入住登记。',
    checkinButton: '开始入住登记',
    timeout: '尚未收到路由器的放行确认。请保持 Wi-Fi 连接并重新打开此页面。',
    invalid: '此连接链接无效或已过期。请关闭窗口，等待认证页面重新打开。'
  },
  'zh-Hant': {
    title: '連接網際網路',
    subtitle: '上網前請閱讀房間規則說明。',
    rulesTitle: '房間規則',
    rules: [
      '管理人員巡查時可能會進入公共區域，並會提前告知。',
      '22:00 後請保持室內外安靜，避免打擾鄰居。',
      '請愛護房屋設施，並尊重鄰里。',
      '請按時退房，並保持房間整潔。'
    ],
    confirm: '我已閱讀並同意遵守上述房間規則。',
    connect: '同意並連接網際網路',
    waiting: '正在開通網路…',
    waitingDetail: '此頁面會自動完成。',
    done: '正在驗證目前的網路身分…',
    retry: '請保持 Wi-Fi 連線；如果私人位址改變，認證頁會依目前裝置身分自動重新開啟。',
    checkinTitle: '請完成入住資訊登記',
    checkinDetail: '網路已連線。預訂中仍有入住者的資訊尚未登記完整，請繼續完成入住登記。',
    checkinButton: '開始入住登記',
    timeout: '尚未收到路由器的放行確認。請保持 Wi-Fi 連線並重新開啟此頁面。',
    invalid: '此連接連結無效或已過期。請關閉視窗，等待認證頁面重新開啟。'
  },
  ko: {
    title: '인터넷 연결',
    subtitle: '인터넷 사용 전에 숙소 규칙을 확인해 주세요.',
    rulesTitle: '숙소 규칙',
    rules: [
      '관리자가 점검을 위해 공용 공간에 출입할 수 있으며, 사전에 안내합니다.',
      '22:00 이후에는 실내외에서 조용히 지내 주세요.',
      '이웃을 배려하고 시설을 소중히 이용해 주세요.',
      '정해진 시간에 체크아웃하고 객실을 깔끔하게 정리해 주세요.'
    ],
    confirm: '위 숙소 규칙을 읽고 동의합니다.',
    connect: '동의하고 인터넷 연결',
    waiting: '인터넷을 연결하는 중…',
    waitingDetail: '이 페이지는 자동으로 완료됩니다.',
    done: '현재 네트워크 연결을 확인하는 중…',
    retry: 'Wi-Fi 연결을 유지해 주세요. 비공개 주소가 바뀌면 현재 기기 정보로 인증 화면이 다시 열립니다.',
    checkinTitle: '투숙객 정보를 등록해 주세요',
    checkinDetail: '인터넷에 연결되었습니다. 예약 인원 중 아직 등록이 완료되지 않은 투숙객이 있습니다. 계속해서 체크인을 완료해 주세요.',
    checkinButton: '체크인 시작',
    timeout: '라우터에서 접속 허용을 확인하지 못했습니다. Wi-Fi 연결을 유지하고 이 페이지를 다시 열어 주세요.',
    invalid: '이 연결 링크가 유효하지 않거나 만료되었습니다. 창을 닫고 인증 화면이 다시 열릴 때까지 기다려 주세요.'
  }
};

function now() {
  return Date.now();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomId() {
  return crypto.randomBytes(32).toString('base64url');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function contentSecurityPolicy() {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'"
  ].join('; ');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-store, private, no-transform',
    'content-security-policy': contentSecurityPolicy(),
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function sendHtml(res, status, body, headers = {}) {
  send(res, status, body, { 'content-type': 'text/html; charset=utf-8', ...headers });
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' });
}

function page(title, body, language = 'ja') {
  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
  <style>
    html { min-height: 100%; color: #14213d; background: #f5f7fb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100%; padding: 24px 16px; }
    main { width: 100%; max-width: 640px; margin: 0 auto; background: #fff; border-radius: 20px; box-shadow: 0 14px 48px rgba(18, 33, 61, .12); padding: 28px; }
    h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: -.02em; }
    h2 { font-size: 18px; margin: 24px 0 10px; }
    p { line-height: 1.55; margin: 8px 0; }
    .subtle { color: #57657f; }
    .rules { background: #f5f7fb; border-radius: 14px; padding: 12px 18px; }
    .rules li { margin: 10px 0; line-height: 1.5; }
    .field { display: block; margin: 24px 0 18px; line-height: 1.45; }
    .field:after { content: ""; display: table; clear: both; }
    .field input { float: left; width: 20px; height: 20px; margin: 1px 0 0; }
    .field span { display: block; margin-left: 32px; }
    button { display: block; width: 100%; border: 0; border-radius: 12px; padding: 15px 18px; color: #fff; background: #1b6ca8; font-size: 16px; font-weight: 700; -webkit-appearance: none; appearance: none; }
    .button-link { display: block; width: 100%; margin-top: 22px; border-radius: 12px; padding: 15px 18px; color: #fff; background: #1b6ca8; font-size: 16px; font-weight: 700; text-align: center; text-decoration: none; }
    [hidden] { display: none !important; }
    .spinner { width: 30px; height: 30px; border: 3px solid #d6e3ee; border-top-color: #1b6ca8; border-radius: 50%; margin: 22px auto; -webkit-animation: spin .9s linear infinite; animation: spin .9s linear infinite; }
    @-webkit-keyframes spin { to { -webkit-transform: rotate(360deg); transform: rotate(360deg); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status { text-align: center; padding: 10px 2px; }
    .error { border-left: 4px solid #bd3b3b; padding-left: 12px; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function parseCookies(req) {
  const values = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) values[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return values;
}

function getSession(req) {
  const sessionId = parseCookies(req).checkin_portal_session;
  if (!sessionId || !/^[A-Za-z0-9_-]{32,128}$/.test(sessionId)) return null;
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { id: sessionId, ...session };
}

function cleanupSessions() {
  const timestamp = now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < timestamp) sessions.delete(id);
  }
}

function decodeBase64(value) {
  if (!value || value.length > 8192 || !/^[A-Za-z0-9+/_= -]+$/.test(value)) return null;
  try {
    const normalised = value.replaceAll(' ', '+').replaceAll('-', '+').replaceAll('_', '/');
    const decoded = Buffer.from(normalised, 'base64').toString('utf8');
    return decoded.length > 0 && decoded.length <= 8192 ? decoded : null;
  } catch {
    return null;
  }
}

function parseFasRequest(encoded) {
  const decoded = decodeBase64(encoded);
  if (!decoded) return null;

  const fields = {};
  for (const pair of decoded.split(', ')) {
    const index = pair.indexOf('=');
    if (index < 1) continue;
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (/^[a-z_]+$/.test(name) && value.length <= 2048) fields[name] = value;
  }

  if (
    !net.isIP(fields.clientip || '') ||
    !/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i.test(fields.clientmac || '') ||
    !/^[a-f0-9]{64}$/i.test(fields.hid || '') ||
    typeof fields.gatewayname !== 'string' || fields.gatewayname.length < 1 || fields.gatewayname.length > 128
  ) {
    return null;
  }

  return {
    clientIp: fields.clientip,
    clientMac: fields.clientmac.toLowerCase(),
    gatewayName: fields.gatewayname,
    gatewayHash: sha256(fields.gatewayname),
    hid: fields.hid.toLowerCase(),
    returnUrl: httpReturnUrl(fields.originurl) || httpReturnUrl(fields.gatewayurl) || 'http://status.client/'
  };
}

function httpReturnUrl(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) return null;
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Use the original value. */ }
  try {
    const url = new URL(decoded);
    if (url.protocol !== 'http:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function languageFor(value) {
  return Object.hasOwn(COPY, value) ? value : 'ja';
}

function languageFromTag(value) {
  const tag = String(value || '').trim().toLowerCase().replaceAll('_', '-');
  if (tag === 'zh-hant' || /^zh-(?:hant|tw|hk|mo)(?:-|$)/.test(tag)) return 'zh-Hant';
  if (tag === 'zh-hans' || /^zh-(?:hans|cn|sg|my)(?:-|$)/.test(tag) || tag === 'zh') return 'zh-Hans';
  if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
  if (tag === 'ko' || tag.startsWith('ko-')) return 'ko';
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  return null;
}

function languageFromAcceptLanguage(header) {
  if (typeof header !== 'string' || header.length > 2048) return null;

  const preferences = header.split(',').map((part, index) => {
    const [rawTag, ...parameters] = part.trim().split(';');
    let quality = 1;
    for (const parameter of parameters) {
      const match = parameter.trim().match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i);
      if (match) quality = Number.parseFloat(match[1]);
    }
    return { tag: rawTag.toLowerCase(), quality, index };
  }).filter(({ tag, quality }) => tag && tag !== '*' && quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const { tag } of preferences) {
    const language = languageFromTag(tag);
    if (language) return language;
  }

  return null;
}

function languageFromUserAgent(header) {
  if (typeof header !== 'string' || header.length > 4096) return null;
  const normalised = header.toLowerCase().replaceAll('_', '-');
  const locale = normalised.match(/(?:^|[^a-z])((?:zh-(?:hans|hant|cn|sg|my|tw|hk|mo))|(?:ja-jp)|(?:ko-kr)|(?:en-[a-z]{2}))(?:[^a-z]|$)/);
  return locale ? languageFromTag(locale[1]) : null;
}

function languageFromRequest(req) {
  return languageFromAcceptLanguage(req.headers['accept-language']) ||
    languageFromUserAgent(req.headers['user-agent']) ||
    'ja';
}

function dateInTokyo(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function openCheckinDatabase() {
  if (checkinDatabase || checkinDatabaseUnavailable) return checkinDatabase;
  try {
    if (!fs.existsSync(CHECKIN_DB_PATH)) throw new Error('database file does not exist');
    checkinDatabase = new DatabaseSync(CHECKIN_DB_PATH, { readOnly: true });
    return checkinDatabase;
  } catch (error) {
    checkinDatabaseUnavailable = true;
    console.error(`Check-in guidance disabled: ${error.message}`);
    return null;
  }
}

function countRegisteredGuests(rawData) {
  try {
    const guests = JSON.parse(rawData || '[]');
    if (!Array.isArray(guests)) return 0;
    return guests.filter((guest) => guest && guest.deleted !== true).length;
  } catch {
    return 0;
  }
}

function getCheckinGuidance() {
  const database = openCheckinDatabase();
  if (!database) return { required: false, reservationCode: null };
  const today = dateInTokyo();
  const reservations = database.prepare(`
    SELECT h.reservation_code, h.number_of_adults, h.number_of_children, c.data AS checkin_data
    FROM hostex_reservations h
    LEFT JOIN checkins c ON c.id = h.checkin_record_id
    WHERE h.status = 'accepted'
      AND h.check_in_date <= ?
      AND (h.check_out_date IS NULL OR h.check_out_date > ?)
  `).all(today, today);

  const incomplete = reservations.filter((reservation) => {
    const expectedGuests = Math.max(
      1,
      Number(reservation.number_of_adults || 0) + Number(reservation.number_of_children || 0)
    );
    return countRegisteredGuests(reservation.checkin_data) < expectedGuests;
  });

  return {
    required: incomplete.length > 0,
    // The venue normally has one active guest group. If upstream data ever
    // violates that invariant, keep the guidance but do not guess an order.
    reservationCode: incomplete.length === 1 ? incomplete[0].reservation_code : null
  };
}

function checkinUrlForLanguage(language, reservationCode = null) {
  const appLanguage = {
    ja: 'jp',
    en: 'en',
    'zh-Hans': 'zh-hans',
    'zh-Hant': 'zh-hant',
    ko: 'ko'
  }[languageFor(language)];
  const parameters = new URLSearchParams({ lang: appLanguage });
  if (reservationCode) parameters.set('res', reservationCode);
  return `/checkin?${parameters.toString()}`;
}

function renderPortal(session) {
  const selectedLanguage = languageFor(session.language);
  const copy = COPY[selectedLanguage];
  const rules = copy.rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join('');

  const body = `
    <h1>${escapeHtml(copy.title)}</h1>
    <p class="subtle">${escapeHtml(copy.subtitle)}</p>
    <h2>${escapeHtml(copy.rulesTitle)}</h2>
    <ol class="rules">${rules}</ol>
    <form action="/portal/agree" method="post">
      <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
      <label class="field"><input name="accepted" type="checkbox" value="yes" required><span>${escapeHtml(copy.confirm)}</span></label>
      <button type="submit">${escapeHtml(copy.connect)}</button>
    </form>`;
  return page(copy.title, body, selectedLanguage);
}

function renderWaiting(session) {
  const language = languageFor(session.language);
  const copy = COPY[language];
  const payload = JSON.stringify({ waiting: copy.waiting, waitingDetail: copy.waitingDetail, done: copy.done, retry: copy.retry, checkinTitle: copy.checkinTitle, checkinDetail: copy.checkinDetail, checkinButton: copy.checkinButton, timeout: copy.timeout, returnUrl: session.returnUrl }).replaceAll('<', '\\u003c');
  const body = `<section class="status"><div class="spinner" id="spinner" aria-hidden="true"></div><h1 id="message">${escapeHtml(copy.waiting)}</h1><p class="subtle" id="detail">${escapeHtml(copy.waitingDetail)}</p><a class="button-link" id="checkin-action" href="/checkin" hidden>${escapeHtml(copy.checkinButton)}</a></section>
  <script>
  (function () {
    var copy = ${payload};
    var message = document.getElementById('message');
    var detail = document.getElementById('detail');
    var spinner = document.getElementById('spinner');
    var checkinAction = document.getElementById('checkin-action');
    var started = new Date().getTime();
    var completed = false;

    function removeSpinner() {
      if (spinner && spinner.parentNode) spinner.parentNode.removeChild(spinner);
      spinner = null;
    }

    function finish(state) {
      if (!state || !state.authorized || completed) return false;
      completed = true;
      removeSpinner();
      if (state.checkinRequired) {
        message.textContent = copy.checkinTitle;
        detail.textContent = copy.checkinDetail;
        checkinAction.textContent = copy.checkinButton;
        checkinAction.href = state.checkinUrl;
        checkinAction.removeAttribute('hidden');
        checkinAction.focus();
        return true;
      }
      message.textContent = copy.done;
      detail.textContent = copy.retry;
      window.setTimeout(function () { window.location.replace(copy.returnUrl); }, 250);
      return true;
    }

    function scheduleNext() {
      if (completed) return;
      if (new Date().getTime() - started > 45000) {
        completed = true;
        removeSpinner();
        message.textContent = copy.timeout;
        detail.textContent = copy.retry;
        return;
      }
      window.setTimeout(check, 1200);
    }

    function check() {
      if (completed) return;
      var request = new XMLHttpRequest();
      var settled = false;

      function settle(state) {
        if (settled) return;
        settled = true;
        if (!finish(state)) scheduleNext();
      }

      request.onreadystatechange = function () {
        if (request.readyState !== 4) return;
        if (request.status >= 200 && request.status < 300) {
          try { settle(JSON.parse(request.responseText)); } catch (error) { settle(null); }
        } else {
          settle(null);
        }
      };
      request.onerror = function () { settle(null); };
      request.ontimeout = function () { settle(null); };
      try {
        request.open('GET', '/portal/status?_=' + new Date().getTime(), true);
        request.timeout = 8000;
        request.setRequestHeader('Accept', 'application/json');
        request.send(null);
      } catch (error) {
        settle(null);
      }
    }

    check();
  }());
  </script>`;
  return page(copy.waiting, body, language);
}

function renderInvalid(language = 'ja') {
  const selectedLanguage = languageFor(language);
  const copy = COPY[selectedLanguage];
  return page(copy.title, `<h1>${escapeHtml(copy.title)}</h1><p class="error">${escapeHtml(copy.invalid)}</p>${renderLoginLink()}`, selectedLanguage);
}

function renderLoginLink() {
  // Resolve the current device on the router instead of reusing a stale FAS
  // identity or relying on the OS to reopen its captive assistant.
  return '<p><a class="button-link" href="https://kawachinagano.ox.gy:4444/captive-portal/login">Wi-Fi ログイン / Sign in / 重新登录</a></p>';
}

function renderReady() {
  return page('Check-in Wi-Fi', `<h1>Check-in Wi-Fi</h1><p class="subtle">Wi-Fi に接続してログインしてください。 / Connect to guest Wi-Fi to sign in. / 请连接客用 Wi-Fi 后登录。</p>${renderLoginLink()}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8192) {
        reject(new Error('Request body too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authDirectory(gatewayHash) {
  if (!/^[a-f0-9]{64}$/.test(gatewayHash)) throw new Error('Invalid gateway hash');
  return path.join(AUTH_DIR, gatewayHash);
}

function authFile(gatewayHash, responseHid) {
  if (!/^[a-f0-9]{64}$/.test(responseHid)) throw new Error('Invalid response HID');
  return path.join(authDirectory(gatewayHash), responseHid);
}

function authReceiptFile(gatewayHash, responseHid) {
  if (!/^[a-f0-9]{64}$/.test(responseHid)) throw new Error('Invalid response HID');
  return path.join(authDirectory(gatewayHash), `.ack-${responseHid}`);
}

function removeAuthorizationReceipt(gatewayHash, responseHid) {
  try { fs.unlinkSync(authReceiptFile(gatewayHash, responseHid)); } catch { /* No receipt to remove. */ }
}

function storeAuthorizationReceipt(gatewayHash, responseHid, timestamp) {
  const directory = authDirectory(gatewayHash);
  const destination = authReceiptFile(gatewayHash, responseHid);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const temporary = path.join(directory, `.receipt.${responseHid}.${randomId()}`);
  fs.writeFileSync(temporary, `${timestamp}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, destination);
}

function consumeAuthorizationReceipt(gatewayHash, responseHid) {
  const receipt = authReceiptFile(gatewayHash, responseHid);
  try {
    const stats = fs.statSync(receipt);
    const timestamp = Number.parseInt(fs.readFileSync(receipt, 'utf8').trim(), 10);
    fs.unlinkSync(receipt);
    if (stats.mtimeMs < now() - AUTH_RECEIPT_TTL_MS || !Number.isSafeInteger(timestamp)) return null;
    return timestamp;
  } catch {
    return null;
  }
}

function removeExpiredEntries(gatewayHash) {
  const directory = authDirectory(gatewayHash);
  if (!fs.existsSync(directory)) return;
  const expiry = now() - AUTH_ENTRY_TTL_MS;
  const receiptExpiry = now() - AUTH_RECEIPT_TTL_MS;
  for (const filename of fs.readdirSync(directory)) {
    const isEntry = /^[a-f0-9]{64}$/.test(filename);
    const isReceipt = /^\.ack-[a-f0-9]{64}$/.test(filename);
    if (!isEntry && !isReceipt) continue;
    const file = path.join(directory, filename);
    try {
      if (fs.statSync(file).mtimeMs < (isEntry ? expiry : receiptExpiry)) fs.unlinkSync(file);
    } catch { /* A concurrent authmon acknowledgement may have removed it. */ }
  }
}

function listAuthEntries(gatewayHash) {
  const directory = authDirectory(gatewayHash);
  if (!fs.existsSync(directory)) return [];
  removeExpiredEntries(gatewayHash);
  return fs.readdirSync(directory)
    .filter((filename) => /^[a-f0-9]{64}$/.test(filename))
    .sort()
    .flatMap((filename) => {
      try {
        const value = fs.readFileSync(path.join(directory, filename), 'utf8').trim();
        return value ? [{ id: filename, value }] : [];
      } catch {
        return [];
      }
    });
}

function queueAuthorization(session) {
  const responseHid = session.responseHid || sha256(`${session.hid}${FAS_KEY}`);
  const custom = Buffer.from(`rules_accepted=1,accepted_at=${new Date().toISOString()}`, 'utf8').toString('base64');
  const entry = `${responseHid} 0 0 0 0 0 ${custom}\n`;
  const directory = authDirectory(session.gatewayHash);
  const destination = authFile(session.gatewayHash, responseHid);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  if (!fs.existsSync(destination)) {
    const temporary = path.join(directory, `.${responseHid}.${randomId()}`);
    fs.writeFileSync(temporary, entry, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, destination);
  }
  return responseHid;
}

function acknowledgeAuthorization(gatewayHash, responseHid) {
  const timestamp = now();
  storeAuthorizationReceipt(gatewayHash, responseHid, timestamp);
  for (const session of sessions.values()) {
    if (
      session.gatewayHash === gatewayHash &&
      session.responseHid === responseHid &&
      session.expiresAt >= timestamp
    ) {
      session.authorizedAt = timestamp;
    }
  }
}

function handleAuthGet(res, url) {
  const action = url.searchParams.get('auth_get');
  const gatewayHash = url.searchParams.get('gatewayhash') || '';
  if (!['list', 'view', 'clear', 'deauthed', 'custom'].includes(action) || !/^[a-f0-9]{64}$/.test(gatewayHash)) {
    return send(res, 400, '');
  }

  if (action === 'deauthed' || action === 'custom') return send(res, 200, 'ack', { 'content-type': 'text/plain; charset=utf-8' });

  const directory = authDirectory(gatewayHash);
  if (action === 'clear') {
    if (fs.existsSync(directory)) {
      for (const { id } of listAuthEntries(gatewayHash)) {
        try { fs.unlinkSync(authFile(gatewayHash, id)); } catch { /* Already handled. */ }
      }
    }
    return send(res, 200, '', { 'content-type': 'text/plain; charset=utf-8' });
  }

  // openNDS base64-encodes every payload, including the sentinel `none` used
  // when it is asking to view the pending authorisations.  Compare the
  // decoded value so that `bm9uZQ==` is not mistaken for an acknowledgement.
  const encodedPayload = url.searchParams.get('payload') || 'none';
  const payload = encodedPayload === 'none' ? 'none' : decodeBase64(encodedPayload);
  if (action === 'view' && payload !== null && payload !== 'none') {
    // authmon may acknowledge up to four clients in one space-separated
    // payload. Only an explicit response HID here means ndsctl reported that
    // exact client as authenticated; queue cleanup alone is not success.
    const acknowledged = payload.split(/\s+/).filter((value) => /^[a-f0-9]{64}$/.test(value));
    for (const responseHid of acknowledged) {
      acknowledgeAuthorization(gatewayHash, responseHid);
      try { fs.unlinkSync(authFile(gatewayHash, responseHid)); } catch { /* Already handled. */ }
    }
    return send(res, 200, 'ack', { 'content-type': 'text/plain; charset=utf-8' });
  }

  const entries = listAuthEntries(gatewayHash);
  const reply = entries.length === 0 ? '*' : `* ${entries.map(({ value }) => encodeURIComponent(value)).join(' ')}`;
  if (action === 'list') {
    for (const { id } of entries) {
      try { fs.unlinkSync(authFile(gatewayHash, id)); } catch { /* Already handled. */ }
    }
  }
  return send(res, 200, reply, { 'content-type': 'text/plain; charset=utf-8' });
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz' && req.method === 'GET') return sendJson(res, 200, { ok: true });

  if (url.pathname === '/portal' && req.method === 'GET' && url.searchParams.has('auth_get')) {
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${AUTHMON_TOKEN}`);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }
    return handleAuthGet(res, url);
  }

  if (url.pathname === '/portal' && req.method === 'GET') {
    const encodedFas = url.searchParams.get('fas');
    // openNDS probes the configured FAS URL without a query string.  A 200
    // response here confirms the service is reachable; a real guest request
    // carries the encoded `fas` data handled below. It is not a router acknowledgement.
    if (!encodedFas) return sendHtml(res, 200, renderReady());
    const fas = parseFasRequest(encodedFas);
    if (!fas) return sendHtml(res, 400, renderInvalid(languageFromRequest(req)));
    cleanupSessions();
    const id = randomId();
    const session = {
      ...fas,
      csrf: randomId(),
      expiresAt: now() + SESSION_TTL_MS,
      approvalRequested: false,
      authorizedAt: null,
      language: languageFromRequest(req)
    };
    sessions.set(id, session);
    return sendHtml(res, 200, renderPortal(session), {
      'set-cookie': `checkin_portal_session=${id}; Path=/portal; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Strict`,
      'content-language': session.language,
      'vary': 'accept-language, user-agent'
    });
  }

  if (url.pathname === '/portal/agree' && req.method === 'POST') {
    let fields;
    try {
      fields = new URLSearchParams(await readBody(req));
    } catch {
      return sendHtml(res, 413, renderInvalid(languageFromRequest(req)));
    }
    const activeSession = getSession(req);
    if (!activeSession || fields.get('accepted') !== 'yes' || fields.get('csrf') !== activeSession.csrf) {
      const language = activeSession ? activeSession.language : languageFromRequest(req);
      return sendHtml(res, 400, renderInvalid(language), { 'content-language': language });
    }
    const session = sessions.get(activeSession.id);
    session.responseHid = sha256(`${session.hid}${FAS_KEY}`);
    session.approvalRequested = true;
    session.expiresAt = now() + APPROVAL_TTL_MS;
    // Clear a receipt from an earlier connection attempt before publishing
    // this request. The router acknowledgement is then recorded durably.
    removeAuthorizationReceipt(session.gatewayHash, session.responseHid);
    queueAuthorization(session);
    return sendHtml(res, 200, renderWaiting(session), { 'content-language': session.language });
  }

  if (url.pathname === '/portal/status' && req.method === 'GET') {
    const activeSession = getSession(req);
    if (!activeSession || !activeSession.approvalRequested || !activeSession.responseHid) return sendJson(res, 400, { authorized: false });
    const session = sessions.get(activeSession.id);
    if (!session.authorizedAt) {
      session.authorizedAt = consumeAuthorizationReceipt(session.gatewayHash, session.responseHid);
    }
    if (!session.authorizedAt && !fs.existsSync(authFile(session.gatewayHash, session.responseHid))) {
      // Recover from an authmon restart or an administrative queue clear.
      // The request remains bounded by the approval/session expiry time.
      queueAuthorization(session);
    }
    const authorized = Boolean(session.authorizedAt);
    if (!authorized) return sendJson(res, 200, { authorized: false });

    if (!session.checkinGuidance) {
      try {
        session.checkinGuidance = getCheckinGuidance();
      } catch (error) {
        // Guest internet access must never depend on Hostex/check-in data health.
        console.error(`Unable to evaluate check-in guidance: ${error.message}`);
        session.checkinGuidance = { required: false, reservationCode: null };
      }
    }
    const guidance = session.checkinGuidance;
    return sendJson(res, 200, {
      authorized: true,
      checkinRequired: guidance.required,
      checkinUrl: guidance.required
        ? checkinUrlForLanguage(session.language, guidance.reservationCode)
        : undefined
    });
  }

  return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    console.error('Unhandled portal error:', error.message);
    if (!res.headersSent) send(res, 500, 'Internal server error', { 'content-type': 'text/plain; charset=utf-8' });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`checkin captive portal listening on ${HOST}:${PORT}`);
});

setInterval(cleanupSessions, 60_000).unref();
