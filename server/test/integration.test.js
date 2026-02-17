const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const net = require('node:net');
const { spawn } = require('node:child_process');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.listen(0, () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
  server.on('error', reject);
});

const waitForServer = async (baseUrl, timeoutMs = 15000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/steps`);
      if (res.ok) return;
    } catch (error) {
      // ignore while booting
    }
    await wait(200);
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
};

const startServer = async () => {
  const port = await getFreePort();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checkin-app-test-'));
  const uploadDir = path.join(tempDir, 'uploads');
  const dbPath = path.join(tempDir, 'test.db');

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DB_PATH: dbPath,
    UPLOAD_DIR: uploadDir,
    ADMIN_API_TOKEN: 'bootstrap-token',
    CORS_ORIGIN: 'http://localhost:5173',
    WEBAUTHN_ORIGIN: 'http://localhost:5173',
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_RP_NAME: 'Checkin Test'
  };

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl);

  const stop = async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        child.once('exit', resolve);
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
          resolve();
        }, 3000);
      });
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  };

  return { baseUrl, stop };
};

let ctx;

test.before(async () => {
  ctx = await startServer();
});

test.after(async () => {
  await ctx?.stop();
});

test('GET /api/steps returns seeded default steps', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/steps`);
  assert.equal(res.status, 200);

  const payload = await res.json();
  assert.ok(Array.isArray(payload));
  assert.ok(payload.length > 0);
  assert.equal(typeof payload[0], 'object');
});

test('GET /api/completion-template returns seeded default template', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/completion-template`);
  assert.equal(res.status, 200);

  const payload = await res.json();
  assert.equal(typeof payload, 'object');
  assert.ok(Object.keys(payload).length > 0);
});

test('POST /api/submit rejects invalid guest payload', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guests: [] })
  });

  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.success, false);
});

test('POST /api/submit accepts valid visitor guest and returns id', async () => {
  const validGuest = {
    id: 'g-1',
    name: 'John Visitor',
    age: 21,
    isResident: false,
    nationality: 'US',
    passportNumber: 'P1234567',
    passportPhoto: 'data:image/png;base64,aGVsbG8='
  };

  const res = await fetch(`${ctx.baseUrl}/api/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guests: [validGuest] })
  });

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.success, true);
  assert.equal(typeof payload.id, 'string');
  assert.ok(payload.id.length > 0);
});

test('admin endpoints require authorization when no valid session', async () => {
  const recordsRes = await fetch(`${ctx.baseUrl}/api/records`);
  assert.equal(recordsRes.status, 401);

  const sessionRes = await fetch(`${ctx.baseUrl}/api/admin/session`);
  assert.equal(sessionRes.status, 401);
});

test('POST /api/admin/passkeys/register/options accepts bootstrap token', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/admin/passkeys/register/options`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer bootstrap-token',
      'content-type': 'application/json'
    },
    body: JSON.stringify({})
  });

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.ok(payload.challenge);
  assert.ok(payload.rp);
});
