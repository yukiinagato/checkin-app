#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import https from 'node:https';
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
const legacyPaddleDir = path.join(serverDir, '.paddle');
const embeddedPythonRootDir = path.join(serverDir, '.python');
const uploadDir = path.join(serverDir, 'uploads_dev');
const dbPath = path.join(serverDir, 'hotel_dev.db');
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
};

main().catch((error) => {
  console.error(`\n[deploy] Failed: ${error.message}`);
  process.exit(1);
});
