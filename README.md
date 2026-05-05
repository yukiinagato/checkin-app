# Checkin App 🏨

一个用于酒店前台 / 自助终端的全栈入住登记系统。包含住客登记流程、多语言引导、护照 OCR、可配置的登记字段、后台模板管理与 Passkey 管理员认证。

## 🌍 语言支持

前台可切换：日本語 (`jp`)、English (`en`)、简体中文 (`zh-hans`)、繁體中文 (`zh-hant`)、한국어 (`ko`)。默认语言为 `jp`。

---

## ✨ 功能概览

### 前台（住客端）

- 多步骤阅读入住须知（多语言）。
- 居民 / 访客 / 未成年人分支登记。
- 内置字段（除姓名外均可在后台启停、可设默认值）：年龄、电话、地址、邮编、国籍、护照号、护照照片、监护人姓名、监护人电话。
- 自定义字段：管理员可新增 text / number / select / checkbox / date / file 六种类型，支持必填、默认值、正则与最小/最大长度（或值范围、日期范围），可指定仅居民、仅访客或两者皆显示。
- 护照照片本地 OCR（RapidOCR ONNX Runtime）自动回填姓名、出生日期、国籍、护照号。
- 完成页支持按语言渲染可配置的标题、副标题与 HTML 富文本区块。

### 后台（管理员）

- Passkey 注册与登录（WebAuthn）。
- 浏览所有入住记录、按住客维度软删除/恢复、查看护照图片、导出 CSV。
- 编辑多语言步骤模板与完成页模板。
- 配置登记表单字段（内置启停 / 默认值，自定义增删改 / 归档）。
- 调整台湾命名模式等全局设置。

---

## 🧱 技术栈

- **Client**：React 18 + Vite + Tailwind CSS + react-router-dom + DOMPurify + lucide-react
- **Server**：Node.js + Express + SQLite3 + pino + @simplewebauthn/server
- **OCR**：RapidOCR ONNX Runtime（Python 子进程）

---

## 📁 项目结构

```text
checkin-app/
├── client/
│   └── src/
│       ├── App.jsx                # 前台流程
│       ├── AdminPage.jsx          # 后台界面（含字段管理）
│       ├── guestFieldsConfig.js   # 登记字段 schema（前端镜像）
│       ├── formValidation.js      # 配置驱动的客户端校验
│       └── countryOptions.js      # ISO 国家代码与本地化
├── server/
│   ├── server.js                  # 后端入口、API、鉴权
│   ├── guestFieldsConfig.js       # 登记字段 schema（服务端，权威清洗）
│   ├── migrations/                # 顺序执行的 schema 迁移
│   ├── stepTemplates.js           # 多语言步骤模板初始数据
│   ├── completionTemplates.js     # 多语言完成页模板初始数据
│   └── tools/paddle_ocr_runner.py # 本地护照 OCR 子进程
├── scripts/
│   ├── deploy.mjs                 # 一键部署 Node + Python OCR 环境
│   └── backup-instance.mjs        # 备份生产实例的 DB / 上传 / env
└── pnpm-workspace.yaml
```

---

## 🚀 开发

```bash
pnpm install
pnpm dev
```

并行启动后端（`http://localhost:3002`）与 Vite（`http://localhost:5173`），前端 `/api` 已代理到后端。`pnpm test` 跑前后端全部测试。

> 后端启动需要 `ADMIN_API_TOKEN` 与 `CORS_ORIGIN`，仓库内置的 `server/.env.development` 已经填好。

---

## 🛳 生产部署

### 1. 服务器准备

- Node.js 18+、pnpm 8+。
- HTTPS 反向代理（Nginx / Caddy / ALB），WebAuthn 强依赖 HTTPS。
- 用于持久化的目录：SQLite 文件 + 上传图片。

### 2. 拉取并安装依赖

```bash
git clone <repo> checkin-app && cd checkin-app
pnpm install --frozen-lockfile
```

### 3. 部署 OCR 环境（推荐）

