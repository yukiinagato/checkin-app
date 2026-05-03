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
│   ├── server.js                 # 后端入口、鉴权、API、HTTP 路由
│   ├── src/
│   │   ├── db.js                 # SQLite 连接、PRAGMA 调优、迁移执行器
│   │   ├── logger.js             # pino 结构化日志工厂
│   │   ├── sessions.js           # 持久化到 SQLite 的 admin session store
│   │   └── semaphore.js          # OCR 子进程并发限流
│   ├── migrations/               # 按文件名顺序执行的 schema 迁移
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

## 📦 一键部署本地依赖与 OCR

在仓库根目录执行：

```bash
pnpm run deploy
```

该命令会完成：

- 安装 Node 依赖：`pnpm install --frozen-lockfile`。
- 优先复用系统 Python 3.10/3.11；若仅检测到 Python 3.9 或未检测到合适版本，会自动下载项目内 CPython 3.11 到 `server/.python/`。
- 创建项目内 Python 虚拟环境：`server/.venv`。
- 将 RapidOCR ONNX Runtime、OpenCV、Pillow/AVIF 等 OCR 依赖安装到 `server/.venv`。
- 在项目内预热 OCR runtime，避免首次识别时才初始化。
- 将 OCR/Python/pip 相关缓存限制在 `server/.cache`、`server/.ocr-models`、`server/.paddle`。
- 生成/更新 `server/.env.development`，指向项目内 venv 和 OCR runner。

这套流程不会安装 Python 包到系统环境，也不会把 OCR 模型写入用户 home 目录。若触发自动升级，CPython runtime 也只会落在项目目录 `server/.python/`。部署产物均已加入 `.gitignore`。

可选参数：

```bash
# 跳过 Node 依赖安装，只部署 OCR 环境
CHECKIN_SKIP_NODE_INSTALL=1 pnpm deploy

# 跳过模型预热，只安装依赖
CHECKIN_SKIP_OCR_WARMUP=1 pnpm deploy

# 指定 Python 3.10-3.11
PYTHON=/path/to/python3.11 pnpm deploy

# 覆盖内置的 standalone Python 版本或 release tag
CHECKIN_PYTHON_STANDALONE_VERSION=3.11.15 CHECKIN_PYTHON_STANDALONE_TAG=20260414 pnpm deploy
```

---

## 🧪 常用命令

