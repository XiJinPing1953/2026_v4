'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {makeDb,loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const {digest}=require('../uniCloud-alipay/cloudfunctions/crm-bottle/suspendPrefixes')

function setup(txWrite) {
 const tables={crm_users:[{_id:'u',token:'test',role:'superadmin'}],crm_customers:[],crm_operation_logs:[],crm_bottles:[
  {_id:'a',bottle_no:'415',is_active:true,pressure_gauge_cycle_months:36,pressure_gauge_check_date:'2026-10-26',pressure_gauge_next_check_date:'2029-10-25',bottle_next_check_date:'2029-03-08'},
  {_id:'b',bottle_no:'J51',is_active:false,pressure_gauge_cycle_months:12,pressure_gauge_check_date:'2026-04-20',pressure_gauge_next_check_date:'2026-10-19'},
  {_id:'c',bottle_no:'X',pressure_gauge_cycle_months:6,pressure_gauge_check_date:'2026-01-01'}]}
 const db=makeDb(tables,{mutate:true,transaction:true,txDocumentObject:true,txWrite})
 return {tables,handler:loadHandler('crm-bottle',db)}
}
test('protected repair verifies originals, rolls back, repairs active and inactive records and is idempotent',async()=>{
 for(const mode of ['stale','failure','rehearse','commit']) {
  const h=setup(()=>{if(mode==='failure')throw Error('failure')});const before=structuredClone(h.tables.crm_bottles)
  const items=before.slice(0,2).map(r=>({id:r._id,expected_hash:mode==='stale'?'0'.repeat(64):digest(r)}))
  const res=await invoke(h.handler,'repairGaugeCyclesV1',{phase:mode==='rehearse'?'rehearse':'execute',items})
  assert.equal(res.code,['stale','failure'].includes(mode)?409:0,res.msg)
  if(mode!=='commit') assert.deepEqual(h.tables.crm_bottles,before)
  else {
   assert.equal(h.tables.crm_bottles[0].pressure_gauge_cycle_months,6)
   assert.equal(h.tables.crm_bottles[0].pressure_gauge_next_check_date,'2027-04-25')
   assert.equal(h.tables.crm_bottles[0].pressure_gauge_check_date,'2026-10-26')
   assert.equal(h.tables.crm_bottles[0].bottle_next_check_date,'2029-03-08')
   assert.equal(h.tables.crm_bottles[1].pressure_gauge_next_check_date,'2026-10-19')
   assert.equal(h.tables.crm_bottles[1].is_active,false)
   assert.deepEqual(h.tables.crm_bottles[2],before[2])
   const retry=await invoke(h.handler,'repairGaugeCyclesV1',{phase:'execute',items});assert.equal(retry.code,0);assert.equal(retry.data.idempotent,true)
  }
 }
})
test('missing inspection date blocks the batch',async()=>{
 const h=setup();h.tables.crm_bottles[0].pressure_gauge_check_date=''
 const before=structuredClone(h.tables.crm_bottles);const r=await invoke(h.handler,'repairGaugeCyclesV1',{phase:'execute',items:[{id:'a',expected_hash:digest(before[0])}]})
 assert.equal(r.code,409);assert.deepEqual(h.tables.crm_bottles,before)
})
test('preview includes inactive anomalies and does not change records',async()=>{
 const h=setup(),before=structuredClone(h.tables.crm_bottles)
 const r=await invoke(h.handler,'repairGaugeCyclesV1',{phase:'preview'})
 assert.equal(r.code,0,r.msg);assert.equal(r.data.total,3);assert.deepEqual(r.data.plan.map(x=>x.id).sort(),['a','b'])
 assert.deepEqual(h.tables.crm_bottles,before)
})
test('entry points reject non-six-month cycles and overly late dates',async()=>{
 const h=setup()
 for(const cycle of [12,36]) {
  assert.equal((await invoke(h.handler,'createV1',{pressure_gauge_cycle_months:cycle})).code,400)
  assert.equal((await invoke(h.handler,'updateV1',{id:'a',pressure_gauge_cycle_months:cycle})).code,400)
  assert.equal((await invoke(h.handler,'batchUpdateInspectionV1',{scope_mode:'ids',selector:{ids:['a']},modules:{gauge:{check_date:'2026-10-26',cycle_months:cycle}}})).code,400)
 }
 assert.equal((await invoke(h.handler,'batchUpdateInspectionV1',{scope_mode:'ids',selector:{ids:['a']},modules:{gauge:{check_date:'2026-10-26',cycle_months:6,next_check_date_override:'2027-10-25'}}})).code,400)
 assert.equal((await invoke(h.handler,'createV1',{pressure_gauge_cycle_months:6,pressure_gauge_check_date:'2026-10-26',pressure_gauge_next_check_date:'2029-10-25'})).code,400)
 assert.equal((await invoke(h.handler,'updateV1',{id:'a',pressure_gauge_cycle_months:6,pressure_gauge_check_date:'2026-10-26',pressure_gauge_next_check_date:'2029-10-25'})).code,400)
})
