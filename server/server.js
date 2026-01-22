const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const STEP_TEMPLATES = require('./stepTemplates');

const app = express();
const PORT = 3001;

// 1. 中間件配置
app.use(cors()); // 允許 React 前端跨域訪問
app.use(express.json({ limit: '50mb' })); // 允許大文件上傳(圖片)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // 公開圖片文件夾

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

        // 更新 guest 對象中的圖片路徑為 URL (供前端訪問)
        return {
          ...guest,
          passportPhoto: `http://localhost:${PORT}/uploads/${filename}`
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

// ----------------------------------------------------------------------
// API 路由
// ----------------------------------------------------------------------

// 獲取所有記錄
app.get('/api/records', (req, res) => {
  db.all("SELECT * FROM checkins ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    // 將數據庫存儲的 JSON 字符串轉回對象
    const records = rows.map(row => {
      return {
        id: row.id,
        submittedAt: row.created_at,
        guests: parseRecordData(row) // 這裡是處理過的 guest 列表
      };
    });
    res.json(records);
  });
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
    const guestsWithUrls = await saveImagesLocally(guests);

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
