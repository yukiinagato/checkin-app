const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
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
const STEP_TEMPLATES = require('./stepTemplates');
const COMPLETION_TEMPLATES = require('./completionTemplates');
const envPath = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
require('dotenv').config({ path: path.resolve(__dirname, envPath) });

const encoder = new TextEncoder();
const execFileAsync = promisify(execFile);

const app = express();
const PORT = process.env.PORT || 3001;

// ----------------------------------------------------------------------
// 1. 環境變數檢查
// ----------------------------------------------------------------------
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
if (!ADMIN_API_TOKEN) {
  throw new Error('ADMIN_API_TOKEN is required');
}

const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Checkin Admin';
// 修復：移除 Origin 可能存在的末尾斜線
const EXPECTED_ORIGIN = (process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');

const CORS_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

if (!CORS_ORIGINS.length) {
  throw new Error('CORS_ORIGIN is required (comma-separated origins)');
}

// ----------------------------------------------------------------------
// 2. 中間件配置
// ----------------------------------------------------------------------
app.use(cors({ origin: CORS_ORIGINS }));
app.use(express.json({ limit: '50mb' })); // 允許大文件上傳(圖片)

// ----------------------------------------------------------------------
// 3. 初始化存儲路徑
// ----------------------------------------------------------------------
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'hotel.db');
const PADDLE_OCR_PYTHON = process.env.PADDLE_OCR_PYTHON || 'python3';
const PADDLE_OCR_RUNNER = process.env.PADDLE_OCR_RUNNER || path.join(__dirname, 'tools', 'paddle_ocr_runner.py');
const ALLOWED_IMAGE_TYPES = new Map([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
].map((mime) => [mime, mime === 'image/jpg' ? 'jpg' : mime.split('/')[1]]));
fs.ensureDirSync(UPLOAD_DIR);

// ----------------------------------------------------------------------
// 4. 初始化 SQLite 數據庫
// ----------------------------------------------------------------------
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('數據庫連接失敗:', err.message);
  else console.log('已連接到本地 SQLite 數據庫');
});