```bash
pnpm deploy
```

执行内容：

- 创建 `server/.venv`，安装 RapidOCR / OpenCV / Pillow-AVIF。
- 优先复用系统 Python 3.10/3.11；若不可用，自动下载 standalone CPython 到 `server/.python/`。
- 预热 OCR runtime，模型缓存写入 `server/.cache` / `server/.ocr-models` / `server/.paddle`，不污染系统。
- 写入 `server/.env.development` 中的 `PADDLE_OCR_PYTHON` 与 `PADDLE_OCR_RUNNER`。

可选环境变量：

```bash
CHECKIN_SKIP_NODE_INSTALL=1 pnpm deploy   # 跳过 Node 依赖安装
CHECKIN_SKIP_OCR_WARMUP=1   pnpm deploy   # 跳过模型预热
PYTHON=/path/to/python3.11  pnpm deploy   # 指定 Python
```

跳过这一步时，护照照片仍可上传，前台会提示手动补充护照信息。

### 4. 配置生产环境变量

```bash
cp server/.env.production.example server/.env.production
```

按 [配置参考](#-配置参考) 调整。**至少**修改：

- `ADMIN_API_TOKEN`（首次绑定 Passkey 用，必须为长随机串）
- `CORS_ORIGIN` / `WEBAUTHN_ORIGIN` / `WEBAUTHN_RP_ID`（与对外域名一致）
- `DB_PATH` / `UPLOAD_DIR`（指向持久化磁盘，不要落在临时目录）

### 5. 构建并启动

```bash
pnpm build      # 构建 client/dist
pnpm start      # 启动后端（NODE_ENV=production，托管 client/dist）
```

`NODE_ENV=production` 时后端会直接托管前端静态资源并对非 `/api` 路径回退到 `index.html`，反向代理只需把全部流量转给后端即可。

### 6. 反向代理

最简模式（推荐）— 把全部流量交给后端，由 Node 处理静态资源 + SPA fallback：

```nginx
server {
  server_name checkin.example.com;
  listen 443 ssl http2;

  location / {
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 12m;
  }
}
```

如果希望 Nginx 直接托管 `client/dist` 静态资源、只把 `/api` 转给后端，**必须**为前端 location 加 SPA fallback，否则刷新 `/checkin/done` 等深层路径会 404：

```nginx
root /var/www/checkin/client/dist;

location /api/ {
  proxy_pass http://127.0.0.1:3002;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 12m;
}

location / {
  try_files $uri $uri/ /index.html;
}
```

### 7. 升级既有实例

```bash
pnpm backup:instance     # 1) 备份当前 DB / UPLOAD_DIR / .env.production 到 backups/
git pull
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

- 数据库 schema 由 `server/migrations/` 顺序脚本管理，启动时自动应用，也可单独执行 `pnpm --filter server migrate`。
- 当前版本对既有 SQLite 数据库**非破坏性兼容**：`checkins` / `admin_passkeys` / 模板 / 上传图片均保留。
- `app_settings` 中缺失 `guestFieldsConfig` 时自动回落到默认（全部启用）。
- 升级后请核对 `CORS_ORIGIN` / `WEBAUTHN_ORIGIN` / `DB_PATH` / `UPLOAD_DIR` 仍指向预期位置。

### 8. 运维与监控

- `GET /api/health`：进程存活探针。
- `GET /api/ready`：数据库可用性探针。
- 日志为 pino JSON（每行一条），交给 systemd / 日志采集器即可；5xx 响应不带堆栈，仅返回 `requestId`，凭它在日志中追溯。
- 备份建议用 `pnpm backup:instance` 或 `sqlite3 hotel.db ".backup ..."`，避免裸 `cp` 在 WAL checkpoint 间隙拿到不一致快照。
- 单机部署：管理员 session 持久化到 SQLite `admin_sessions`，进程重启不会强制下线，但未对多实例共享 session 做适配。

---

## ⚙️ 配置参考

后端按 `NODE_ENV` 自动读取 `server/.env.development` 或 `server/.env.production`。

### 必填

| 变量 | 说明 |
|---|---|
| `ADMIN_API_TOKEN` | 首次绑定 Passkey 时使用的初始化令牌 |
| `CORS_ORIGIN` | 允许跨域来源，逗号分隔 |

### 监听与路径

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3002` (dev) / 按 env | 后端监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DB_PATH` | `server/hotel.db` | SQLite 文件路径 |
| `UPLOAD_DIR` | `server/uploads` | 上传文件目录 |
| `CLIENT_DIST_DIR` | `../client/dist` | 生产环境前端构建目录 |
| `TRUST_PROXY` | `loopback` | Express trust proxy 设置 |

### WebAuthn

| 变量 | 默认 | 说明 |
|---|---|---|
| `WEBAUTHN_RP_ID` | `localhost` | RP ID，需与对外域名匹配 |
| `WEBAUTHN_RP_NAME` | `Checkin Admin` | RP 显示名称 |
| `WEBAUTHN_ORIGIN` | — | 验证 Origin（末尾 `/` 会被去除） |

### 限额与超时

| 变量 | 默认 | 说明 |
|---|---|---|
| `JSON_BODY_LIMIT` | `10mb` | 含图片路由的请求体上限 |
| `SMALL_JSON_BODY_LIMIT` | `256kb` | 其他 API 的请求体上限 |
| `MAX_IMAGE_BYTES` | `10485760` | 单张证件图最大字节 |
| `MAX_GUESTS_PER_SUBMISSION` | `12` | 单次提交住客数上限 |
| `REQUEST_TIMEOUT_MS` | `30000` | 单请求超时 |
| `OCR_MAX_CONCURRENCY` | `2` | 同时执行的 OCR 子进程上限 |
| `OCR_QUEUE_TIMEOUT_MS` | `15000` | OCR 排队等待超时；超时返回 `503 OCR_BUSY` |

### OCR 与日志

| 变量 | 默认 | 说明 |
|---|---|---|
| `PADDLE_OCR_PYTHON` | `python3` | OCR 子进程的 Python 命令 |
| `PADDLE_OCR_RUNNER` | `server/tools/paddle_ocr_runner.py` | OCR 识别脚本路径 |
| `LOG_LEVEL` | dev `debug` / prod `info` | pino 日志等级 |

---

## 🧩 登记字段配置

字段集合保存在 `app_settings.guestFieldsConfig`，schema 由 [server/guestFieldsConfig.js](server/guestFieldsConfig.js) 与 [client/src/guestFieldsConfig.js](client/src/guestFieldsConfig.js) 镜像定义。

```jsonc
{
  "builtins": {
    "name":           { "enabled": true, "defaultValue": "" }, // 永远启用
    "age":            { "enabled": true, "defaultValue": "" },
    "phone":          { "enabled": true, "defaultValue": "" },
    "address":        { "enabled": true, "defaultValue": "" },
    "postalCode":     { "enabled": true, "defaultValue": "" },
    "nationality":    { "enabled": true, "defaultValue": "" },
    "passportNumber": { "enabled": true, "defaultValue": "" },
    "passportPhoto":  { "enabled": true, "defaultValue": "" }, // 图片字段无默认值
    "guardianName":   { "enabled": true, "defaultValue": "" },
    "guardianPhone":  { "enabled": true, "defaultValue": "" }
  },
  "custom": [
    {
      "id": "cf_xxx",
      "key": "companyName",                // [a-zA-Z][a-zA-Z0-9_]{0,31}，不可与内置 key 冲突
      "label": "公司名称",
      "type": "text",                       // text | number | select | checkbox | date | file
      "required": true,
      "defaultValue": "",
      "scope": "both",                      // both | resident | visitor
      "options": [{ "value": "vip", "label": "VIP" }],   // 仅 select
      "validation": {
        "regex": "^[A-Z]",                  // text 专用
        "regexMessage": "需以大写字母开头",
        "minLength": 2, "maxLength": 80,    // text 专用
        "min": 0, "max": 100                // number 专用；date 时为最早 / 最晚日期 YYYY-MM-DD
      },
      "archived": false                     // 软删除：隐藏字段但保留旧数据
    }
  ]
}
```

`checkins.data` 中每位住客对象会新增 `customFields: { [key]: value }`。文件类自定义字段在写入时会被服务端转为 `<uuid>_custom.<ext>` 文件名。

兼容性约定：

- 老 DB 没有 `guestFieldsConfig` 行 → 回落到默认（全部启用、无默认值）。
- 老 `checkins` 记录没有 `customFields` → 读取无影响，新字段不会回溯校验旧记录。
- 自定义字段 `key` 一旦保存请勿再修改（历史数据按 key 检索）；想换名请归档旧字段后新建一个新 key。
- `app_settings` 写入按 key 增量进行：保存「台湾命名模式」不会覆盖 `guestFieldsConfig`，反之亦然。

---

## 🧾 提交校验规则

`POST /api/submit` 时后端先加载 `guestFieldsConfig`，再按当前配置驱动校验：

- `guests` 必须非空、不超过 `MAX_GUESTS_PER_SUBMISSION`。
- `name` 永远必填，最长 200 字符。
- 内置字段仅在 `enabled === true` 时参与校验：
  - `age`：整数 `0~120`；为 `< 18` 时触发未成年人逻辑。
  - `phone`：居民住客 `age` 关闭或 `age >= 16` 时必填。
  - `address`：居民必填。
  - `nationality` / `passportNumber` / `passportPhoto`：访客必填。
  - `guardianName` / `guardianPhone`：未成年时必填。
- 自定义字段按 `scope` 筛选后逐一校验类型与 `validation`。
- 已归档字段不参与新数据校验；历史 `customFields` 中的旧值保留。

图片与文件保存：

- 仅接受 `data:image/...;base64,...`，白名单类型 jpg / jpeg / png / webp / heic / heif。
- 文件名为随机 UUID（护照 `_passport.<ext>`，自定义文件字段 `_custom.<ext>`），写入 `UPLOAD_DIR`，使用路径检查避免目录穿越。

---

## 🔐 Passkey 认证

- **首次绑定**：调用注册 options 时需 `Authorization: Bearer <ADMIN_API_TOKEN>`，前端 `navigator.credentials.create(...)`，后端验证后写入 `admin_passkeys`。
- **后续登录**：请求认证 options → `navigator.credentials.get(...)` → 验证签名并更新 `counter` → 返回 `sessionToken`。
- challenge 5 分钟、session 24 小时；session 持久化到 `admin_sessions`，进程重启仍有效。

---

## 🗄️ 数据存储

启动时自动创建 / 迁移以下表：

| 表 | 主键 | 说明 |
|---|---|---|
| `checkins` | `id` | `data` 含住客数组 JSON（含可选 `customFields`），还有 `check_in` / `check_out` / `created_at` |
| `app_settings` | `key` | `value`（TEXT，复杂值序列化为 JSON），当前 key：`taiwanNamingMode`、`guestFieldsConfig` |
| `step_templates` | `lang` | 多语言步骤模板 |
| `completion_templates` | `lang` | 多语言完成页模板 |
| `admin_passkeys` | `credential_id` | WebAuthn 凭证（启动时自动补齐缺失字段，兼容旧库） |
| `admin_sessions` | `token` | 管理员会话；启动时 hydrate 到内存 |
| `schema_migrations` | — | 已应用的迁移记录 |

新增 schema 变更：在 `server/migrations/` 下新增 `00X_*.js` 并实现 `up({ db, runAsync, allAsync, getAsync })`。

---

## 🔌 API 概览

### 公开

- `GET /api/health` / `GET /api/ready`
- `GET /api/steps?lang=...` / `GET /api/completion-template?lang=...`
- `GET /api/app-settings`：含 `taiwanNamingMode` 与 `guestFieldsConfig`
- `GET /api/template-bundle?lang=...`：一次性返回 steps + completion + app-settings（前台首屏使用）
- `POST /api/submit`：按当前 `guestFieldsConfig` 校验
- `POST /api/ocr/passport`：本地护照 OCR，返回识别字段与 `passportPhoto` 文件名
- Passkey 公开端点：`/api/admin/passkeys/status`、`/api/admin/passkeys/auth/options`、`/api/admin/passkeys/auth/verify`、`/api/admin/passkeys/register/verify`

### 需管理员会话

- `GET /api/records`、`PATCH /api/records/:recordId/guests/:guestId`
- `GET /api/admin/uploads/:filename`
- `GET /api/admin/session`、`POST /api/admin/logout`
- `PUT /api/admin/steps?lang=...`
- `PUT /api/admin/completion-template?lang=...`
- `PUT /api/admin/app-settings`：按 key 增量写入

### 需初始化令牌或管理员会话

- `POST /api/admin/passkeys/register/options`：无 Passkey 时需 `ADMIN_API_TOKEN`，已绑定后需会话 token

---

## 🧭 前端路由

前端使用 `react-router-dom` 的 `BrowserRouter`，所有视图都有独立 URL，可直接刷新或分享。

| 路径 | 视图 |
|---|---|
| `/` | 首页（语言选择 / 落地 / 历史回看入口） |
| `/checkin` | 多步登记表单 |
| `/checkin/done` | 提交成功页，引导阅读住宿指南 |
| `/guide` / `/guide/:stepId` / `/guide/:stepId/:childId` | 指南目录与子步骤 |
| `/admin` | 自动跳到 `/admin/data` |
| `/admin/data` / `/admin/files` / `/admin/settings` / `/admin/steps` | 后台四个 tab |

---

## 🛡️ 安全清单

- 必须修改默认 `ADMIN_API_TOKEN`，仅在受控环境注入。
- 生产强制 HTTPS（WebAuthn 要求）。
- `CORS_ORIGIN` 精确配置为可信域名列表。
- 反向代理与服务端均设置请求体上限（`client_max_body_size` + `JSON_BODY_LIMIT` / `SMALL_JSON_BODY_LIMIT`）。
- OCR 接口受 `OCR_MAX_CONCURRENCY` + `ocrRateLimit`（每分钟 10 次/IP）双重保护。
- 定期备份 `DB_PATH` 与 `UPLOAD_DIR`（建议用 `pnpm backup:instance`）。

---

## 📜 许可证

- 本项目代码以 **MIT** 协议发布，见 [LICENSE](LICENSE)。
- 所有 npm 依赖均为宽松协议（MIT / ISC / BSD / Apache-2.0 / 0BSD / Python-2.0），未引入 GPL/LGPL/AGPL/SSPL 等会污染源码协议的依赖。
- 第三方依赖的版权声明与许可文本汇总在 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)，由脚本生成：

  ```bash
  pnpm notices
  ```

  发布前或升级依赖后请重新运行该命令。

---

## 🧰 故障排查

| 现象 | 检查项 |
|---|---|
| `ADMIN_API_TOKEN is required` | 对应 env 文件中是否配置 |
| `CORS_ORIGIN is required` | 设置 `CORS_ORIGIN`，多个来源逗号分隔 |
| 前端请求失败 | Vite 代理目标端口与后端是否一致；后端是否启动 |
| Passkey 验证失败 | `WEBAUTHN_ORIGIN` / `WEBAUTHN_RP_ID` 是否与实际域名匹配；浏览器是否支持 |
| OCR 一直返回 `OCR_BUSY` | 增大 `OCR_MAX_CONCURRENCY` 或确认 `pnpm deploy` 已成功执行 |
| 刷新 `/checkin/done` 返回 404 | Nginx 直接托管前端时缺少 `try_files ... /index.html` |
