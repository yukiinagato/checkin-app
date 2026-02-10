# Checkin App 🏨

这是一个全栈入住登记系统（Check-in System），用于酒店前台/自助登记场景。系统支持多语言登记流程、护照照片上传、后台管理与本地 SQLite 持久化。

## 🌟 核心功能

- **住客登记**：录入住客基本信息与入住信息。
- **证件上传**：支持护照等证件图片上传与本地存储。
- **多语言引导**：内置多语言步骤模板，可在后台管理。
- **后台管理**：查看登记记录、编辑步骤模板、管理系统配置。
- **数据持久化**：使用 SQLite 本地保存登记数据。

## 🛠 技术栈

### 前端（client）

- React 18
- Vite
- Tailwind CSS
- Lucide React

### 后端（server）

- Node.js + Express
- SQLite3
- fs-extra（文件存储）
- CORS

---

## 📂 项目结构

```text
checkin-app/
├── client/                  # 前端 React 应用
│   ├── src/                 # 页面与组件
│   ├── public/              # 静态资源
│   └── vite.config.js       # Vite 构建配置
├── server/                  # 后端 Express 服务
│   ├── server.js            # 服务入口
│   ├── stepTemplates.js     # 多语言步骤模板初始化数据
│   ├── uploads/             # 上传图片目录（运行后自动创建）
│   └── hotel.db             # SQLite 数据文件（运行后生成/使用）
├── package.json             # Monorepo 根脚本
└── pnpm-workspace.yaml      # pnpm workspace 配置
```

---

## ✅ 运行环境要求

- Node.js **18+**（推荐 20 LTS）
- pnpm **8+**（或更高版本）

安装 pnpm（如果未安装）：

```bash
npm i -g pnpm
```

---

## 🚀 安装步骤

在项目根目录执行：

```bash
# 1) 安装所有工作区依赖
pnpm install

# 2) 启动开发环境（前后端同时启动）
pnpm dev
```

启动后默认端口：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`

> 前端开发模式下会直接请求 `http://localhost:3001/api`。

---

## 🧪 常用命令

### 根目录命令

```bash
pnpm dev          # 同时启动 client + server（开发模式）
pnpm start        # 启动 server + client dev
pnpm build        # 构建前端产物（输出到 client/dist）
```

### 子项目命令

```bash
# 后端
pnpm --filter server dev
pnpm --filter server start

# 前端
pnpm --filter client dev
pnpm --filter client build
pnpm --filter client preview
```

---

## ⚙️ 配置说明

### 后端环境变量

后端目前支持以下关键变量：

- `ADMIN_API_TOKEN`：后台首次绑定 Passkey 的初始化密钥。
  - 默认值：`8808`
  - 生产环境请务必修改。

可以通过以下方式传入：

```bash
ADMIN_API_TOKEN='your-strong-token' pnpm --filter server start
```

### 数据与上传目录

- SQLite 数据库文件：`server/hotel.db`
- 证件上传目录：`server/uploads/`

请对以上目录做好备份与权限控制。

---

## 📘 使用方法

### 1) 前台登记（住客端）

1. 打开前端页面（开发环境默认 `http://localhost:5173`）。
2. 按流程填写住客信息。
3. 上传护照/证件照片。
4. 提交后数据写入 SQLite，图片保存到 `server/uploads/`。

### 2) 管理后台登录

1. 在首页进入管理页面。
2. 首次使用时，输入 `ADMIN_API_TOKEN` 完成 Passkey 绑定。
3. 后续通过 Passkey 进行登录。
4. 登录后可查看登记记录、加载图片、调整步骤模板等。

---

## 🌐 生产部署（PM2）

由于前端生产模式请求 `/api`，建议通过 Nginx/Caddy 统一反向代理：

- `/` -> 前端静态站点（Vite build 产物）
- `/api` -> Node 后端（3001）

部署 PM2 并配置后端服务。

### 1) 安装依赖并构建前端

```bash
pnpm install --frozen-lockfile
pnpm build
```

### 2) 安装 PM2

```bash
npm i -g pm2
```

### 3) 创建 PM2 配置文件

在项目根目录创建 `ecosystem.config.cjs`：

```js
module.exports = {
  apps: [
    {
      name: 'checkin-server',
      cwd: '/workspace/checkin-app/server',
      script: 'server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        ADMIN_API_TOKEN: 'replace-with-strong-token',
      },
    },
    {
      name: 'checkin-client',
      cwd: '/workspace/checkin-app/client',
      script: 'npx',
      args: 'serve -s dist -l 4173',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

> `checkin-client` 这里使用 `serve` 启动静态文件，你也可以改为 Nginx 直接托管 `client/dist`。

### 4) 安装静态服务器（若使用上面配置）

```bash
npm i -g serve
```

### 5) 启动 PM2

```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs checkin-server
```

### 6) 设置开机自启

```bash
pm2 startup
pm2 save
```

---

## 🔀 Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端
    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 后端 API
    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 🧯 常见问题

### 1) 前端能打开，但接口 404 / 请求失败

检查后端是否启动在 `3001`，并确认反向代理是否正确转发 `/api`。

### 2) 上传图片失败

检查 `server/uploads/` 是否有写权限，并确认上传数据未被网关限制。

### 3) 无法进入管理后台

确认 `ADMIN_API_TOKEN` 设置是否正确（用于首次绑定），以及浏览器是否支持 Passkey。

---

## 🔐 安全建议

- 生产环境务必修改默认 `ADMIN_API_TOKEN`。
- 限制 `server/hotel.db` 和 `server/uploads/` 文件访问权限。
- 建议开启 HTTPS（Passkey 在 HTTPS 场景下兼容性更好）。
- 建议对数据库和上传目录执行定期备份。