// 創建表結構 (保留原始詳細定義)
db.run(`
  CREATE TABLE IF NOT EXISTS checkins (
    id TEXT PRIMARY KEY,
    date TEXT,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS step_templates (
    lang TEXT PRIMARY KEY,
    steps TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS completion_templates (
    lang TEXT PRIMARY KEY,
    template TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS admin_passkeys (
    credential_id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.serialize(() => {
  db.all('PRAGMA table_info(admin_passkeys)', [], (pragmaErr, columns) => {
    if (pragmaErr) {
      console.error('讀取 admin_passkeys 表結構失敗:', pragmaErr.message);
      return;
    }

    const columnNames = new Set((columns || []).map((column) => column.name));
    if (!columnNames.has('public_key')) {
      db.run('ALTER TABLE admin_passkeys ADD COLUMN public_key TEXT', (err) => {
        if (err) console.error('添加 public_key 欄位失敗:', err.message);
      });
    }
    if (!columnNames.has('counter')) {
      db.run('ALTER TABLE admin_passkeys ADD COLUMN counter INTEGER NOT NULL DEFAULT 0', (err) => {
        if (err) console.error('添加 counter 欄位失敗:', err.message);
      });
    }
    if (!columnNames.has('transports')) {
      db.run('ALTER TABLE admin_passkeys ADD COLUMN transports TEXT', (err) => {
        if (err) console.error('添加 transports 欄位失敗:', err.message);
      });
    }
  });
});

const seedStepTemplates = () => {
  Object.entries(STEP_TEMPLATES).forEach(([lang, steps]) => {
    db.get('SELECT lang FROM step_templates WHERE lang = ?', [lang], (err, row) => {
      if (err) {
        console.error('步驟模板查詢失敗:', err.message);
        return;
      }
      if (!row) {
        db.run(
          'INSERT INTO step_templates (lang, steps) VALUES (?, ?)',
          [lang, JSON.stringify(steps)],
          (insertErr) => {
            if (insertErr) {
              console.error('初始化步驟模板失敗:', insertErr.message);
            }
          }
        );
      }
    });
  });
};

seedStepTemplates();

const seedCompletionTemplates = () => {
  Object.entries(COMPLETION_TEMPLATES).forEach(([lang, template]) => {
    db.get('SELECT lang FROM completion_templates WHERE lang = ?', [lang], (err, row) => {
      if (err) {
        console.error('完成頁模板查詢失敗:', err.message);
        return;
      }
      if (!row) {
        db.run(
          'INSERT INTO completion_templates (lang, template) VALUES (?, ?)',
          [lang, JSON.stringify(template)],
          (insertErr) => {
            if (insertErr) {
              console.error('初始化完成頁模板失敗:', insertErr.message);
            }
          }
        );
      }
    });
  });
};

seedCompletionTemplates();

// ----------------------------------------------------------------------
// 5. 輔助函數：業務邏輯與安全驗證
// ----------------------------------------------------------------------
const saveImagesLocally = async (guests) => {
  const processedGuests = await Promise.all(guests.map(async (guest) => {
    if (guest.passportPhoto && guest.passportPhoto.startsWith('data:image')) {
      try {
        // 解析 Base64
        const matches = guest.passportPhoto.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return guest;
        const extension = ALLOWED_IMAGE_TYPES.get(matches[1]);
        if (!extension) return guest;

        const imageBuffer = Buffer.from(matches[2], 'base64');
        const filename = `${crypto.randomUUID()}_passport.${extension}`;
        const safeUploadDir = path.resolve(UPLOAD_DIR);
        const filePath = path.resolve(safeUploadDir, filename);
        if (!filePath.startsWith(`${safeUploadDir}${path.sep}`)) {
          throw new Error('Invalid upload path');
        }

        // 寫入文件
        await fs.outputFile(filePath, imageBuffer, { flag: 'wx' });

        // 更新 guest 對象中的圖片路徑為文件名
        return {
          ...guest,
          passportPhoto: filename
        };
      } catch (err) {
        console.error('圖片保存失敗:', err);
        return guest;
      }
    }
    return guest;
  }));
  return processedGuests;
};

const parseDataImage = (dataImage) => {
  if (typeof dataImage !== 'string') return null;
  const matches = dataImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return null;
  const extension = ALLOWED_IMAGE_TYPES.get(matches[1]);
  if (!extension) return null;
  return {
    extension,
    mime: matches[1],
    buffer: Buffer.from(matches[2], 'base64')
  };
};

const runLocalPaddleOcr = async (dataImage) => {
  const parsed = parseDataImage(dataImage);
  if (!parsed) {
    return { success: false, unsupported: true, error: 'Invalid image payload' };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'passport-ocr-'));
  const imagePath = path.join(tempDir, `passport.${parsed.extension}`);

  try {
    await fs.writeFile(imagePath, parsed.buffer);
    const { stdout } = await execFileAsync(PADDLE_OCR_PYTHON, [PADDLE_OCR_RUNNER, imagePath], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000
    });

    const output = String(stdout || '').trim();
    const parsedJson = JSON.parse(output || '{}');
    return parsedJson;
  } catch (error) {
    console.error('PaddleOCR 本地識別失敗:', error.message || error);
    return {
      success: false,
      unsupported: true,
      error: error.message || 'PaddleOCR execution failed'
    };
  } finally {
    await fs.remove(tempDir);
  }
};

const parseRecordData = (row) => {
  try {
    return JSON.parse(row.data);
  } catch (error) {
    console.warn(`無法解析記錄 ${row.id} 的數據:`, error);
    return [];
  }
};

const parseAge = (value) => Number.parseInt(String(value ?? '').trim(), 10);

const validateGuestPayload = (guest) => {
  if (!guest || typeof guest !== 'object') {
    return { valid: false, error: 'Invalid guest item' };
  }

  const name = typeof guest.name === 'string' ? guest.name.trim() : '';
  const age = parseAge(guest.age);
  const hasValidAge = Number.isInteger(age) && age >= 0 && age <= 120;
  if (!name || !hasValidAge) {
    return { valid: false, error: 'Guest name/age is invalid' };
  }

  const isMinor = age < 18;
  const guardianName = typeof guest.guardianName === 'string' ? guest.guardianName.trim() : '';
  const guardianPhone = typeof guest.guardianPhone === 'string' ? guest.guardianPhone.trim() : '';
  if (isMinor && (!guardianName || !guardianPhone)) {
    return { valid: false, error: 'Minor guest must include guardian info' };
  }

  if (guest.isResident === true) {
    const address = typeof guest.address === 'string' ? guest.address.trim() : '';
    const phone = typeof guest.phone === 'string' ? guest.phone.trim() : '';
    const needsPhone = age >= 16;
    if (!address || (needsPhone && !phone)) {
      return { valid: false, error: 'Resident guest info is incomplete' };
    }
    return { valid: true };
  }

  const nationality = typeof guest.nationality === 'string' ? guest.nationality.trim() : '';
  const passportNumber = typeof guest.passportNumber === 'string' ? guest.passportNumber.trim() : '';
  if (!nationality || !passportNumber || !guest.passportPhoto) {
    return { valid: false, error: 'Visitor guest info is incomplete' };
  }

  return { valid: true };
};

const adminChallenges = new Map();
const adminSessions = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

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
      console.error(`Challenge purpose mismatch: ${found.purpose} vs ${purpose}`);
      return false;
    }
    if (found.expiresAt < Date.now()) {
      console.error('Challenge expired');
      return false;
    }
    return true;
  }

  // 2. 嘗試解碼匹配 (處理客戶端回傳雙重編碼的情況)
  // 如果前端回傳的是 Base64(OriginalChallenge)，我們嘗試解碼它看看是否能對應到 Map 中的 Key
  try {
    const decoded = Buffer.from(norm, 'base64url').toString('utf-8');
    const decodedNorm = normalizeChallenge(decoded);
    if (adminChallenges.has(decodedNorm)) {
      const found = adminChallenges.get(decodedNorm);
      adminChallenges.delete(decodedNorm);
      if (found.purpose !== purpose) {
        console.error(`Challenge purpose mismatch (decoded): ${found.purpose} vs ${purpose}`);
        return false;
      }
      if (found.expiresAt < Date.now()) {
        console.error('Challenge expired (decoded)');
        return false;
      }
      return true;
    }
  } catch (e) {
    // 解碼失敗則忽略，繼續報錯
  }

  console.error(`Challenge not found in map. Key: ${norm}, Map keys: ${Array.from(adminChallenges.keys())}`);
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
  const bearerToken = getBearerToken(req);
  if (bearerToken) {
    return bearerToken;
  }
  const sessionToken = typeof req.query?.sessionToken === 'string' ? req.query.sessionToken.trim() : '';
  return sessionToken;
};

const requireAdminAuth = (req, res, next) => {
  const token = getAdminSessionFromRequest(req);
  const expiresAt = adminSessions.get(token);
  if (!token || !expiresAt || expiresAt < Date.now()) {
    if (token) adminSessions.delete(token);
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
    // [修復] 提取時也進行標準化處理
    return normalizeChallenge(parsed.challenge);
  } catch (error) {
    console.error('Error parsing clientDataJSON:', error);
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
// 6. API 路由
// ----------------------------------------------------------------------

app.get('/api/records', requireAdminAuth, (req, res) => {
  db.all("SELECT * FROM checkins ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
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
    console.error('路徑安全檢查失敗:', { filePath, absoluteUploadDir });
    return res.status(403).json({ error: 'Invalid file path' });
  }

  const exists = await fs.pathExists(filePath);
  if (!exists) {
    console.error('請求檔案不存在:', { filePath });
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
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ hasPasskey: Number(row?.count || 0) > 0 });
  });
});

app.post('/api/admin/passkeys/register/options', async (req, res) => {
  const bearerToken = getBearerToken(req);

  try {
    // 檢查管理員狀態
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

    // 獲取排除列表
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
    console.error('Registration Options Error:', err);
    res.status(500).json({ error: err.message });
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
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true });
        }
      );
    } else {
      res.status(400).json({ error: 'Registration verification failed' });
    }
  } catch (error) {
    console.error('Verify Registration Error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/passkeys/auth/options', (req, res) => {
  db.all('SELECT credential_id FROM admin_passkeys', [], async (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
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
      res.status(500).json({ error: e.message });
    }
  });
});

app.post('/api/admin/passkeys/auth/verify', async (req, res) => {
  const { credential } = req.body || {};
  if (!credential || !credential.id) return res.status(400).json({ error: 'credential is required' });

  const challenge = extractChallengeFromCredential(credential);
  if (!challenge || !consumeChallenge(challenge, 'auth')) {
    return res.status(400).json({ error: 'Invalid or expired challenge' });
  }

  db.get('SELECT * FROM admin_passkeys WHERE credential_id = ?', [credential.id], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
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
      console.error('Verify Auth Error:', verifyErr);
      res.status(400).json({ error: verifyErr.message });
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
  db.get('SELECT steps FROM step_templates WHERE lang = ?', [targetLang], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Steps not found' });
    try {
      res.json(JSON.parse(row.steps));
    } catch (parseErr) {
      res.status(500).json({ error: 'Invalid step data' });
    }
  });
});

app.get('/api/completion-template', (req, res) => {
  const { lang } = req.query;
  const targetLang = typeof lang === 'string' ? lang : 'zh-hans';
  db.get('SELECT template FROM completion_templates WHERE lang = ?', [targetLang], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Completion template not found' });
    try {
      res.json(JSON.parse(row.template));
    } catch (parseErr) {
      res.status(500).json({ error: 'Invalid completion template data' });
    }
  });
});

app.patch('/api/records/:recordId/guests/:guestId', requireAdminAuth, (req, res) => {
  const { recordId, guestId } = req.params;
  const { deleted } = req.body || {};
  if (typeof deleted !== 'boolean') return res.status(400).json({ error: 'Invalid deleted flag' });

  db.get('SELECT data FROM checkins WHERE id = ?', [recordId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
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
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        res.json({ success: true });
      });
    } catch (parseErr) {
      res.status(500).json({ error: 'Invalid record data' });
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
      if (err) return res.status(500).json({ error: err.message });
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
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.post('/api/submit', async (req, res) => {
  try {
    const { guests } = req.body;
    if (!Array.isArray(guests) || guests.length === 0) {
      res.status(400).json({ success: false, error: 'Invalid guest payload' });
      return;
    }

    const invalidGuest = guests.find((guest) => !validateGuestPayload(guest).valid);
    if (invalidGuest) {
      const { error } = validateGuestPayload(invalidGuest);
      res.status(400).json({ success: false, error: error || 'Guest payload validation failed' });
      return;
    }

    const submitId = uuidv4();
    const today = new Date().toISOString().split('T')[0];

    const guestsWithUrls = (await saveImagesLocally(guests)).map((guest) => ({ ...guest, deleted: guest.deleted === true }));

    const stmt = db.prepare("INSERT INTO checkins (id, date, data) VALUES (?, ?, ?)");
    stmt.run(submitId, today, JSON.stringify(guestsWithUrls), function (err) {
      if (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
      } else {
        console.log(`新入住登記: ${submitId}, 日期: ${today}`);
        res.json({ success: true, id: submitId });
      }
    });
    stmt.finalize();
  } catch (error) {
    console.error('服務器錯誤:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.post('/api/ocr/passport', async (req, res) => {
  try {
    const { image } = req.body || {};
    if (typeof image !== 'string' || !image.startsWith('data:image')) {
      res.status(400).json({ success: false, error: 'Invalid image payload' });
      return;
    }

    const ocrResult = await runLocalPaddleOcr(image);
    res.json(ocrResult);
  } catch (error) {
    console.error('護照 OCR 接口錯誤:', error);
    res.status(500).json({ success: false, error: 'Passport OCR failed' });
  }
});

app.listen(PORT, () => {
  console.log(`--------------------------------------------------`);
  console.log(`🏨 飯店管理後台服務已啟動`);
  console.log(`📡 API 地址: http://localhost:${PORT}`);
  console.log(`📂 圖片存儲: ${UPLOAD_DIR}`);
  console.log(`💾 數據庫: ${DB_PATH}`);
  console.log(`🌐 WebAuthn Origin: ${EXPECTED_ORIGIN}`);
  console.log(`--------------------------------------------------`);
});
