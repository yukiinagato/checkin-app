'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');
const STEP_TEMPLATES = require('./stepTemplates');
const COMPLETION_TEMPLATES = require('./completionTemplates');

const envPath = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
require('dotenv').config({ path: path.resolve(__dirname, envPath) });

const { createLogger } = require('./src/logger');
const {
  openDatabase,
  applyPragmas,
  runMigrations,
  closeDatabase,
  runAsync,
  allAsync,
  getAsync
} = require('./src/db');
const { createSelectionService, fullNameMatches } = require('./src/reservationSelection');
const { createTTLockClient, createOrderAccess, receiptToken, validReceipt } = require('./src/ttlock');
const { AdminSessionStore } = require('./src/sessions');
const { Semaphore } = require('./src/semaphore');
const { createHostexClient } = require('./src/hostex');
const { createReservationLinker, createReservationReconciler } = require('./src/reservationLinks');
const { createHostexSync, dedupeReservationPhotos } = require('./src/hostexSync');
const { createOcrWorkerPool } = require('./src/ocrWorkerPool');

const logger = createLogger();
const encoder = new TextEncoder();

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY || 'loopback';
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '10mb';
const SMALL_JSON_BODY_LIMIT = process.env.SMALL_JSON_BODY_LIMIT || '256kb';
const MAX_IMAGE_BYTES = Number.parseInt(process.env.MAX_IMAGE_BYTES || `${10 * 1024 * 1024}`, 10);
const MAX_GUESTS_PER_SUBMISSION = Number.parseInt(process.env.MAX_GUESTS_PER_SUBMISSION || '12', 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10);
const MAX_TEXT_FIELD_LENGTH = Number.parseInt(process.env.MAX_TEXT_FIELD_LENGTH || '200', 10);
const MAX_PASSPORT_NUMBER_LENGTH = Number.parseInt(process.env.MAX_PASSPORT_NUMBER_LENGTH || '32', 10);
const OCR_MAX_CONCURRENCY = Number.parseInt(process.env.OCR_MAX_CONCURRENCY || '2', 10);
const OCR_QUEUE_TIMEOUT_MS = Number.parseInt(process.env.OCR_QUEUE_TIMEOUT_MS || '15000', 10);
// 護照 OCR 是 CPU 密集的同步推理，遠超一般請求；單獨放寬，其餘路由仍用 REQUEST_TIMEOUT_MS。
const OCR_REQUEST_TIMEOUT_MS = Number.parseInt(process.env.OCR_REQUEST_TIMEOUT_MS || '180000', 10);
const SESSION_BACKEND = 'sqlite';

// Hostex 訂單同步（未配 token 時全部功能靜默停用）
const HOSTEX_API_TOKEN = process.env.HOSTEX_API_TOKEN || '';
const HOSTEX_PROPERTY_ID = process.env.HOSTEX_PROPERTY_ID || '';
const HOSTEX_SYNC_INTERVAL_MS = Number.parseInt(process.env.HOSTEX_SYNC_INTERVAL_MS || '600000', 10);
const HOSTEX_SYNC_PAST_DAYS = Number.parseInt(process.env.HOSTEX_SYNC_PAST_DAYS || '7', 10);
const HOSTEX_SYNC_FUTURE_DAYS = Number.parseInt(process.env.HOSTEX_SYNC_FUTURE_DAYS || '60', 10);
const HOSTEX_ENABLED = Boolean(HOSTEX_API_TOKEN && HOSTEX_PROPERTY_ID);
// 客人照片回顯令牌有效期
const RESERVATION_PHOTO_TOKEN_TTL_MS = 30 * 60 * 1000;

// ----------------------------------------------------------------------
// 1. 環境變數檢查
// ----------------------------------------------------------------------
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
if (!ADMIN_API_TOKEN) {
  throw new Error('ADMIN_API_TOKEN is required');
}

const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Checkin Admin';
const EXPECTED_ORIGIN = (process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');

const CORS_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

if (!CORS_ORIGINS.length) {
  throw new Error('CORS_ORIGIN is required (comma-separated origins)');
}

if (!Number.isFinite(MAX_IMAGE_BYTES) || MAX_IMAGE_BYTES <= 0) {
  throw new Error('MAX_IMAGE_BYTES must be a positive integer');
}

if (!Number.isFinite(MAX_GUESTS_PER_SUBMISSION) || MAX_GUESTS_PER_SUBMISSION <= 0) {
  throw new Error('MAX_GUESTS_PER_SUBMISSION must be a positive integer');
}

if (!Number.isFinite(REQUEST_TIMEOUT_MS) || REQUEST_TIMEOUT_MS <= 0) {
  throw new Error('REQUEST_TIMEOUT_MS must be a positive integer');
}

if (!Number.isFinite(OCR_MAX_CONCURRENCY) || OCR_MAX_CONCURRENCY <= 0) {
  throw new Error('OCR_MAX_CONCURRENCY must be a positive integer');
}

if (!Number.isFinite(OCR_REQUEST_TIMEOUT_MS) || OCR_REQUEST_TIMEOUT_MS <= 0) {
  throw new Error('OCR_REQUEST_TIMEOUT_MS must be a positive integer');
}

// 防止只配 token 不配房源時把全帳號訂單同步進來
if (HOSTEX_API_TOKEN && !HOSTEX_PROPERTY_ID) {
  throw new Error('HOSTEX_PROPERTY_ID is required when HOSTEX_API_TOKEN is set');
}

// ----------------------------------------------------------------------
// 2. 中間件配置
// ----------------------------------------------------------------------
app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY);
app.use(cors({ origin: CORS_ORIGINS }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // CDN entry retained for legacy WASM OCR fallback paths and pinned by tests.
      'script-src': ["'self'", 'cdn.jsdelivr.net'],
      'connect-src': ["'self'", 'https://zipcloud.ibsnet.co.jp']
    }
  }
}));

// Per-route JSON body limits: image-bearing routes get JSON_BODY_LIMIT,
// everything else is capped at SMALL_JSON_BODY_LIMIT to shrink the abuse surface.
const LARGE_BODY_PATHS = new Set([
  '/api/submit',
  '/api/ocr/passport',
  '/api/admin/steps',
  '/api/admin/completion-template'
]);
const smallJsonParser = express.json({ limit: SMALL_JSON_BODY_LIMIT });
const largeJsonParser = express.json({ limit: JSON_BODY_LIMIT });
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  const parser = LARGE_BODY_PATHS.has(req.path) ? largeJsonParser : smallJsonParser;
  return parser(req, res, next);
});
// Fallback parser; previous middleware will have already parsed the body so this is a no-op,
// retained as a defensive default for any future routes not in LARGE_BODY_PATHS.
app.use(express.json({ limit: SMALL_JSON_BODY_LIMIT }));

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  res.setTimeout(REQUEST_TIMEOUT_MS);
  next();
});
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const payload = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs,
      requestId: req.requestId
    };
    if (res.statusCode >= 500) logger.error(payload, 'request');
    else if (res.statusCode >= 400) logger.warn(payload, 'request');
    else logger.info(payload, 'request');
  });
  next();
});

// Helper: log internal errors with full detail but only return generic 5xx to clients.
const sendInternal = (req, res, err, hint) => {
  logger.error({
    err: err?.message || String(err),
    stack: err?.stack,
    requestId: req?.requestId,
    hint
  }, 'request failed');
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal Server Error',
      requestId: req?.requestId
    });
  }
};

// ----------------------------------------------------------------------
// 3. 初始化存儲路徑
// ----------------------------------------------------------------------
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'hotel.db');
const CLIENT_DIST_DIR = path.resolve(__dirname, process.env.CLIENT_DIST_DIR || path.join('..', 'client', 'dist'));
const PADDLE_OCR_PYTHON_PATH = process.env.PADDLE_OCR_PYTHON_PATH || process.env.PADDLE_OCR_PYTHON || 'python3';
const PADDLE_OCR_RUNNER = process.env.PADDLE_OCR_RUNNER || path.join(__dirname, 'tools', 'paddle_ocr_runner.py');
const PADDLE_OCR_WORKER = process.env.PADDLE_OCR_WORKER || path.join(__dirname, 'tools', 'paddle_ocr_worker.py');
const OCR_CACHE_HOME = path.resolve(__dirname, process.env.CHECKIN_OCR_HOME || path.join('.cache', 'home'));
const OCR_CACHE_DIR = path.resolve(__dirname, process.env.XDG_CACHE_HOME || '.cache');
const OCR_PADDLE_HOME = path.resolve(__dirname, process.env.PADDLE_HOME || '.paddle');
const OCR_MODEL_HOME = path.resolve(__dirname, process.env.PADDLEOCR_HOME || '.ocr-models');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const {
  BUILTIN_FIELD_KEYS,
  ALWAYS_ENABLED_BUILTINS,
  DEFAULT_GUEST_FIELDS_CONFIG,
  sanitizeGuestFieldsConfig,
  isBuiltinEnabled,
  getActiveCustomFields
} = require('./guestFieldsConfig');

const DEFAULT_APP_SETTINGS = Object.freeze({
  taiwanNamingMode: 'locale-default',
  guestFieldsConfig: DEFAULT_GUEST_FIELDS_CONFIG
});
const TAIWAN_NAMING_MODES = new Set(['locale-default', 'neutral', 'cn', 'roc']);
const ALLOWED_IMAGE_TYPES = new Map([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif'
].map((mime) => [mime, mime === 'image/jpg' ? 'jpg' : mime.split('/')[1]]));
fs.ensureDirSync(UPLOAD_DIR);

