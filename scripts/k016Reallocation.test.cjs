'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs'),{loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const p=require('../uniCloud-alipay/cloudfunctions/crm-k016-reconciliation/plan'),{snapshot}=require('../uniCloud-alipay/cloudfunctions/crm-k016-reconciliation/snapshot')
test('K016受保护批次：失败回滚、冲突、幂等及三账务入口',async()=>{
 const before=JSON.parse(fs.readFileSync(process.env.K016_REALLOCATION_SOURCE)).data,t=structuredClone(before.tables),cid=before.customer_id
 t.crm_users=[{_id:'testactor',username:'test',token:'test',role:'superadmin'}];t.crm_operation_logs=[]
 const db=mutableDb(t),h=loadHandler('crm-k016-reconciliation',db),s=loadHandler('crm-customer-settlement',db)
 const req={customer_id:cid,operation_id:'k016-reallocation-20260916-v1',expected_snapshot_hash:before.snapshot_hash,evidence:{confirmed_by_user:true,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}}
 assert.equal((await h({action:'prepareV1',data:req})).code,403)
 assert.equal((await invoke(h,'prepareV1',{...req,customer_id:'a'.repeat(24)})).code,409)
 let r=await invoke(h,'prepareV1',req);assert.equal(r.code,0,r.msg);const plan=r.data,act={customer_id:cid,operation_id:req.operation_id,plan_hash:plan.plan_hash}
 t.crm_customer_receipts[0].note+='changed';assert.equal((await invoke(h,'rehearseV1',act)).code,409);t.crm_customer_receipts[0].note=before.tables.crm_customer_receipts[0].note
 r=await invoke(h,'rehearseV1',{...act,fail_after_writes:5});assert.equal(r.data.status,'interruption_rolled_back');assert.equal((await snapshot(db,cid)).snapshot_hash,before.snapshot_hash)
 r=await invoke(h,'rehearseV1',act);assert.equal(r.data.status,'rehearsed_rolled_back');r=await invoke(h,'executeV1',act);assert.equal(r.code,0,r.msg)
 assert.equal((await invoke(h,'executeV1',act)).data.idempotent,true)

 for(const old of before.tables.crm_sale_records){const current=t.crm_sale_records.find(r=>r._id===old._id);for(const k of Object.keys(old))assert.deepEqual(current[k],old[k],k)}
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){r=await invoke(s,action,{customer_id:cid,date_from:'2026-01-01',date_to:'2026-09-16'});assert.equal(r.code,0,r.msg);const x=r.data.period_summary;if(!x.complete)console.log(JSON.stringify(x));for(const [k,v]of Object.entries({business_revenue:21978.8,cash_received:27382,refund_total:0,net_cash_received:27382,rounding_total:0.8,settlement_fee_total:0,complete:true}))assert.equal(x[k],v,action+':'+k);if(action!=='getCustomerStatementV1')assert.equal(r.data.closing_balance,-580);if(r.data.summary){assert.equal(r.data.summary.receivable_balance,0);assert.equal(r.data.summary.prepay_balance,580)}}
 r=await invoke(s,'getCustomerStatementV1',{customer_id:cid,date_from:'2026-01-01',date_to:'2026-09-16'})
 const rows=r.data.recent_sales
 const paid=rows.find(x=>x._id==='6a83f9999a962fec68e1dee3'),returned=rows.find(x=>x._id==='6a8e9ecf8f7c293f9f40baea')
 assert.equal(paid.receipt_allocated_amount,500);assert.equal(paid.offset_applied_amount,0);assert.equal(paid.offset_sources.length,0)
 assert.equal(returned.offset_target_amount,0);assert.equal(returned.offset_targets.length,0)
 assert.ok(rows.some(x=>x.offset_applied_amount>0),'有效冲抵仍保留')
 assert.equal(t.crm_customer_receipts.find(r=>r._id==='6a9fb0226c031c11faccf65c').unallocated_amount,0)
 assert.equal(t.crm_customer_receipts.find(r=>r._id==='6a8e9ed7fbc4c8ef097665ad').unallocated_amount,580)
})
