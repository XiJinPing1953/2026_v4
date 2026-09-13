'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs')
const p=require('../uniCloud-alipay/cloudfunctions/crm-k004-reconciliation/plan')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs'),{loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const raw=JSON.parse(fs.readFileSync('outputs/trust-audit/2026-09-13/k004/raw-before.json'))
const evidence={confirmed_by_user:true,customer_id:p.CUSTOMER_ID,source_snapshot_hash:raw.snapshot_hash,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}
test('K004 real snapshot protected handler rollback, conflict and idempotency',async()=>{
 const t={...structuredClone(raw.tables),crm_users:[{_id:'sa',token:'test',role:'superadmin'}],crm_operation_logs:[]},db=mutableDb(t),handler=loadHandler('crm-k004-reconciliation',db)
 const call=(action,data={})=>invoke(handler,action,{customer_id:p.CUSTOMER_ID,...data})
 const prepared=await call('prepareV1',{expected_snapshot_hash:raw.snapshot_hash,evidence});assert.equal(prepared.code,0,prepared.msg)
 const args={run_id:prepared.data.run_id,plan_hash:prepared.data.plan_hash}
 assert.equal((await call('executeV1',args)).code,409)
 const stop=await call('rehearseV1',{...args,fail_after_writes:30});assert.equal(stop.code,0,stop.msg);assert.equal(stop.data.status,'interruption_rolled_back');assert.equal(p.snapshotHash(t),raw.snapshot_hash)
 assert.equal((await call('executeV1',args)).code,409)
 const rehearsal=await call('rehearseV1',args);assert.equal(rehearsal.code,0,rehearsal.msg);assert.equal(p.snapshotHash(t),raw.snapshot_hash)
 const original=t.crm_sale_records[0].updated_at;t.crm_sale_records[0].updated_at=1;assert.equal((await call('executeV1',args)).code,409);t.crm_sale_records[0].updated_at=original
 const done=await call('executeV1',args);assert.equal(done.code,0,done.msg);assert.equal(done.data.status,'committed')
 const hash=p.snapshotHash(t),repeat=await call('executeV1',args);assert.equal(repeat.data.idempotent,true);assert.equal(p.snapshotHash(t),hash)
 assert.equal((await call('inspectV1',{customer_id:'other'})).code,400)
})
