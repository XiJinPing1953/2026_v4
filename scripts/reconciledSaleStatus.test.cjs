'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { buildSaleStatusPlan } = require('../uniCloud-alipay/cloudfunctions/crm-ledger-reconciliation/saleStatusPlan')
const { digest } = require('../uniCloud-alipay/cloudfunctions/crm-ledger-reconciliation/plan')
function fixture() {
  const linked = { _id:'linked', customer_id:'c', settlement_mode:'customer_flow', payment_status:'unpaid', amount_received:0,
    flow_volume_m3:1, out_items:[{bottle_no:'KEEP'}], accounting_reconciliation:{flow_settlement_id:'flow'} }
  const zero = {...linked,_id:'zero',flow_volume_m3:0,accounting_reconciliation:{flow_settlement_id:null}}
  const flow = {_id:'flow',customer_id:'c',status:'posted',payment_status:'paid',should_receive:1.123,amount_received:1.123,sale_ids:['linked']}
  const tables = {crm_customers:[{_id:'c',updated_at:2}],crm_sale_records:[linked,zero],crm_customer_flow_settlements:[flow],crm_customer_receipts:[{_id:'receipt',amount:1.123}]}
  const snapshot = {complete:true,customer_id:'c',tables,snapshot_hash:digest(tables)}
  const parent = {status:'committed',customer_id:'c',request_id:'a'.repeat(24),detail:{before:{tables:structuredClone(tables)},plan:{
    plan_hash:'original',summary:{sales_reclassified:2},writes:[linked,zero].map(row=>({table:'crm_sale_records',id:row._id,before:{...row,settlement_mode:''},after:structuredClone(row)}))}}}
  return {snapshot,parent}
}
const build = f => buildSaleStatusPlan(f.snapshot,f.parent,{_id:'admin'},10)
test('status follow-up preserves amounts and delivery facts, with a backup for each source',()=>{
 const f=fixture(),before=structuredClone(f),p=build(f)
 assert.deepEqual(f,before)
 assert.deepEqual(p.summary,{write_count:2,linked_flow_paid:1,zero_receivable:1,financial_amounts_changed:false})
 for(const w of p.writes){assert.equal(w.after.payment_status,'paid');assert.deepEqual(Object.keys(w.patch).sort(),['payment_note','payment_status','settlement_status_correction','updated_at']);for(const [k,v] of Object.entries(w.before)){if(!Object.hasOwn(w.patch,k))assert.deepEqual(w.after[k],v)}}
 assert.equal(p.plan_hash,build(f).plan_hash)
})
test('changed sources and uncommitted reconciliation cannot generate a status plan',()=>{
 for(const change of [f=>{f.snapshot.complete=false},f=>{f.parent.status='prepared'},f=>{f.snapshot.tables.crm_sale_records[0].amount_received=1},f=>{f.snapshot.tables.crm_customer_receipts.push({_id:'extra',amount:1})}]){const f=fixture();change(f);assert.throws(()=>build(f))}
 const f=fixture();f.snapshot.tables.crm_customers[0].updated_at=99;assert.equal(build(f).writes.length,2)
})
test('a flow must actually be settled and linked; a zero source must not hide usage',()=>{
 for(const change of [f=>{f.snapshot.tables.crm_customer_flow_settlements[0].payment_status='unpaid'},f=>{f.snapshot.tables.crm_customer_flow_settlements[0].amount_received=.5},f=>{f.snapshot.tables.crm_customer_flow_settlements[0].sale_ids=[]},f=>{f.snapshot.tables.crm_sale_records[1].flow_volume_m3=1}]){
  const f=fixture();change(f)
  f.parent.detail.before.tables=structuredClone(f.snapshot.tables)
  f.parent.detail.plan.writes.forEach(w=>{w.after=structuredClone(f.snapshot.tables.crm_sale_records.find(r=>r._id===w.id))})
  assert.throws(()=>build(f))
 }
})
