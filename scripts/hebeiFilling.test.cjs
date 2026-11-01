'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {makeDatabase}=require('./lib/fillingHarness.cjs')
const {createService,JOBS,STATES,key}=require('../uniCloud-alipay/cloudfunctions/crm-hebei-filling/worker')
const {buildPayload,parseSoap,envelope,matchReceipt}=require('../uniCloud-alipay/cloudfunctions/crm-hebei-filling/protocol')
const {prepare}=require('../uniCloud-alipay/cloudfunctions/crm-hebei-filling/plan')
const {POLICY}=require('../uniCloud-alipay/cloudfunctions/crm-hebei-filling/worker')
const time=Date.parse('2026-11-01T10:00:00+08:00')
function setup(){
 const db=makeDatabase(), clock={time},counts={sent:0},records=[]
 const r={_id:'fill-1',operation_id:'op-1',source_version:1,updated_at:time,bottle_no:'2',date:'2026-11-01',created_at:time,status:'completed',entry_source:'pda_reweigh',fill_weight:80,consistency_status:'complete',reweigh:{gross_weight:210,tare_weight:120,net_weight:90,basis:{gross_weight:130,return_reweigh_id:'return-1'},capture_method:'ble',capture:{stable:true},measured_at:time}}
 const b={_id:'bottle-1',bottle_no:'2',product_no:'product-2',qr_code:'02546001003',tare_weight:120,is_active:true}
 const index={records:[{crm_id:b._id,bottle_no:'2',product_no:b.product_no,source_product_no:b.product_no,regulator_inner_no:'q-002',tag:b.qr_code,medium:'LNG',status:'在用',next_inspection:'2029-01-01'}]}
 const target={enterprise_id:'6739',appid:321,tag:b.qr_code,product_no:b.product_no,inner_no:'q-002',medium:'LNG',next_inspection:'2029-01-01',status:'在用',volume:195}
 const roles={before:{personid:'05',personname:'郭增杰'},after:{personid:'05',personname:'郭增杰'},filling1:{personid:'01',personname:'齐新英'},filling2:{personid:'02',personname:'张虹茵'}}
 const transport={authenticate:async()=>{},personnel:async()=>({roles}),lookup:async()=>target,records:async()=>structuredClone(records),submit:async payload=>{counts.sent++;const c=JSON.parse(payload.czStr),j=JSON.parse(payload.jcStr);records.push({...c,id:100+counts.sent,qrcode:target.tag,originid:target.product_no,innerid:target.inner_no,cylinderId:321,czl:j.chzl});return {code:0}}}
 db.data('crm_fillings').set(r._id,r);db.data('crm_bottles').set(b._id,b)
 db.data(STATES).set('config',{_id:'config',mode:'enabled',activation_at:time-1000})
 const svc=createService({db,transport,index,now:()=>clock.time})
 const temp=()=>svc.setTemperature({date:'2026-11-01',temperature_c:0},{_id:'user1',username:'操作员'})
 return {db,clock,counts,records,r,b,index,target,roles,transport,svc,temp,job:()=>db.data(JOBS).get(key(r._id))}
}
test('incremental fill, exact enterprise personnel/defaults and 10-minute template',async()=>{
 const h=setup(),weather=await h.temp();const plan=prepare({record:h.r,bottle:h.b,index:h.index,weather,policy:POLICY,now:time})
 const p=buildPayload(plan,h.target,{roles:h.roles},time),j=JSON.parse(p.jcStr),c=JSON.parse(p.czStr)
 assert.equal(j.chzl,'80');assert.notEqual(j.chzl,'90');assert.equal(j.cztemperature,'0');assert.equal(j.chtime-j.cztime,600000);assert.equal(c.personid,'01，02');assert.equal(c.checkpersonid,'05');assert.equal(j.chgb,'无');assert.equal(j.cqyz,'否');assert.equal(p.gasId,'321')
})
test('one save is discovered; repeat/concurrent workers never resubmit',async()=>{
 const h=setup();await h.temp();await Promise.all([h.svc.run(),h.svc.run()]);await h.svc.run();assert.equal(h.counts.sent,1);assert.equal(h.job().state,'confirmed')
})
test('daily manual value first-writer wins including zero; next day is blank',async()=>{
 const h=setup();await h.temp();await assert.rejects(h.svc.setTemperature({date:'2026-11-01',temperature_c:15},{_id:'user2'}),/当天温度已/)
 assert.equal((await h.svc.temperature()).temperature_c,0);h.clock.time+=86400000;assert.equal(await h.svc.temperature(),null);await assert.rejects(h.svc.setTemperature({date:'2026-11-01',temperature_c:15},{_id:'user1'}),/日期已变化/)
})
test('missing temperature waits without blocking CRM or posting, resumes when entered',async()=>{
 const h=setup();await h.svc.run();assert.equal(h.counts.sent,0);assert.equal(h.r.status,'completed');assert.equal(h.job().state,'waiting');await h.temp();h.clock.time+=61000;await h.svc.run();assert.equal(h.job().state,'confirmed')
})
test('network timeout after remote commit is verified without retry',async()=>{
 const h=setup();await h.temp();const post=h.transport.submit;h.transport.submit=async p=>{await post(p);throw Error('timeout')};await h.svc.run();assert.equal(h.job().state,'unknown');h.clock.time+=61000;await h.svc.run();assert.equal(h.job().state,'confirmed');assert.equal(h.counts.sent,1)
})
test('ambiguous/lost response remains unknown; no blind retry',async()=>{
 const h=setup();await h.temp();h.transport.submit=async()=>{h.counts.sent++;throw Error('timeout')};await h.svc.run();h.clock.time+=61000;await h.svc.run();h.clock.time+=310000;await h.svc.run();assert.equal(h.job().state,'unknown');assert.equal(h.counts.sent,1)
})
test('crash after durable attempting marker does not allow second post',async()=>{
 const h=setup();await h.temp();h.transport.submit=async()=>{h.counts.sent++;h.db.setFault((name,method)=>{if(name===JOBS&&method==='update')throw Error('db unavailable')});throw Error('timeout')};await assert.rejects(h.svc.run());h.db.setFault(null);assert.equal(h.job().state,'attempting');h.clock.time+=61000;await h.svc.run();assert.equal(h.counts.sent,1)
})
test('unverified tags, inactive bottles, identity swap, non-LNG and stale inspection block',async()=>{
 for(const mutate of [h=>h.index.records=[],h=>h.b.is_active=false,h=>h.target.product_no='other',h=>h.target.medium='',h=>h.target.next_inspection='2028-01-01']){
  const h=setup();mutate(h);await h.temp();await h.svc.run();assert.equal(h.counts.sent,0);assert.equal(h.job().state,'blocked')
 }
})
test('source correction is review-only and cannot reupload original or edited values',async()=>{
 const h=setup();await h.temp();await h.svc.run();h.r.source_version=2;h.r.updated_at++;h.r.fill_weight=85;await h.svc.run();assert.equal(h.job().state,'requires_review');assert.equal(h.counts.sent,1)
})
test('activation excludes historical records; preview/disabled never submit',async()=>{
 const h=setup();await h.temp();h.r.created_at=time-2000;await h.svc.run();assert.equal(h.db.data(JOBS).size,0);h.r.created_at=time;h.db.data(STATES).get('config').mode='preview';await h.svc.run();assert.equal(h.counts.sent,0)
})
test('same-time receipt ambiguity cannot be confirmed',async()=>{
 const h=setup();await h.temp();const post=h.transport.submit;h.transport.submit=async p=>{const r=await post(p);h.records.push({...h.records[0],id:999});return r};await h.svc.run();assert.equal(h.job().state,'accepted_pending_verify');assert.equal(matchReceipt(h.job(),h.records),null)
})
test('SOAP encoding and decoding retain Chinese, quotes and literal ampersands',()=>{
 assert.match(envelope('login',{uname:'a&b',pwd:'<test>'},time),/a&amp;b/)
 assert.deepEqual(parseSoap('<e><return>{&quot;code&quot;:0,&quot;data&quot;:&quot;A&amp;B&quot;}</return></e>'),{code:0,data:'A&B'})
 assert.throws(()=>parseSoap('<!DOCTYPE x><return>{}</return>'),/格式异常/)
})
test('expired day and unstable/missing measurement cannot be submitted',async()=>{
 for(const mutate of [h=>h.r.date='2026-10-31',h=>h.r.reweigh.capture.stable=false,h=>delete h.r.reweigh.basis.return_reweigh_id,h=>h.r.fill_weight=90]){
  const h=setup();mutate(h);await h.temp();await h.svc.run();assert.equal(h.counts.sent,0);assert.equal(h.job().state,'blocked')
 }
})
test('lock loss before the durable attempt prevents an external write',async()=>{
 const h=setup();await h.temp();h.transport.records=async()=>{h.db.data(STATES).set('worker',{_id:'worker',lease:'other',until:time+999999});return []};await h.svc.run();assert.equal(h.counts.sent,0)
})
test('source changes during target lookup prevent upload',async()=>{
 const h=setup();await h.temp();h.transport.lookup=async()=>{h.r.source_version++;return h.target};await h.svc.run();assert.equal(h.counts.sent,0);assert.equal(h.job().state,'requires_review')
})
test('preview does not establish an activation date for later historical catchup',async()=>{
 const h=setup();h.db.data(STATES).delete('config');await h.svc.setMode('preview',{_id:'admin'});assert.equal((await h.svc.getConfig()).activation_at,null);h.clock.time+=10000;await h.svc.setMode('enabled',{_id:'admin'});assert.equal((await h.svc.getConfig()).activation_at,time+10000)
})
