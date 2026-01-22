# Checkin App 🏨

這是一個功能齊全的全棧登記管理應用（Check-in System）。它支持旅客信息登記、護照照片上傳以及數據持久化管理。

## 🌟 核心功能

- **旅客登記**: 錄入旅客基本信息。
- **證件上傳**: 支持護照（Passport）等證件照片的上傳與預覽（基於 `multer`）。
- **實時 UI**: 使用 `framer-motion` 實現流暢的動畫交互。
- **數據持久化**: 使用輕量級 SQLite 數據庫存儲登記信息。
- **響應式設計**: 採用 Tailwind CSS 構建，適配不同設備。

## 🛠️ 技術棧

### 前端 (Client)
- **框架**: React 18
- **構建工具**: Vite
- **樣式**: Tailwind CSS
- **動畫**: Framer Motion
- **圖標**: Lucide React
- **通信**: Axios

### 後端 (Server)
- **環境**: Node.js
- **框架**: Express
- **數據庫**: SQLite 3
- **文件處理**: Multer (處理圖片上傳)
- **中間件**: CORS, Dotenv

---

## 📂 項目結構

項目採用 pnpm 工作區（Workspace）管理：

```text
checkin-app/
├── client/                # 前端 React 應用
│   ├── src/               # 源代碼
│   └── vite.config.js     # Vite 配置
├── server/                # 後端 Express 服務
│   ├── uploads/           # 證件照片存儲目錄
│   ├── server.js          # 服務端入口
│   └── hotel.db           # SQLite 數據庫文件
├── package.json           # 根目錄配置
└── pnpm-workspace.yaml    # pnpm 工作區定義