// ----------------------------------------------------------------------
// 4. 資料庫與 session store（在 startServer 之前可用，但 hydrate 在 startServer 中執行）
// ----------------------------------------------------------------------
let db = null;
let sessionStore = null;
const ocrSemaphore = new Semaphore(OCR_MAX_CONCURRENCY);

const seedStepTemplates = async () => {
  for (const [lang, steps] of Object.entries(STEP_TEMPLATES)) {
    const row = await getAsync(db, 'SELECT lang FROM step_templates WHERE lang = ?', [lang]);
    if (!row) {
      await runAsync(db, 'INSERT INTO step_templates (lang, steps) VALUES (?, ?)', [lang, JSON.stringify(steps)]);
    }
  }
};

const seedCompletionTemplates = async () => {
  for (const [lang, template] of Object.entries(COMPLETION_TEMPLATES)) {
    const row = await getAsync(db, 'SELECT lang FROM completion_templates WHERE lang = ?', [lang]);
    if (!row) {
      await runAsync(db, 'INSERT INTO completion_templates (lang, template) VALUES (?, ?)', [lang, JSON.stringify(template)]);
    }
  }
};

// ----------------------------------------------------------------------
// 5. 輔助函數：業務邏輯與安全驗證
// ----------------------------------------------------------------------
const persistDataImage = async (dataImage, suffix) => {
  if (typeof dataImage !== 'string' || !dataImage.startsWith('data:image')) return null;
  const matches = dataImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return null;
  const extension = ALLOWED_IMAGE_TYPES.get(matches[1]);
  if (!extension) return null;

  const imageBuffer = Buffer.from(matches[2], 'base64');
  const md5 = crypto.createHash('md5').update(imageBuffer).digest('hex');
  const filename = `${crypto.randomUUID()}_${suffix}.${extension}`;
  const safeUploadDir = path.resolve(UPLOAD_DIR);
  const filePath = path.resolve(safeUploadDir, filename);
  if (!filePath.startsWith(`${safeUploadDir}${path.sep}`)) {
    throw new Error('Invalid upload path');
  }
  await fs.outputFile(filePath, imageBuffer, { flag: 'wx' });
  return { filename, md5 };
};

const saveImagesLocally = async (guests) => {
  const processedGuests = await Promise.all(guests.map(async (guest) => {
    let next = guest;
    if (guest.passportPhoto && typeof guest.passportPhoto === 'string' && guest.passportPhoto.startsWith('data:image')) {
      try {
        const persisted = await persistDataImage(guest.passportPhoto, 'passport');
        if (persisted) {
          next = { ...next, passportPhoto: persisted.filename, passportPhotoMd5: persisted.md5 };
        }
      } catch (err) {
        logger.error({ err: err.message, guestId: guest?.id }, 'failed to save guest image');
      }
    }

    if (next.customFields && typeof next.customFields === 'object') {
      const customFields = { ...next.customFields };
      let touched = false;
      for (const [key, value] of Object.entries(customFields)) {
        if (typeof value === 'string' && value.startsWith('data:image')) {
          try {
            const persisted = await persistDataImage(value, 'custom');
            if (persisted) {
              customFields[key] = persisted.filename;
              touched = true;
            }
          } catch (err) {
            logger.error({ err: err.message, guestId: guest?.id, key }, 'failed to save custom field image');
          }
        }
      }
      if (touched) next = { ...next, customFields };
    }
    return next;
  }));
  return processedGuests;
};

const savePassportImage = async (dataImage) => {
  const parsed = parseDataImage(dataImage);
  if (!parsed) {
    throw new Error('Invalid image payload');
  }

  const filename = `${crypto.randomUUID()}_passport.${parsed.extension}`;
  const safeUploadDir = path.resolve(UPLOAD_DIR);
  const filePath = path.resolve(safeUploadDir, filename);
  if (!filePath.startsWith(`${safeUploadDir}${path.sep}`)) {
    throw new Error('Invalid upload path');
  }

  await fs.outputFile(filePath, parsed.buffer, { flag: 'wx' });
  return filename;
};

