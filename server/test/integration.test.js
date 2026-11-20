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
      const res = await fetch(`${baseUrl}/api/health`);
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
    WEBAUTHN_RP_NAME: 'Checkin Test',
    MAX_IMAGE_BYTES: '1024'
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

  return { baseUrl, stop, dbPath };
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

test('GET /api/health and /api/ready expose runtime status', async () => {
  const healthRes = await fetch(`${ctx.baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  const healthPayload = await healthRes.json();
  assert.equal(healthPayload.ok, true);
  assert.equal(healthPayload.service, 'checkin-app-server');

  const readyRes = await fetch(`${ctx.baseUrl}/api/ready`);
  assert.equal(readyRes.status, 200);
  const readyPayload = await readyRes.json();
  assert.equal(readyPayload.ok, true);
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

test('POST /api/submit rejects invalid stay dates', async () => {
  const validGuest = {
    id: 'g-1',
    name: 'Resident Guest',
    age: 28,
    isResident: true,
    address: 'Tokyo',
    phone: '09012345678'
  };

  const res = await fetch(`${ctx.baseUrl}/api/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      guests: [validGuest],
      checkIn: '2026-05-10',
      checkOut: '2026-05-09'
    })
  });

  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.success, false);
  assert.match(payload.error, /checkOut must be on or after checkIn/);
});

test('POST /api/ocr/passport rejects oversized image payload', async () => {
  const base64 = Buffer.alloc(1500, 1).toString('base64');
  const res = await fetch(`${ctx.baseUrl}/api/ocr/passport`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      image: `data:image/png;base64,${base64}`
    })
  });

  assert.equal(res.status, 400);
  const payload = await res.json();
  assert.equal(payload.success, false);
  assert.equal(payload.error, 'Invalid image payload');
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


test('reservation linkage survives retries and rejects mismatched stay dates', async () => {
  const sqlite3 = require('sqlite3');
  const { runAsync, getAsync } = require('../src/db');
  const db = await new Promise((resolve, reject) => {
    const handle = new sqlite3.Database(ctx.dbPath, (err) => err ? reject(err) : resolve(handle));
  });
  const code = 'TEST-LINK-RETRY';
  const wrongCode = 'TEST-LINK-WRONG-DATES';
  const guest = { id: 'link-guest', name: 'Link Retry Guest', age: 28, isResident: true, address: 'Tokyo', phone: '09012345678' };
  const body = { guests: [guest], checkIn: '2026-10-05', checkOut: '2026-10-08' };
  const submit = async (payload) => {
    const res = await fetch(`${ctx.baseUrl}/api/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal(res.status, 200);
    return res.json();
  };
  try {
    for (const [reservationCode, checkIn] of [[code, body.checkIn], [wrongCode, '2026-10-06']]) {
      await runAsync(db, 'INSERT INTO hostex_reservations (reservation_code, status, check_in_date, check_out_date, raw_json) VALUES (?, ?, ?, ?, ?)', [reservationCode, 'accepted', checkIn, body.checkOut, '{}']);
    }
    await runAsync(db, 'INSERT INTO hostex_reservations (reservation_code, guest_name, status, check_in_date, check_out_date, raw_json) VALUES (?, ?, ?, ?, ?, ?)', ['TEST-NO-DEEP-LINK', guest.name, 'accepted', body.checkIn, body.checkOut, '{}']);
    const first = await submit(body);
    const automatic = await getAsync(db, 'SELECT checkin_record_id, checkin_link_source FROM hostex_reservations WHERE reservation_code = ?', ['TEST-NO-DEEP-LINK']);
    assert.equal(automatic.checkin_record_id, first.id);
    assert.equal(automatic.checkin_link_source, 'name_and_dates');
    const retry = await submit({ ...body, reservationCode: code, submissionId: 'b68ed654-2d03-400f-8412-84e9a3d64c94' });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.id, first.id);
    assert.equal((await getAsync(db, 'SELECT checkin_record_id FROM hostex_reservations WHERE reservation_code = ?', [code])).checkin_record_id, first.id);
    await submit({ ...body, reservationCode: wrongCode });
    assert.equal((await getAsync(db, 'SELECT checkin_record_id FROM hostex_reservations WHERE reservation_code = ?', [wrongCode])).checkin_record_id, null);
    const freshCode = 'TEST-LINK-FRESH';
    await runAsync(db, 'INSERT INTO hostex_reservations (reservation_code, status, check_in_date, check_out_date, raw_json) VALUES (?, ?, ?, ?, ?)', [freshCode, 'accepted', body.checkIn, body.checkOut, '{}']);
    const fresh = await submit({ ...body, guests: [{ ...guest, name: 'Fresh Linked Guest' }], reservationCode: freshCode });
    assert.equal((await getAsync(db, 'SELECT checkin_record_id FROM hostex_reservations WHERE reservation_code = ?', [freshCode])).checkin_record_id, fresh.id);
  } finally { await new Promise((resolve) => db.close(resolve)); }
});
