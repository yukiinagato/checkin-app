'use strict';
const crypto = require('node:crypto');
const LOCK_NAME = '河内长野';
class TTLockError extends Error { constructor(code) { super(code); this.code = code; } }
function stayPeriod(checkIn, checkOut) {
  const parse = (day, hour) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new TTLockError('invalid_stay');
    const value = Date.parse(`${day}T${hour}:00:00+09:00`);
    if (!Number.isFinite(value) || new Date(value + 9 * 3600000).toISOString().slice(0, 10) !== day) throw new TTLockError('invalid_stay');
    return value;
  };
  const startDate = parse(checkIn, '15'), endDate = parse(checkOut, '12');
  if (endDate <= startDate) throw new TTLockError('invalid_stay');
  return { startDate, endDate };
}
function createTTLockClient({ db, getAsync, runAsync, env = process.env, fetchImpl = fetch }) {
  // The secret stays on the backend; OAuth tokens are encrypted at rest.
  const encryptionKey = crypto.createHash('sha256').update(env.ADMIN_API_TOKEN || '').digest();
  const base = env.TTLOCK_API_BASE || 'https://euapi.ttlock.com';
  const clientId = env.TTLOCK_CLIENT_ID, clientSecret = env.TTLOCK_CLIENT_SECRET;
  let tokenPromise = null;
  const configured = () => Boolean(clientId && clientSecret);
  const encode = (data) => {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  };
  const decode = (value) => {
    const bytes = Buffer.from(value, 'base64'), decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
  };
  async function post(path, params) {
    let response;
    try { response = await fetchImpl(base + path, { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams(params), signal: AbortSignal.timeout(18000) }); }
    catch { throw new TTLockError('provider_unavailable'); }
    let data;
    try { data = await response.json(); } catch { throw new TTLockError('provider_unavailable'); }
    if (!response.ok) throw new TTLockError('provider_unavailable');
    if (data.errcode && Number(data.errcode) !== 0 || data.error) throw new TTLockError(`provider_error_${Number(data.errcode) || 'auth'}`);
    return data;
  }
  async function accessToken() {
    if (!configured()) throw new TTLockError('not_configured');
    const stored = await getAsync(db, 'SELECT encrypted_payload FROM ttlock_tokens WHERE id=1');
    const current = stored ? decode(stored.encrypted_payload) : null;
    if (current?.expiresAt > Date.now() + 60000) return current.access_token;
    if (!tokenPromise) tokenPromise = (async () => {
      let params = {client_id:clientId, client_secret:clientSecret};
      const refresh = current?.refresh_token || env.TTLOCK_REFRESH_TOKEN;
      if (refresh) params = {...params, grant_type:'refresh_token', refresh_token:refresh};
      else if (env.TTLOCK_USERNAME && env.TTLOCK_PASSWORD_MD5) params = {...params, username:env.TTLOCK_USERNAME, password:env.TTLOCK_PASSWORD_MD5};
      else throw new TTLockError('authorization_required');
      const result = await post('/oauth2/token', params);
      if (!result.access_token || !result.refresh_token || !Number(result.expires_in)) throw new TTLockError('authorization_required');
      const saved = {...result, expiresAt:Date.now()+Number(result.expires_in)*1000};
      await runAsync(db, 'INSERT OR REPLACE INTO ttlock_tokens(id, encrypted_payload) VALUES(1, ?)', [encode(saved)]);
      return saved.access_token;
    })().finally(() => {tokenPromise=null;});
    return tokenPromise;
  }
  async function request(path, params) {
    return post(path, {clientId, accessToken:await accessToken(), date:Date.now(), ...params});
  }
  async function pages(path, params) {
    const list = [];
    for(let pageNo=1;pageNo<=100;pageNo++) {
      const data = await request(path, {...params,pageNo,pageSize:100});
      if (!Array.isArray(data.list)) throw new TTLockError('invalid_provider_response');
      list.push(...data.list);
      if (data.list.length<100 || (data.pages && pageNo>=data.pages)) return list;
    }
    throw new TTLockError('too_many_results');
  }
  async function selectedLock() {
    const locks = await pages('/v3/lock/list',{lockAlias:LOCK_NAME});
    const exact = locks.filter(l => (l.lockAlias || l.lockName) === LOCK_NAME);
    if (exact.length !== 1) throw new TTLockError('lock_name_not_unique');
    const lock = exact[0];
    if (env.TTLOCK_LOCK_ID && String(lock.lockId)!==String(env.TTLOCK_LOCK_ID)) throw new TTLockError('lock_changed');
    if (Number(lock.keyboardPwdVersion)!==4 || Number(lock.hasGateway)!==1) throw new TTLockError('gateway_or_custom_passcode_unavailable');
    return lock;
  }
  return {configured, selectedLock,
    listPasscodes:lockId=>pages('/v3/lock/listKeyboardPwd',{lockId}),
    deletePasscode:row=>request('/v3/keyboardPwd/delete',{lockId:row.lock_id,keyboardPwdId:row.keyboard_pwd_id,deleteType:2}),
    addPasscode:row=>request('/v3/keyboardPwd/add',{lockId:row.lock_id,keyboardPwd:row.passcode,keyboardPwdName:row.passcode_name,startDate:row.start_date,endDate:row.end_date,addType:2})};
}
function receiptToken(recordId, secret) {return crypto.createHmac('sha256',secret).update('ttlock-completion:'+recordId).digest('hex');}
function validReceipt(recordId, token, secret) {
  if (typeof token!=='string' || !/^[0-9a-f]{64}$/.test(token)) return false;
  return crypto.timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(receiptToken(recordId,secret),'hex'));
}
function createOrderAccess({ db, getAsync, allAsync, runAsync, client, propertyId, now = Date.now }) {
  const pending = new Map();
  const publicCode = row => ({status:'ready',passcode:row.passcode,startDate:row.start_date,endDate:row.end_date,timeZone:'Asia/Tokyo',lockName:LOCK_NAME,reservationCode:row.reservation_code});
  async function issue(reservation) {
    if (!client.configured()) return {status:'unavailable'};
    const period = stayPeriod(reservation.check_in_date,reservation.check_out_date);
    if (period.endDate<=now()) return {status:'expired'};
    let row = await getAsync(db,'SELECT * FROM ttlock_order_codes WHERE reservation_code=?',[reservation.reservation_code]);
    if (row && (row.start_date!==period.startDate || row.end_date!==period.endDate)) return {status:'stay_changed'};
    if (row?.status==='ready') return publicCode(row);
    const lock = await client.selectedLock();
    if (row && row.lock_id!==Number(lock.lockId)) throw new TTLockError('lock_changed');
    // Check provider state first: recover an accepted add after a network timeout or process restart.
    const remote = await client.listPasscodes(lock.lockId);
    if (!row) {
      const occupied = new Set(remote.map(p=>String(p.keyboardPwd)));
      (await allAsync(db,'SELECT passcode FROM ttlock_order_codes WHERE lock_id=?',[lock.lockId])).forEach(p=>occupied.add(p.passcode));
      let passcode;
      for(let i=0;i<100;i++) {const candidate=String(crypto.randomInt(100000,1000000));if(!occupied.has(candidate)){passcode=candidate;break;}}
      if (!passcode) throw new TTLockError('passcode_capacity');
      const name = 'checkin-'+crypto.createHash('sha256').update(reservation.reservation_code).digest('hex').slice(0,24);
      await runAsync(db,`INSERT OR IGNORE INTO ttlock_order_codes(reservation_code,lock_id,passcode,passcode_name,start_date,end_date) VALUES(?,?,?,?,?,?)`,[reservation.reservation_code,lock.lockId,passcode,name,period.startDate,period.endDate]);
      row=await getAsync(db,'SELECT * FROM ttlock_order_codes WHERE reservation_code=?',[reservation.reservation_code]);
      if (!row) throw new TTLockError('passcode_conflict');
    }
    const existing = remote.find(p=>p.keyboardPwdName===row.passcode_name);
    if (existing) {
      if(String(existing.keyboardPwd)!==row.passcode || Number(existing.startDate)!==row.start_date || Number(existing.endDate)!==row.end_date || [3,4,5,6,7,8,9].includes(Number(existing.status))) throw new TTLockError('provider_passcode_mismatch');
      await runAsync(db,"UPDATE ttlock_order_codes SET status='ready',keyboard_pwd_id=?,lease_until=0,updated_at=CURRENT_TIMESTAMP WHERE reservation_code=?",[existing.keyboardPwdId,row.reservation_code]);
      return publicCode(row);
    }
    const claim=await runAsync(db,`UPDATE ttlock_order_codes SET lease_until=?,updated_at=CURRENT_TIMESTAMP WHERE reservation_code=? AND status='pending' AND lease_until<?`,[now()+60000,row.reservation_code,now()]);
    if (!claim.changes) return {status:'pending'};
    // Keep the lease after uncertain failures. A retry reconciles the same passcode, never generates another.
    const result=await client.addPasscode(row);
    if (!Number.isInteger(result.keyboardPwdId)) throw new TTLockError('invalid_provider_response');
    await runAsync(db,"UPDATE ttlock_order_codes SET status='ready',keyboard_pwd_id=?,lease_until=0,updated_at=CURRENT_TIMESTAMP WHERE reservation_code=?",[result.keyboardPwdId,row.reservation_code]);
    return publicCode(row);
  }
  async function getAccess(recordId, selectedReservation = null) {
    const rows=selectedReservation ? [selectedReservation] : await allAsync(db,"SELECT * FROM hostex_reservations WHERE checkin_record_id=? AND status='accepted' AND property_id=?",[recordId,propertyId]);
    if(rows.length!==1) return {status:'reservation_required'};
    const reservation=rows[0];
    const record=await getAsync(db,'SELECT check_in,check_out FROM checkins WHERE id=?',[recordId]);
    if(!record || record.check_in!==reservation.check_in_date || record.check_out!==reservation.check_out_date) return {status:'stay_changed'};
    if(!pending.has(reservation.reservation_code)) pending.set(reservation.reservation_code,issue(reservation).finally(()=>pending.delete(reservation.reservation_code)));
    return pending.get(reservation.reservation_code);
  }
  return {getAccess};
}
module.exports={createTTLockClient,createOrderAccess,TTLockError,stayPeriod,receiptToken,validReceipt,LOCK_NAME};
