'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {createCorrection,hash}=require('./lib/bottleArchiveCorrection.cjs')
const {makeDb}=require('./lib/accountingTestHarness.cjs')
function fixture(hooks={}) {
 const rows=[{_id:'a',bottle_no:'A',qr_code:'02546000001',updated_at:1,remark:'保留',status:'at_customer'},{_id:'b',bottle_no:'B',qr_code:'02546000002',updated_at:1,remark:'原备注',status:'in_station'}]
 const tables={crm_bottles:structuredClone(rows)}
 const db=makeDb(tables,{mutate:true,transaction:true,...hooks})
 const payload={batch_id:'TEST_ONLY',items:rows.map((before,i)=>({_id:before._id,bottle_no:before.bottle_no,before,set:{qr_code:rows[1-i].qr_code,remark:before.remark+'\n河北内部编号：测试'},expected_updated_at:1,applied_at:2,rollback_at:3})),groups:[['a','b']]}
 const config={batch_id:payload.batch_id,payload_sha256:hash(payload),secret_sha256:crypto.createHash('sha256').update('TEST_SECRET').digest('hex')}
 const create=()=>createCorrection({db,payload,config:{...config,payload_sha256:hash(payload)}})
 const call=(handler,mode,extra={})=>handler({secret:'TEST_SECRET',batch_id:'TEST_ONLY',mode,group:0,confirm:mode.toUpperCase()+':TEST_ONLY',...extra})
 return {db,tables,payload,config,create,call}
}
test('预览零写入；交换标签在同一事务完成，重复执行不再写入',async()=>{const f=fixture(),h=f.create();assert.equal((await f.call(h,'probe')).data.results[0].state,'ready');assert.equal(f.db.writes.length,0);assert.equal((await f.call(h,'apply')).data.changed,2);assert.equal(f.tables.crm_bottles[0].qr_code,'02546000002');assert.equal(f.tables.crm_bottles[0].status,'at_customer');assert.equal((await f.call(h,'apply')).data.changed,0)});
test('源字段改变，即使updated_at未变也整组拒绝',async()=>{const f=fixture(),h=f.create();f.tables.crm_bottles[1].remark='现场新修改';const r=await f.call(h,'apply');assert.equal(r.data.changed,0);assert.equal(f.db.writes.length,0);assert.equal(r.data.results[1].state,'source_changed')});
test('组外标签或PDA码冲突拒绝',async()=>{const f=fixture(),h=f.create();f.tables.crm_bottles.push({_id:'c',bottle_no:'C',pda_qr_code:'02546000002'});assert.equal((await f.call(h,'apply')).data.state,'rejected');assert.equal(f.db.writes.length,0)});
test('事务第二次写入失败时第一笔也不提交',async()=>{let n=0;const f=fixture({txWrite(){if(++n===2)throw Error('TEST_FAILURE')}}),before=structuredClone(f.tables);assert.equal((await f.call(f.create(),'apply')).data.state,'rejected');assert.deepEqual(f.tables,before)});
test('受保护回退恢复原字段，保留历史版本；重复回退无写入',async()=>{const f=fixture(),h=f.create();await f.call(h,'apply');assert.equal((await f.call(h,'rollback')).data.changed,2);assert.equal(f.tables.crm_bottles[0].qr_code,'02546000001');assert.equal(f.tables.crm_bottles[0].remark,'保留');assert.equal(f.tables.crm_bottles[0].updated_at,3);assert.equal((await f.call(h,'rollback')).data.changed,0)});
test('回退拒绝覆盖之后的现场修改',async()=>{const f=fixture(),h=f.create();await f.call(h,'apply');f.tables.crm_bottles[0].status='lost';assert.equal((await f.call(h,'rollback')).data.changed,0);assert.equal(f.tables.crm_bottles[1].qr_code,'02546000001')});
test('权限、批次和确认文本不符均不写',async()=>{const f=fixture(),h=f.create();for(const change of [{secret:'WRONG'},{batch_id:'OTHER'},{confirm:'WRONG'}])assert.equal((await f.call(h,'apply',change)).code,403);assert.equal(f.db.writes.length,0)});
test('载荷哈希、范围及已有PDA码覆盖均拒绝',()=>{const f=fixture();assert.throws(()=>createCorrection({db:f.db,payload:f.payload,config:{...f.config,payload_sha256:'wrong'}}));f.payload.items[0].set.status='lost';assert.throws(f.create,/范围/);delete f.payload.items[0].set.status;f.payload.items[0].before.pda_qr_code='ORIGINAL';f.payload.items[0].set.pda_qr_code='OTHER';assert.throws(f.create,/已有PDA/)});
