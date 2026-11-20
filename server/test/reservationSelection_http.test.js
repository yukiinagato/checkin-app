'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');const sqlite3=require('sqlite3');
let child,base,folder,dbPath;
const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const addDays=n=>new Date(Date.now()+9*3600000+n*86400000).toISOString().slice(0,10);
const sql=(statement,args=[])=>new Promise((resolve,reject)=>{const db=new sqlite3.Database(dbPath);db.run(statement,args,err=>{db.close();err?reject(err):resolve();});});
test.before(async()=>{
 folder=await fs.mkdtemp(path.join(os.tmpdir(),'selection-http-'));dbPath=path.join(folder,'test.db');
 // Prevent actual Hostex network synchronization in this isolated HTTP fixture.
 const preload=path.join(folder,'preload.js');await fs.writeFile(preload,`const m=require(${JSON.stringify(path.resolve(__dirname,'../src/hostexSync.js'))});m.createHostexSync=()=>({start(){},stop(){}});`);
 const port=await new Promise(resolve=>{const net=require('node:net').createServer();net.listen(0,'127.0.0.1',()=>{const p=net.address().port;net.close(()=>resolve(p));});});base='http://127.0.0.1:'+port;
 child=spawn(process.execPath,['--require',preload,'server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',DB_PATH:dbPath,UPLOAD_DIR:path.join(folder,'uploads'),ADMIN_API_TOKEN:'test-secret',CORS_ORIGIN:'http://localhost',HOSTEX_API_TOKEN:'fixture-only',HOSTEX_PROPERTY_ID:'99',TTLOCK_CLIENT_ID:'',TTLOCK_CLIENT_SECRET:''},stdio:'ignore'});
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/ready')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Server did not start');
});
test.after(async()=>{if(child){child.kill('SIGTERM');await new Promise(r=>{child.once('exit',r);setTimeout(r,3000).unref();});}await fs.rm(folder,{recursive:true,force:true});});
test('selection HTTP flow masks candidate data, groups collisions, verifies persisted identities and counts duplicates',async()=>{
 const start=addDays(0),end=addDays(3);
 for(const [code,name]of[['test-one','TANAKA MOMOKA'],['test-two','TAKAJIMA MASHITA']])await sql('INSERT INTO hostex_reservations(reservation_code,property_id,status,check_in_date,check_out_date,guest_name,guest_name_norm,channel_type,number_of_adults,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?)',[code,99,'accepted',start,end,name,name.toLowerCase(),'airbnb',2,'{"number_of_guests":2}']);
 const r=await fetch(base+'/api/checkin/reservation-candidates'),list=(await r.json()).candidates;assert.equal(list.length,1);assert.equal(list[0].maskedName,'T*** M*');assert.equal(list[0].platform,'Airbnb');assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(!JSON.stringify(list).includes('TANAKA'));assert.ok(!JSON.stringify(list).includes('test-one'));
 const pending=await(await post('/api/checkin/reservation-select',{selectionToken:list[0].selectionToken})).json();assert.equal(pending.confirmation,'full_name');
 const selected=(await(await post('/api/checkin/reservation-select',{selectionToken:list[0].selectionToken,bookerName:'TAKAJIMA MASHITA'})).json()).reservation;assert.ok(selected.selectionOnly);assert.ok(!('guestName'in selected));assert.ok(!('reservationCode'in selected));assert.equal(selected.photos.length,0);
 const guest={id:'guest',name:'Other Person',age:30,isResident:true,address:'Tokyo',phone:'09012345678'};
 const submission={submissionId:crypto.randomUUID(),guests:[guest],checkIn:start,checkOut:end,selectionToken:selected.selectionToken};
 const result=await(await post('/api/submit',submission)).json();assert.ok(result.accessReceipt.selectionOnly);assert.equal(result.accessReceipt.reservationCode,null);
 const access=receipt=>post('/api/checkin/access-code',{recordId:receipt.recordId,receiptToken:receipt.receiptToken});
 assert.equal((await(await access(result.accessReceipt)).json()).status,'name_verification_required');
 const retry=await(await post('/api/submit',submission)).json();assert.equal(retry.accessReceipt.recordId,result.accessReceipt.recordId);assert.equal((await(await access(retry.accessReceipt)).json()).registeredCount,1);
 const second=await(await post('/api/submit',{...submission,submissionId:crypto.randomUUID(),guests:[{...guest,name:'Another Person'}]})).json();assert.equal((await(await access(second.accessReceipt)).json()).status,'order_confirmation_required');
 const real=await(await post('/api/submit',{...submission,submissionId:crypto.randomUUID(),guests:[{...guest,name:'TAKAJIMA MASHITA'}]})).json();assert.equal((await(await access(real.accessReceipt)).json()).status,'unavailable'); // identity passed; TTLock deliberately disabled in fixture
 assert.equal((await(await access(result.accessReceipt)).json()).status,'order_confirmation_required'); // cannot borrow booker's proof
 const remaining=(await(await fetch(base+'/api/checkin/reservation-candidates')).json()).candidates;assert.equal(remaining.length,1);const only=(await(await post('/api/checkin/reservation-select',{selectionToken:remaining[0].selectionToken})).json()).reservation;assert.ok(only.selectionOnly);
 const partial=await(await post('/api/checkin/reservation-lookup',{name:'TANAKA',checkInDate:start})).json();assert.equal(partial.found,false);
 const invalid=await post('/api/submit',{...submission,submissionId:crypto.randomUUID(),selectionToken:list[0].selectionToken});assert.equal(invalid.status,400);
});
