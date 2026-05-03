#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(rootDir, 'server');
const envName = process.env.CHECKIN_BACKUP_ENV || 'production';
const envFileName = envName === 'development' ? '.env.development' : '.env.production';
const envPath = path.join(serverDir, envFileName);

const parseEnv = (source) => {
  const result = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    result[key] = value;
  }
  return result;
};

const timestampForDir = () => {
  const iso = new Date().toISOString();
  return iso.replace(/[:]/g, '-').replace(/\..+$/, 'Z');
};

const ensureExists = async (targetPath, label) => {
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(`${label} not found: ${targetPath}`);
  }
};

const copyIfExists = async (sourcePath, targetPath) => {
  try {
    await fs.access(sourcePath);
  } catch {
    return false;
  }
  await fs.cp(sourcePath, targetPath, { recursive: true, force: false });
  return true;
};

const run = async () => {
  await ensureExists(envPath, 'Environment file');
  const envSource = await fs.readFile(envPath, 'utf8');
  const env = parseEnv(envSource);

  const dbPath = path.resolve(serverDir, env.DB_PATH || './hotel.db');
  const uploadDir = path.resolve(serverDir, env.UPLOAD_DIR || './uploads');
  const backupRoot = path.join(rootDir, 'backups');
  const backupDir = path.join(backupRoot, `instance-${envName}-${timestampForDir()}`);

  await ensureExists(dbPath, 'Database file');
  await fs.mkdir(backupDir, { recursive: true });

  const dbBackupPath = path.join(backupDir, path.basename(dbPath));
  await fs.copyFile(dbPath, dbBackupPath);

  const uploadsBackupPath = path.join(backupDir, path.basename(uploadDir));
  const uploadsCopied = await copyIfExists(uploadDir, uploadsBackupPath);

  await fs.writeFile(path.join(backupDir, envFileName), envSource, 'utf8');

  console.log(`[backup] env: ${envName}`);
  console.log(`[backup] database: ${dbPath} -> ${dbBackupPath}`);
  if (uploadsCopied) {
    console.log(`[backup] uploads: ${uploadDir} -> ${uploadsBackupPath}`);
  } else {
    console.log(`[backup] uploads: skipped (not found at ${uploadDir})`);
  }
  console.log(`[backup] env copy: ${envPath} -> ${path.join(backupDir, envFileName)}`);
  console.log(`[backup] complete: ${backupDir}`);
};

run().catch((error) => {
  console.error(`[backup] failed: ${error.message}`);
  process.exitCode = 1;
});
