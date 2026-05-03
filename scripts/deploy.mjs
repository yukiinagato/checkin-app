#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import https from 'node:https';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(rootDir, 'server');
const venvDir = path.join(serverDir, '.venv');
const requirementsPath = path.join(serverDir, 'requirements-ocr.txt');
const envPath = path.join(serverDir, '.env.development');
const ocrModelDir = path.join(serverDir, '.ocr-models');
const cacheDir = path.join(serverDir, '.cache');
const cacheHomeDir = path.join(cacheDir, 'home');
const pipCacheDir = path.join(cacheDir, 'pip');
const pycacheDir = path.join(cacheDir, 'pycache');
const legacyPaddleDir = path.join(serverDir, '.paddle');
const embeddedPythonRootDir = path.join(serverDir, '.python');
const uploadDir = path.join(serverDir, 'uploads_dev');
const dbPath = path.join(serverDir, 'hotel_dev.db');
const envProductionPath = path.join(serverDir, '.env.production');
const envProductionExamplePath = path.join(serverDir, '.env.production.example');
const clientDir = path.join(rootDir, 'client');
const clientDistDir = path.join(clientDir, 'dist');
const deployDir = path.join(rootDir, 'deploy');
const pm2EcosystemPath = path.join(rootDir, 'ecosystem.config.cjs');
const pm2LogsDir = path.join(rootDir, 'logs');
const modulesYamlPath = path.join(rootDir, 'node_modules', '.modules.yaml');
const standalonePythonTag = process.env.CHECKIN_PYTHON_STANDALONE_TAG || '20260414';
const standalonePythonVersion = process.env.CHECKIN_PYTHON_STANDALONE_VERSION || '3.11.15';
const standalonePythonPlatform = resolveStandalonePlatform();
const standalonePythonAssetName = standalonePythonPlatform
  ? `cpython-${standalonePythonVersion}+${standalonePythonTag}-${standalonePythonPlatform}-install_only.tar.gz`
  : null;
const standalonePythonInstallDir = standalonePythonAssetName
  ? path.join(embeddedPythonRootDir, standalonePythonAssetName.replace(/\.tar\.gz$/, ''))
  : null;

const isWindows = process.platform === 'win32';
const venvPython = path.join(venvDir, isWindows ? 'Scripts/python.exe' : 'bin/python');
const pythonCandidates = [
  process.env.PYTHON,
  process.env.PYTHON3,
  'python3',
  'python'
].filter(Boolean);

function resolveStandalonePlatform() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'x86_64-apple-darwin';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  if (process.platform === 'linux' && process.arch === 'x64') return 'x86_64-unknown-linux-gnu';
  return null;
}

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd || rootDir,
    env: {
      ...process.env,
      PADDLEOCR_HOME: ocrModelDir,
      XDG_CACHE_HOME: cacheDir,
      PADDLE_HOME: legacyPaddleDir,
      HOME: cacheHomeDir,
      PIP_CACHE_DIR: pipCacheDir,
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONPYCACHEPREFIX: pycacheDir,
      ...options.env
    },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: isWindows
  });

  let stdout = '';
  let stderr = '';
  if (options.capture) {
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
  }

  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) {
      resolve({ stdout, stderr });
      return;
    }
    reject(new Error(`${command} ${args.join(' ')} exited with ${code}${stderr ? `\n${stderr}` : ''}`));
  });
});

