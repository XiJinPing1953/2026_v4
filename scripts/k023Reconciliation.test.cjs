'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs'),{loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const {snapshot}=require('../uniCloud-alipay/cloudfunctions/crm-k023-reconciliation/snapshot')

test('K023受保护批次：期初预付、现金补证、非现金调整、回滚与幂等',async()=>{
 const source=JSON.parse(fs.readFileSync(process.env.K023_SOURCE)),before=source.response?.data||source.data||source
 const t=structuredClone(before.tables),cid=before.customer_id
 t.crm_users=[{_id:'testactor',username:'test',token:'test',role:'superadmin'}]
 t.crm_operation_logs=[]
 const db=mutableDb(t),h=loadHandler('crm-k023-reconciliation',db),s=loadHandler('crm-customer-settlement',db)
 const req={customer_id:cid,operation_id:'k023-reconciliation-20260922-v1',expected_snapshot_hash:before.snapshot_hash,evidence:{confirmed_by_user:true,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}}
 assert.equal((await h({action:'prepareV1',data:req})).code,403)
 assert.equal((await invoke(h,'prepareV1',{...req,customer_id:'a'.repeat(24)})).code,409)
 let r=await invoke(h,'prepareV1',req);assert.equal(r.code,0,r.msg)
 assert.deepEqual(r.data.summary,{business_revenue:13964,noncash_balance_adjustment:7,receivable_total:13971,cash_received:13963,opening_prepay_transferred:8,rounding_total:0,refund_total:0,net_cash_received:13963,receivable_balance:0,prepay_balance:0,cash_receipts_created:8,cash_backing_created:5390,writes:30})
 const act={customer_id:cid,operation_id:req.operation_id,plan_hash:r.data.plan_hash}
 t.crm_customer_receipts.find(x=>x.status==='posted').note='changed'
 assert.equal((await invoke(h,'rehearseV1',act)).code,409)
 Object.assign(t.crm_customer_receipts.find(x=>x.note==='changed'),before.tables.crm_customer_receipts.find(x=>x._id===t.crm_customer_receipts.find(y=>y.note==='changed')._id))
 r=await invoke(h,'rehearseV1',{...act,fail_after_writes:5});assert.equal(r.data.status,'interruption_rolled_back');assert.equal((await snapshot(db,cid)).snapshot_hash,before.snapshot_hash)
 r=await invoke(h,'rehearseV1',act);assert.equal(r.data.status,'rehearsed_rolled_back');assert.equal((await snapshot(db,cid)).snapshot_hash,before.snapshot_hash)
 r=await invoke(h,'executeV1',act);assert.equal(r.code,0,r.msg);assert.equal((await invoke(h,'executeV1',act)).data.idempotent,true)

 for(const old of before.tables.crm_sale_records){
  const current=t.crm_sale_records.find(x=>x._id===old._id)
  const allowed=['amount_received','receipt_allocated_amount','receipt_rounding_amount','updated_at','accounting_reconciliation']
  for(const key of Object.keys(old).filter(k=>!allowed.includes(k)))assert.deepEqual(current[key],old[key],old._id+':'+key)
 }
 const oldRound=before.tables.crm_customer_receipts.find(x=>x._id==='6a0c032da2aff69e3bfc7cea')
 assert.equal(t.crm_customer_receipts.find(x=>x._id===oldRound._id).status,'void')
 assert.equal(t.crm_customer_receipts.filter(x=>x.status==='posted'&&x.source_type==='legacy_received_confirmation').length,8)
 assert.equal(t.crm_customer_receipts.filter(x=>x.status==='posted'&&x.source_type==='opening_prepay').reduce((n,x)=>n+x.amount,0),8)
 assert.equal(t.crm_customer_opening_debts.filter(x=>x.status==='posted'&&x.source_type==='balance_adjustment').reduce((n,x)=>n+x.amount,0),7)

 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
  r=await invoke(s,action,{customer_id:cid,date_from:'2026-01-01',date_to:'2026-09-22'});assert.equal(r.code,0,r.msg)
  const x=r.data.period_summary
  for(const [key,value] of Object.entries({business_revenue:13964,noncash_balance_adjustment:7,receivable_total:13971,cash_received:13963,opening_prepay_transferred:8,rounding_total:0,refund_total:0,net_cash_received:13963,complete:true}))assert.equal(x[key],value,action+':'+key)
  if(r.data.summary){assert.equal(r.data.summary.receivable_balance,0);assert.equal(r.data.summary.prepay_balance,0)}
  if(action!=='getCustomerStatementV1')assert.equal(r.data.closing_balance,0)
 }
 for(const [date,cash,opening,adjustment] of [['2026-01-01',0,8,0],['2026-02-07',660,0,0],['2026-02-08',600,0,0],['2026-06-12',0,0,7]]){
  r=await invoke(s,'getCustomerStatementV1',{customer_id:cid,date_from:date,date_to:date});assert.equal(r.data.period_summary.cash_received,cash,date);assert.equal(r.data.period_summary.opening_prepay_transferred,opening,date);assert.equal(r.data.period_summary.noncash_balance_adjustment,adjustment,date)
 }
})
