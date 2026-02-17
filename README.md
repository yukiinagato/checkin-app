# Checkin App 🏨

一个用于酒店前台 / 自助终端的全栈入住登记系统，包含住客登记流程、多语言引导、证件图片上传、后台模板管理与 Passkey 管理员认证。

## 🌍 语言支持（UI）

当前内置并可在前台切换的主要语言：

- 日本語 (`jp`)
- English (`en`)
- 简体中文 (`zh-hans`)
- 繁體中文 (`zh-hant`)
- 한국어 (`ko`)

> 说明：默认语言为 `jp`（代码中 `DEFAULT_LANG = 'jp'`）。

---

## ✨ 功能概览

### 前台（住客端）

- 分步骤阅读入住须知（可多语言）。
- 按人数登记住客信息（成人 / 未成年人）。
- 区分本地住客与海外住客字段：
  - 本地住客：姓名、年龄、地址；16 岁及以上要求电话。
  - 海外住客：姓名、年龄、国籍、护照号、护照照片。
  - 未成年人：额外要求监护人姓名与电话。
- 提交后将数据写入 SQLite，证件图保存到本地上传目录。
- 完成页支持按语言渲染可配置内容（标题、副标题、HTML 富文本区块）。

### 后台（管理员）

- Passkey 注册与登录（WebAuthn）。
- 查看所有入住记录（按时间倒序）。
- 按住客维度软删除/恢复（`deleted` 标记）。
- 查看护照图片（鉴权后访问）。
- 编辑并保存多语言步骤模板。
- 编辑并保存多语言完成页模板。
- 导出 CSV。

---

## 🧱 技术栈

### Client

- React 18 + Vite
- Tailwind CSS
- Lucide React
- DOMPurify（富文本清洗）

### Server

- Node.js + Express
- SQLite3
- fs-extra（文件写入）
- @simplewebauthn/server（Passkey / WebAuthn）

---

## 📁 项目结构

```text
checkin-app/
├── client/
│   ├── src/
│   │   ├── App.jsx               # 前台流程、API 调用、语言与登记逻辑
│   │   └── AdminPage.jsx         # 后台登录与管理页面
│   ├── public/ha-login-image.png # 默认完成页图示资源
│   └── vite.config.js            # 前端代理配置（/api -> localhost:3002）
├── server/
│   ├── server.js                 # 后端入口、鉴权、API、SQLite 初始化
│   ├── stepTemplates.js          # 多语言步骤模板初始数据
│   ├── completionTemplates.js    # 多语言完成页模板初始数据
│   └── .env.development          # 开发环境默认变量
├── package.json                  # monorepo 根脚本
└── pnpm-workspace.yaml
```

---

## ✅ 环境要求

- Node.js 18+
- pnpm 8+

安装依赖：

```bash
pnpm install
```

---

## 🚀 快速启动（开发）

在仓库根目录执行：

```bash
pnpm dev
```

该命令会并行启动：

- `server`：`NODE_ENV=development nodemon server.js`
- `client`：`vite`

默认开发端口（来自现有配置）：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3002`（`server/.env.development` 中 `PORT=3002`）

> 前端通过 Vite proxy 将 `/api` 转发到 `http://localhost:3002`。

---

## 🧪 常用命令

```bash
# 根目录
pnpm dev
pnpm start
pnpm test
pnpm build

# 单独运行后端
pnpm --filter server dev
pnpm --filter server start
pnpm --filter server test

# 单独运行前端
pnpm --filter client dev
pnpm --filter client test
pnpm --filter client build
pnpm --filter client preview
```

---

## ⚙️ 配置说明（后端环境变量）

后端会根据 `NODE_ENV` 自动读取：

- `development` -> `server/.env.development`
- `production` -> `server/.env.production`

关键变量如下：

- `PORT`：后端监听端口。
- `DB_PATH`：SQLite 数据库路径。
- `UPLOAD_DIR`：上传文件目录。
- `ADMIN_API_TOKEN`：首次注册 Passkey 时的初始化令牌（必填）。
- `CORS_ORIGIN`：允许跨域来源，支持逗号分隔多值（必填）。
- `WEBAUTHN_RP_ID`：WebAuthn Relying Party ID（默认 `localhost`）。
- `WEBAUTHN_RP_NAME`：WebAuthn RP 展示名称（默认 `Checkin Admin`）。
- `WEBAUTHN_ORIGIN`：WebAuthn 验证 Origin（会移除末尾 `/`）。
- `PADDLE_OCR_PYTHON`：本地 PaddleOCR 运行的 Python 命令（默认 `python3`）。
- `PADDLE_OCR_RUNNER`：本地 PaddleOCR 识别脚本路径（默认 `server/tools/paddle_ocr_runner.py`）。

如果缺少 `ADMIN_API_TOKEN` 或 `CORS_ORIGIN`，服务将直接抛错退出。

### 本地部署 PaddleOCR（服务端）

当前项目已支持通过后端本地调用 PaddleOCR（Python 版）进行护照识别，接口为：

- `POST /api/ocr/passport`（body: `{ "image": "data:image/...;base64,..." }`）

部署步骤：

```bash
# 1) 安装 Python 依赖（建议在虚拟环境）
pip install paddleocr paddlepaddle

# 2) 确认运行脚本存在
ls server/tools/paddle_ocr_runner.py

# 3) 启动后端（按需设置环境变量）
PADDLE_OCR_PYTHON=python3 \
PADDLE_OCR_RUNNER=./server/tools/paddle_ocr_runner.py \
pnpm --filter server dev
```

