const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const STEP_TEMPLATES = require('./stepTemplates');

const app = express();
const PORT = 3001;

// 1. 中間件配置
app.use(cors()); // 允許 React 前端跨域訪問
app.use(express.json({ limit: '50mb' })); // 允許大文件上傳(圖片)

// 2. 初始化存儲路徑
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_PATH = path.join(__dirname, 'hotel.db');
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || '8808';
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

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
        if (!ALLOWED_IMAGE_TYPES.has(matches[1])) return guest;

        const imageBuffer = Buffer.from(matches[2], 'base64');
        const extension = matches[1].split('/')[1];
        const filename = `${guest.id}_passport.${extension}`;
        const filePath = path.join(UPLOAD_DIR, filename);

        // 寫入文件
        await fs.outputFile(filePath, imageBuffer);

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

const getAdminSessionFromRequest = (req) => {
  const authHeader = req.get('authorization');
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }

  const sessionHeader = req.get('x-admin-session');
  if (typeof sessionHeader === 'string' && sessionHeader) {
    return sessionHeader;
  }

  if (typeof req.query.token === 'string' && req.query.token) {
    return req.query.token;
  }

  return '';
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

const toAdminImageUrl = (passportPhoto, sessionToken) => {
  if (typeof passportPhoto !== 'string' || !passportPhoto) {
    return passportPhoto;
  }

  if (passportPhoto.startsWith('/api/admin/uploads/')) {
    return passportPhoto;
  }

  const rawName = passportPhoto
    .replace(/^https?:\/\/[^/]+\/uploads\//, '')
    .replace(/^\/uploads\//, '');

  return `http://localhost:${PORT}/api/admin/uploads/${encodeURIComponent(rawName)}?token=${encodeURIComponent(sessionToken)}`;
};

// ----------------------------------------------------------------------
// API 路由
// ----------------------------------------------------------------------

// 獲取所有記錄
app.get('/api/records', requireAdminAuth, (req, res) => {
  const sessionToken = getAdminSessionFromRequest(req);
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
        passportPhoto: toAdminImageUrl(guest.passportPhoto, sessionToken)
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
  const bootstrapToken = req.get('x-admin-token') || req.body?.bootstrapToken || '';
  db.get('SELECT COUNT(*) as count FROM admin_passkeys', [], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    const hasPasskey = Number(row?.count || 0) > 0;
    if (hasPasskey) {
      res.status(403).json({ error: 'Passkey already configured' });
      return;
    }
    if (!bootstrapToken || bootstrapToken !== ADMIN_API_TOKEN) {
      res.status(401).json({ error: 'Invalid bootstrap token' });
      return;
    }

    const challenge = createChallenge('register');
    res.json({ challenge });
  });
});

app.post('/api/admin/passkeys/register/verify', (req, res) => {
  const { challenge, credentialId } = req.body || {};
  if (!challenge || !credentialId) {
    res.status(400).json({ error: 'challenge and credentialId are required' });
    return;
  }

  if (!consumeChallenge(challenge, 'register')) {
    res.status(400).json({ error: 'Invalid or expired challenge' });
    return;
  }

  db.run('INSERT OR REPLACE INTO admin_passkeys (credential_id) VALUES (?)', [credentialId], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ success: true });
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
    res.json({
      challenge,
      allowCredentials: rows.map((row) => ({ id: row.credential_id, type: 'public-key' }))
    });
  });
});

app.post('/api/admin/passkeys/auth/verify', (req, res) => {
  const { challenge, credentialId } = req.body || {};
  if (!challenge || !credentialId) {
    res.status(400).json({ error: 'challenge and credentialId are required' });
    return;
  }

  if (!consumeChallenge(challenge, 'auth')) {
    res.status(400).json({ error: 'Invalid or expired challenge' });
    return;
  }

  db.get('SELECT credential_id FROM admin_passkeys WHERE credential_id = ?', [credentialId], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(401).json({ error: 'Unknown passkey' });
      return;
    }

    const sessionToken = createSessionToken();
    res.json({ success: true, sessionToken });
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
