'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
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
const { AdminSessionStore } = require('./src/sessions');
const { Semaphore } = require('./src/semaphore');

const logger = createLogger();
const encoder = new TextEncoder();
const execFileAsync = promisify(execFile);

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
const SESSION_BACKEND = 'sqlite';

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

const runLocalPassportOcr = async (dataImage) => {
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
    const { stdout, stderr } = await execFileAsync(PADDLE_OCR_PYTHON_PATH, [PADDLE_OCR_RUNNER, imagePath], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
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

    const outputLines = `${String(stdout || '')}\n${String(stderr || '')}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = outputLines.length - 1; index >= 0; index -= 1) {
      const line = outputLines[index];
      if (!line.startsWith('{') || !line.endsWith('}')) continue;
      try {
        return JSON.parse(line);
      } catch {
        // continue searching previous lines
      }
    }

    throw new Error('Passport OCR output does not contain JSON payload');
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
      guestFieldsConfig: sanitizeGuestFieldsConfig(DEFAULT_GUEST_FIELDS_CONFIG)
    };
    (rows || []).forEach((row) => {
      if (row.key === 'taiwanNamingMode' && TAIWAN_NAMING_MODES.has(row.value)) {
        settings.taiwanNamingMode = row.value;
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
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const purgeExpiredEntries = () => {
  const now = Date.now();
  for (const [key, value] of adminChallenges) {
    if (value.expiresAt < now) adminChallenges.delete(key);
  }
  if (!adminSessions) return;
  for (const [token, expiresAt] of adminSessions) {
    if (expiresAt < now) adminSessions.delete(token);
  }
};

const cleanupInterval = setInterval(purgeExpiredEntries, 5 * 60 * 1000);
cleanupInterval.unref();

const normalizeChallenge = (str) => {
  if (!str) return '';
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const createChallenge = (purpose) => {
  const raw = crypto.randomBytes(32).toString('base64url');
  const challenge = normalizeChallenge(raw);
  adminChallenges.set(challenge, { purpose, expiresAt: Date.now() + CHALLENGE_TTL_MS });
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
    return true;
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
      return true;
    }
  } catch (e) {
    // ignore decode errors and fall through
  }

  logger.warn({ key: norm }, 'challenge not found');
  return false;
};

const createSessionToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
};

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

const requireAdminAuth = (req, res, next) => {
  const token = getAdminSessionFromRequest(req);
  const expiresAt = adminSessions?.get(token);
  if (!token || !expiresAt || expiresAt < Date.now()) {
    if (token && adminSessions) adminSessions.delete(token);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
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
      db.get('SELECT COUNT(*) as count FROM admin_passkeys', [], (err, r) => err ? reject(err) : resolve(r));
    });

    const hasPasskey = Number(row?.count || 0) > 0;
    if (!hasPasskey) {
      if (!bearerToken || bearerToken !== ADMIN_API_TOKEN) return res.status(401).json({ error: 'Invalid bootstrap token' });
    } else {
      const expiresAt = adminSessions.get(bearerToken);
      if (!bearerToken || !expiresAt || expiresAt < Date.now()) {
        if (bearerToken) adminSessions.delete(bearerToken);
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const challenge = createChallenge('register');

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

  if (!challenge || !consumeChallenge(challenge, 'register')) {
    return res.status(400).json({ error: 'Invalid or expired challenge' });
  }

  try {
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

      db.run(
        'INSERT OR REPLACE INTO admin_passkeys (credential_id, public_key, counter, transports) VALUES (?, ?, ?, ?)',
        [credentialID, Buffer.from(credentialPublicKey).toString('base64url'), counter, transports],
        (err) => {
          if (err) return sendInternal(req, res, err, 'persist passkey');
          res.json({ success: true });
        }
      );
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

    const challenge = createChallenge('auth');
    try {
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
  if (!challenge || !consumeChallenge(challenge, 'auth')) {
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

        const sessionToken = createSessionToken();
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

app.post('/api/admin/logout', requireAdminAuth, (req, res) => {
  const token = getAdminSessionFromRequest(req);
  if (token) adminSessions.delete(token);
  res.json({ success: true });
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
        appSettings
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

    const incomingMd5s = guests.map(g => computePhotoMd5(g.passportPhoto));
    const isDuplicate = await new Promise((resolve) => {
      db.all('SELECT data, check_in FROM checkins', [], (err, rows) => {
        if (err || !rows || rows.length === 0) { resolve(false); return; }
        const existingGuests = rows.flatMap(row => {
          try {
            return JSON.parse(row.data).map(g => ({ ...g, _checkIn: row.check_in }));
          } catch { return []; }
        });
        const allMatch = guests.every((g, i) =>
          existingGuests.some(ex => isContentDuplicate(g, incomingMd5s[i], checkIn, ex, ex._checkIn))
        );
        resolve(allMatch);
      });
    });

    if (isDuplicate) {
      logger.info({ submitId, requestId: req.requestId }, 'duplicate submission ignored (content match)');
      return res.json({ success: true, id: submitId, duplicate: true });
    }

    const guestsWithUrls = (await saveImagesLocally(guests)).map((guest) => ({ ...guest, deleted: guest.deleted === true }));

    const stmt = db.prepare("INSERT OR IGNORE INTO checkins (id, date, data, check_in, check_out) VALUES (?, ?, ?, ?, ?)");
    stmt.run(submitId, today, JSON.stringify(guestsWithUrls), checkIn || null, checkOut || null, function (err) {
      if (err) {
        sendInternal(req, res, err, 'persist submission');
      } else if (this.changes === 0) {
        logger.info({ submitId, requestId: req.requestId }, 'duplicate submissionId ignored');
        res.json({ success: true, id: submitId, duplicate: true });
      } else {
        logger.info({ submitId, date: today, requestId: req.requestId }, 'new check-in registered');
        res.json({ success: true, id: submitId });
      }
    });
    stmt.finalize();
  } catch (error) {
    sendInternal(req, res, error, '/api/submit');
  }
});

app.post('/api/ocr/passport', ocrRateLimit, async (req, res) => {
  try {
    const { image } = req.body || {};
    if (!parseDataImage(image)) {
      res.status(400).json({ success: false, error: 'Invalid image payload' });
      return;
    }

    const passportPhoto = await savePassportImage(image);
    const ocrResult = await runLocalPassportOcr(image);
    if (ocrResult?.error === 'OCR_BUSY') {
      // Photo was saved; surface a 503 so the client can retry while keeping the upload.
      res.status(503).json({ success: false, error: 'OCR_BUSY', passportPhoto });
      return;
    }
    res.json({ ...ocrResult, passportPhoto });
  } catch (error) {
    sendInternal(req, res, error, 'passport OCR');
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