const parseDataImage = (dataImage) => {
  if (typeof dataImage !== 'string') return null;
  const matches = dataImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return null;
  const extension = ALLOWED_IMAGE_TYPES.get(matches[1]);
  if (!extension) return null;
  const buffer = Buffer.from(matches[2], 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
  return {
    extension,
    mime: matches[1],
    buffer
  };
};

const PROGRESS_PREFIX = '@@PROGRESS@@ ';
const OCR_CHILD_TIMEOUT_MS = 120000;

// 以 spawn 取代 execFile，讓 Python 端的進度事件能邊跑邊往外送。
const spawnPassportOcr = (imagePath, onProgress) => new Promise((resolve, reject) => {
  const child = spawn(PADDLE_OCR_PYTHON_PATH, [PADDLE_OCR_RUNNER, imagePath], {
    cwd: __dirname,
    env: {
      ...process.env,
      HOME: OCR_CACHE_HOME,
      XDG_CACHE_HOME: OCR_CACHE_DIR,
      PADDLE_HOME: OCR_PADDLE_HOME,
      PADDLEOCR_HOME: OCR_MODEL_HOME,
      PYTHONPYCACHEPREFIX: path.join(OCR_CACHE_DIR, 'pycache')
    }
  });

  let stdoutBuffer = '';
  let stderrTail = '';
  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill('SIGKILL');
    reject(new Error('Passport OCR timed out'));
  }, OCR_CHILD_TIMEOUT_MS);

  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fn(value);
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdoutBuffer += chunk; });

  // 進度事件走 stderr，逐行解析；非進度行只保留尾段用於錯誤診斷。
  child.stderr.setEncoding('utf8');
  let stderrBuffer = '';
  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk;
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith(PROGRESS_PREFIX)) {
        try {
          onProgress?.(JSON.parse(line.slice(PROGRESS_PREFIX.length)));
        } catch {
          // 進度解析失敗不影響識別流程
        }
      } else if (line.trim()) {
        stderrTail = `${stderrTail}\n${line}`.slice(-2000);
      }
    }
  });

  child.on('error', (err) => finish(reject, err));

  child.on('close', (code) => {
    if (settled) return;
    const lines = `${stdoutBuffer}\n${stderrTail}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line.startsWith('{') || !line.endsWith('}')) continue;
      try {
        finish(resolve, JSON.parse(line));
        return;
      } catch {
        // continue searching previous lines
      }
    }

    finish(reject, new Error(
      `Passport OCR output does not contain JSON payload (exit ${code})`
    ));
  });
});

// 常駐 worker 池（startServer 中初始化）；不可用時回退到一次性子進程
let ocrWorkerPool = null;

const executePassportOcr = async (imagePath, onProgress) => {
  if (ocrWorkerPool?.isReady()) {
    try {
      return await ocrWorkerPool.run(imagePath, onProgress);
    } catch (err) {
      logger.warn({ err: err.message }, 'ocr worker pool failed, falling back to one-shot process');
    }
  }
  return spawnPassportOcr(imagePath, onProgress);
};

const runLocalPassportOcr = async (dataImage, onProgress) => {
  const parsed = parseDataImage(dataImage);
  if (!parsed) {
    return { success: false, unsupported: true, error: 'Invalid image payload' };
  }

  let release = null;
  try {
    release = await ocrSemaphore.acquire(OCR_QUEUE_TIMEOUT_MS);
  } catch (err) {
    logger.warn({ err: err.message, semaphore: ocrSemaphore.stats() }, 'OCR queue saturated');
    return { success: false, unsupported: true, error: 'OCR_BUSY' };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'passport-ocr-'));
  const imagePath = path.join(tempDir, `passport.${parsed.extension}`);

  try {
    await fs.writeFile(imagePath, parsed.buffer);
    return await executePassportOcr(imagePath, onProgress);
  } catch (error) {
    logger.error({ err: error.message || String(error) }, 'passport OCR failed');
    return {
      success: false,
      unsupported: true,
      error: error.message || 'Passport OCR execution failed'
    };
  } finally {
    if (release) release();
    await fs.remove(tempDir);
  }
};

const parseRecordData = (row) => {
  try {
    return JSON.parse(row.data);
  } catch (error) {
    logger.warn({ err: error.message, recordId: row.id }, 'failed to parse record data');
    return [];
  }
};

const loadAppSettings = () => new Promise((resolve, reject) => {
  db.all('SELECT key, value FROM app_settings', [], (err, rows) => {
    if (err) {
      reject(err);
      return;
    }

    const settings = {
      taiwanNamingMode: DEFAULT_APP_SETTINGS.taiwanNamingMode,
      guestFieldsConfig: sanitizeGuestFieldsConfig(DEFAULT_GUEST_FIELDS_CONFIG),
      hostexSyncEnabled: true
    };
    (rows || []).forEach((row) => {
      if (row.key === 'taiwanNamingMode' && TAIWAN_NAMING_MODES.has(row.value)) {
        settings.taiwanNamingMode = row.value;
      } else if (row.key === 'hostexSyncEnabled') {
        settings.hostexSyncEnabled = row.value !== 'false';
        hostexSyncEnabledCache = settings.hostexSyncEnabled;
      } else if (row.key === 'guestFieldsConfig') {
        try {
          const parsed = JSON.parse(row.value);
          settings.guestFieldsConfig = sanitizeGuestFieldsConfig(parsed);
        } catch (parseErr) {
          logger.warn({ err: parseErr.message }, 'failed to parse guestFieldsConfig — using defaults');
        }
      }
    });

    resolve(settings);
  });
});

const validateAppSettings = (settings) => {
  if (!settings || typeof settings !== 'object') {
    return { valid: false, error: 'settings must be an object' };
  }

  if (settings.taiwanNamingMode && !TAIWAN_NAMING_MODES.has(settings.taiwanNamingMode)) {
    return { valid: false, error: 'Invalid taiwanNamingMode' };
  }

  if (settings.guestFieldsConfig !== undefined && (settings.guestFieldsConfig === null || typeof settings.guestFieldsConfig !== 'object')) {
    return { valid: false, error: 'guestFieldsConfig must be an object' };
  }

  return { valid: true };
};

const SETTING_SERIALIZERS = {
  guestFieldsConfig: (value) => JSON.stringify(sanitizeGuestFieldsConfig(value))
};

const saveAppSettings = (settings) => new Promise((resolve, reject) => {
  const incoming = settings && typeof settings === 'object' ? settings : {};
  const entries = [];
  if (Object.prototype.hasOwnProperty.call(incoming, 'taiwanNamingMode')) {
    entries.push(['taiwanNamingMode', String(incoming.taiwanNamingMode)]);
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'guestFieldsConfig')) {
    entries.push(['guestFieldsConfig', SETTING_SERIALIZERS.guestFieldsConfig(incoming.guestFieldsConfig)]);
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'hostexSyncEnabled')) {
    const enabled = !(incoming.hostexSyncEnabled === false || incoming.hostexSyncEnabled === 'false');
    hostexSyncEnabledCache = enabled;
    entries.push(['hostexSyncEnabled', enabled ? 'true' : 'false']);
  }

  if (entries.length === 0) {
    resolve();
    return;
  }

  db.serialize(() => {
    const stmt = db.prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = CURRENT_TIMESTAMP`
    );

    entries.forEach(([key, value]) => {
      stmt.run([key, value]);
    });

    stmt.finalize((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

const parseAge = (value) => Number.parseInt(String(value ?? '').trim(), 10);
const parseDateOnly = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed;
};
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isSafeTextField = (value, maxLength = MAX_TEXT_FIELD_LENGTH) => {
  if (!isNonEmptyString(value)) return false;
  return value.trim().length <= maxLength;
};
const normalizeBoolean = (value) => value === true;

const ALLOWED_TABLES = {
  step_templates:       { steps:    true },
  completion_templates: { template: true }
};

const getTemplateRowWithFallback = (tableName, columnName, targetLang, fallbackLang = 'jp') => new Promise((resolve, reject) => {
  if (!ALLOWED_TABLES[tableName]?.[columnName]) {
    reject(new Error('Invalid table or column'));
    return;
  }

  const preferred = typeof targetLang === 'string' && targetLang.trim() ? targetLang.trim() : fallbackLang;
  const sql = `
    SELECT lang, ${columnName} AS payload
    FROM ${tableName}
    WHERE lang IN (?, ?)
    ORDER BY CASE WHEN lang = ? THEN 0 WHEN lang = ? THEN 1 ELSE 2 END
    LIMIT 1
  `;

  db.get(sql, [preferred, fallbackLang, preferred, fallbackLang], (err, row) => {
    if (err) {
      reject(err);
      return;
    }
    resolve({
      requestedLang: preferred,
      resolvedLang: row?.lang || null,
      payload: row?.payload || null
    });
  });
});

const validateCustomFieldValueServer = (field, value) => {
  const isEmpty =
    value === undefined ||
    value === null ||
    value === '' ||
    (field.type === 'checkbox' && value === false && !field.required);
  if (field.required && field.type === 'checkbox' && value !== true) {
    return { valid: false, error: `Custom field "${field.key}" is required` };
  }
  if (field.required && isEmpty && field.type !== 'checkbox') {
    return { valid: false, error: `Custom field "${field.key}" is required` };
  }
  if (isEmpty && !field.required) return { valid: true };

  switch (field.type) {
    case 'text': {
      if (typeof value !== 'string') return { valid: false, error: `Custom field "${field.key}" must be a string` };
      const len = value.trim().length;
      const v = field.validation || {};
      if (Number.isInteger(v.minLength) && len < v.minLength) return { valid: false, error: `Custom field "${field.key}" too short` };
      if (Number.isInteger(v.maxLength) && len > v.maxLength) return { valid: false, error: `Custom field "${field.key}" too long` };
      if (value.length > 4000) return { valid: false, error: `Custom field "${field.key}" too long` };
      if (v.regex) {
        try { if (!new RegExp(v.regex).test(value)) return { valid: false, error: v.regexMessage || `Custom field "${field.key}" format invalid` }; }
        catch { /* invalid stored regex, skip */ }
      }
      return { valid: true };
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return { valid: false, error: `Custom field "${field.key}" must be a number` };
      const v = field.validation || {};
      if (Number.isFinite(v.min) && n < v.min) return { valid: false, error: `Custom field "${field.key}" below min` };
      if (Number.isFinite(v.max) && n > v.max) return { valid: false, error: `Custom field "${field.key}" above max` };
      return { valid: true };
    }
    case 'date': {
      if (typeof value !== 'string' || !parseDateOnly(value)) return { valid: false, error: `Custom field "${field.key}" invalid date` };
      const v = field.validation || {};
      if (v.min && value < v.min) return { valid: false, error: `Custom field "${field.key}" date too early` };
      if (v.max && value > v.max) return { valid: false, error: `Custom field "${field.key}" date too late` };
      return { valid: true };
    }
    case 'select': {
      if (!Array.isArray(field.options) || !field.options.some((o) => o.value === value)) {
        return { valid: false, error: `Custom field "${field.key}" has invalid option` };
      }
      return { valid: true };
    }
    case 'checkbox':
      if (typeof value !== 'boolean') return { valid: false, error: `Custom field "${field.key}" must be boolean` };
      return { valid: true };
    case 'file': {
      if (typeof value !== 'string' || value.length === 0) return { valid: false, error: `Custom field "${field.key}" file missing` };
      if (!parseDataImage(value) && !/^[0-9a-f-]+_custom\.[a-z0-9]+$/i.test(value)) {
        return { valid: false, error: `Custom field "${field.key}" invalid file payload` };
      }
      return { valid: true };
    }
    default:
      return { valid: true };
  }
};

const validateGuestPayload = (guest, config = DEFAULT_GUEST_FIELDS_CONFIG) => {
  if (!guest || typeof guest !== 'object') {
    return { valid: false, error: 'Invalid guest item' };
  }

  // name is always required
  const name = typeof guest.name === 'string' ? guest.name.trim() : '';
  if (!isSafeTextField(name)) {
    return { valid: false, error: 'Guest name is invalid' };
  }

  // age may be disabled; if enabled, must be valid 0-120
  const ageEnabled = isBuiltinEnabled(config, 'age');
  let age = NaN;
  if (ageEnabled) {
    age = parseAge(guest.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) {
      return { valid: false, error: 'Guest age is invalid' };
    }
  }

  const isResident = normalizeBoolean(guest.isResident);
  const isMinor = ageEnabled && age < 18;

  // Guardian fields only enforced when both age + guardian fields enabled and minor.
  if (isMinor) {
    if (isBuiltinEnabled(config, 'guardianName')) {
      const guardianName = typeof guest.guardianName === 'string' ? guest.guardianName.trim() : '';
      if (!isSafeTextField(guardianName)) return { valid: false, error: 'Minor guest must include guardian name' };
    }
    if (isBuiltinEnabled(config, 'guardianPhone')) {
      const guardianPhone = typeof guest.guardianPhone === 'string' ? guest.guardianPhone.trim() : '';
      if (!isSafeTextField(guardianPhone)) return { valid: false, error: 'Minor guest must include guardian phone' };
    }
  }

  if (isResident) {
    if (isBuiltinEnabled(config, 'address')) {
      const address = typeof guest.address === 'string' ? guest.address.trim() : '';
      if (!isSafeTextField(address)) return { valid: false, error: 'Resident guest info is incomplete' };
    }
    if (isBuiltinEnabled(config, 'phone')) {
      // phone required for adults (or when age disabled, always required)
      const needsPhone = !ageEnabled || age >= 16;
      const phone = typeof guest.phone === 'string' ? guest.phone.trim() : '';
      if (needsPhone && !isSafeTextField(phone)) return { valid: false, error: 'Resident guest info is incomplete' };
    }
  } else {
    if (isBuiltinEnabled(config, 'nationality')) {
      const nationality = typeof guest.nationality === 'string' ? guest.nationality.trim() : '';
      if (!isSafeTextField(nationality)) return { valid: false, error: 'Visitor guest info is incomplete' };
    }
    if (isBuiltinEnabled(config, 'passportNumber')) {
      const passportNumber = typeof guest.passportNumber === 'string' ? guest.passportNumber.trim() : '';
      if (!isSafeTextField(passportNumber, MAX_PASSPORT_NUMBER_LENGTH)) return { valid: false, error: 'Visitor guest info is incomplete' };
    }
    if (isBuiltinEnabled(config, 'passportPhoto')) {
      const hasPhoto = typeof guest.passportPhoto === 'string' && guest.passportPhoto.length > 0;
      if (!hasPhoto) return { valid: false, error: 'Visitor guest info is incomplete' };
      if (!parseDataImage(guest.passportPhoto) && !/^[0-9a-f-]+_passport\.[a-z0-9]+$/i.test(guest.passportPhoto)) {
        return { valid: false, error: 'Visitor passport photo is invalid' };
      }
    }
  }

  // custom fields (only validate ones in scope)
  const customFields = guest.customFields && typeof guest.customFields === 'object' ? guest.customFields : {};
  const activeCustom = getActiveCustomFields(config, { isResident });
  for (const field of activeCustom) {
    const value = customFields[field.key];
    const result = validateCustomFieldValueServer(field, value);
    if (!result.valid) return result;
  }

  return { valid: true };
};

const validateSubmissionPayload = (payload, config = DEFAULT_GUEST_FIELDS_CONFIG) => {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }

  const { guests, checkIn, checkOut } = payload;
  if (!Array.isArray(guests) || guests.length === 0) {
    return { valid: false, error: 'Invalid guest payload' };
  }

  if (guests.length > MAX_GUESTS_PER_SUBMISSION) {
    return { valid: false, error: `Guest count exceeds limit (${MAX_GUESTS_PER_SUBMISSION})` };
  }

  const normalizedCheckIn = checkIn == null || checkIn === '' ? null : parseDateOnly(checkIn);
  const normalizedCheckOut = checkOut == null || checkOut === '' ? null : parseDateOnly(checkOut);
  if ((checkIn != null && checkIn !== '' && !normalizedCheckIn) || (checkOut != null && checkOut !== '' && !normalizedCheckOut)) {
    return { valid: false, error: 'Invalid check-in/check-out date' };
  }
  if (normalizedCheckIn && normalizedCheckOut && normalizedCheckOut < normalizedCheckIn) {
    return { valid: false, error: 'checkOut must be on or after checkIn' };
  }

  for (const guest of guests) {
    const validation = validateGuestPayload(guest, config);
    if (!validation.valid) return validation;
  }

  return {
    valid: true,
    normalized: {
      guests,
      checkIn: normalizedCheckIn,
      checkOut: normalizedCheckOut,
      submissionId: payload.submissionId
    }
  };
};

const adminChallenges = new Map();
// adminSessions exposes a Map-like API but is backed by SQLite (see AdminSessionStore).
let adminSessions = null;
// Hostex 同步實例（startServer 中構建）；enabled 快取供輪詢間隔判斷
let hostexSync = null;
const reconcileReservationLinks = createReservationReconciler({ db: null, allAsync: (_, ...args) => allAsync(db, ...args), runAsync: (_, ...args) => runAsync(db, ...args), logger });
const reconcileLinksSafely = () => reconcileReservationLinks().catch((err) => logger.warn({ err: err.message }, 'registration reconciliation failed'));
let hostexSyncEnabledCache = true;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// 客人照片回顯令牌：lookup 時簽發，短時效、一 token 對應一個已下載的護照檔名
const reservationPhotoTokens = new Map();

const issueReservationPhotoToken = (filename) => {
  const token = crypto.randomBytes(32).toString('hex');
  reservationPhotoTokens.set(token, {
    filename,
    expiresAt: Date.now() + RESERVATION_PHOTO_TOKEN_TTL_MS
  });
  return token;
};

const purgeExpiredEntries = () => {
  const now = Date.now();
  for (const [key, value] of adminChallenges) {
    if (value.expiresAt < now) adminChallenges.delete(key);
  }
  for (const [token, value] of reservationPhotoTokens) {
    if (value.expiresAt < now) reservationPhotoTokens.delete(token);
  }
  if (!adminSessions) return;
  for (const [token, expiresAt] of adminSessions) {
    if (expiresAt < now) adminSessions.delete(token);
  }
  void adminSessions.purgeExpired();
};

const cleanupInterval = setInterval(purgeExpiredEntries, 5 * 60 * 1000);
cleanupInterval.unref();

const normalizeChallenge = (str) => {
  if (!str) return '';
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const createChallenge = (purpose, context = {}) => {
  const raw = crypto.randomBytes(32).toString('base64url');
  const challenge = normalizeChallenge(raw);
  adminChallenges.set(challenge, { ...context, purpose, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return challenge;
};

const consumeChallenge = (challenge, purpose) => {
  const norm = normalizeChallenge(challenge);

  if (adminChallenges.has(norm)) {
    const found = adminChallenges.get(norm);
    adminChallenges.delete(norm);
    if (found.purpose !== purpose) {
      logger.warn({ expected: purpose, actual: found.purpose }, 'challenge purpose mismatch');
      return false;
    }
    if (found.expiresAt < Date.now()) {
      logger.warn('challenge expired');
      return false;
    }
    return found;
  }

  // Some clients double-encode the challenge; try decoding once before giving up.
  try {
    const decoded = Buffer.from(norm, 'base64url').toString('utf-8');
    const decodedNorm = normalizeChallenge(decoded);
    if (adminChallenges.has(decodedNorm)) {
      const found = adminChallenges.get(decodedNorm);
      adminChallenges.delete(decodedNorm);
      if (found.purpose !== purpose) {
        logger.warn({ expected: purpose, actual: found.purpose }, 'challenge purpose mismatch (decoded)');
        return false;
      }
      if (found.expiresAt < Date.now()) {
        logger.warn('challenge expired (decoded)');
        return false;
      }
      return found;
    }
  } catch (e) {
    // ignore decode errors and fall through
  }

  logger.warn({ key: norm }, 'challenge not found');
  return false;
};

const createSessionToken = async (epoch, credentialId) => {
  const token = crypto.randomBytes(32).toString('hex');
  // The conditional insert also covers a reset occurring during WebAuthn verification.
  const result = await runAsync(db, `INSERT INTO admin_sessions (token, expires_at)
    SELECT ?, ? WHERE EXISTS (SELECT 1 FROM admin_auth_state WHERE id=1 AND epoch=?)
    AND EXISTS (SELECT 1 FROM admin_passkeys WHERE credential_id=?)`,
  [token, Date.now() + SESSION_TTL_MS, epoch, credentialId]);
  return result.changes === 1 ? token : null;
};

const registrationTokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

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

const requireAdminAuth = async (req, res, next) => {
  try {
    if (!await adminSessions?.isActive(getAdminSessionFromRequest(req))) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  } catch (err) {
    sendInternal(req, res, err, 'validate admin session');
  }
};

const extractChallengeFromCredential = (credential) => {
  try {
    const clientDataJSON = credential?.response?.clientDataJSON;
    if (!clientDataJSON) return '';
    const decoded = Buffer.from(clientDataJSON, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    return normalizeChallenge(parsed.challenge);
  } catch (error) {
    logger.warn({ err: error.message }, 'failed to parse clientDataJSON');
    return '';
  }
};

const toAdminImageUrl = (passportPhoto) => {
  if (typeof passportPhoto !== 'string' || !passportPhoto) {
    return passportPhoto;
  }
  if (passportPhoto.startsWith('/api/admin/uploads/')) {
    return passportPhoto;
  }
  const rawName = passportPhoto
    .replace(/^https?:\/\/[^/]+\/uploads\//, '')
    .replace(/^\/uploads\//, '');
  return process.env.WEBAUTHN_ORIGIN + `/api/admin/uploads/${encodeURIComponent(rawName)}`;
};

// ----------------------------------------------------------------------
// 6. 限流規則
// ----------------------------------------------------------------------
const ocrRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '請求過於頻繁，護照 OCR 每分鐘最多 10 次，請稍後再試。' }
});

const submitRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '請求過於頻繁，表單提交每分鐘最多 20 次，請稍後再試。' }
});

const authVerifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '驗證嘗試次數過多，每 15 分鐘最多 10 次，請稍後再試。' }
});

const lookupRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { found: false, error: '查詢過於頻繁，每 10 分鐘最多 10 次，請稍後再試。' }
});

const shouldServeClientBuild = () => process.env.NODE_ENV === 'production';
const canServeClientBuild = async () => fs.pathExists(path.join(CLIENT_DIST_DIR, 'index.html'));

const mountClientBuild = () => {
  app.use(express.static(CLIENT_DIST_DIR, {
    index: false,
    maxAge: '1h'
  }));

  app.get('*', async (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    try {
      const hasClientBuild = await canServeClientBuild();
      if (!hasClientBuild) {
        res.status(503).send('Client build is not available. Run `pnpm build` before starting production server.');
        return;
      }
      res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
    } catch (error) {
      next(error);
    }
  });
};

// ----------------------------------------------------------------------
// 7. API 路由
// ----------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'checkin-app-server',
    now: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    sessionBackend: SESSION_BACKEND
  });
});

app.get('/api/ready', (req, res) => {
  if (!db) {
    res.status(503).json({ ok: false, error: 'Database not initialized' });
    return;
  }
  db.get('SELECT 1 AS ok', [], (err) => {
    if (err) {
      res.status(503).json({ ok: false, error: 'Database unavailable' });
      return;
    }
    res.json({ ok: true });
  });
});

