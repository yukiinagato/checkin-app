const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const STEP_TEMPLATES = require('./stepTemplates');

const app = express();
const PORT = 3001;

const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
if (!ADMIN_API_TOKEN) {
  throw new Error('ADMIN_API_TOKEN is required');
}

const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Checkin Admin';
const EXPECTED_ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173';

const CORS_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

if (!CORS_ORIGINS.length) {
  throw new Error('CORS_ORIGIN is required (comma-separated origins)');
}

// 1. 中間件配置
app.use(cors({ origin: CORS_ORIGINS }));
app.use(express.json({ limit: '50mb' })); // 允許大文件上傳(圖片)

// 2. 初始化存儲路徑
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_PATH = path.join(__dirname, 'hotel.db');
const ALLOWED_IMAGE_TYPES = new Map([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
].map((mime) => [mime, mime === 'image/jpg' ? 'jpg' : mime.split('/')[1]]));
fs.ensureDirSync(UPLOAD_DIR);

// 3. 初始化 SQLite 數據庫
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('數據庫連接失敗:', err.message);
  else console.log('已連接到本地 SQLite 數據庫');
});

// 創建表結構
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

// ----------------------------------------------------------------------
// 輔助函數：處理 Base64 圖片並保存為文件
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

        // 更新 guest 對象中的圖片路徑為文件名（管理端按權限讀取）
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

const parseRecordData = (row) => {
  try {
    return JSON.parse(row.data);
  } catch (error) {
    console.warn(`無法解析記錄 ${row.id} 的數據:`, error);
    return [];
  }
};

const adminChallenges = new Map();
const adminSessions = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const createChallenge = (purpose) => {
  const challenge = crypto.randomBytes(32).toString('base64url');
  adminChallenges.set(challenge, { purpose, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return challenge;
};

const consumeChallenge = (challenge, purpose) => {
  const found = adminChallenges.get(challenge);
  if (!found) return false;
  adminChallenges.delete(challenge);
  if (found.purpose !== purpose) return false;
  if (found.expiresAt < Date.now()) return false;
  return true;
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

const getAdminSessionFromRequest = (req) => getBearerToken(req);

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
    return typeof parsed.challenge === 'string' ? parsed.challenge : '';
  } catch (error) {
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

  return `http://localhost:${PORT}/api/admin/uploads/${encodeURIComponent(rawName)}`;
};

// ----------------------------------------------------------------------
// API 路由
// ----------------------------------------------------------------------

// 獲取所有記錄
app.get('/api/records', requireAdminAuth, (req, res) => {
  db.all("SELECT * FROM checkins ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    // 將數據庫存儲的 JSON 字符串轉回對象
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
  const filePath = path.join(UPLOAD_DIR, filename);

  if (!filePath.startsWith(UPLOAD_DIR)) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }

  const exists = await fs.pathExists(filePath);
  if (!exists) {
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

app.post('/api/admin/passkeys/register/options', (req, res) => {
  const bearerToken = getBearerToken(req);
  db.get('SELECT COUNT(*) as count FROM admin_passkeys', [], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const hasPasskey = Number(row?.count || 0) > 0;
    if (!hasPasskey) {
      if (!bearerToken || bearerToken !== ADMIN_API_TOKEN) {
        res.status(401).json({ error: 'Invalid bootstrap token' });
        return;
      }
    } else {
      const expiresAt = adminSessions.get(bearerToken);
      if (!bearerToken || !expiresAt || expiresAt < Date.now()) {
        if (bearerToken) adminSessions.delete(bearerToken);
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }

    const challenge = createChallenge('register');
    db.all('SELECT credential_id FROM admin_passkeys', [], (queryErr, rowsForExclude) => {
      if (queryErr) {
        res.status(500).json({ error: queryErr.message });
        return;
      }

      const options = generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userID: 'admin-user',
        userName: 'admin@checkin.local',
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

      res.json(options);
    });
  });
});

app.post('/api/admin/passkeys/register/verify', (req, res) => {
  const { credential } = req.body || {};
  if (!credential) {
    res.status(400).json({ error: 'credential is required' });
    return;
  }

  const challenge = extractChallengeFromCredential(credential);

  if (!challenge || !consumeChallenge(challenge, 'register')) {
    res.status(400).json({ error: 'Invalid or expired challenge' });
    return;
  }

  verifyRegistrationResponse({
    response: credential,
    expectedChallenge: challenge,
    expectedOrigin: EXPECTED_ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: true
  })
    .then((verification) => {
      if (!verification.verified || !verification.registrationInfo) {
        res.status(401).json({ error: 'Registration verification failed' });
        return;
      }

      const { credential: credentialInfo } = verification.registrationInfo;
      const transports = Array.isArray(credential.response?.transports)
        ? JSON.stringify(credential.response.transports)
        : null;
      db.run(
        'INSERT OR REPLACE INTO admin_passkeys (credential_id, public_key, counter, transports) VALUES (?, ?, ?, ?)',
        [
          credentialInfo.id,
          Buffer.from(credentialInfo.publicKey).toString('base64url'),
          Number(credentialInfo.counter || 0),
          transports
        ],
        function (err) {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({ success: true });
        }
      );
    })
    .catch((error) => {
      res.status(400).json({ error: error.message || 'Invalid registration response' });
    });
});

app.post('/api/admin/passkeys/auth/options', (req, res) => {
  db.all('SELECT credential_id FROM admin_passkeys', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (!rows?.length) {
      res.status(404).json({ error: 'No passkey registered' });
      return;
    }

    const challenge = createChallenge('auth');
    const options = generateAuthenticationOptions({
      rpID: RP_ID,
      challenge,
      userVerification: 'preferred',
      allowCredentials: rows.map((row) => ({
        id: row.credential_id,
        type: 'public-key'
      }))
    });
    res.json(options);
  });
});

app.post('/api/admin/passkeys/auth/verify', (req, res) => {
  const { credential } = req.body || {};
  if (!credential || !credential.id) {
    res.status(400).json({ error: 'credential is required' });
    return;
  }

  const challenge = extractChallengeFromCredential(credential);

  if (!challenge || !consumeChallenge(challenge, 'auth')) {
    res.status(400).json({ error: 'Invalid or expired challenge' });
    return;
  }

  db.get('SELECT credential_id, public_key, counter, transports FROM admin_passkeys WHERE credential_id = ?', [credential.id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(401).json({ error: 'Unknown passkey' });
      return;
    }

    const authenticator = {
      credentialID: row.credential_id,
      credentialPublicKey: Buffer.from(row.public_key, 'base64url'),
      counter: Number(row.counter || 0),
      transports: row.transports ? JSON.parse(row.transports) : undefined
    };

    verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      authenticator,
      requireUserVerification: true
    })
      .then((verification) => {
        if (!verification.verified) {
          res.status(401).json({ error: 'Authentication verification failed' });
          return;
        }

        const newCounter = Number(verification.authenticationInfo?.newCounter || 0);
        db.run(
          'UPDATE admin_passkeys SET counter = ? WHERE credential_id = ?',
          [newCounter, row.credential_id],
          (updateErr) => {
            if (updateErr) {
              res.status(500).json({ error: updateErr.message });
              return;
            }

            const sessionToken = createSessionToken();
            res.json({ success: true, sessionToken });
          }
        );
      })
      .catch((verifyErr) => {
        res.status(400).json({ error: verifyErr.message || 'Invalid authentication response' });
      });
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
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: 'Steps not found' });
      return;
    }
    try {
      res.json(JSON.parse(row.steps));
    } catch (parseErr) {
      res.status(500).json({ error: 'Invalid step data' });
    }
  });
});