```bash
# 根目录
pnpm deploy
pnpm dev
pnpm build
pnpm start
pnpm test

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

生产启动顺序：

```bash
pnpm build
pnpm start
```

`pnpm start` 现在只启动后端生产服务；当 `NODE_ENV=production` 时，后端会直接托管 `client/dist` 静态文件，不再依赖 Vite 开发服务器。

---

## ⚙️ 配置说明（后端环境变量）

后端会根据 `NODE_ENV` 自动读取：

- `development` -> `server/.env.development`
- `production` -> `server/.env.production`

生产环境建议从 [server/.env.production.example](/Users/ox/Documents/project/checkin-app/server/.env.production.example) 复制生成 `server/.env.production`，再按真实域名、数据库目录与管理员令牌调整。

关键变量如下：

- `PORT`：后端监听端口。
- `HOST`：后端绑定地址，默认 `0.0.0.0`。
- `DB_PATH`：SQLite 数据库路径。
- `UPLOAD_DIR`：上传文件目录。
- `CLIENT_DIST_DIR`：生产环境前端构建目录，默认 `../client/dist`。
- `ADMIN_API_TOKEN`：首次注册 Passkey 时的初始化令牌（必填）。
- `CORS_ORIGIN`：允许跨域来源，支持逗号分隔多值（必填）。
- `WEBAUTHN_RP_ID`：WebAuthn Relying Party ID（默认 `localhost`）。
- `WEBAUTHN_RP_NAME`：WebAuthn RP 展示名称（默认 `Checkin Admin`）。
- `WEBAUTHN_ORIGIN`：WebAuthn 验证 Origin（会移除末尾 `/`）。
- `TRUST_PROXY`：反向代理场景下的 `Express trust proxy` 设置，默认 `loopback`。
- `JSON_BODY_LIMIT`：含图片的路由（`/api/submit`、`/api/ocr/passport`、`/api/admin/steps`、`/api/admin/completion-template`）的 JSON 请求体大小上限，默认 `10mb`。
- `SMALL_JSON_BODY_LIMIT`：其它 API 的 JSON 请求体大小上限，默认 `256kb`，用于压缩滥用面。
- `MAX_IMAGE_BYTES`：单张证件图片最大字节数，默认 `10485760`（10MB）。
- `MAX_GUESTS_PER_SUBMISSION`：单次提交最多住客数，默认 `12`。
- `REQUEST_TIMEOUT_MS`：单请求超时，默认 `30000`。
- `OCR_MAX_CONCURRENCY`：同时执行的本地护照 OCR Python 子进程上限，默认 `2`，避免同时多张照片打爆 CPU。
- `OCR_QUEUE_TIMEOUT_MS`：OCR 信号量等待最长时间，默认 `15000`，超时返回 `503 OCR_BUSY` 并保留已上传照片。
- `LOG_LEVEL`：pino 日志等级（`trace`/`debug`/`info`/`warn`/`error`/`fatal`），生产默认 `info`、开发默认 `debug`。
- `PADDLE_OCR_PYTHON`：本地护照 OCR 运行的 Python 命令（默认 `python3`，变量名保留用于兼容旧配置）。
- `PADDLE_OCR_RUNNER`：本地护照 OCR 识别脚本路径（默认 `server/tools/paddle_ocr_runner.py`，变量名保留用于兼容旧配置）。

如果缺少 `ADMIN_API_TOKEN` 或 `CORS_ORIGIN`，服务将直接抛错退出。

### 生产运行建议

- 用反向代理（Nginx / Caddy / ALB）终止 HTTPS，再把流量转发到本服务。
- 将 `DB_PATH`、`UPLOAD_DIR` 指向持久化磁盘，不要落在临时目录。
- `ADMIN_API_TOKEN` 必须替换为长随机串，并只用于首次绑定 Passkey。
- 管理员 session 现已持久化到 SQLite `admin_sessions` 表，进程重启不会强制下线。本服务为**单机部署**设计，未对多实例共享 session 做适配。
- SQLite 启动时会自动开启 `journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`、`busy_timeout=5000`，提升并发与崩溃容错。
- 数据库 schema 由 `server/migrations/` 下的迁移脚本管理，启动时按版本号顺序自动执行；可单独运行 `pnpm --filter server migrate` 手动跑迁移。
- 日志为 pino JSON 输出（每行一条），生产建议交由 systemd / 文件重定向 / 日志采集器处理；不再使用 `console.*`。
- 5xx 错误响应不会带出内部错误信息，仅返回 `{ "error": "Internal Server Error", "requestId": "..." }`，详细错误堆栈写入日志，可凭 `requestId` 追溯。
- 建议用探针接入：
  - `GET /api/health`：进程存活检查
  - `GET /api/ready`：数据库可用性检查

### 已部署实例迁移步骤

已有实例升级到当前版本时，建议按下面顺序执行：

```bash
# 1) 先备份当前生产实例数据
pnpm backup:instance

# 2) 更新代码并安装依赖
git pull
pnpm install

# 3) 构建前端静态资源
pnpm build

# 4) 重启生产服务
pnpm start
```

说明：

- `pnpm backup:instance` 会读取 `server/.env.production`，备份当前 `DB_PATH`、`UPLOAD_DIR` 以及 `.env.production` 到项目根目录 `backups/`。
- 当前版本对既有 SQLite 数据库是**非破坏性兼容**的，不会重置 `checkins`、`admin_passkeys`、模板数据或上传图片。
- 远端新增的步骤 `category` 字段对旧模板数据做了兼容推断；旧实例不需要手工改库即可启动。
- 如果生产实例仍使用旧的 `server/.env.production`，请至少核对 `CORS_ORIGIN`、`WEBAUTHN_ORIGIN`、`DB_PATH`、`UPLOAD_DIR` 是否仍指向正确的持久化位置。

### 本地部署 OCR（服务端）

当前项目已支持通过后端本地调用 RapidOCR ONNX Runtime 进行护照识别，并在 OCR 请求时保存护照照片，接口为：

- `POST /api/ocr/passport`（body: `{ "image": "data:image/...;base64,..." }`，返回包含 `passportPhoto` 文件名）

部署步骤：

```bash
# 1) 一键部署项目内虚拟环境和 OCR 依赖
pnpm deploy

# 2) 确认运行脚本存在
ls server/tools/paddle_ocr_runner.py

