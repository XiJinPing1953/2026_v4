'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs'),{loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const {snapshot}=require('../uniCloud-alipay/cloudfunctions/crm-k021-reconciliation/snapshot')
test('K021合并范围、原值冲突、事务回滚幂等、退款及三入口',async()=>{
 const before=JSON.parse(fs.readFileSync(process.env.K021_SOURCE)).response.data,t=structuredClone(before.tables),cid=before.customer_id
 t.crm_users=[{_id:'testactor',username:'test',token:'test',role:'superadmin'}];t.crm_operation_logs=[]
 const db=mutableDb(t),h=loadHandler('crm-k021-reconciliation',db),s=loadHandler('crm-customer-settlement',db)
 const req={customer_id:cid,operation_id:'k021-reconciliation-20260921-v1',expected_snapshot_hash:before.snapshot_hash,evidence:{confirmed_by_user:true,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}}
 assert.equal((await h({action:'prepareV1',data:req})).code,403)
 assert.equal((await invoke(h,'prepareV1',{...req,customer_id:'a'.repeat(24)})).code,409)
 let r=await invoke(h,'prepareV1',req);assert.equal(r.code,0,r.msg);const act={customer_id:cid,operation_id:req.operation_id,plan_hash:r.data.plan_hash}
 t.crm_customers.find(x=>x._id!==cid).settlement_customer_id='other';assert.equal((await invoke(h,'rehearseV1',act)).code,409);t.crm_customers.find(x=>x._id!==cid).settlement_customer_id=cid
 r=await invoke(h,'rehearseV1',{...act,fail_after_writes:5});assert.equal(r.data?.status,'interruption_rolled_back',r.msg);assert.equal((await snapshot(db,cid)).snapshot_hash,before.snapshot_hash)
 r=await invoke(h,'rehearseV1',act);assert.equal(r.data?.status,'rehearsed_rolled_back',r.msg);r=await invoke(h,'executeV1',act);assert.equal(r.code,0,r.msg);assert.equal((await invoke(h,'executeV1',act)).data.idempotent,true)
 assert.deepEqual(t.crm_sale_records,before.tables.crm_sale_records)
 assert.deepEqual(t.crm_customers.find(x=>x._id!==cid),before.tables.crm_customers.find(x=>x._id!==cid))
 const context=await invoke(s,'listCustomerRefundsV1',{customer_id:cid});assert.equal(context.code,0,context.msg)
 const source=context.data.sources.find(x=>x.available===200);assert.ok(source)
 const input={customer_id:cid,amount:200,biz_date:'2026-08-27',payment_method:'unknown',note:'用户确认已退款200元',voucher_ref:'记-086',sources:[{id:source.id,amount:200,version:source.version}],operation_id:'k021-refund-200-test',confirm_paid:true}
 const preview=await invoke(s,'previewCustomerRefundV1',input);assert.equal(preview.code,0,preview.msg);input.plan_hash=preview.data.plan_hash
 r=await invoke(s,'createCustomerRefundV1',input);assert.equal(r.code,0,r.msg);r=await invoke(s,'createCustomerRefundV1',input);assert.equal(r.data.idempotent,true)
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
  r=await invoke(s,action,{customer_id:cid,date_from:'2026-01-01',date_to:'2026-09-21'});assert.equal(r.code,0,r.msg)
  for(const [k,v]of Object.entries({business_revenue:24848,cash_received:25258,refund_total:410,net_cash_received:24848,rounding_total:0,complete:true}))assert.equal(r.data.period_summary[k],v,action+':'+k)
  if(r.data.summary){assert.equal(r.data.summary.prepay_balance,0);assert.equal(r.data.summary.receivable_balance,0)}
 }
 for(const [date,cash,refund]of [['2026-01-24',0,0],['2026-01-27',612,0],['2026-08-14',520,0],['2026-08-15',0,0],['2026-08-25',0,210],['2026-08-27',0,200]]){r=await invoke(s,'getCustomerStatementV1',{customer_id:cid,date_from:date,date_to:date});assert.equal(r.data.period_summary.cash_received,cash,date);assert.equal(r.data.period_summary.refund_total,refund,date)}
})
