'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs')
const p = require('../uniCloud-alipay/cloudfunctions/crm-accounting-correction/plan')
const { snapshot } = require('../uniCloud-alipay/cloudfunctions/crm-accounting-correction/snapshot')
const { mutableDb } = require('./lib/mutableAccountingDb.cjs')
const { loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
const cid='69d73d2087d884262d90eb9f', a='6a80078e5d732f70fc7fe4dc', s='6aaf79b05ece8f08a45a9e5b', n='6aaf7a03cc54bda3f68090e4'
const ca='369453ce1997b698c2a66e2e', cs='c6069717d1100a111550ee91', off='6aaf7a0ff2fa6c299e05fe1e'
const actor={_id:'test-actor',username:'test',role:'superadmin',token:'test'}
function fixture(raw) {
 const base={customer_id:cid}, sale={...base,price_unit:'kg',settlement_mode:'sale',rounding_amount:0,back_items:[]}
 const receipt={...base,status:'posted',entry_kind:'prepay',source_type:'cashier_intake',unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0}
 const allocation=(id,r,sid,amount,kind='receipt')=>({_id:id,...base,receipt_id:r,target_type:'sale',target_id:sid,sale_id:sid,allocate_amount:amount,allocate_kind:kind})
 const tables=raw?structuredClone(raw.tables):{
  crm_customers:[{_id:cid,name:'修复反例',default_price_unit:'kg',prepay_balance:30,receipt_unallocated_balance:30,net_balance:-30,amount_received_total:4777.5}],
  crm_sale_records:[{...sale,_id:a,date:'2026-08-15',unit_price:7.5,out_items:[{net:361}],amount_received:2707.5},
   {...sale,_id:s,date:'2026-09-20',unit_price:8,out_items:[{net:264}],amount_received:2107.5,receipt_rounding_amount:4.5},
   {...sale,_id:n,date:'2026-09-20',unit_price:7.5,out_items:[],back_items:[{net:5,bottle_no:'217'}],amount_received:0,offset_enabled:true}],
  crm_customer_receipts:[{...receipt,_id:ca,biz_date:'2026-08-15',amount:2700,allocated_amount:2670,unallocated_amount:30},
   {...receipt,_id:cs,biz_date:'2026-09-20',amount:2070,allocated_amount:2070,rounding_amount:4.5,rounding_allocated_amount:4.5},
   {...receipt,_id:off,biz_date:'',source_type:'manual',source_id:null,amount:0,allocated_amount:0}],
  crm_customer_allocations:[allocation('6ac739512550b2f5660a60a2',ca,a,2670),allocation('cash-september',cs,s,2070),allocation('rounding-september',cs,s,4.5,'rounding')]
 }
 for(const k of ['crm_customer_flow_settlements','crm_customer_opening_debts','crm_customer_receipt_adjustments','crm_customer_deposit_accounts','crm_customer_deposit_entries','crm_collection_tasks','crm_collection_followups','crm_vouchers'])tables[k]||=[]
 const before={customer_id:cid,complete:true,tables,snapshot_hash:p.snapshotHash(tables)}
 const request={customer_id:cid,operation_id:'haisheng-offset-375-20261012-v1',expected_snapshot_hash:before.snapshot_hash,
  evidence:{confirmed_by_user:true,approval_sha256:'1'.repeat(64),source_commit:'2'.repeat(40)},corrections:[{type:'restore_haisheng_offset_20261012'}]}
 return{before,request}
}
test('同笔退气恢复且现金不增，八月孤立已收转为有依据的现金/抹零，九月销售不重加',()=>{
 const {before,request}=fixture(), plan=p.buildPlan(before,request,actor,Date.now())
 assert.equal(plan.writes.length,7);assert.equal(plan.summary.new_receipts,0)
 assert.equal(plan.writes.some(w=>w.table==='crm_sale_records'&&w.id===s),false)
 const receipts=plan.writes.filter(w=>w.table==='crm_customer_receipts')
 assert.equal(receipts.find(w=>w.id===ca).after.amount,2700)
 assert.equal(receipts.find(w=>w.id===off).after.source_id,n)
 const august=plan.writes.find(w=>w.id===a).after
 assert.equal(august.amount_received+august.receipt_rounding_amount,2707.5)
 assert.equal(plan.writes.find(w=>w.id===cid).after.net_balance,0)
})
test('错误范围、改变现金、重复退气来源、退款及未完成调整均拒绝',()=>{
 for(const mutate of [x=>x.request.customer_id='a'.repeat(24),x=>x.request.operation_id='other-batch',
  x=>x.request.corrections[0].amount=37.5,x=>x.before.tables.crm_customer_receipts[0].amount=2701,
  x=>x.before.tables.crm_customer_receipts[2].cash_refunded_amount=1,
  x=>x.before.tables.crm_customer_receipts.push({_id:'refund',customer_id:cid,status:'posted',source_type:'customer_cash_refund',amount:-1,refund_sources:[{id:off,amount:1,version:'v1'}]}),
  x=>x.before.tables.crm_customer_receipts[0].receipt_adjustment_status='pending',
  x=>x.before.tables.crm_customer_receipts.push({...x.before.tables.crm_customer_receipts[2],_id:'duplicate',source_id:n}),
  x=>x.before.tables.crm_customer_allocations.push({...x.before.tables.crm_customer_allocations[0],_id:'extra',receipt_id:off})]){
  const x=fixture();mutate(x);x.before.snapshot_hash=p.snapshotHash(x.before.tables);x.request.expected_snapshot_hash=x.before.snapshot_hash
  assert.throws(()=>p.buildPlan(x.before,x.request,actor,Date.now()))
 }
})
test('真实受保护入口：原值冲突拒绝、中断/完整回滚、一次提交及同批重试',async()=>{
 const {before,request}=fixture(),tables=structuredClone(before.tables)
 tables.crm_users=[actor];tables.crm_operation_logs=[]
 const db=mutableDb(tables),handler=loadHandler('crm-accounting-correction',db)
 const prepared=await invoke(handler,'prepareV1',request);assert.equal(prepared.code,0,prepared.msg)
 const data={customer_id:cid,operation_id:request.operation_id,plan_hash:prepared.data.plan_hash}
 tables.crm_sale_records[0].remark='changed';assert.equal((await invoke(handler,'executeV1',data)).code,409);delete tables.crm_sale_records[0].remark
 let r=await invoke(handler,'rehearseV1',{...data,fail_after_writes:4});assert.equal(r.data.status,'interruption_rolled_back')
 assert.equal((await snapshot(db,cid)).snapshot_hash,before.snapshot_hash)
 r=await invoke(handler,'rehearseV1',data);assert.equal(r.data.status,'rehearsed_rolled_back')
 r=await invoke(handler,'executeV1',data);assert.equal(r.code,0,r.msg)
 const hash=(await snapshot(db,cid)).snapshot_hash
 r=await invoke(handler,'executeV1',data);assert.equal(r.data.idempotent,true)
 assert.equal((await snapshot(db,cid)).snapshot_hash,hash)
})
test('本批完整原账模拟：三个真实账务入口、现金不变、两笔待核移除、两种导出归零', {skip:!process.env.HAISHENG_REPAIR_EVIDENCE},async()=>{
 const raw=JSON.parse(fs.readFileSync(process.env.HAISHENG_REPAIR_EVIDENCE)).response.data
 const {before,request}=fixture(raw),plan=p.buildPlan(before,request,actor,Date.now()),tables=structuredClone(before.tables)
 for(const w of plan.writes){const i=tables[w.table].findIndex(x=>x._id===w.id);if(i<0)tables[w.table].push(w.after);else tables[w.table][i]=w.after}
 tables.crm_users=[actor];tables.crm_operation_logs=[]
 const handler=loadHandler('crm-customer-settlement',mutableDb(tables))
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
  const r=await invoke(handler,action,{customer_id:cid,date_from:'2026-01-01',date_to:'2026-10-12'})
  assert.equal(r.code,0,r.msg)
  assert.equal(r.data.period_summary.rounding_total,43)
  assert.equal(r.data.period_summary.known_cash.cash_received,109336)
  assert.equal(r.data.period_summary.unresolved_count,1)
  const pending=JSON.stringify(r.data.period_summary.unresolved_sources)
  assert(!pending.includes(a)&&!pending.includes(s),pending)
  if(action==='getCustomerStatementV1'){
   assert.equal(r.data.summary.net_balance,0);assert.equal(r.data.summary.receivable_balance,5176)
   assert.equal(r.data.summary.prepay_balance,5176);assert.equal(r.data.summary.amount_received_total,112563)
  }else if(action==='exportCustomerStatementV1')assert.equal(r.data.closing_balance,0)
  else assert.equal(r.data.closing.balance,0)
 }
 assert.equal(p.snapshotHash(Object.fromEntries(Object.keys(before.tables).map(k=>[k,tables[k]]))),p.expectedAfter(before,plan))
})