说明：前端上传护照后会优先请求该后端 OCR 接口；若本地 PaddleOCR 不可用，前端会回退到浏览器端本地识别流程。

---

## 🔐 管理员认证机制（Passkey）

### 首次绑定

1. 后台查询当前是否已有 Passkey。
2. 若无 Passkey，必须用 `Authorization: Bearer <ADMIN_API_TOKEN>` 调用注册 options。
3. 前端发起 `navigator.credentials.create(...)`。
4. 后端验证注册响应后写入 `admin_passkeys` 表。

### 后续登录

1. 请求认证 options。
2. 前端调用 `navigator.credentials.get(...)`。
3. 后端验证签名并更新计数器 `counter`。
4. 返回 `sessionToken`（内存会话，默认有效期 24 小时）。

### 会话与挑战

- 挑战 challenge 有效期 5 分钟。
- 管理员会话 token 有效期 24 小时。
- 受保护接口通过 `Bearer token`（或个别图片场景 query 参数）鉴权。

---

## 🗄️ 数据存储设计

系统初始化时自动创建/迁移以下表：

- `checkins`
  - `id` 主键
  - `date`（提交日期）
  - `data`（住客数组 JSON）
  - `created_at`
- `step_templates`
  - `lang` 主键
  - `steps`（JSON）
  - `updated_at`
- `completion_templates`
  - `lang` 主键
  - `template`（JSON）
  - `updated_at`
- `admin_passkeys`
  - `credential_id` 主键
  - `public_key`
  - `counter`
  - `transports`
  - `created_at`

> `admin_passkeys` 支持启动时自动补齐缺失字段（兼容旧库）。

---

## 🧾 前台提交校验规则

提交 `/api/submit` 时，后端会做核心校验：

- `guests` 必须是非空数组。
- 每位住客都必须有有效 `name` 与 `age`（`0~120`）。
- 未成年人（`age < 18`）必须有 `guardianName` + `guardianPhone`。
- `isResident === true`：
  - 必须有 `address`
  - 若 `age >= 16`，必须有 `phone`
- `isResident !== true`：
  - 必须有 `nationality`、`passportNumber`、`passportPhoto`

图片保存逻辑：

- 仅处理 `data:image/...;base64,...` 格式。
- 白名单类型：jpg / jpeg / png / webp / heic / heif。
- 文件名使用随机 UUID，写入 `UPLOAD_DIR`。
- 使用路径安全检查避免目录穿越。

---

## 🔌 API 概览

### 公开接口

- `GET /api/steps?lang=...`：获取指定语言步骤模板。
- `GET /api/completion-template?lang=...`：获取指定语言完成页模板。
- `POST /api/submit`：提交入住数据。
- `GET /api/admin/passkeys/status`：查询是否已绑定 Passkey。
- `POST /api/admin/passkeys/auth/options`：获取认证 options。
- `POST /api/admin/passkeys/auth/verify`：验证认证响应。
- `POST /api/admin/passkeys/register/verify`：验证注册响应。

### 需管理员会话接口

- `GET /api/records`
- `PATCH /api/records/:recordId/guests/:guestId`
- `GET /api/admin/uploads/:filename`
- `GET /api/admin/session`
- `POST /api/admin/logout`
- `PUT /api/admin/steps?lang=...`
- `PUT /api/admin/completion-template?lang=...`

### 需初始化令牌或管理员会话

- `POST /api/admin/passkeys/register/options`
  - 无 Passkey 时：需 `ADMIN_API_TOKEN`
  - 有 Passkey 后：需管理员会话 token

---

## 🧭 前端流程说明

1. 选择语言并加载该语言步骤模板。
2. 按步骤阅读须知。
3. 在登记步骤填入住客信息并上传证件图。
4. 提交成功后展示“完成页模板”（支持富文本与图片）。
5. 管理入口可切换到后台登录页，进行 Passkey 登录与数据管理。

---

## 🛡️ 安全与运维建议

- **务必修改默认 `ADMIN_API_TOKEN`**，并仅在受控环境注入。
- 生产环境使用 HTTPS（WebAuthn 对 HTTPS 依赖强）。
- 将 `CORS_ORIGIN` 精确配置为可信域名列表。
- 定期备份 `DB_PATH` 与 `UPLOAD_DIR`。
- 如果多实例部署，当前内存会话（`adminSessions`）需改造为共享存储（如 Redis）。

---

## 🚢 生产部署建议

推荐使用反向代理统一入口：

- `/` -> 前端静态资源（`client/dist`）
- `/api` -> Node 服务

最小流程：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter server start
```

然后由 Nginx / Caddy 对外提供 HTTPS 与反向代理。

---

## 🧰 故障排查

### 1) 启动即报错 `ADMIN_API_TOKEN is required`

- 检查环境变量是否存在。
- 确认 `NODE_ENV` 对应的 env 文件中已配置。

### 2) 启动即报错 `CORS_ORIGIN is required`

- 设置 `CORS_ORIGIN`，可用逗号分隔多个来源。

### 3) 前端请求失败

- 检查 Vite 代理目标端口是否与后端端口一致（默认 3002）。
- 检查后端是否已启动。

### 4) Passkey 验证失败

- 检查 `WEBAUTHN_ORIGIN`、`WEBAUTHN_RP_ID` 与实际访问域名是否匹配。
- 确保浏览器/系统支持 WebAuthn 与 Passkey。