app.get('/api/records', requireAdminAuth, (req, res) => {
  db.all("SELECT * FROM checkins ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      sendInternal(req, res, err, 'list records');
      return;
    }
    const records = rows.map((row) => {
      const guests = parseRecordData(row).map((guest) => ({
        ...guest,
        deleted: guest.deleted === true,
        passportPhoto: toAdminImageUrl(guest.passportPhoto)
      }));
      return {
        id: row.id,
        submittedAt: row.created_at,
        checkIn: row.check_in,
        checkOut: row.check_out,
        guests
      };
    });
    res.json(records);
  });
});

app.get('/api/admin/uploads/:filename', requireAdminAuth, async (req, res) => {
  const filename = path.basename(req.params.filename || '');
  const absoluteUploadDir = path.resolve(UPLOAD_DIR);
  const filePath = path.resolve(path.join(absoluteUploadDir, filename));

  if (!filePath.startsWith(absoluteUploadDir)) {
    logger.warn({ filePath, absoluteUploadDir, requestId: req.requestId }, 'upload path traversal blocked');
    return res.status(403).json({ error: 'Invalid file path' });
  }

  const exists = await fs.pathExists(filePath);
  if (!exists) {
    logger.warn({ filePath, requestId: req.requestId }, 'upload not found');
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.sendFile(filePath);
});

app.get('/api/admin/session', requireAdminAuth, (req, res) => {
  res.json({ success: true });
});

app.get('/api/admin/passkeys/status', (req, res) => {
  db.get('SELECT COUNT(*) as count FROM admin_passkeys', [], (err, row) => {
    if (err) {
      sendInternal(req, res, err, 'passkeys status');
      return;
    }
    res.json({ hasPasskey: Number(row?.count || 0) > 0 });
  });
});

app.post('/api/admin/passkeys/register/options', async (req, res) => {
  const bearerToken = getBearerToken(req);

  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT epoch, (SELECT COUNT(*) FROM admin_passkeys) AS count FROM admin_auth_state WHERE id=1', [], (err, r) => err ? reject(err) : resolve(r));
    });

    const hasPasskey = Number(row?.count || 0) > 0;
    if (!hasPasskey) {
      if (!bearerToken || bearerToken !== ADMIN_API_TOKEN) return res.status(401).json({ error: 'Invalid bootstrap token' });
    } else {
      if (!await adminSessions.isActive(bearerToken)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const challenge = createChallenge('register', { epoch: row.epoch, mode: hasPasskey ? 'session' : 'bootstrap', tokenHash: registrationTokenHash(bearerToken) });

    const rowsForExclude = await new Promise((resolve, reject) => {
      db.all('SELECT credential_id FROM admin_passkeys', [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: encoder.encode('admin'),
      userName: 'checkin-admin',
      attestationType: 'none',
      challenge,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred'
      },
      excludeCredentials: (rowsForExclude || []).map((item) => ({
        id: item.credential_id,
        type: 'public-key'
      }))
    });

    const serializableOptions = {
      ...options,
      user: {
        ...options.user,
        id: Buffer.from(options.user.id).toString('base64url')
      }
    };

    res.json(serializableOptions);
  } catch (err) {
    sendInternal(req, res, err, 'registration options');
  }
});

app.post('/api/admin/passkeys/register/verify', async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'credential is required' });

  const challenge = extractChallengeFromCredential(credential);

  const registration = challenge && consumeChallenge(challenge, 'register');
  if (!registration) {
    return res.status(400).json({ error: 'Invalid or expired challenge' });
  }

  const bearerToken = getBearerToken(req);
  if (!bearerToken || registration.tokenHash !== registrationTokenHash(bearerToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const state = await getAsync(db, 'SELECT epoch FROM admin_auth_state WHERE id=1');
    if (state?.epoch !== registration.epoch ||
        (registration.mode === 'session' && !await adminSessions.isActive(bearerToken)) ||
        (registration.mode === 'bootstrap' && bearerToken !== ADMIN_API_TOKEN)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true
    });

    if (verification.verified && verification.registrationInfo) {
      const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
      const transports = Array.isArray(credential.response?.transports) ? JSON.stringify(credential.response.transports) : null;

      // Check the authority again atomically with the write. Bootstrap is single-use.
      const authoritySql = registration.mode === 'bootstrap'
        ? 'NOT EXISTS (SELECT 1 FROM admin_passkeys)'
        : 'EXISTS (SELECT 1 FROM admin_sessions WHERE token=? AND expires_at>?)';
      const authorityParams = registration.mode === 'bootstrap' ? [] : [bearerToken, Date.now()];
      const inserted = await runAsync(db, `INSERT INTO admin_passkeys
        (credential_id, public_key, counter, transports)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_auth_state WHERE id=1 AND epoch=?)
        AND ${authoritySql}`,
      [credentialID, Buffer.from(credentialPublicKey).toString('base64url'), counter, transports,
        registration.epoch, ...authorityParams]);
      if (inserted.changes !== 1) return res.status(401).json({ error: 'Registration authorization expired' });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Registration verification failed' });
    }
  } catch (error) {
    logger.warn({ err: error.message, requestId: req.requestId }, 'verify registration error');
    res.status(400).json({ error: 'Registration verification failed' });
  }
});

app.post('/api/admin/passkeys/auth/options', (req, res) => {
  db.all('SELECT credential_id FROM admin_passkeys', [], async (err, rows) => {
    if (err) return sendInternal(req, res, err, 'auth options');
    if (!rows?.length) return res.status(404).json({ error: 'No passkey registered' });

    try {
      const state = await getAsync(db, 'SELECT epoch FROM admin_auth_state WHERE id=1');
      const challenge = createChallenge('auth', { epoch: state.epoch });
      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        challenge,
        userVerification: 'preferred',
        allowCredentials: rows.map((row) => ({
          id: row.credential_id,
          type: 'public-key'
        }))
      });
      res.json(options);
    } catch (e) {
      sendInternal(req, res, e, 'generate auth options');
    }
  });
});

app.post('/api/admin/passkeys/auth/verify', authVerifyRateLimit, async (req, res) => {
  const { credential } = req.body || {};
  if (!credential || !credential.id) return res.status(400).json({ error: 'credential is required' });

  const challenge = extractChallengeFromCredential(credential);
  const authentication = challenge && consumeChallenge(challenge, 'auth');
  if (!authentication) {
    return res.status(400).json({ error: 'Invalid or expired challenge' });
  }

  db.get('SELECT * FROM admin_passkeys WHERE credential_id = ?', [credential.id], async (err, row) => {
    if (err) return sendInternal(req, res, err, 'lookup passkey');
    if (!row) return res.status(401).json({ error: 'Unknown passkey' });

    try {
      const verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: challenge,
        expectedOrigin: EXPECTED_ORIGIN,
        expectedRPID: RP_ID,
        authenticator: {
          credentialID: row.credential_id,
          credentialPublicKey: Buffer.from(row.public_key, 'base64url'),
          counter: Number(row.counter || 0),
          transports: row.transports ? JSON.parse(row.transports) : undefined
        },
        requireUserVerification: true
      });

      if (verification.verified) {
        const newCounter = verification.authenticationInfo.newCounter;
        db.run('UPDATE admin_passkeys SET counter = ? WHERE credential_id = ?', [newCounter, row.credential_id]);

        const sessionToken = await createSessionToken(authentication.epoch, row.credential_id);
        if (!sessionToken) return res.status(401).json({ error: 'Authentication authorization expired' });
        res.json({ success: true, sessionToken });
      } else {
        res.status(401).json({ error: 'Authentication verification failed' });
      }
    } catch (verifyErr) {
      logger.warn({ err: verifyErr.message, requestId: req.requestId }, 'verify auth error');
      res.status(400).json({ error: 'Authentication verification failed' });
    }
  });
});

app.post('/api/admin/logout', requireAdminAuth, async (req, res) => {
  try {
    const token = getAdminSessionFromRequest(req);
    await adminSessions.revoke(token);
    for (const [challenge, context] of adminChallenges) {
      if (context.tokenHash === registrationTokenHash(token)) adminChallenges.delete(challenge);
    }
    res.json({ success: true });
  } catch (err) {
    sendInternal(req, res, err, 'revoke admin session');
  }
});

app.get('/api/steps', (req, res) => {
  const { lang } = req.query;
  const targetLang = typeof lang === 'string' ? lang : 'zh-hans';
  getTemplateRowWithFallback('step_templates', 'steps', targetLang)
    .then((row) => {
      if (!row.payload) return res.status(404).json({ error: 'Steps not found' });
      try {
        res.json(JSON.parse(row.payload));
      } catch (parseErr) {
        sendInternal(req, res, parseErr, 'parse steps');
      }
    })
    .catch((err) => sendInternal(req, res, err, 'load steps'));
});

app.get('/api/app-settings', async (req, res) => {
  try {
    const settings = await loadAppSettings();
    res.json(settings);
  } catch (err) {
    sendInternal(req, res, err, 'load app-settings');
  }
});

