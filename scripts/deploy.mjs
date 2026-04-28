#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
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
const paddleDir = path.join(serverDir, '.paddle');
const uploadDir = path.join(serverDir, 'uploads_dev');
const dbPath = path.join(serverDir, 'hotel_dev.db');

const isWindows = process.platform === 'win32';
const venvPython = path.join(venvDir, isWindows ? 'Scripts/python.exe' : 'bin/python');
const pythonCandidates = [
  process.env.PYTHON,
  process.env.PYTHON3,
  'python3',
  'python'
].filter(Boolean);

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd || rootDir,
    env: {
      ...process.env,
      PADDLEOCR_HOME: ocrModelDir,
      XDG_CACHE_HOME: cacheDir,
      PADDLE_HOME: paddleDir,
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

const runPnpm = async (args) => {
  const npmExecPath = process.env.npm_execpath || '';
  if (npmExecPath.toLowerCase().includes('pnpm')) {
    return run(process.execPath, [npmExecPath, ...args]);
  }
  return run('pnpm', args);
};

const findPython = async () => {
  for (const candidate of pythonCandidates) {
    try {
      const result = await run(candidate, ['-c', 'import sys; print(sys.executable); print(f"{sys.version_info.major}.{sys.version_info.minor}")'], { capture: true });
      const [executable, version] = result.stdout.trim().split(/\r?\n/);
      const [major, minor] = version.split('.').map(Number);
      if (major === 3 && minor >= 9 && minor <= 11) {
        return executable || candidate;
      }
      console.warn(`[deploy] Skip ${candidate}: Python ${version} is not supported by the pinned OCR stack. Use Python 3.9-3.11.`);
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('No supported Python found. Install Python 3.9, 3.10, or 3.11, or set PYTHON=/path/to/python.');
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
    fs.mkdir(ocrModelDir, { recursive: true }),
    fs.mkdir(cacheDir, { recursive: true }),
    fs.mkdir(cacheHomeDir, { recursive: true }),
    fs.mkdir(pipCacheDir, { recursive: true }),
    fs.mkdir(pycacheDir, { recursive: true }),
    fs.mkdir(paddleDir, { recursive: true }),
    fs.mkdir(uploadDir, { recursive: true })
  ]);
};

const installNodeDependencies = async () => {
  if (process.env.CHECKIN_SKIP_NODE_INSTALL === '1') {
    console.log('[deploy] Skip pnpm install because CHECKIN_SKIP_NODE_INSTALL=1');
    return;
  }
  console.log('[deploy] Installing Node dependencies with pnpm...');
  await runPnpm(['install', '--frozen-lockfile']);
};

const installOcrDependencies = async () => {
  const python = await findPython();
  try {
    await fs.access(venvPython);
    console.log(`[deploy] Reusing ${path.relative(rootDir, venvDir)}`);
  } catch {
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

  console.log('[deploy] Warming PaddleOCR model cache inside project-local server/.cache/home...');
  await run(venvPython, [
    '-c',
    [
      'import os',
      'from paddleocr import PaddleOCR',
      'PaddleOCR(use_angle_cls=True, lang="en", show_log=False, det_limit_side_len=1920, det_db_unclip_ratio=2.2)',
      'print("PaddleOCR model cache ready:", os.environ.get("PADDLEOCR_HOME"))'
    ].join('; ')
  ], { cwd: serverDir });
};

const verifyOcrImports = async () => {
  console.log('[deploy] Verifying OCR runtime imports...');
  await run(venvPython, ['-c', 'import cv2, numpy, PIL; from paddleocr import PaddleOCR; print("OCR runtime OK")'], { cwd: serverDir });
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
  console.log(`[deploy] OCR models/cache: ${path.relative(rootDir, path.join(cacheHomeDir, '.paddleocr'))}`);
  console.log(`[deploy] OCR auxiliary cache: ${path.relative(rootDir, ocrModelDir)}`);
  console.log(`[deploy] Uploads: ${path.relative(rootDir, uploadDir)}`);
  console.log(`[deploy] Dev DB path: ${path.relative(rootDir, dbPath)}`);
  console.log('[deploy] Start with: pnpm dev');
};

main().catch((error) => {
  console.error(`\n[deploy] Failed: ${error.message}`);
  process.exit(1);
});
