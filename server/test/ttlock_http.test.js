'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sqlite3=require('sqlite3');
let child,base,folder,dbPath;
const post=async(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test.before(async()=>{
 folder=await fs.mkdtemp(path.join(os.tmpdir(),'ttlock-http-'));dbPath=path.join(folder,'test.db');
 const port=await new Promise(resolve=>{const net=require('node:net').createServer();net.listen(0,'127.0.0.1',()=>{const p=net.address().port;net.close(()=>resolve(p));});});
 base='http://127.0.0.1:'+port;
 child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',DB_PATH:dbPath,UPLOAD_DIR:path.join(folder,'uploads'),ADMIN_API_TOKEN:'test-secret',CORS_ORIGIN:'http://localhost',HOSTEX_API_TOKEN:'',HOSTEX_PROPERTY_ID:'99',TTLOCK_CLIENT_ID:'',TTLOCK_CLIENT_SECRET:''},stdio:'ignore'});
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/ready')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}
 throw new Error('Test server did not start');
});
test.after(async()=>{if(child){child.kill('SIGTERM');await new Promise(r=>{child.once('exit',r);setTimeout(r,3000).unref();});}await fs.rm(folder,{recursive:true,force:true});});
test('only matching persisted guest registration obtains a usable receipt; UUID replay cannot steal one',async()=>{
 const id=crypto.randomUUID();const guest={id:'guest',name:'Receipt Test',age:28,isResident:true,address:'Tokyo',phone:'09012345678'};
 const request={submissionId:id,guests:[guest],checkIn:'2030-01-02',checkOut:'2030-01-05'};
 const response=await post('/api/submit',request);assert.equal(response.status,200);const result=await response.json();assert.equal(result.accessReceipt.recordId,id);assert.match(result.accessReceipt.receiptToken,/^[0-9a-f]{64}$/);
 const db=new sqlite3.Database(dbPath);await new Promise((r,j)=>db.run("INSERT INTO hostex_reservations(reservation_code,property_id,status,check_in_date,check_out_date,raw_json,checkin_record_id) VALUES(?,?,?,?,?,?,?)",['test-order',99,'accepted',request.checkIn,request.checkOut,'{}',id],e=>e?j(e):r()));await new Promise(r=>db.close(r));
 const retry=await(await post('/api/submit',request)).json();assert.equal(retry.accessReceipt.reservationCode,'test-order');assert.equal(retry.accessReceipt.receiptToken,result.accessReceipt.receiptToken);
 const noAuth=await post('/api/checkin/access-code',{recordId:id});assert.equal(noAuth.status,403);
 const badArray=await post('/api/checkin/access-code',{recordId:id,receiptToken:[result.accessReceipt.receiptToken]});assert.equal(badArray.status,403);
 const wrongRecord=await post('/api/checkin/access-code',{recordId:crypto.randomUUID(),receiptToken:result.accessReceipt.receiptToken});assert.equal(wrongRecord.status,403);
 const access=await post('/api/checkin/access-code',{recordId:id,receiptToken:result.accessReceipt.receiptToken});assert.equal(access.status,200);assert.equal(access.headers.get('cache-control'),'no-store');assert.equal((await access.json()).status,'unavailable');
 const replay=await(await post('/api/submit',{...request,guests:[{...guest,name:'Different Guest'}]})).json();assert.equal(replay.accessReceipt,null);
});