app.get('/api/template-bundle', async (req, res) => {
  const { lang } = req.query;
  const targetLang = typeof lang === 'string' ? lang : 'zh-hans';

  try {
    const [stepsRow, completionRow, appSettings] = await Promise.all([
      getTemplateRowWithFallback('step_templates', 'steps', targetLang),
      getTemplateRowWithFallback('completion_templates', 'template', targetLang),
      loadAppSettings()
    ]);

    if (!stepsRow.payload || !completionRow.payload) {
      return res.status(404).json({ error: 'Template bundle not found' });
    }

    try {
      const parsedSteps = JSON.parse(stepsRow.payload);
      const parsedCompletionTemplate = JSON.parse(completionRow.payload);
      return res.json({
        lang: targetLang,
        steps: {
          resolvedLang: stepsRow.resolvedLang,
          fallbackUsed: stepsRow.resolvedLang !== targetLang,
          data: parsedSteps
        },
        completionTemplate: {
          resolvedLang: completionRow.resolvedLang,
          fallbackUsed: completionRow.resolvedLang !== targetLang,
          data: parsedCompletionTemplate
        },
        appSettings: { ...appSettings, hostexEnabled: HOSTEX_ENABLED }
      });
    } catch (parseErr) {
      return sendInternal(req, res, parseErr, 'parse template bundle');
    }
  } catch (err) {
    return sendInternal(req, res, err, 'load template bundle');
  }
});

app.get('/api/completion-template', (req, res) => {
  const { lang } = req.query;
  const targetLang = typeof lang === 'string' ? lang : 'zh-hans';
  getTemplateRowWithFallback('completion_templates', 'template', targetLang)
    .then((row) => {
      if (!row.payload) return res.status(404).json({ error: 'Completion template not found' });
      try {
        res.json(JSON.parse(row.payload));
      } catch (parseErr) {
        sendInternal(req, res, parseErr, 'parse completion template');
      }
    })
    .catch((err) => sendInternal(req, res, err, 'load completion template'));
});

app.patch('/api/records/:recordId/guests/:guestId', requireAdminAuth, (req, res) => {
  const { recordId, guestId } = req.params;
  const { deleted } = req.body || {};
  if (typeof deleted !== 'boolean') return res.status(400).json({ error: 'Invalid deleted flag' });

  db.get('SELECT data FROM checkins WHERE id = ?', [recordId], (err, row) => {
    if (err) return sendInternal(req, res, err, 'lookup record for patch');
    if (!row) return res.status(404).json({ error: 'Record not found' });

    try {
      const guests = JSON.parse(row.data);
      let found = false;
      const updatedGuests = guests.map((guest) => {
        if (String(guest.id) !== String(guestId)) return guest;
        found = true;
        return { ...guest, deleted };
      });

      if (!found) return res.status(404).json({ error: 'Guest not found' });

      db.run('UPDATE checkins SET data = ? WHERE id = ?', [JSON.stringify(updatedGuests), recordId], (updateErr) => {
        if (updateErr) return sendInternal(req, res, updateErr, 'update record');
        res.json({ success: true });
      });
    } catch (parseErr) {
      sendInternal(req, res, parseErr, 'parse record data');
    }
  });
});

app.put('/api/admin/steps', requireAdminAuth, (req, res) => {
  const { lang } = req.query;
  const { steps } = req.body || {};
  const targetLang = typeof lang === 'string' ? lang : '';

  if (!targetLang) return res.status(400).json({ error: 'lang is required' });
  if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps must be an array' });

  db.run(
    `INSERT INTO step_templates (lang, steps, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(lang) DO UPDATE SET
       steps = excluded.steps,
       updated_at = CURRENT_TIMESTAMP`,
    [targetLang, JSON.stringify(steps)],
    (err) => {
      if (err) return sendInternal(req, res, err, 'save steps');
      res.json({ success: true });
    }
  );
});

app.put('/api/admin/completion-template', requireAdminAuth, (req, res) => {
  const { lang } = req.query;
  const { template } = req.body || {};
  const targetLang = typeof lang === 'string' ? lang : '';

  if (!targetLang) return res.status(400).json({ error: 'lang is required' });
  if (!template || typeof template !== 'object') return res.status(400).json({ error: 'template must be an object' });

  db.run(
    `INSERT INTO completion_templates (lang, template, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(lang) DO UPDATE SET
       template = excluded.template,
       updated_at = CURRENT_TIMESTAMP`,
    [targetLang, JSON.stringify(template)],
    (err) => {
      if (err) return sendInternal(req, res, err, 'save completion template');
      res.json({ success: true });
    }
  );
});

