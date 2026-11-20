'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { openDatabase, closeDatabase, runAsync, getAsync } = require('../src/db');
const root = path.resolve(__dirname, '../..');
const origin = 'http://localhost:5173';
const bootstrap = 'test-only-bootstrap-token';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startProcess(file, env, readyPath) {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, [file], { env: { ...process.env, ...env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
  };
  try {
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      try { if ((await fetch(base + readyPath)).ok) return { base, stop }; } catch {}
      await sleep(50);
    }
    throw new Error(`Server startup timed out: ${logs}`);
  } catch (error) { await stop(); throw error; }
}

// Small CBOR encoder for real WebAuthn "none" attestation fixtures.
function cbor(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from([0x58, value.length]), value]);
  if (Number.isInteger(value)) return Buffer.from([value >= 0 ? value : 0x20 + (-1 - value)]);
  if (typeof value === 'string') return Buffer.concat([Buffer.from([0x60 + Buffer.byteLength(value)]), Buffer.from(value)]);
  if (value instanceof Map) return Buffer.concat([Buffer.from([0xa0 + value.size]), ...[...value].flatMap(([k,v]) => [cbor(k), cbor(v)])]);
  throw new Error('Unsupported CBOR fixture');
}
function device() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const id = crypto.randomBytes(32);
  const cose = cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
  const rpHash = crypto.createHash('sha256').update('localhost').digest();
  const common = { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key', clientExtensionResults: {} };
  return {
    register(challenge) {
      const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0,id.length]), id, cose]);
      return { ...common, response: {
        clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin })).toString('base64url'),
        attestationObject: cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',authData]])).toString('base64url'), transports: ['internal']
      } };
    },
    authenticate(challenge) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
      const authenticatorData = Buffer.concat([rpHash, Buffer.from([0x05]), Buffer.from([0,0,0,1])]);
      const signed = Buffer.concat([authenticatorData, crypto.createHash('sha256').update(clientDataJSON).digest()]);
      return { ...common, response: { clientDataJSON: clientDataJSON.toString('base64url'), authenticatorData: authenticatorData.toString('base64url'), signature: crypto.sign('sha256', signed, privateKey).toString('base64url') } };
    }
  };
}

