'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs'),{loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const p=require('../uniCloud-alipay/cloudfunctions/crm-k010-reconciliation/plan'),{snapshot}=require('../uniCloud-alipay/cloudfunctions/crm-k010-reconciliation/snapshot')
test('K010受保护批次：失败回滚、冲突、幂等及三账务入口',async()=>{
 const before=JSON.parse(fs.readFileSync(process.env.K010_SOURCE)).data,t=structuredClone(before.tables),cid=before.customer_id
 t.crm_users=[{_id:'testactor',username:'test',token:'test',role:'superadmin'}];t.crm_operation_logs=[]
 const db=mutableDb(t),h=loadHandler('crm-k010-reconciliation',db),s=loadHandler('crm-customer-settlement',db)
 const req={customer_id:cid,operation_id:'k010-reconciliation-20260915-v1',expected_snapshot_hash:before.snapshot_hash,evidence:{confirmed_by_user:true,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}}
 assert.equal((await h({action:'prepareV1',data:req})).code,403)
 assert.equal((await invoke(h,'prepareV1',{...req,customer_id:'a'.repeat(24)})).code,409)
 let r=await invoke(h,'prepareV1',req);assert.equal(r.code,0,r.msg);const plan=r.data,act={customer_id:cid,operation_id:req.operation_id,plan_hash:plan.plan_hash}
 t.crm_sale_records[0].remark+='changed';assert.equal((await invoke(h,'rehearseV1',act)).code,409);t.crm_sale_records[0].remark=before.tables.crm_sale_records[0].remark
 r=await invoke(h,'rehearseV1',{...act,fail_after_writes:5});assert.equal(r.data.status,'interruption_rolled_back');assert.equal((await snapshot(db,cid)).snapshot_hash,before.snapshot_hash)
 r=await invoke(h,'rehearseV1',act);assert.equal(r.data.status,'rehearsed_rolled_back');r=await invoke(h,'executeV1',act);assert.equal(r.code,0,r.msg)
 assert.equal((await invoke(h,'executeV1',act)).data.idempotent,true)
 for(const old of before.tables.crm_sale_records){const current=t.crm_sale_records.find(r=>r._id===old._id);for(const k of Object.keys(old).filter(k=>!['amount_received','receipt_rounding_amount','payment_status','updated_at','accounting_reconciliation'].includes(k)))assert.deepEqual(current[k],old[k],k)}
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){r=await invoke(s,action,{customer_id:cid,date_from:'2026-01-01',date_to:'2026-09-15'});assert.equal(r.code,0,r.msg);const x=r.data.period_summary;for(const [k,v]of Object.entries({business_revenue:1080,cash_received:1150,refund_total:70,net_cash_received:1080,rounding_total:0,complete:true}))assert.equal(x[k],v,action+':'+k);if(r.data.summary){assert.equal(r.data.summary.receivable_balance,0);assert.equal(r.data.summary.prepay_balance,0)}}
})