app.put('/api/admin/app-settings', requireAdminAuth, async (req, res) => {
  const { settings } = req.body || {};
  const validation = validateAppSettings(settings);
  if (!validation.valid) return res.status(400).json({ error: validation.error });

  try {
    await saveAppSettings(settings);
    const saved = await loadAppSettings();
    res.json({ success: true, settings: saved });
  } catch (err) {
    sendInternal(req, res, err, 'save app-settings');
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const computePhotoMd5 = (dataImage) => {
  if (!dataImage || !dataImage.startsWith('data:image')) return null;
  const matches = dataImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches) return null;
  try {
    return crypto.createHash('md5').update(Buffer.from(matches[2], 'base64')).digest('hex');
  } catch { return null; }
};

const norm = (s) => (s == null ? '' : String(s).trim().toLowerCase());

const isContentDuplicate = (newGuest, newMd5, newCheckIn, existing, existingCheckIn) => {
  if (newMd5 && existing.passportPhotoMd5 && newMd5 !== existing.passportPhotoMd5) return false;
  return (
    norm(newGuest.name) === norm(existing.name) &&
    norm(newGuest.phone) === norm(existing.phone) &&
    norm(newGuest.address) === norm(existing.address) &&
    norm(newGuest.age) === norm(existing.age) &&
    norm(newGuest.passportNumber) === norm(existing.passportNumber) &&
    norm(newCheckIn) === norm(existingCheckIn)
  );
};

// Only a successful registration receives a signed receipt. Order IDs alone never reveal codes.
let orderSelections = null;
const selectionService = () => orderSelections || (orderSelections = createSelectionService({db,getAsync,allAsync,runAsync,secret:ADMIN_API_TOKEN,propertyId:HOSTEX_PROPERTY_ID}));
const registrationReceipt = async (id, submittedGuests, checkIn, checkOut, selectionToken) => {
  const record = await getAsync(db, 'SELECT id,data,check_in,check_out FROM checkins WHERE id=?', [id]);
  if (!record || record.check_in !== checkIn || record.check_out !== checkOut) return null;
  let saved; try { saved = JSON.parse(record.data).filter(g => !g.deleted); } catch { return null; }
  if (!submittedGuests.every(g => saved.some(ex => isContentDuplicate(g, computePhotoMd5(g.passportPhoto), checkIn, ex, record.check_in)))) return null;
  if (selectionToken) await selectionService().attach(id, selectionToken);
  const selected = await getAsync(db, 'SELECT record_id FROM checkin_order_selections WHERE record_id=?', [id]);
  const orders = await allAsync(db, "SELECT reservation_code FROM hostex_reservations WHERE checkin_record_id=? AND property_id=? AND status='accepted'", [id, HOSTEX_PROPERTY_ID]);
  return {recordId:id, receiptToken:receiptToken(id, ADMIN_API_TOKEN), selectionOnly:Boolean(selected), reservationCode:!selected && orders.length===1 ? orders[0].reservation_code : null};
};

let ttlockOrderAccess = null;
app.post('/api/checkin/access-code', submitRateLimit, async (req,res) => {
  res.set('Cache-Control', 'no-store');
  res.setTimeout(75000);
  const {recordId,receiptToken:token}=req.body || {};
  if (typeof recordId!=='string' || !UUID_RE.test(recordId) || !validReceipt(recordId,token,ADMIN_API_TOKEN)) return res.status(403).json({error:'Invalid registration receipt'});
  try {
    const gate = await selectionService().accessGate(recordId);
    if (gate && gate.status !== 'verified') return res.json(gate);
    if (!ttlockOrderAccess) {
      const client=createTTLockClient({db,getAsync,runAsync});
      ttlockOrderAccess=createOrderAccess({db,getAsync,allAsync,runAsync,client,propertyId:HOSTEX_PROPERTY_ID});
    }
    // Persistent DB leases protect concurrent requests, including across workers.
    res.json(await ttlockOrderAccess.getAccess(recordId, gate?.reservation));
  } catch(err) {
    logger.warn({code:err.code || 'access_failed',requestId:req.requestId}, 'TTLock access code unavailable');
    res.status(503).json({status:'unavailable'});
  }
});

app.post('/api/submit', submitRateLimit, async (req, res) => {
  try {
    const appSettings = await loadAppSettings();
    const fieldsConfig = appSettings.guestFieldsConfig || DEFAULT_GUEST_FIELDS_CONFIG;
    const validation = validateSubmissionPayload(req.body, fieldsConfig);
    if (!validation.valid) {
      res.status(400).json({ success: false, error: validation.error || 'Invalid submission payload' });
      return;
    }

    const {
      guests,
      submissionId: clientId,
      checkIn,
      checkOut
    } = validation.normalized;
    const invalidGuest = guests.find((guest) => !validateGuestPayload(guest, fieldsConfig).valid);
    if (invalidGuest) {
      const { error } = validateGuestPayload(invalidGuest, fieldsConfig);
      res.status(400).json({ success: false, error: error || 'Guest payload validation failed' });
      return;
    }

    const submitId = (typeof clientId === 'string' && UUID_RE.test(clientId)) ? clientId : uuidv4();
    const today = new Date().toISOString().split('T')[0];

    const selectionToken = typeof req.body?.selectionToken === 'string' ? req.body.selectionToken : '';
    if (selectionToken) {
      const selectedCode = selectionService().tokenCode(selectionToken);
      const selectedOrder = selectedCode ? await getAsync(db, "SELECT check_in_date,check_out_date FROM hostex_reservations WHERE reservation_code=? AND property_id=? AND status='accepted'", [selectedCode,HOSTEX_PROPERTY_ID]) : null;
      if (!selectedOrder || selectedOrder.check_in_date!==checkIn || selectedOrder.check_out_date!==checkOut) return res.status(400).json({success:false,error:'Selected order is unavailable or dates changed'});
    }
    const code = !selectionToken && typeof req.body?.reservationCode === 'string' ? req.body.reservationCode.trim() : '';
    const linkReservation = createReservationLinker({ db, getAsync, runAsync, logger });
    const incomingMd5s = guests.map(g => computePhotoMd5(g.passportPhoto));
    const existingRows = await allAsync(db, 'SELECT id, data, check_in, check_out FROM checkins WHERE check_in = ?', [checkIn]);
    const parsedRows = existingRows.map((row) => {
      try { return { ...row, guests: JSON.parse(row.data).filter((g) => !g.deleted) }; }
      catch { return { ...row, guests: [] }; }
    });
    const matches = (g, i, row) => row.guests.some((ex) => isContentDuplicate(g, incomingMd5s[i], checkIn, ex, row.check_in));
    const duplicateRecord = parsedRows.find((row) => row.check_out === checkOut && guests.every((g, i) => matches(g, i, row)));
    const isDuplicate = guests.every((g, i) => parsedRows.some((row) => row.check_out === checkOut && matches(g, i, row)));
    if (isDuplicate) {
      // A retry must link the persisted record, never a new, unused submission UUID.
      if (duplicateRecord) await linkReservation(code, duplicateRecord.id);
      await reconcileLinksSafely();
      logger.info({ submitId, requestId: req.requestId }, 'duplicate submission ignored (content match)');
      return res.json({ success: true, id: duplicateRecord?.id || submitId, duplicate: true, accessReceipt: duplicateRecord ? await registrationReceipt(duplicateRecord.id, guests, checkIn, checkOut, selectionToken) : null });
    }

    const guestsWithUrls = (await saveImagesLocally(guests)).map((guest) => ({ ...guest, deleted: guest.deleted === true }));

    const inserted = await runAsync(db, 'INSERT OR IGNORE INTO checkins (id, date, data, check_in, check_out) VALUES (?, ?, ?, ?, ?)',
      [submitId, today, JSON.stringify(guestsWithUrls), checkIn || null, checkOut || null]);
    if (inserted.changes === 0) {
      logger.info({ submitId, requestId: req.requestId }, 'duplicate submissionId ignored');
      res.json({ success: true, id: submitId, duplicate: true, accessReceipt: await registrationReceipt(submitId, guests, checkIn, checkOut, selectionToken) });
    } else {
      await linkReservation(code, submitId);
      await reconcileLinksSafely();
      logger.info({ submitId, date: today, requestId: req.requestId }, 'new check-in registered');
      res.json({ success: true, id: submitId, accessReceipt: await registrationReceipt(submitId, guests, checkIn, checkOut, selectionToken) });
    }

  } catch (error) {
    sendInternal(req, res, error, '/api/submit');
  }
});

app.post('/api/ocr/passport', ocrRateLimit, async (req, res) => {
  // OCR 遠比一般請求慢，單獨放寬這條路由的回應逾時。
  res.setTimeout(OCR_REQUEST_TIMEOUT_MS);

  // 客戶端帶 Accept: application/x-ndjson 時改走串流，逐步回報識別階段；
  // 未帶則維持原本的單一 JSON 回應，既有呼叫端不受影響。
  const wantsStream = String(req.headers.accept || '').includes('application/x-ndjson');

  try {
    const { image } = req.body || {};
    if (!parseDataImage(image)) {
      res.status(400).json({ success: false, error: 'Invalid image payload' });
      return;
    }

    if (!wantsStream) {
      const passportPhoto = await savePassportImage(image);
      const ocrResult = await runLocalPassportOcr(image);
      if (ocrResult?.error === 'OCR_BUSY') {
        // Photo was saved; surface a 503 so the client can retry while keeping the upload.
        res.status(503).json({ success: false, error: 'OCR_BUSY', passportPhoto });
        return;
      }
      res.json({ ...ocrResult, passportPhoto });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no'); // 讓 nginx 不要緩衝，進度才會即時到達
    res.flushHeaders();

    const send = (event) => {
      if (res.writableEnded) return;
      res.write(`${JSON.stringify(event)}\n`);
    };

    send({ stage: 'uploading' });
    const passportPhoto = await savePassportImage(image);
    send({ stage: 'uploaded' });

    const ocrResult = await runLocalPassportOcr(image, (progress) => send(progress));

    if (ocrResult?.error === 'OCR_BUSY') {
      send({ stage: 'error', error: 'OCR_BUSY', passportPhoto });
    } else {
      send({ stage: 'done', result: { ...ocrResult, passportPhoto } });
    }
    res.end();
  } catch (error) {
    if (wantsStream && res.headersSent) {
      logger.error({ err: error.message, requestId: req.requestId }, 'passport OCR stream failed');
      if (!res.writableEnded) {
        res.write(`${JSON.stringify({ stage: 'error', error: 'OCR_FAILED' })}\n`);
        res.end();
      }
      return;
    }
    sendInternal(req, res, error, 'passport OCR');
  }
});

// ----------------------------------------------------------------------
// Hostex 訂單查找與照片回顯（客人側）
// ----------------------------------------------------------------------
const RESERVATION_CODE_RE = /^[A-Za-z0-9_-]{4,64}$/;

const buildLookupResponse = async (row) => {
  let raw = {};
  try {
    raw = JSON.parse(row.raw_json);
  } catch { /* raw_json 損壞時仍返回基本欄位 */ }

  const imageRows = await allAsync(db, `
    SELECT image_id, hostex_guest_id, filename, ocr_json FROM hostex_id_images
    WHERE reservation_code = ? AND status = 'downloaded' AND filename IS NOT NULL
  `, [row.reservation_code]);

  // 去重（同一本護照傳兩次）並排序（成年人優先），詳見 dedupeReservationPhotos
  const { photos: dedupedRows, duplicatesRemoved } = dedupeReservationPhotos(imageRows, UPLOAD_DIR);
  if (duplicatesRemoved > 0) {
    logger.info({ reservationCode: row.reservation_code, duplicatesRemoved }, 'duplicate reservation photos removed from lookup');
  }

  const photos = dedupedRows.map((img) => {
    const parsed = img.parsedOcr;
    // OCR 判定的視覺方向（PIL 逆時針度數），前端用 CSS rotate(-deg) 擺正顯示
    const rotation = Number.isFinite(parsed?.rotation) ? parsed.rotation : 0;
    const ocr = parsed ? {
      passportNumber: parsed.passportNumber || '',
      fullName: parsed.fullName || '',
      age: Number.isFinite(parsed.age) ? parsed.age : null,
      birthDate: parsed.birthDate || '',
      sex: parsed.sex || '',
      nationalityCode: parsed.nationalityCode || ''
    } : null;
    return {
      photoToken: issueReservationPhotoToken(img.filename),
      filename: img.filename,
      guestId: img.hostex_guest_id || null,
      rotation,
      ocr
    };
  });

  const guests = (raw.guests || []).map((g) => ({
    hostexGuestId: String(g.id ?? ''),
    name: g.name || '',
    nationality: typeof g.country === 'string' ? g.country.toUpperCase() : '',
    passportNumber: g.id_type === 'passport' && g.id_number ? String(g.id_number) : '',
    isBooker: Boolean(g.is_booker)
  }));

  return {
    found: true,
    reservation: {
      reservationCode: row.reservation_code,
      checkInDate: row.check_in_date,
      checkOutDate: row.check_out_date,
      numberOfGuests: raw.number_of_guests ?? null,
      numberOfAdults: row.number_of_adults ?? 1,
      numberOfChildren: row.number_of_children ?? 0,
      petCount: row.number_of_pets ?? 0,
      guestName: row.guest_name || '',
      // 已通過訂單號或姓名+日期驗證，回傳預訂人電話供監護人欄快捷填充
      bookerPhone: typeof raw.guest_phone === 'string' ? raw.guest_phone : '',
      guests,
      photos
    }
  };
};

const reservationSelectionRateLimit = rateLimit({windowMs:10*60*1000,limit:30,standardHeaders:'draft-7',legacyHeaders:false,message:{found:false,error:'Too many booking selections; please try later'}});
app.get('/api/checkin/reservation-candidates', reservationSelectionRateLimit, async (req,res) => {
  res.set('Cache-Control','no-store');
  try { res.json({candidates:HOSTEX_ENABLED ? await selectionService().recentOrders() : []}); }
  catch(err) { sendInternal(req,res,err,'reservation candidates'); }
});
app.post('/api/checkin/reservation-select', reservationSelectionRateLimit, async (req,res) => {
  res.set('Cache-Control','no-store');
  try {
    const reservation=HOSTEX_ENABLED ? await selectionService().select(req.body?.selectionToken,req.body?.bookerName,req.body?.checkInDate,req.body?.checkOutDate) : null;
    if(!reservation)return res.status(404).json({found:false});
    if(reservation.needsConfirmation)return res.json(reservation);
    res.json({found:true,reservation});
  } catch(err) { sendInternal(req,res,err,'reservation selection'); }
});

app.post('/api/checkin/reservation-lookup', lookupRateLimit, async (req, res) => {
  try {
    if (!HOSTEX_ENABLED) {
      res.json({ found: false });
      return;
    }

    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const checkInDate = typeof req.body?.checkInDate === 'string' ? req.body.checkInDate.trim() : '';

    // 只在近窗口内可查，降低撞库价值
    const now = Date.now();
    const windowFrom = new Date(now - 86400000).toISOString().slice(0, 10);
    const windowTo = new Date(now + 30 * 86400000).toISOString().slice(0, 10);

    let row = null;
    if (code && RESERVATION_CODE_RE.test(code)) {
      row = await getAsync(db, `
        SELECT * FROM hostex_reservations
        WHERE reservation_code = ? AND status = 'accepted'
          AND check_in_date BETWEEN ? AND ?
      `, [code, windowFrom, windowTo]);
    } else if (name.length >= 2 && name.length <= 100 && parseDateOnly(checkInDate)) {
      const candidates = await allAsync(db, `
        SELECT * FROM hostex_reservations
        WHERE status = 'accepted' AND check_in_date = ?
          AND check_in_date BETWEEN ? AND ?
      `, [checkInDate, windowFrom, windowTo]);
      const matches = candidates.filter((c) => fullNameMatches(c.guest_name, name));
      // 同名同日多单时不猜，让客人改用订单号
      if (matches.length === 1) row = matches[0];
    }

    if (!row) {
      res.json({ found: false });
      return;
    }
    res.json(await buildLookupResponse(row));
  } catch (error) {
    sendInternal(req, res, error, 'reservation lookup');
  }
});

app.get('/api/checkin/reservation-photo/:token', (req, res) => {
  const token = String(req.params.token || '');
  const entry = reservationPhotoTokens.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    reservationPhotoTokens.delete(token);
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const safeName = path.basename(entry.filename);
  const filePath = path.resolve(UPLOAD_DIR, safeName);
  if (!filePath.startsWith(path.resolve(UPLOAD_DIR) + path.sep) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(filePath);
});

// ----------------------------------------------------------------------
// Hostex 管理端
// ----------------------------------------------------------------------
app.get('/api/admin/hostex/status', requireAdminAuth, async (req, res) => {
  try {
    if (!hostexSync) {
      res.json({ enabled: false });
      return;
    }
    const status = await hostexSync.getStatus();
    res.json({ enabled: true, syncEnabled: hostexSyncEnabledCache, ...status });
  } catch (error) {
    sendInternal(req, res, error, 'hostex status');
  }
});

app.post('/api/admin/hostex/sync', requireAdminAuth, async (req, res) => {
  try {
    if (!hostexSync) {
      res.status(400).json({ success: false, error: 'Hostex integration is not configured' });
      return;
    }
    const result = await hostexSync.syncNow();
    res.json(result);
  } catch (error) {
    sendInternal(req, res, error, 'hostex manual sync');
  }
});

app.get('/api/admin/hostex/reservations', requireAdminAuth, async (req, res) => {
  try {
    const registrationMatches = await reconcileReservationLinks();
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const where = q
      ? "WHERE reservation_code LIKE ? OR guest_name_norm LIKE ?"
      : '';
    const params = q ? [`%${q}%`, `%${q}%`] : [];

    const total = await getAsync(db, `SELECT COUNT(*) AS c FROM hostex_reservations ${where}`, params);
    const rows = await allAsync(db, `
      SELECT reservation_code, stay_code, channel_type, status, check_in_date, check_out_date,
             guest_name, number_of_adults, number_of_children, number_of_pets,
             booked_at, checkin_record_id, checkin_link_source, last_synced_at, raw_json
      FROM hostex_reservations ${where}
      ORDER BY check_in_date DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const codes = rows.map((r) => r.reservation_code);
    let imagesByCode = {};
    if (codes.length) {
      const placeholders = codes.map(() => '?').join(',');
      const imgs = await allAsync(db, `
        SELECT reservation_code, filename, status FROM hostex_id_images
        WHERE reservation_code IN (${placeholders})
      `, codes);
      imagesByCode = imgs.reduce((acc, img) => {
        (acc[img.reservation_code] ||= []).push({ filename: img.filename, status: img.status });
        return acc;
      }, {});
    }

    res.json({
      total: total?.c ?? 0,
      reservations: rows.map(({ raw_json, ...r }) => {
        let numberOfGuests = null;
        try { numberOfGuests = JSON.parse(raw_json).number_of_guests ?? null; } catch { /* legacy row */ }
        return { ...r, registration_match_count: registrationMatches.ambiguous[r.reservation_code] || 0, number_of_guests: numberOfGuests, images: imagesByCode[r.reservation_code] || [] };
      })
    });
  } catch (error) {
    sendInternal(req, res, error, 'hostex reservations list');
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request entity too large' });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }
  sendInternal(req, res, error, 'unhandled error');
});

let activeServer = null;
let shuttingDown = false;

const shutdown = (signal = 'unknown') => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  clearInterval(cleanupInterval);
  if (hostexSync) hostexSync.stop();
  if (ocrWorkerPool) ocrWorkerPool.stop();

  const finalizeExit = async (code) => {
    await closeDatabase(db);
    process.exit(code);
  };

  if (!activeServer) {
    finalizeExit(0);
    return;
  }

  activeServer.close((closeErr) => {
    if (closeErr) {
      logger.error({ err: closeErr.message }, 'failed to close http server');
      finalizeExit(1);
      return;
    }
    finalizeExit(0);
  });

  setTimeout(() => {
    logger.error('force exiting after shutdown timeout');
    process.exit(1);
  }, 10000).unref();
};

const startServer = async () => {
  db = await openDatabase(DB_PATH, logger);
  await applyPragmas(db, logger);
  await runMigrations(db, MIGRATIONS_DIR, logger);
  await seedStepTemplates();
  await seedCompletionTemplates();

  sessionStore = new AdminSessionStore({ db, logger, runAsync, allAsync });
  await sessionStore.hydrate();
  adminSessions = sessionStore;

  await loadAppSettings(); // 預熱 hostexSyncEnabledCache

  // 常駐 OCR worker 池：模型只加載一次，單張識別從 ~15s 降到 ~4s
  ocrWorkerPool = createOcrWorkerPool({
    pythonPath: PADDLE_OCR_PYTHON_PATH,
    workerScript: PADDLE_OCR_WORKER,
    size: OCR_MAX_CONCURRENCY,
    cwd: __dirname,
    env: {
      ...process.env,
      HOME: OCR_CACHE_HOME,
      XDG_CACHE_HOME: OCR_CACHE_DIR,
      PADDLE_HOME: OCR_PADDLE_HOME,
      PADDLEOCR_HOME: OCR_MODEL_HOME,
      PYTHONPYCACHEPREFIX: path.join(OCR_CACHE_DIR, 'pycache')
    },
    logger
  });

  if (HOSTEX_ENABLED) {
    const hostexClient = createHostexClient({ token: HOSTEX_API_TOKEN, logger });
    hostexSync = createHostexSync({
      db,
      runAsync,
      allAsync,
      getAsync,
      client: hostexClient,
      uploadDir: UPLOAD_DIR,
      propertyId: HOSTEX_PROPERTY_ID,
      pastDays: HOSTEX_SYNC_PAST_DAYS,
      futureDays: HOSTEX_SYNC_FUTURE_DAYS,
      intervalMs: HOSTEX_SYNC_INTERVAL_MS,
      isEnabled: () => hostexSyncEnabledCache,
      reconcileLinks: reconcileReservationLinks,
      // 預跑 OCR 與到店客人的實時 OCR 共用同一個併發閘
      runOcr: async (imagePath) => {
        const release = await ocrSemaphore.acquire(OCR_QUEUE_TIMEOUT_MS);
        try {
          return await executePassportOcr(imagePath);
        } finally {
          release();
        }
      },
      logger
    });
    hostexSync.start();
  } else {
    logger.info('hostex integration disabled (HOSTEX_API_TOKEN not configured)');
  }

  if (shouldServeClientBuild()) {
    mountClientBuild();
  }
  activeServer = app.listen(PORT, HOST, () => {
    logger.info({
      address: `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`,
      uploadDir: UPLOAD_DIR,
      dbPath: DB_PATH,
      clientDistDir: CLIENT_DIST_DIR,
      webauthnOrigin: EXPECTED_ORIGIN,
      trustProxy: TRUST_PROXY,
      sessionBackend: SESSION_BACKEND,
      ocrConcurrency: OCR_MAX_CONCURRENCY
    }, 'checkin-app server started');
  });
  return activeServer;
};

if (require.main === module) {
  startServer().catch((err) => {
    logger.error({ err: err.message, stack: err.stack }, 'failed to start server');
    process.exit(1);
  });
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason?.message || String(reason), stack: reason?.stack }, 'unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'uncaught exception');
    shutdown('uncaughtException');
  });
}

module.exports = {
  app,
  parseDataImage,
  parseDateOnly,
  validateGuestPayload,
  validateSubmissionPayload,
  runLocalPassportOcr,
  savePassportImage,
  startServer,
  shutdown,
  purgeExpiredEntries,
  cleanupInterval,
  get adminSessions() { return adminSessions; },
  adminChallenges
};