test('admin registration, reset and session authorization over HTTP', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'checkin-auth-security-'));
  const env = { NODE_ENV:'test', DB_PATH:path.join(dir,'test.db'), UPLOAD_DIR:path.join(dir,'uploads'), ADMIN_API_TOKEN:bootstrap, CORS_ORIGIN:origin, WEBAUTHN_ORIGIN:origin, WEBAUTHN_RP_ID:'localhost', LOG_LEVEL:'silent' };
  let server, db;
  t.after(async () => {
    if (db) await closeDatabase(db);
    if (server) await server.stop();
    await fs.rm(dir, { recursive:true, force:true });
  });
  {
    server = await startProcess(path.join(root,'server/server.js'), env, '/api/health');
    db = await openDatabase(env.DB_PATH, { info() {}, error() {} });
    const request = async (route, body, token) => {
      const res = await fetch(server.base + route, { method:body === undefined ? 'GET':'POST', headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` }: {}) }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
      return { status:res.status, body:await res.json() };
    };
    const options = async token => {
      const res = await request('/api/admin/passkeys/register/options', {}, token);
      assert.equal(res.status, 200); return res.body;
    };
    const verify = (dev, opts, token) => request('/api/admin/passkeys/register/verify', { credential:dev.register(opts.challenge) }, token);
    const reset = async () => {
      const child = spawn(process.execPath, [path.join(root,'server/reset-passkey.js'),'--yes'], { env:{ ...process.env,...env }, stdio:'ignore' });
      assert.equal(await new Promise(resolve => child.once('exit', resolve)), 0);
    };
    const seedSession = token => runAsync(db, 'INSERT INTO admin_sessions(token,expires_at) VALUES(?,?)', [token,Date.now()+60000]);

    await t.test('bootstrap verify requires the same token and permits only the first enrollment', async () => {
      const dev = device();
      assert.equal((await verify(dev, await options(bootstrap))).status, 401);
      assert.equal((await verify(dev, await options(bootstrap), 'wrong-token')).status, 401);
      const first = await options(bootstrap), second = await options(bootstrap);
      assert.equal((await verify(dev, first, bootstrap)).status, 200);
      assert.equal((await verify(device(), second, bootstrap)).status, 401);
      assert.equal((await getAsync(db,'SELECT COUNT(*) AS n FROM admin_passkeys')).n, 1);
      const loginOptions = await request('/api/admin/passkeys/auth/options', {});
      const login = await request('/api/admin/passkeys/auth/verify', { credential:dev.authenticate(loginOptions.body.challenge) });
      assert.equal(login.status, 200);
      assert.equal((await request('/api/records', undefined, login.body.sessionToken)).status, 200);
      assert.equal((await request('/api/admin/logout', {}, login.body.sessionToken)).status, 200);
      assert.equal((await request('/api/records', undefined, login.body.sessionToken)).status, 401);
    });
    await t.test('registration cannot switch sessions, survive logout, or survive expiry', async () => {
      await seedSession('session-a'); await seedSession('session-b');
      assert.equal((await verify(device(), await options('session-a'), 'session-b')).status, 401);
      const pending = await options('session-a');
      assert.equal((await request('/api/admin/logout', {}, 'session-a')).status, 200);
      assert.equal((await verify(device(), pending, 'session-a')).status, 400);
      const expired = await options('session-b');
      await runAsync(db,'UPDATE admin_sessions SET expires_at=0 WHERE token=?',['session-b']);
      assert.equal((await verify(device(), expired, 'session-b')).status, 401);
      await seedSession('session-c');
      assert.equal((await verify(device(), await options('session-c'), 'session-c')).status, 200);
    });
    await t.test('external reset revokes active sessions and pending registration without restart', async () => {
      await seedSession('survivor');
      const pending = await options('survivor');
      assert.equal((await request('/api/records', undefined, 'survivor')).status, 200);
      await reset();
      assert.equal((await request('/api/records', undefined, 'survivor')).status, 401);
      assert.equal((await verify(device(), pending, 'survivor')).status, 401);
      assert.equal((await getAsync(db,'SELECT COUNT(*) AS n FROM admin_sessions')).n, 0);
      const bootstrapPending = await options(bootstrap);
      // Reset with zero passkeys must still invalidate outstanding bootstrap challenges.
      await reset();
      assert.equal((await verify(device(), bootstrapPending, bootstrap)).status, 401);
      const dev = device();
      assert.equal((await verify(dev, await options(bootstrap), bootstrap)).status, 200);
      const pendingLogin = await request('/api/admin/passkeys/auth/options', {});
      await reset();
      // Even reenrolling the same key cannot revive a login challenge from before reset.
      assert.equal((await verify(dev, await options(bootstrap), bootstrap)).status, 200);
      const staleLogin = await request('/api/admin/passkeys/auth/verify', {
        credential: dev.authenticate(pendingLogin.body.challenge)
      });
      assert.equal(staleLogin.status, 401);
      assert.equal((await getAsync(db, 'SELECT COUNT(*) AS n FROM admin_sessions')).n, 0);
    });
  }
});

test('portal only accepts router credentials for queue operations and acknowledgements', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'checkin-portal-security-'));
  const token = 'audit-router-token-12345678901234567890';
  let server;
  try {
    server = await startProcess(path.join(root,'captive-portal/server.js'), { AUTH_DIR:dir, FAS_KEY:'audit-fas-key-12345678901234567890', AUTHMON_TOKEN:token, CHECKIN_DB_PATH:path.join(dir,'missing.db') }, '/healthz');
    const gateway = 'test-gateway';
    const fas = Buffer.from(`clientip=192.0.2.1, clientmac=02:00:00:00:00:01, hid=${'a'.repeat(64)}, gatewayname=${gateway}`).toString('base64');
    const landing = await fetch(server.base+'/portal?fas='+encodeURIComponent(fas));
    assert.equal(landing.status, 200);
    const cookie = landing.headers.get('set-cookie').split(';')[0];
    const csrf = (await landing.text()).match(/name="csrf" value="([^"]+)"/)[1];
    await fetch(server.base+'/portal/agree', { method:'POST', headers:{ Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded' }, body:new URLSearchParams({ csrf, accepted:'yes' }) });
    const gatewayhash = crypto.createHash('sha256').update(gateway).digest('hex');
    const command = (action, auth, payload='none') => fetch(server.base+'/portal?'+new URLSearchParams({ auth_get:action, gatewayhash, payload }), { headers:auth ? { Authorization:`Bearer ${auth}` } : {} });
    for (const action of ['list','view','clear','deauthed','custom']) {
      assert.equal((await command(action)).status, 401);
      assert.equal((await command(action, 'invalid')).status, 401);
    }
    const state = async () => (await fetch(server.base+'/portal/status',{ headers:{ Cookie:cookie } })).json();
    assert.equal((await state()).authorized, false);
    const queue = await command('view',token);
    assert.equal(queue.status,200);
    const responseHid = decodeURIComponent(await queue.text()).match(/[a-f0-9]{64}/)[0];
    const ack = Buffer.from(responseHid).toString('base64');
    assert.equal((await command('view',undefined,ack)).status,401);
    assert.equal((await state()).authorized,false);
    assert.equal((await command('view',token,ack)).status,200);
    assert.equal((await state()).authorized,true);
    assert.equal(await (await command('view',token)).text(), '*');
  } finally {
    if (server) await server.stop();
    await fs.rm(dir,{ recursive:true,force:true });
  }
});

test('router adapter keeps the secret in a header and preserves authmon payloads', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'checkin-authmon-adapter-'));
  try {
    const token = 'router-test-token-12345678901234567890';
    const secretFile = path.join(dir,'token');
    await fs.writeFile(secretFile, token+'\n', { mode:0o600 });
    // Capture the exact curl input without contacting a router or external host.
    await fs.writeFile(path.join(dir,'curl'), '#!/bin/sh\ncat > "$CAPTURE_DIR/headers"\nprintf "%s\\n" "$@" > "$CAPTURE_DIR/args"\nprintf "*"\n', { mode:0o755 });
    const run = async url => {
      const child = spawn('/bin/sh', [path.join(root,'captive-portal/authmon-request.sh'),url,'view','a'.repeat(64),'test-authmon','* '+ 'b'.repeat(64)], {
        env:{ ...process.env, PATH:dir+path.delimiter+process.env.PATH, AUTHMON_TOKEN_FILE:secretFile, CAPTURE_DIR:dir }, stdio:'ignore'
      });
      return new Promise(resolve => child.once('exit', resolve));
    };
    assert.equal(await run('https://portal.example/portal'),0);
    const headers = await fs.readFile(path.join(dir,'headers'),'utf8');
    const args = await fs.readFile(path.join(dir,'args'),'utf8');
    assert.equal(headers, `header = "Authorization: Bearer ${token}"\n`);
    assert.ok(!args.includes(token));
    assert.ok(args.includes('payload='+Buffer.from('* '+'b'.repeat(64)).toString('base64')));
    assert.ok(args.includes('--proto\n=https\n'));
    assert.ok(!args.includes('--location'));
    assert.equal(await run('http://portal.example/portal'),1);
    await fs.writeFile(secretFile, 'bad-token\n');
    assert.equal(await run('https://portal.example/portal'),1);
  } finally { await fs.rm(dir,{ recursive:true,force:true }); }
});
