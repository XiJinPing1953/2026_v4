'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { auditSnapshot, summarize, collect,permissionInventory } = require('./auditOffsetCreditReliability.cjs')
const sale = (id, amount, received=0, flag=true) => ({_id:id,customer_id:'c',date:'2026-10-30',biz_mode:'bottle',price_unit:'kg',settlement_mode:'sale',unit_price:1,out_items:[],back_items:[{net:-amount}],amount_received:received,offset_enabled:flag})
const credit = (id, source, amount, allocated=0, refunded=0) => ({_id:id,customer_id:'c',biz_date:'2026-10-30',status:'posted',source_type:'sale_offset_credit',entry_kind:'offset_credit',source_id:source,amount,allocated_amount:allocated,unallocated_amount:amount-allocated-refunded,offset_cash_refunded_amount:refunded})
const fixture = () => ({customer_id:'c',complete:true,tables:{crm_customers:[{_id:'c',name:'合成客户'}],crm_sale_records:[],crm_customer_receipts:[],crm_customer_allocations:[],crm_customer_flow_settlements:[],crm_customer_opening_debts:[]}})
test('read-only audit distinguishes disabled historical intent, missing credit, partial refund and valid available credit',()=>{
  const s=fixture()
  s.tables.crm_sale_records=[sale('pending',-24),sale('disabled',-24,0,false),sale('eighty-eight',-88),sale('partial',-24,-10),sale('refunded',-88)]
  s.tables.crm_customer_receipts=[credit('c88','eighty-eight',88),credit('c14','partial',14),credit('cr','refunded',88,0,88),
    {_id:'refund-proof',customer_id:'c',status:'posted',source_type:'customer_cash_refund',refund_source_status:'linked',amount:-88,refund_sources:[{id:'cr',amount:88}]}]
  const before=structuredClone(s),r=auditSnapshot(s)
  assert.deepEqual(s,before)
  assert.equal(r.issues.filter(x=>x.kind==='sale_credit_shortfall').length,1)
  assert.equal(r.issues.find(x=>x.record_id==='pending').amount,24)
  assert.equal(r.issues.find(x=>x.record_id==='disabled').confirmation_required,false)
  assert.equal(r.issues.find(x=>x.record_id==='disabled').classification,'旧规则保留')
  assert.equal(r.issues.length,3)
  assert.equal(r.issues.find(row=>row.kind==='legacy_embedded_refund_unverified').record_id,'partial')
  assert.equal(r.negative_sales.find(x=>x.id==='eighty-eight').available,88)
  assert.equal(r.negative_sales.find(x=>x.id==='refunded').refunded_from_pool,88)
})
test('multiple legitimate source rows are compared by totals, not marked duplicates merely by count',()=>{
  const s=fixture();s.tables.crm_sale_records=[sale('s',-88)]
  s.tables.crm_customer_receipts=[credit('a','s',50),credit('b','s',38)]
  assert.equal(auditSnapshot(s).issues.length,0)
  s.tables.crm_customer_receipts.push(credit('extra','s',10))
  assert.equal(auditSnapshot(s).issues.find(x=>x.kind==='sale_credit_excess').amount,10)
})
test('positive embedded surplus is evidence to review, while an obsolete source is checked separately',()=>{
  const s=fixture(),positive=(id,received,flag)=>({...sale(id,-1,received,flag),out_items:[{net:100}],back_items:[]})
  s.tables.crm_sale_records=[{...positive('extra-fee',130),remark:'含运费30元'},positive('edited-source',100),positive('disabled-positive',130,false)]
  s.tables.crm_customer_receipts=[credit('old-credit','edited-source',20)]
  const r=auditSnapshot(s)
  assert.equal(r.negative_sales.length,0)
  assert.equal(r.positive_credit_review.length,2)
  assert(r.issues.some(row=>row.kind==='positive_sale_credit_mismatch'&&row.amount===20))
  const evidence=r.issues.find(row=>row.kind==='positive_sale_embedded_surplus')
  assert(evidence.detail.includes('含运费30元'))
  assert(evidence.suggestion.includes('不把内嵌超收差额直接补入池'))
  assert(!r.issues.some(row=>row.kind==='sale_credit_shortfall'))
})
test('source conservation, allocation links and refund pending are distinct issues',()=>{
  const s=fixture();s.tables.crm_sale_records=[sale('s',-88),{...sale('target',-1),out_items:[{net:100}],back_items:[]}]
  s.tables.crm_customer_receipts=[{...credit('a','s',88,50),unallocated_amount:88},{_id:'refund',customer_id:'c',status:'posted',source_type:'customer_cash_refund',refund_source_status:'pending',amount:-20}]
  s.tables.crm_customer_allocations=[{_id:'allocation',customer_id:'c',receipt_id:'a',target_id:'target',allocate_amount:30}]
  const r=auditSnapshot(s)
  assert(r.issues.some(x=>x.kind==='offset_components_mismatch'))
  assert(r.issues.some(x=>x.kind==='offset_allocation_sum_mismatch'))
  assert(r.issues.some(x=>x.kind==='refund_source_pending'))
})
test('same operation duplicates and refund totals need independent backing',()=>{
  const s=fixture();s.tables.crm_sale_records=[sale('s',-88),{...sale('target',-1),out_items:[{net:100}],back_items:[]}]
  s.tables.crm_customer_receipts=[credit('a','s',88,20,30)]
  s.tables.crm_customer_allocations=['one','two'].map(id=>({_id:id,customer_id:'c',receipt_id:'a',target_id:'target',allocate_amount:10,request_id:'same-request',seq:1}))
  const kinds=auditSnapshot(s).issues.map(x=>x.kind)
  assert(kinds.includes('offset_duplicate_operation'));assert(kinds.includes('offset_refund_sum_mismatch'))
})
test('target aggregate bounds are checked where offset and cash allocations share a target',()=>{
  const s=fixture();s.tables.crm_sale_records=[sale('source',-88),{...sale('target',-1),out_items:[{net:100}],back_items:[]}]
  s.tables.crm_customer_receipts=[credit('offset','source',88,60),{_id:'cash',customer_id:'c',status:'posted',source_type:'customer_receipt',amount:50,allocated_amount:50,unallocated_amount:0}]
  s.tables.crm_customer_allocations=[{_id:'a',customer_id:'c',receipt_id:'offset',target_id:'target',allocate_amount:60},{_id:'b',customer_id:'c',receipt_id:'cash',target_id:'target',allocate_amount:50}]
  const r=auditSnapshot(s)
  assert.equal(r.issues.find(row=>row.kind==='offset_target_overallocated').amount,10)
})
test('unresolved settlement and orphan records never silently become clean zeroes',()=>{
  const s=fixture();s.tables.crm_sale_records=[{...sale('unknown',-24),price_unit:'m3',settlement_mode:''}]
  s.tables.crm_customer_receipts=[credit('orphan','missing',12)]
  s.tables.crm_customer_allocations=[{_id:'a',customer_id:'c',receipt_id:'missing-source',target_id:'unknown',allocate_amount:1}]
  const kinds=auditSnapshot(s).issues.map(x=>x.kind)
  assert(kinds.includes('sale_classification_unresolved'))
  assert(kinds.includes('offset_sale_missing'))
  assert(kinds.includes('allocation_source_missing'))
})
test('missing sale facts are unresolved while signed legacy weighing values retain their established calculation',()=>{
  const s=fixture();s.tables.crm_sale_records=[{...sale('missing-price',-24),unit_price:null},{...sale('missing-weight',-24),back_items:[{net:null}]},{...sale('signed-weight',-24),out_items:[{net:-2}],back_items:[{net:22}]}]
  const r=auditSnapshot(s)
  assert.equal(r.issues.filter(row=>row.kind==='sale_basis_unresolved').length,2)
  assert.equal(r.negative_sales[0].effective_should_receive,-24)
})
test('incomplete collection and unstable customers make overall report incomplete',()=>{
  const s=fixture();s.complete=false
  assert.throws(()=>auditSnapshot(s),/未声明完整/)
  const r=summarize({customers:[{_id:'c',name:'客户'}],snapshots:{c:{stable:false,error:'本版不支持合并结算客户'}},evidence:{customer_inventory_stable:true}})
  assert.equal(r.complete,false);assert.equal(r.customers_audited,0);assert.equal(r.failures.length,1)
})
test('refund array references are checked across complete available customer scopes',()=>{
  const left=fixture();left.tables.crm_sale_records=[sale('s',-24)];left.tables.crm_customer_receipts=[credit('credit','s',24)]
  const right=fixture();right.customer_id='d';right.tables.crm_customers=[{_id:'d',name:'其他客户'}]
  right.tables.crm_customer_receipts=[{_id:'refund',customer_id:'d',status:'posted',source_type:'customer_cash_refund',refund_source_status:'linked',amount:-10,refund_sources:[{id:'credit',amount:10}]}]
  const r=summarize({customers:[{_id:'c',name:'合成客户'},{_id:'d',name:'其他客户'}],snapshots:{c:{stable:true,snapshot:left},d:{stable:true,snapshot:right}},evidence:{customer_inventory_stable:true}})
  assert(r.issues.some(row=>row.kind==='cross_customer_refund_link'&&row.amount===10))
})
test('collection never calls accounting mutation actions; refuses duplicate customer pages',async()=>{
  const calls=[],client={callFunction:async(name,event)=>{calls.push([name,event.action]);return{code:0,total:2,data:[{_id:'same'},{_id:'same'}],paging:{hasMore:false}}}}
  await assert.rejects(collect({client,token:'test',spaceId:'fixture',out:'/not-used',requestId:()=>''}),/存在重复/)
  assert.deepEqual(calls,[['crm-customer','listV1']])
})
test('permission inventory resolves templates and retains only whitelisted nonsecret fields',async()=>{
  const client={callFunction:async(name,event)=>{assert.equal(name,'crm-user');assert.equal(event.action,'listManageV1');return{code:0,data:[{username:'fixture',role:'user',token:'secret-token',password_hash:'secret-hash',phone:'private-phone'}]}}}
  const r=await permissionInventory({client,token:'test',spaceId:'fixture',requestId:()=>''})
  assert.equal(r.rows[0].sale_create,true)
  assert.equal(r.complete,false)
  assert(!JSON.stringify(r).includes('secret-token'));assert(!JSON.stringify(r).includes('secret-hash'));assert(!JSON.stringify(r).includes('private-phone'))
})
