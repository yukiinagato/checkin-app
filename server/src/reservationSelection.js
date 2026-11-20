'use strict';
const crypto=require('node:crypto');
const canonicalName=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const fullNameMatches=(a,b)=>Boolean(canonicalName(a) && canonicalName(a)===canonicalName(b));
function maskName(name) {
 const words=String(name||'').normalize('NFKC').trim().split(/\s+/u).filter(Boolean);
 if(!words.length)return '***';
 if(words.some(w=>/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(w))) {
  return words.map((w,i)=>i===0?Array.from(w)[0]+'*'.repeat(Math.min(2,Math.max(0,Array.from(w).length-1))):'*'.repeat(Math.min(3,Array.from(w).length))).join(' ');
 }
 return words.map((w,i)=>Array.from(w)[0]+(i===0?'***':'*')).join(' ');
}
function expectedGuests(row) {
 let raw={};try{raw=JSON.parse(row.raw_json||'{}');}catch{}
 const count=Number(raw.number_of_guests);
 if(Number.isInteger(count)&&count>0)return count;
 return Math.max(1,Number(row.number_of_adults||0)+Number(row.number_of_children||0)+Number(raw.number_of_infants||0));
}
function distinctGuests(records) {
 const result=[];
 const seen=new Set();
 for(const record of records) {
  let guests=[];try{guests=JSON.parse(record.data||'[]');}catch{}
  if(!Array.isArray(guests))continue;
  for(const g of guests) {
   if(!g || g.deleted || !canonicalName(g.name))continue;
   const passport=String(g.passportNumber||'').normalize('NFKC').toUpperCase().replace(/\s/g,'');
   const key=passport?'passport:'+String(g.nationality||'').toUpperCase()+':'+passport:
    'resident:'+canonicalName(g.name)+':'+String(g.age||'')+':'+canonicalName(g.address);
   if(!seen.has(key)){seen.add(key);result.push(g);}
  }
 }
 return result;
}
const platform=channel=>({'airbnb':'Airbnb','booking.com':'Booking','booking':'Booking','trip.com':'Trip.com','agoda':'Agoda','hostex_direct':'Direct'}[String(channel||'').toLowerCase()] || 'Other');
function createSelectionService({db,getAsync,allAsync,runAsync,secret,propertyId,now=Date.now}) {
 const key=crypto.createHash('sha256').update('reservation-selection:'+secret).digest();
 function tokenFor(value) {
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify({...Array.isArray(value)?{codes:value}:{code:value},expires:now()+12*3600000})),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
 }
 function tokenData(token) {
  try {
   if(typeof token!=='string'||token.length>16384)return null;
   const bytes=Buffer.from(token,'base64url');if(bytes.length<29)return null;
   const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
   const data=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());
   return data.expires>now()?data:null;
  }catch{return null;}
 }
 const tokenCode=token=>{const data=tokenData(token);return typeof data?.code==='string'?data.code:null;};
 const today=()=>new Date(now()+9*3600000).toISOString().slice(0,10);
 const dayOffset=days=>new Date(now()+9*3600000+days*86400000).toISOString().slice(0,10);
 async function order(code) {return getAsync(db,"SELECT * FROM hostex_reservations WHERE reservation_code=? AND status='accepted' AND property_id=?",[code,propertyId]);}
 async function recordsFor(row) {
  return allAsync(db,`SELECT c.* FROM checkins c WHERE ((c.id=? AND NOT EXISTS (SELECT 1 FROM checkin_order_selections other WHERE other.record_id=c.id AND other.reservation_code<>?)) OR c.id IN (SELECT record_id FROM checkin_order_selections WHERE reservation_code=?)) AND c.check_in=? AND c.check_out=?`,[row.checkin_record_id||'',row.reservation_code,row.reservation_code,row.check_in_date,row.check_out_date]);
 }
 async function progress(row) {
  const records=await recordsFor(row),guests=distinctGuests(records);
  const nameMatched=records.some(record=>{try{return JSON.parse(record.data||'[]').some(g=>g&&!g.deleted&&fullNameMatches(g.name,row.guest_name));}catch{return false;}});
  return {registeredCount:guests.length,expectedCount:expectedGuests(row),nameMatched};
 }
 async function recentOrders() {
  const rows=await allAsync(db,`SELECT * FROM hostex_reservations WHERE property_id=? AND status='accepted' AND check_out_date>=? AND check_in_date<=? ORDER BY CASE WHEN check_in_date<=? AND check_out_date>=? THEN 0 WHEN check_in_date>? THEN 1 ELSE 2 END, ABS(julianday(check_in_date)-julianday(?)),reservation_code`,[propertyId,dayOffset(-7),dayOffset(14),today(),today(),today(),today()]);
  const groups=new Map();
  for(const row of rows) {
   const p=await progress(row);
   if(p.nameMatched&&p.registeredCount>=p.expectedCount)continue;
   const maskedName=maskName(row.guest_name),channel=platform(row.channel_type),id=maskedName+'|'+channel;
   if(!groups.has(id))groups.set(id,{maskedName,platform:channel,codes:[],period:row.check_in_date<=today()&&row.check_out_date>=today()?'current':row.check_in_date>today()?'future':'past'});
   groups.get(id).codes.push(row.reservation_code);
  }
  const all=[...groups.values()],picked=[];
  // Include a representative current, upcoming and earlier stay when each exists.
  for(const period of ['current','future','past']){const group=all.find(g=>g.period===period);if(group)picked.push(group);}
  for(const group of all){if(picked.length>=6)break;if(!picked.includes(group))picked.push(group);}
  return picked.map(g=>({maskedName:g.maskedName,platform:g.platform,selectionToken:tokenFor(g.codes)}));
 }
 async function select(token,bookerName='',checkInDate='',checkOutDate='') {
  const data=tokenData(token);if(!data)return null;
  const codes=Array.isArray(data.codes)?data.codes:typeof data.code==='string'?[data.code]:[];
  if(!codes.length||codes.length>100)return null;
  const rows=[];
  for(const code of codes){
   const row=await order(code);if(!row||row.check_out_date<dayOffset(-7)||row.check_in_date>dayOffset(14))continue;
   const p=await progress(row);if(!(p.nameMatched&&p.registeredCount>=p.expectedCount))rows.push(row);
  }
  if(!rows.length)return null;
  let matches=rows;
  if(codes.length>1){
   if(typeof bookerName!=='string'||!bookerName.trim())return {needsConfirmation:true,confirmation:'full_name'};
   if(bookerName.length>100)return null;
   matches=rows.filter(row=>fullNameMatches(row.guest_name,bookerName));
   if(!matches.length)return null;
   if(matches.length>1){
    if(!checkInDate||!checkOutDate)return {needsConfirmation:true,confirmation:'stay_dates'};
    matches=matches.filter(row=>row.check_in_date===checkInDate&&row.check_out_date===checkOutDate);
    if(!matches.length)return null;
    if(matches.length>1)return {needsConfirmation:true,confirmation:'contact'};
   }
  }
  const row=matches[0],p=await progress(row);
  return {selectionOnly:true,selectionToken:tokenFor(row.reservation_code),maskedName:maskName(row.guest_name),platform:platform(row.channel_type),checkInDate:row.check_in_date,checkOutDate:row.check_out_date,numberOfGuests:p.expectedCount,numberOfAdults:row.number_of_adults,numberOfChildren:row.number_of_children,petCount:row.number_of_pets||0,guests:[],photos:[]};
 }
 async function attach(recordId,token) {
  const code=tokenCode(token);if(!code)throw new Error('Invalid selection token');
  const row=await order(code),record=await getAsync(db,'SELECT * FROM checkins WHERE id=?',[recordId]);
  if(!row || !record || record.check_in!==row.check_in_date || record.check_out!==row.check_out_date)throw new Error('Selected order dates do not match');
  const existing=await getAsync(db,'SELECT reservation_code FROM checkin_order_selections WHERE record_id=?',[recordId]);
  if(existing && existing.reservation_code!==code)throw new Error('Registration already belongs to another selection');
  await runAsync(db,'INSERT OR IGNORE INTO checkin_order_selections(record_id,reservation_code) VALUES(?,?)',[recordId,code]);
 }
 async function accessGate(recordId) {
  const selection=await getAsync(db,'SELECT reservation_code FROM checkin_order_selections WHERE record_id=?',[recordId]);
  if(!selection)return null;
  const row=await order(selection.reservation_code);
  if(!row)return {status:'reservation_required'};
  const record=await getAsync(db,'SELECT * FROM checkins WHERE id=?',[recordId]);
  if(!record || record.check_in!==row.check_in_date || record.check_out!==row.check_out_date)return {status:'stay_changed'};
  const p=await progress(row);
  // Other guests selecting the same masked order cannot borrow a booker's verification.
  const ownMatch=distinctGuests([record]).some(g=>fullNameMatches(g.name,row.guest_name));
  if(!ownMatch)return {status:p.registeredCount>=p.expectedCount?'order_confirmation_required':'name_verification_required',registeredCount:p.registeredCount,expectedCount:p.expectedCount};
  return {status:'verified',reservation:row};
 }
 return{recentOrders,select,attach,accessGate,tokenCode,progress};
}
module.exports={createSelectionService,maskName,fullNameMatches,distinctGuests,expectedGuests,platform};