app.patch('/api/records/:recordId/guests/:guestId', requireAdminAuth, (req, res) => {
  const { recordId, guestId } = req.params;
  const { deleted } = req.body || {};

  if (typeof deleted !== 'boolean') {
    res.status(400).json({ error: 'Invalid deleted flag' });
    return;
  }

  db.get('SELECT data FROM checkins WHERE id = ?', [recordId], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (!row) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }

    let guests = [];
    try {
      guests = JSON.parse(row.data);
    } catch (parseErr) {
      res.status(500).json({ error: 'Invalid record data' });
      return;
    }

    let found = false;
    const updatedGuests = guests.map((guest) => {
      if (String(guest.id) !== String(guestId)) return guest;
      found = true;
      return {
        ...guest,
        deleted
      };
    });

    if (!found) {
      res.status(404).json({ error: 'Guest not found' });
      return;
    }

    db.run('UPDATE checkins SET data = ? WHERE id = ?', [JSON.stringify(updatedGuests), recordId], function (updateErr) {
      if (updateErr) {
        res.status(500).json({ error: updateErr.message });
        return;
      }
      res.json({ success: true });
    });
  });
});


app.put('/api/admin/steps', requireAdminAuth, (req, res) => {
  const { lang } = req.query;
  const { steps } = req.body || {};

  const targetLang = typeof lang === 'string' ? lang : '';
  if (!targetLang) {
    res.status(400).json({ error: 'lang is required' });
    return;
  }

  if (!Array.isArray(steps)) {
    res.status(400).json({ error: 'steps must be an array' });
    return;
  }

  db.run(
    `INSERT INTO step_templates (lang, steps, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(lang) DO UPDATE SET
       steps = excluded.steps,
       updated_at = CURRENT_TIMESTAMP`,
    [targetLang, JSON.stringify(steps)],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ success: true });
    }
  );
});

// 提交入住信息
app.post('/api/submit', async (req, res) => {
  try {
    const { guests } = req.body;
    if (!Array.isArray(guests) || guests.length === 0) {
      res.status(400).json({ success: false, error: 'Invalid guest payload' });
      return;
    }
    const submitId = uuidv4();
    const today = new Date().toISOString().split('T')[0];

    // 1. 先處理圖片，保存到本地，獲取 URL
    const guestsWithUrls = (await saveImagesLocally(guests)).map((guest) => ({ ...guest, deleted: guest.deleted === true }));

    // 2. 存入數據庫
    const stmt = db.prepare("INSERT INTO checkins (id, date, data) VALUES (?, ?, ?)");
    stmt.run(submitId, today, JSON.stringify(guestsWithUrls), function(err) {
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

// 啟動服務
app.listen(PORT, () => {
  console.log(`--------------------------------------------------`);
  console.log(`🏨 飯店管理後台服務已啟動`);
  console.log(`📡 API 地址: http://localhost:${PORT}`);
  console.log(`📂 圖片存儲: ${UPLOAD_DIR}`);
  console.log(`💾 數據庫: ${DB_PATH}`);
  console.log(`--------------------------------------------------`);
});