const githubJsonGet = (pathname) => new Promise((resolve, reject) => {
  const request = https.get({
    hostname: 'api.github.com',
    path: pathname,
    headers: {
      'User-Agent': 'checkin-app-deploy',
      Accept: 'application/vnd.github+json'
    }
  }, (response) => {
    let body = '';
    response.on('data', (chunk) => {
      body += chunk.toString();
    });
    response.on('end', () => {
      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`GitHub API ${pathname} failed with ${response.statusCode}`));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
  request.on('error', reject);
});

const downloadFile = (url, destination) => new Promise((resolve, reject) => {
  const request = https.get(url, {
    headers: {
      'User-Agent': 'checkin-app-deploy',
      Accept: 'application/octet-stream'
    }
  }, (response) => {
    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      response.resume();
      downloadFile(response.headers.location, destination).then(resolve, reject);
      return;
    }
    if (response.statusCode !== 200) {
      reject(new Error(`Download failed with HTTP ${response.statusCode}`));
      response.resume();
      return;
    }

    const fileHandlePromise = fs.open(destination, 'w');
    fileHandlePromise.then((fileHandle) => {
      response.on('data', async (chunk) => {
        response.pause();
        try {
          await fileHandle.write(chunk);
          response.resume();
        } catch (error) {
          await fileHandle.close().catch(() => {});
          reject(error);
        }
      });
      response.on('end', async () => {
        await fileHandle.close();
        resolve();
      });
      response.on('error', async (error) => {
        await fileHandle.close().catch(() => {});
        reject(error);
      });
    }, reject);
  });
  request.on('error', reject);
});

const readPythonVersion = async (pythonExecutable) => {
  const result = await run(pythonExecutable, ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")'], { capture: true });
  return result.stdout.trim();
};

const parsePythonVersion = (version) => version.split('.').map((part) => Number(part));

const isSupportedPythonVersion = (version) => {
  const [major, minor] = parsePythonVersion(version);
  return major === 3 && minor >= 9 && minor <= 11;
};

const isPreferredPythonVersion = (version) => {
  const [major, minor] = parsePythonVersion(version);
  return major === 3 && minor >= 10 && minor <= 11;
};

const getStandalonePythonPath = () => {
  if (!standalonePythonInstallDir) return null;
  return path.join(standalonePythonInstallDir, isWindows ? 'python.exe' : 'bin/python3.11');
};

const verifySha256 = async (filePath, expectedDigest) => {
  const digest = createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      digest.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  const actual = digest.digest('hex');
  if (actual !== expectedDigest) {
    throw new Error(`Standalone Python checksum mismatch: expected ${expectedDigest}, got ${actual}`);
  }
};

const ensureStandalonePython = async () => {
  const standalonePython = getStandalonePythonPath();
  if (!standalonePythonPlatform || !standalonePythonAssetName || !standalonePythonInstallDir || !standalonePython) {
    throw new Error(`Automatic Python bootstrap is not supported on ${process.platform}/${process.arch}. Set PYTHON=/path/to/python3.10 or python3.11.`);
  }

  try {
    await fs.access(standalonePython);
    const version = await readPythonVersion(standalonePython);
    console.log(`[deploy] Reusing project-local Python ${version} from ${path.relative(rootDir, standalonePythonInstallDir)}`);
    return standalonePython;
  } catch {
    // Download below.
  }

  console.log(`[deploy] Bootstrapping project-local CPython ${standalonePythonVersion} for ${standalonePythonPlatform}...`);
  await fs.mkdir(embeddedPythonRootDir, { recursive: true });
  const release = await githubJsonGet(`/repos/astral-sh/python-build-standalone/releases/tags/${standalonePythonTag}`);
  const asset = (release.assets || []).find((entry) => entry.name === standalonePythonAssetName);
  if (!asset?.browser_download_url) {
    throw new Error(`Could not find standalone Python asset ${standalonePythonAssetName} in release ${standalonePythonTag}.`);
  }

  const archivePath = path.join(embeddedPythonRootDir, standalonePythonAssetName);
  await downloadFile(asset.browser_download_url, archivePath);
  if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:')) {
    await verifySha256(archivePath, asset.digest.slice('sha256:'.length));
  }

  const extractRoot = await fs.mkdtemp(path.join(embeddedPythonRootDir, 'extract-'));
  try {
    await run('tar', ['-xzf', archivePath, '-C', extractRoot]);
    const extractedPythonDir = path.join(extractRoot, 'python');
    await fs.access(extractedPythonDir);
    await fs.rm(standalonePythonInstallDir, { recursive: true, force: true });
    await fs.rename(extractedPythonDir, standalonePythonInstallDir);
  } finally {
    await fs.rm(extractRoot, { recursive: true, force: true });
    await fs.rm(archivePath, { force: true });
  }

  const version = await readPythonVersion(standalonePython);
  console.log(`[deploy] Installed project-local Python ${version} into ${path.relative(rootDir, standalonePythonInstallDir)}`);
  return standalonePython;
};

const readExistingPnpmStoreDir = async () => {
  if (process.env.npm_config_store_dir) {
    return process.env.npm_config_store_dir;
  }

  try {
    const modulesYaml = await fs.readFile(modulesYamlPath, 'utf8');
    const match = modulesYaml.match(/^\s*"storeDir":\s*"(.+)"\s*,?\s*$/m);
    return match?.[1] || null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const runPnpm = async (args) => {
  const npmExecPath = process.env.npm_execpath || '';
  if (npmExecPath.toLowerCase().includes('pnpm')) {
    const execPathLower = npmExecPath.toLowerCase();
    if (execPathLower.endsWith('.js') || execPathLower.endsWith('.cjs') || execPathLower.endsWith('.mjs')) {
      return run(process.execPath, [npmExecPath, ...args]);
    }
    return run(npmExecPath, args);
  }

  try {
    return await run('pnpm', args);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      try {
        return await run('corepack', ['pnpm', ...args]);
      } catch (corepackError) {
        if (corepackError?.code === 'ENOENT') {
          throw new Error('pnpm is required to install Node dependencies. Run this script via `pnpm run deploy`, install pnpm globally, or enable Corepack.');
        }
        throw corepackError;
      }
    }
    throw error;
  }
};

const findPython = async () => {
  const supportedCandidates = [];
  for (const candidate of pythonCandidates) {
    try {
      const result = await run(candidate, ['-c', 'import sys; print(sys.executable); print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")'], { capture: true });
      const [executable, version] = result.stdout.trim().split(/\r?\n/);
      if (isPreferredPythonVersion(version)) {
        console.log(`[deploy] Using system Python ${version} from ${executable || candidate}`);
        return executable || candidate;
      }
      if (isSupportedPythonVersion(version)) {
        supportedCandidates.push({ executable: executable || candidate, version });
        console.warn(`[deploy] Found fallback Python ${version} at ${candidate}; will try to upgrade to project-local Python 3.11.`);
        continue;
      }
      console.warn(`[deploy] Skip ${candidate}: Python ${version} is not supported by the pinned OCR stack. Use Python 3.10-3.11 or allow automatic bootstrap.`);
    } catch {
      // Try the next candidate.
    }
  }

  try {
    return await ensureStandalonePython();
  } catch (error) {
    if (supportedCandidates.length) {
      console.warn(`[deploy] Falling back to ${supportedCandidates[0].executable} because standalone Python bootstrap failed: ${error.message}`);
      return supportedCandidates[0].executable;
    }
    throw error;
  }
};

const readEnv = async () => {
  try {
    return await fs.readFile(envPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
};

const parseEnv = (raw) => {
  const values = new Map();
  raw.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  });
  return values;
};

const writeEnv = async () => {
  const existing = parseEnv(await readEnv());
  const defaults = new Map([
    ['PORT', existing.get('PORT') || '3002'],
    ['DB_PATH', existing.get('DB_PATH') || './hotel_dev.db'],
    ['UPLOAD_DIR', existing.get('UPLOAD_DIR') || 'uploads_dev'],
    ['ADMIN_API_TOKEN', existing.get('ADMIN_API_TOKEN') || crypto.randomBytes(24).toString('hex')],
    ['CORS_ORIGIN', existing.get('CORS_ORIGIN') || 'http://localhost:5173,http://127.0.0.1:5173'],
    ['WEBAUTHN_RP_ID', existing.get('WEBAUTHN_RP_ID') || 'localhost'],
    ['WEBAUTHN_ORIGIN', existing.get('WEBAUTHN_ORIGIN') || 'http://localhost:5173'],
    ['PADDLE_OCR_PYTHON', `./.venv/${isWindows ? 'Scripts/python.exe' : 'bin/python'}`],
    ['PADDLE_OCR_RUNNER', './tools/paddle_ocr_runner.py'],
    ['PADDLEOCR_HOME', './.ocr-models'],
    ['XDG_CACHE_HOME', './.cache'],
    ['PADDLE_HOME', './.paddle'],
    ['CHECKIN_OCR_HOME', './.cache/home'],
    ['PIP_CACHE_DIR', './.cache/pip'],
    ['PYTHONPYCACHEPREFIX', './.cache/pycache']
  ]);

  const content = `${[...defaults.entries()].map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
  await fs.writeFile(envPath, content, 'utf8');
  console.log(`[deploy] Wrote ${path.relative(rootDir, envPath)}`);
};

const ensureDirs = async () => {
  await Promise.all([
    fs.mkdir(embeddedPythonRootDir, { recursive: true }),
    fs.mkdir(ocrModelDir, { recursive: true }),
    fs.mkdir(cacheDir, { recursive: true }),
    fs.mkdir(cacheHomeDir, { recursive: true }),
    fs.mkdir(pipCacheDir, { recursive: true }),
    fs.mkdir(pycacheDir, { recursive: true }),
    fs.mkdir(legacyPaddleDir, { recursive: true }),
    fs.mkdir(uploadDir, { recursive: true })
  ]);
};

const installNodeDependencies = async () => {
  if (process.env.CHECKIN_SKIP_NODE_INSTALL === '1') {
    console.log('[deploy] Skip pnpm install because CHECKIN_SKIP_NODE_INSTALL=1');
    return;
  }

  console.log('[deploy] Installing Node dependencies with pnpm...');
  const pnpmArgs = ['install', '--frozen-lockfile'];
  const storeDir = await readExistingPnpmStoreDir();
  if (storeDir) {
    pnpmArgs.push('--store-dir', storeDir);
  }
  await runPnpm(pnpmArgs);
};

const installOcrDependencies = async () => {
  const python = await findPython();
  const targetVersion = await readPythonVersion(python);
  let reuseVenv = false;

  try {
    await fs.access(venvPython);
    const currentVersion = await readPythonVersion(venvPython);
    if (currentVersion.split('.').slice(0, 2).join('.') === targetVersion.split('.').slice(0, 2).join('.')) {
      reuseVenv = true;
      console.log(`[deploy] Reusing ${path.relative(rootDir, venvDir)} on Python ${currentVersion}`);
    } else {
      console.log(`[deploy] Recreating ${path.relative(rootDir, venvDir)} because it uses Python ${currentVersion}, target is ${targetVersion}`);
      await fs.rm(venvDir, { recursive: true, force: true });
    }
  } catch {
    // Create below.
  }

  if (!reuseVenv) {
    console.log(`[deploy] Creating OCR virtualenv with ${python}`);
    await run(python, ['-m', 'venv', venvDir]);
  }

  console.log('[deploy] Installing OCR dependencies into server/.venv...');
  await run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel']);
  await run(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath]);
};

const warmOcrModel = async () => {
  if (process.env.CHECKIN_SKIP_OCR_WARMUP === '1') {
    console.log('[deploy] Skip OCR warmup because CHECKIN_SKIP_OCR_WARMUP=1');
    return;
  }

  console.log('[deploy] Warming RapidOCR ONNX runtime inside project-local server/.cache/home...');
  await run(venvPython, [
    '-c',
    [
      'import os',
      'from rapidocr_onnxruntime import RapidOCR',
      'RapidOCR()',
      'print("RapidOCR runtime ready:", os.environ.get("XDG_CACHE_HOME"))'
    ].join('; ')
  ], { cwd: serverDir });
};

const verifyOcrImports = async () => {
  console.log('[deploy] Verifying OCR runtime imports...');
  await run(venvPython, [
    '-c',
    'import cv2, numpy, PIL, pillow_avif; from rapidocr_onnxruntime import RapidOCR; print("OCR runtime OK")'
  ], { cwd: serverDir });
};

const createPrompter = () => {
  const rl = readline.createInterface({ input, output });
  const ask = async (question, defaultValue = '') => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue;
  };
  const confirm = async (question, defaultYes = false) => {
    const hint = defaultYes ? 'Y/n' : 'y/N';
    const raw = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase();
    if (!raw) return defaultYes;
    return ['y', 'yes', '1', 'true'].includes(raw);
  };
  return { ask, confirm, close: () => rl.close() };
};

const fileExists = async (p) => {
  try { await fs.access(p); return true; } catch { return false; }
};

const upsertEnv = (raw, updates) => {
  const lines = raw.split(/\r?\n/);
  const handled = new Set();
  const out = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return line;
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      handled.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!handled.has(key)) out.push(`${key}=${value}`);
  }
  return out.join('\n').replace(/\n*$/, '\n');
};

const writeEnvProduction = async ({ ask, confirm }) => {
  const exists = await fileExists(envProductionPath);
  if (exists && !(await confirm(`已存在 ${path.relative(rootDir, envProductionPath)}，是否覆盖关键字段？`, false))) {
    console.log('[deploy] 保留现有 .env.production，不修改。');
    return parseEnv(await fs.readFile(envProductionPath, 'utf8'));
  }

  let baseRaw;
  if (exists) {
    baseRaw = await fs.readFile(envProductionPath, 'utf8');
  } else if (await fileExists(envProductionExamplePath)) {
    baseRaw = await fs.readFile(envProductionExamplePath, 'utf8');
  } else {
    baseRaw = '';
  }
  const existing = parseEnv(baseRaw);

  const domain = await ask('对外域名（例如 checkin.example.com）', existing.get('WEBAUTHN_RP_ID') || '');
  if (!domain) throw new Error('域名不能为空。');
  const useHttps = await confirm('对外是否使用 HTTPS？', true);
  const scheme = useHttps ? 'https' : 'http';
  const port = await ask('后端监听端口', existing.get('PORT') || '3001');
  const corsOrigin = await ask('CORS_ORIGIN（多个用逗号分隔）', existing.get('CORS_ORIGIN') || `${scheme}://${domain}`);
  const webauthnOrigin = await ask('WEBAUTHN_ORIGIN', existing.get('WEBAUTHN_ORIGIN') || `${scheme}://${domain}`);
  const adminToken = existing.get('ADMIN_API_TOKEN') && existing.get('ADMIN_API_TOKEN') !== 'replace-with-a-long-random-bootstrap-token'
    ? existing.get('ADMIN_API_TOKEN')
    : crypto.randomBytes(32).toString('hex');

  const updates = {
    PORT: port,
    HOST: existing.get('HOST') || '0.0.0.0',
    DB_PATH: existing.get('DB_PATH') || './data/hotel.db',
    UPLOAD_DIR: existing.get('UPLOAD_DIR') || './uploads',
    ADMIN_API_TOKEN: adminToken,
    CORS_ORIGIN: corsOrigin,
    WEBAUTHN_RP_ID: domain,
    WEBAUTHN_RP_NAME: existing.get('WEBAUTHN_RP_NAME') || 'Checkin Admin',
    WEBAUTHN_ORIGIN: webauthnOrigin,
    TRUST_PROXY: existing.get('TRUST_PROXY') || 'loopback',
    PADDLE_OCR_PYTHON: `./.venv/${isWindows ? 'Scripts/python.exe' : 'bin/python'}`,
    PADDLE_OCR_RUNNER: existing.get('PADDLE_OCR_RUNNER') || './tools/paddle_ocr_runner.py',
    PADDLEOCR_HOME: existing.get('PADDLEOCR_HOME') || './.ocr-models',
    XDG_CACHE_HOME: existing.get('XDG_CACHE_HOME') || './.cache',
    PADDLE_HOME: existing.get('PADDLE_HOME') || './.paddle',
    CHECKIN_OCR_HOME: existing.get('CHECKIN_OCR_HOME') || './.cache/home',
    PIP_CACHE_DIR: existing.get('PIP_CACHE_DIR') || './.cache/pip',
    PYTHONPYCACHEPREFIX: existing.get('PYTHONPYCACHEPREFIX') || './.cache/pycache'
  };

  const next = upsertEnv(baseRaw, updates);
  await fs.writeFile(envProductionPath, next, 'utf8');
  console.log(`[deploy] 已写入 ${path.relative(rootDir, envProductionPath)}`);
  return new Map(Object.entries(updates));
};

const buildClient = async () => {
  console.log('[deploy] 构建前端 client/dist...');
  await runPnpm(['--filter', 'client', 'build']);
};

const writePm2Config = async ({ appName, port }) => {
  const content = `module.exports = {
  apps: [
    {
      name: ${JSON.stringify(appName)},
      cwd: ${JSON.stringify(serverDir)},
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: ${JSON.stringify(String(port))}
      },
      error_file: ${JSON.stringify(path.join(pm2LogsDir, 'pm2-error.log'))},
      out_file: ${JSON.stringify(path.join(pm2LogsDir, 'pm2-out.log'))},
      time: true
    }
  ]
};
`;
  await fs.mkdir(pm2LogsDir, { recursive: true });
  await fs.writeFile(pm2EcosystemPath, content, 'utf8');
  console.log(`[deploy] 已写入 ${path.relative(rootDir, pm2EcosystemPath)}`);
};

const runPm2 = async ({ appName, confirm }) => {
  if (process.platform === 'win32') {
    console.log('[deploy] Windows 上不自动启动 PM2，请手动执行：pm2 start ecosystem.config.cjs');
    return;
  }
  if (!(await confirm('是否现在通过 PM2 启动 / 重启服务？', true))) return;

  try {
    await run('pm2', ['--version'], { capture: true });
  } catch {
    console.log('[deploy] 未检测到 pm2，跳过。可执行：npm i -g pm2 后再运行 pm2 start ecosystem.config.cjs');
    return;
  }

  try {
    await run('pm2', ['describe', appName], { capture: true });
    console.log(`[deploy] 重新加载 PM2 应用 ${appName}...`);
    await run('pm2', ['reload', pm2EcosystemPath, '--update-env']);
  } catch {
    console.log(`[deploy] 启动 PM2 应用 ${appName}...`);
    await run('pm2', ['start', pm2EcosystemPath]);
  }
  await run('pm2', ['save']);
  console.log('[deploy] 提示：首次部署可执行 `pm2 startup` 并按提示运行其输出，让 PM2 开机自启。');
};

const detectAcmeTools = async () => {
  const tools = [];
  for (const candidate of ['certbot', '/usr/bin/certbot', '/usr/local/bin/certbot', '/snap/bin/certbot']) {
    try {
      await run(candidate, ['--version'], { capture: true });
      tools.push({ name: 'certbot', bin: candidate });
      break;
    } catch {}
  }
  const home = process.env.HOME || '/root';
  for (const candidate of [path.join(home, '.acme.sh', 'acme.sh'), '/root/.acme.sh/acme.sh']) {
    if (await fileExists(candidate)) {
      tools.push({ name: 'acme.sh', bin: candidate });
      break;
    }
  }
  return tools;
};

const pathExistsMaybeSudo = async (p) => {
  if (await fileExists(p)) return true;
  if (process.platform !== 'linux') return false;
  try {
    await run('sudo', ['-n', 'test', '-e', p], { capture: true });
    return true;
  } catch {
    return false;
  }
};

const findExistingCertForDomain = async (domain) => {
  const home = process.env.HOME || '/root';
  const candidates = [
    {
      source: 'certbot (Let\'s Encrypt)',
      certificate: `/etc/letsencrypt/live/${domain}/fullchain.pem`,
      certificateKey: `/etc/letsencrypt/live/${domain}/privkey.pem`
    },
    {
      source: 'acme.sh (ECC)',
      certificate: path.join(home, '.acme.sh', `${domain}_ecc`, 'fullchain.cer'),
      certificateKey: path.join(home, '.acme.sh', `${domain}_ecc`, `${domain}.key`)
    },
    {
      source: 'acme.sh (RSA)',
      certificate: path.join(home, '.acme.sh', domain, 'fullchain.cer'),
      certificateKey: path.join(home, '.acme.sh', domain, `${domain}.key`)
    }
  ];

  const found = [];
  for (const c of candidates) {
    if ((await pathExistsMaybeSudo(c.certificate)) && (await pathExistsMaybeSudo(c.certificateKey))) {
      found.push(c);
    }
  }
  return found;
};

const resolveTlsCertificate = async ({ domain, ask, confirm }) => {
  const tools = await detectAcmeTools();
  const found = await findExistingCertForDomain(domain);

  if (tools.length === 0 && found.length === 0) {
    console.log('[deploy] 未检测到 ACME 工具（certbot / acme.sh），将生成占位证书路径，请稍后手动填写。');
    return null;
  }

  if (tools.length > 0) {
    console.log(`[deploy] 检测到 ACME 工具：${tools.map((t) => t.name).join(', ')}`);
  }

  if (found.length > 0) {
    console.log('[deploy] 在常见路径下找到下列匹配 ' + domain + ' 的证书：');
    found.forEach((c, idx) => {
      console.log(`  [${idx + 1}] ${c.source}`);
      console.log(`      cert: ${c.certificate}`);
      console.log(`      key : ${c.certificateKey}`);
    });
    if (await confirm('是否使用上述证书？', true)) {
      let pick = found[0];
      if (found.length > 1) {
        const raw = await ask(`选择编号 1-${found.length}`, '1');
        const idx = Number.parseInt(raw, 10);
        if (Number.isFinite(idx) && idx >= 1 && idx <= found.length) pick = found[idx - 1];
      }
      console.log(`[deploy] 将在 Nginx 中使用 ${pick.source} 的证书。`);
      return { certificate: pick.certificate, certificateKey: pick.certificateKey, source: pick.source };
    }
  } else if (tools.length > 0) {
    console.log(`[deploy] 未在默认路径下找到 ${domain} 的证书。`);
    const certbot = tools.find((t) => t.name === 'certbot');
    const acme = tools.find((t) => t.name === 'acme.sh');
    if (certbot) {
      console.log('  示例签发命令（certbot, webroot 模式需要先把 nginx 跑起来）：');
      console.log(`    sudo certbot certonly --nginx -d ${domain}`);
    }
    if (acme) {
      console.log('  示例签发命令（acme.sh, standalone）：');
      console.log(`    ${acme.bin} --issue --standalone -d ${domain}`);
      console.log('  签发后建议安装到固定路径（这样 reload 不会丢）：');
      console.log(`    ${acme.bin} --install-cert -d ${domain} \\\n      --key-file       /etc/nginx/ssl/${domain}.key \\\n      --fullchain-file /etc/nginx/ssl/${domain}.cer \\\n      --reloadcmd      "sudo systemctl reload nginx"`);
    }
    if (await confirm('是否手动填写已有证书路径？', false)) {
      const certificate = await ask('fullchain 证书绝对路径', '');
      const certificateKey = await ask('私钥绝对路径', '');
      if (certificate && certificateKey) {
        return { certificate, certificateKey, source: 'manual' };
      }
    }
  }

  console.log('[deploy] 将先生成不含 ssl 路径的占位 Nginx 配置，签发完成后再次运行本命令即可自动写入。');
  return null;
};

const writeNginxConfig = async ({ domain, port, useHttps, tlsCert }) => {
  const nginxOutDir = path.join(deployDir, 'nginx');
  await fs.mkdir(nginxOutDir, { recursive: true });
  const confPath = path.join(nginxOutDir, `${domain}.conf`);

  const httpRedirectBlock = useHttps
    ? `server {
  listen 80;
  listen [::]:80;
  server_name ${domain};
  return 301 https://$host$request_uri;
}

`
    : '';

  let sslHints = '';
  if (useHttps) {
    if (tlsCert?.certificate && tlsCert?.certificateKey) {
      sslHints = `  # 来源：${tlsCert.source}
  ssl_certificate     ${tlsCert.certificate};
  ssl_certificate_key ${tlsCert.certificateKey};
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 1d;
`;
    } else {
      sslHints = `  # TODO: 填写真实 SSL 证书路径（未在本机自动检测到 ${domain} 的证书）
  # ssl_certificate     /etc/letsencrypt/live/${domain}/fullchain.pem;
  # ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
`;
    }
  }

  const listenLine = useHttps ? 'listen 443 ssl http2;\n  listen [::]:443 ssl http2;' : 'listen 80;\n  listen [::]:80;';

  const config = `${httpRedirectBlock}server {
  ${listenLine}
  server_name ${domain};

${sslHints}
  client_max_body_size 12m;
  proxy_read_timeout 60s;
  proxy_send_timeout 60s;

  # 方案 A：后端在 NODE_ENV=production 下托管 client/dist 并对非 /api 路径回退到 index.html
  location / {
    proxy_pass http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
`;
  await fs.writeFile(confPath, config, 'utf8');
  console.log(`[deploy] 已写入 ${path.relative(rootDir, confPath)}`);
  return confPath;
};

const installNginxConfig = async ({ confPath, domain, confirm }) => {
  if (process.platform !== 'linux') {
    console.log('[deploy] 当前非 Linux 系统，跳过把 Nginx 配置安装到 /etc/nginx 的步骤。');
    return;
  }
  if (!(await confirm('是否将该 Nginx 配置安装到 /etc/nginx/sites-available 并启用？（需要 sudo）', false))) return;

  const target = `/etc/nginx/sites-available/${domain}.conf`;
  const link = `/etc/nginx/sites-enabled/${domain}.conf`;
  console.log(`[deploy] 将执行：sudo cp ${confPath} ${target}`);
  await run('sudo', ['cp', confPath, target]);
  console.log(`[deploy] 将执行：sudo ln -sf ${target} ${link}`);
  await run('sudo', ['ln', '-sf', target, link]);
  console.log('[deploy] 校验 Nginx 配置：sudo nginx -t');
  await run('sudo', ['nginx', '-t']);
  if (await confirm('校验通过，是否 reload Nginx？', true)) {
    await run('sudo', ['systemctl', 'reload', 'nginx']);
    console.log('[deploy] Nginx 已 reload。');
  }
};

const configureProduction = async () => {
  const prompter = createPrompter();
  try {
    if (!(await prompter.confirm('是否进入生产部署配置（写 .env.production / 构建前端 / PM2 / Nginx）？', false))) {
      console.log('[deploy] 跳过生产部署配置。');
      return;
    }

    const envValues = await writeEnvProduction(prompter);
    const port = envValues.get('PORT') || '3001';
    const domain = envValues.get('WEBAUTHN_RP_ID');
    const useHttps = (envValues.get('WEBAUTHN_ORIGIN') || '').startsWith('https://');

    if (await prompter.confirm('是否构建前端（pnpm --filter client build）？', true)) {
      await buildClient();
    }

    const appName = await prompter.ask('PM2 应用名', 'checkin-app');
    if (await prompter.confirm('是否生成 PM2 ecosystem.config.cjs？', true)) {
      await writePm2Config({ appName, port });
      await runPm2({ appName, confirm: prompter.confirm });
    }

    if (await prompter.confirm('是否生成 Nginx 反代配置？', true)) {
      let tlsCert = null;
      if (useHttps && (await prompter.confirm('是否检测本机 ACME 证书并写入 Nginx？', true))) {
        tlsCert = await resolveTlsCertificate({ domain, ask: prompter.ask, confirm: prompter.confirm });
      }
      const confPath = await writeNginxConfig({ domain, port, useHttps, tlsCert });
      await installNginxConfig({ confPath, domain, confirm: prompter.confirm });
    }

    console.log('');
    console.log('[deploy] 生产部署配置完成。');
    console.log(`[deploy] 后端 .env.production：${path.relative(rootDir, envProductionPath)}`);
    console.log(`[deploy] 前端构建产物：${path.relative(rootDir, clientDistDir)}`);
    console.log(`[deploy] PM2 配置：${path.relative(rootDir, pm2EcosystemPath)}`);
    console.log(`[deploy] Nginx 配置：${path.relative(rootDir, path.join(deployDir, 'nginx'))}/`);
    console.log('[deploy] 检查服务：pm2 status / curl -I http://127.0.0.1:' + port);
  } finally {
    prompter.close();
  }
};

const main = async () => {
  console.log('[deploy] Preparing checkin-app without writing to system Python or user model caches.');
  await ensureDirs();
  await installNodeDependencies();
  await installOcrDependencies();
  await verifyOcrImports();
  await warmOcrModel();
  await writeEnv();
  console.log('');
  console.log('[deploy] Done.');
  console.log(`[deploy] OCR venv: ${path.relative(rootDir, venvDir)}`);
  console.log(`[deploy] OCR cache home: ${path.relative(rootDir, cacheHomeDir)}`);
  console.log(`[deploy] OCR auxiliary cache: ${path.relative(rootDir, ocrModelDir)}`);
  console.log(`[deploy] Uploads: ${path.relative(rootDir, uploadDir)}`);
  console.log(`[deploy] Dev DB path: ${path.relative(rootDir, dbPath)}`);
  console.log('[deploy] Start with: pnpm dev');
  console.log('');
  await configureProduction();
};

main().catch((error) => {
  console.error(`\n[deploy] Failed: ${error.message}`);
  process.exit(1);
});