# 3) 启动后端（按需设置环境变量）
PADDLE_OCR_PYTHON=./server/.venv/bin/python \
PADDLE_OCR_RUNNER=./server/tools/paddle_ocr_runner.py \
pnpm --filter server dev
```

说明：前端使用系统拍照/相册选择上传护照照片；后端会先保存照片，再执行 OCR。若本地 OCR 不可用，照片仍会保存，前台会提示手动补充护照信息。

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
- `admin_sessions`
  - `token` 主键
  - `expires_at`（毫秒时间戳）
  - `created_at`
  - 用于跨进程重启保留管理员会话；启动时 hydrate 到内存缓存。

> `admin_passkeys` 支持启动时自动补齐缺失字段（兼容旧库）。

> 数据库 schema 由 `server/migrations/` 下的版本化脚本管理，记录在 `schema_migrations` 表。新增 schema 变更请新增一个 `00X_*.js` 文件并实现 `up({ db, runAsync, allAsync, getAsync })`。

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
4. 提交成功后跳转到 `/checkin/done` 完成页，**强提示客人继续阅读住宿指南**（"查看住宿指南"按钮为主 CTA）。
5. 管理入口可切换到后台登录页，进行 Passkey 登录与数据管理。

### 路由总览

前端使用 `react-router-dom` 的 `BrowserRouter`，所有视图都有独立 URL：

| 路径 | 视图 |
|---|---|
| `/` | 首页（语言未选时显示语言选择，已选时显示落地页 / 历史回看入口） |
| `/checkin` | 多步登记表单（中间步骤是表单 wizard 的内部状态，不会出现在 URL） |
| `/checkin/done` | 提交成功页 + 强提示阅读指南 |
| `/guide` | 指南目录 |
| `/guide/:stepId` | 单步骤页（solo）或群组子目录（如 `/guide/safety`） |
| `/guide/:stepId/:childId` | 群组下的子步骤（如 `/guide/safety/emergency`） |
| `/admin` | 自动跳到 `/admin/data` |
| `/admin/data` / `/admin/files` / `/admin/settings` / `/admin/steps` | 后台四个 tab |

浏览器前进/后退按钮按预期工作；任何深层 URL 都可直接刷新或分享。SPA fallback 配置见下文"生产部署建议"。

---

## 🛡️ 安全与运维建议

- **务必修改默认 `ADMIN_API_TOKEN`**，并仅在受控环境注入。
- 生产环境使用 HTTPS（WebAuthn 对 HTTPS 依赖强）。
- 将 `CORS_ORIGIN` 精确配置为可信域名列表。
- 定期备份 `DB_PATH` 与 `UPLOAD_DIR`（启用 WAL 后备份建议用 `sqlite3 hotel.db ".backup ..."` 或 `pnpm backup:instance`，避免裸 cp 在 checkpoint 时刻拿到不一致快照）。
- 若反向代理已限制 client_max_body_size，也保留 nginx 侧的限制；服务端 `SMALL_JSON_BODY_LIMIT` 与 `JSON_BODY_LIMIT` 仍提供第二道防线。
- OCR 接口同时受 `OCR_MAX_CONCURRENCY`（同时执行）+ `ocrRateLimit`（每分钟 10 次/IP）双重保护，超额自动排队或 503。
- 数据库迁移：`pnpm --filter server migrate` 可在不启动服务的情况下应用 `server/migrations/` 下未应用的迁移；服务启动时也会自动执行。

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

### SPA 路由 fallback

前端使用 react-router 的 BrowserRouter，刷新或直接访问 `/checkin`、`/guide/safety`、`/admin/steps` 等深层 URL 必须能落到 `index.html`，否则会 404。

- **方案 A（默认）**：Node 后端在 `NODE_ENV=production` 下已经接管 `client/dist` 静态托管，并对所有非 `/api` 路径回退到 `index.html`，反代只需把全部流量转给后端即可。
- **方案 B（Nginx 直接托管前端）**：如果想让 nginx 直接服务静态文件、只把 `/api` 转给后端，需要给前端 location 加 SPA fallback：

  ```nginx
  server {
    server_name checkin.example.com;
    listen 443 ssl http2;

    root /var/www/checkin/client/dist;
    index index.html;

    location /api/ {
      proxy_pass http://127.0.0.1:3001;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      client_max_body_size 12m;
    }

    location / {
      try_files $uri $uri/ /index.html;
    }
  }
  ```

  - `try_files ... /index.html` 是 SPA 必备项，未配置会让 `/checkin/done` 这类深层路径返回 404。
  - 如果用方案 B，请把 `CLIENT_DIST_DIR` 留给后端但不会被使用——只要 `/api` 走后端即可，后端的静态托管会被 nginx 屏蔽。

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
