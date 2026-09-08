'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {buildPlan,digest,SPEC,CUSTOMER_ID}=require('../uniCloud-alipay/cloudfunctions/crm-haonuo-reconciliation/plan')
const {fixture,snapshot,evidence}=require('./lib/haonuoFixture.cjs')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs')
const {makeDb,loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const build=t=>buildPlan(snapshot(t),evidence,{_id:'admin'},10)
function apply(t,p){t=structuredClone(t);for(const w of p.writes){const rows=t[w.table]||=[];const i=rows.findIndex(r=>r._id===w.id);if(i<0)rows.push(structuredClone(w.after));else rows[i]=structuredClone(w.after)}return t}
const q=(handler,action,from='2026-01-01',to='2026-09-07')=>invoke(handler,action,{customer_id:CUSTOMER_ID,date_from:from,date_to:to,summary_only:true})
test('approved meter intervals, accounting receipts and FIFO allocation preserve every operational sale field',()=>{
 const before=fixture(),p=build(before),after=apply(before,p)
 assert.equal(p.summary.flows_created,11);assert.equal(p.summary.zero_flows,2);assert.equal(p.summary.gas_charges,289710);assert.equal(p.summary.actual_receipts,280000);assert.equal(p.summary.remaining_prepay,36361.68)
 assert.equal(p.run_id,build(before).run_id);assert.equal(p.plan_hash,build(before).plan_hash)
 const flows=after.crm_customer_flow_settlements.filter(r=>r.status==='posted'),allIds=flows.flatMap(r=>r.sale_ids)
 assert.equal(allIds.length,24);assert.equal(new Set(allIds).size,24)
 const allowed=['settlement_mode','amount_received','rounding_amount','receipt_rounding_amount','payment_method','payment_status','payment_note','updated_at','accounting_reconciliation']
 for(const s of before.crm_sale_records){const a=after.crm_sale_records.find(r=>r._id===s._id);for(const k of Object.keys(s).filter(k=>!allowed.includes(k)))assert.deepEqual(a[k],s[k]);assert.equal(a.payment_status,'paid');assert.equal(a.amount_received,0)}
 assert.ok(after.crm_customer_allocations.filter(r=>r._id.startsWith('old-')).every(r=>r.status==='void' && r.allocate_amount===0))
 assert.equal(after.crm_customers[0].is_active,true)
})
test('source additions, changed amounts and unsupported related vouchers cannot be rebuilt',()=>{
 for(const change of [t=>t.crm_sale_records.push({...t.crm_sale_records[0],_id:'added'}),t=>t.crm_sale_records[0].amount_received++,t=>t.crm_sale_records[0].date='2026-09-08',t=>t.crm_customers[0].is_active=false,t=>t.crm_vouchers.push({_id:'voucher'}),t=>t.crm_customer_receipts[0].status='void']){const t=fixture();change(t);assert.throws(()=>build(t))}
})
test('all three real handler entry points agree; opening credit is not cash in either year or cross-year query',async()=>{
 const t=apply(fixture(),build(fixture())),db=makeDb(t),handler=loadHandler('crm-customer-settlement',db)
 for(const [from,to,fees,cash,opening]of[['2026-01-01','2026-09-07',289710,280000,0],['2025-12-01','2026-09-07',289710,280000,46071.68],['2025-12-01','2025-12-31',0,0,46071.68]]){
  for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
   const r=await q(handler,action,from,to);assert.equal(r.code,0,r.msg);const p=r.data.period_summary
   assert.equal(p.complete,true,JSON.stringify(p.unresolved_sources));assert.equal(p.business_revenue,fees);assert.equal(p.cash_received,cash);assert.equal(p.opening_prepay_transferred,opening);assert.equal(p.refund_total,0)
   if(action==='exportCustomerStatementV1'){assert.equal(r.data.totals.receipt,cash);assert.equal(r.data.totals.opening_prepay,opening);assert.equal(r.data.closing_balance,fees-cash-46071.68)}
   if(action==='exportCustomerAccountingLedgerV1'){assert.equal(r.data.closing.balance,fees-cash-46071.68);if(opening)assert.ok(r.data.rows.some(row=>row.source_type==='opening_prepay' && /期初预付款/.test(row.summary)))}
  }
 }
 assert.equal(db.writes.length,0)
 const current=await q(handler,'getCustomerStatementV1');assert.equal(current.data.summary.receivable_balance,0);assert.equal(current.data.summary.prepay_balance,36361.68)
 assert.match(current.data.period_summary.source_notes[0].text,/2025-12-16至2026-01-12/)
 for(const [to,expected]of SPEC.checkpoints){for(const action of ['exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){const r=await q(handler,action,'2026-01-01',to);assert.equal(r.code,0,r.msg);assert.equal(action==='exportCustomerStatementV1'?r.data.closing_balance:r.data.closing.balance,-expected)}}
})
test('opening credit remains spendable through the existing prepay allocation endpoint and does not become cash',async()=>{
 const t=fixture();t.crm_sale_records=[];t.crm_customer_receipts=[{_id:'opening',customer_id:CUSTOMER_ID,source_type:'opening_prepay',entry_kind:'prepay',status:'posted',biz_date:'2025-12-16',amount:100,unallocated_amount:100,allocated_amount:0,payment_method:'unknown'}]
 t.crm_customer_flow_settlements=[{_id:'future',customer_id:CUSTOMER_ID,status:'posted',biz_date:'2026-09-09',should_receive:60,amount_received:0,payment_status:'unpaid'}];t.crm_customer_allocations=[]
 const db=mutableDb(t),handler=loadHandler('crm-customer-settlement',db)
 const r=await invoke(handler,'allocatePrepayReceiptV1',{customer_id:CUSTOMER_ID,receipt_id:'opening',amount:60,allocation_mode:'checked',allocation_targets:[{target_type:'flow_settlement',target_id:'future'}]})
 assert.equal(r.code,0,r.msg);assert.equal(t.crm_customer_receipts[0].unallocated_amount,40);assert.equal(t.crm_customer_receipts[0].source_type,'opening_prepay');assert.equal(t.crm_customer_flow_settlements[0].payment_status,'paid')
 const p=(await q(handler,'getCustomerStatementV1','2025-12-01','2026-09-09')).data.period_summary;assert.equal(p.complete,true,JSON.stringify(p.unresolved_sources));assert.equal(p.cash_received,0);assert.equal(p.refund_total,0)
 for(const action of ['updateReceiptV1','removeReceiptV1','beginReceiptAdjustmentV1']){const before=digest(t);const res=await invoke(handler,action,{customer_id:CUSTOMER_ID,receipt_id:'opening',amount:200});assert.equal(res.code,400,action);assert.equal(digest(t),before)}
})
test('scoped transaction rolls back full rehearsal, injected failure, rejects changed source and is idempotent',async()=>{
 const t=fixture(),db=mutableDb(t),handler=loadHandler('crm-haonuo-reconciliation',db)
 const inspect=await invoke(handler,'inspectV1',{customer_id:CUSTOMER_ID});assert.equal(inspect.code,0)
 const prepare=await invoke(handler,'prepareV1',{customer_id:CUSTOMER_ID,expected_snapshot_hash:inspect.data.snapshot_hash,evidence});assert.equal(prepare.code,0,prepare.msg)
 const args={customer_id:CUSTOMER_ID,run_id:prepare.data.run_id,plan_hash:prepare.data.plan_hash}
 assert.equal((await invoke(handler,'executeV1',args)).code,409)
 for(const fail_after_writes of [17,0]){const before=snapshot(t).snapshot_hash;const r=await invoke(handler,'rehearseV1',{...args,fail_after_writes});assert.equal(r.code,0,r.msg);assert.equal(r.data.snapshot_unchanged,true);assert.equal(snapshot(t).snapshot_hash,before)}
 t.crm_sale_records[0].updated_at=2;assert.equal((await invoke(handler,'executeV1',args)).code,409);t.crm_sale_records[0].updated_at=1
 assert.equal((await invoke(handler,'executeV1',args)).data.status,'committed');const committed=digest(t)
 assert.equal((await invoke(handler,'executeV1',args)).data.status,'committed');assert.equal(digest(t),committed)
 assert.equal((await invoke(handler,'inspectV1',{customer_id:'another'})).code,400)
})
test('transaction database failure and in-transaction source conflict leave original business data intact',async()=>{
 for(const mode of ['write','conflict']){
  const t=fixture();let count=0,armed=false
  const db=mutableDb(t,{txWrite:()=>{if(mode==='write' && ++count===12)throw Error('database failure')},start:tables=>{if(mode==='conflict' && armed)tables.crm_sale_records[0].updated_at=2}}),handler=loadHandler('crm-haonuo-reconciliation',db)
  const before=await invoke(handler,'inspectV1',{customer_id:CUSTOMER_ID}),p=await invoke(handler,'prepareV1',{customer_id:CUSTOMER_ID,expected_snapshot_hash:before.data.snapshot_hash,evidence});assert.equal(p.code,0,p.msg)
  armed=true;const r=await invoke(handler,'rehearseV1',{customer_id:CUSTOMER_ID,run_id:p.data.run_id,plan_hash:p.data.plan_hash});assert.equal(r.code,409)
  if(mode==='conflict')t.crm_sale_records[0].updated_at=1
  assert.equal(snapshot(t).snapshot_hash,before.data.snapshot_hash)
 }
})
