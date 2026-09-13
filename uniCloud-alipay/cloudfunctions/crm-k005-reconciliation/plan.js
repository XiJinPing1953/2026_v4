'use strict'
const crypto = require('crypto')
const { CUSTOMER_ID, CUSTOMER_NAME, VERSION, SPEC } = require('./spec')
const TABLES = Object.keys(SPEC.counts)
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const assert = (ok, message) => { if (!ok) throw Error(message) }
const fix = value => Number(Number(value || 0).toFixed(2))
const active = row => !row.status || row.status === 'posted'
function snapshotHash(tables) {
  return digest(Object.fromEntries(TABLES.map(name => {
    assert(Array.isArray(tables[name]), `原始集合缺失：${name}`)
    const rows = [...tables[name]].sort((a, b) => String(a._id).localeCompare(String(b._id)))
    assert(rows.every(row => row._id) && new Set(rows.map(row => row._id)).size === rows.length, `编号缺失或重复：${name}`)
    return [name, rows]
  })))
}
const batchId = () => digest({ customer_id: CUSTOMER_ID, correction_key: SPEC.correction_key }).slice(0, 24)
const rowTarget = row => row.target_id || row.sale_id || row.flow_settlement_id || row.opening_debt_id || ''
const rowType = row => row.target_type || (row.flow_settlement_id ? 'flow_settlement' : row.sale_id ? 'sale' : 'opening_debt')
const fen = value => { const n = Math.round(Number(value || 0) * 100); assert(Number.isSafeInteger(n), '非法金额'); return n }
function buildPlan(snapshot, evidence, actor, now) {
 assert(snapshot?.complete === true && snapshot.customer_id === CUSTOMER_ID, '快照客户或完整性不符')
 assert(snapshot.snapshot_hash === snapshotHash(snapshot.tables) && snapshot.snapshot_hash === SPEC.source_snapshot_hash, '快照原值哈希不符')
 assert(evidence?.confirmed_by_user === true && evidence.customer_id === CUSTOMER_ID && evidence.source_snapshot_hash === snapshot.snapshot_hash, '用户确认或原值依据不符')
 assert(/^[a-f0-9]{64}$/.test(evidence.approval_sha256 || '') && /^[a-f0-9]{40}$/.test(evidence.source_commit || ''), '缺少确认材料或源码版本校验值')
 assert(actor?._id && Number.isSafeInteger(now) && now > 0, '缺少执行人或时间')
 const t=snapshot.tables
 for(const table of TABLES) { assert(t[table].length===SPEC.counts[table], '集合数量不符：'+table); if(table!=='crm_customers')assert(t[table].every(r=>r.customer_id===CUSTOMER_ID),'跨客户数据') }
 assert(t.crm_customers[0]._id===CUSTOMER_ID && t.crm_customers[0].name===CUSTOMER_NAME,'客户身份不符')
 assert(!t.crm_customer_receipt_adjustments.some(r=>r.status==='pending'),'存在待处理收款调整')
 const runId=batchId(), stable=key=>digest(`${runId}:${key}`).slice(0,24),writes=[]
 const audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:snapshot.snapshot_hash}
 const base={customer_id:CUSTOMER_ID,customer_name:CUSTOMER_NAME,source_type:'legacy_received_confirmation',source_id:runId,request_id:runId,created_at:now,created_by:actor._id,created_by_name:actor.username||'',updated_at:now,accounting_reconciliation:audit,status:'posted'}
 const add=(table,key,row)=>{const after={...base,_id:stable(key),...row};assert(!t[table].some(r=>r._id===after._id),'确定编号已存在');writes.push({table,id:after._id,before:null,after});return after}
 const update=(table,row,patch)=>{assert(row,'更新原值不存在');assert(!row.updated_at||now>row.updated_at,'版本时间必须晚于原值');patch={...patch,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch,after:{...row,...patch}})}
 const corrected=t.crm_customer_receipts.find(r=>r._id===SPEC.date_correction.receipt_id)
 assert(corrected.biz_date===SPEC.date_correction.old_date && fen(corrected.amount)===85000,'850元原收款不符')
 update('crm_customer_receipts',corrected,{biz_date:SPEC.date_correction.target_date})
 for(const a of t.crm_customer_allocations.filter(a=>a.receipt_id===corrected._id&&active(a))){
  const date=SPEC.date_correction.target_date
  update('crm_customer_allocations',a,{receipt_biz_date:date,biz_date:date>a.sale_date?date:a.sale_date})
 }
 const oldAllocations=t.crm_customer_allocations.filter(active), newAllocations=[]
 assert(t.crm_customer_receipts.every(r=>['posted','void'].includes(r.status)), '未确认的收款状态')
 for(const a of oldAllocations){assert(['receipt','rounding'].includes(a.allocate_kind||'receipt'),'未知分配类型');assert(t.crm_customer_receipts.some(r=>r._id===a.receipt_id&&active(r)),'有效分配缺少有效收款')}
 // The existing 20 offset is the transfer of the 04-08 overpayment, not new cash.
 // Back all 2050 to that source sale; its old offset already backs the next sale.

 for(const item of SPEC.receipts){
  const cash=add('crm_customer_receipts',`cash:${item.date}:${item.voucher}`,{biz_date:item.date,amount:item.amount_fen/100,allocated_amount:item.amount_fen/100,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,payment_method:'unknown',entry_kind:'prepay',allocation_mode:'checked',accounting_voucher:item.voucher,note:`会计凭证${item.voucher}核准既有历史现金；补充关联，不增加源单已收。`})
  assert(item.targets.reduce((sum,r)=>sum+r[1],0)===item.amount_fen,'现金分配不守恒')
  for(const [id,amount] of item.targets){
   const sale=t.crm_sale_records.find(s=>s._id===id);assert(sale,'分配销售不存在')
   newAllocations.push(add('crm_customer_allocations',`allocation:${cash._id}:${id}`,{receipt_id:cash._id,target_type:'sale',target_id:id,sale_id:id,sale_date:sale.date,biz_date:cash.biz_date>sale.date?cash.biz_date:sale.date,receipt_biz_date:cash.biz_date,receipt_source_type:cash.source_type,receipt_entry_kind:cash.entry_kind,allocate_kind:'receipt',allocate_amount:amount/100,allocation_mode:'checked',seq:newAllocations.length+1}))
  }
 }
 for(const saleId of new Set(newAllocations.map(a=>a.sale_id))){
  const sale=t.crm_sale_records.find(s=>s._id===saleId)
  const backing=[...oldAllocations,...newAllocations].filter(a=>rowTarget(a)===saleId&&(a.allocate_kind||'receipt')==='receipt').reduce((s,a)=>s+fen(a.allocate_amount),0)
  assert(backing===fen(sale.amount_received),`销售背书与原已收不等价：${saleId} ${backing}/${fen(sale.amount_received)}`)
  update('crm_sale_records',sale,{})
 }
 const cashRows=[...t.crm_customer_receipts.filter(r=>active(r)&&!['offset_credit','opening_prepay'].includes(r.entry_kind)&&!['sale_offset_credit','opening_prepay'].includes(r.source_type)),...writes.filter(w=>w.table==='crm_customer_receipts'&&!w.before).map(w=>w.after)]
 assert(cashRows.reduce((sum,r)=>sum+fen(r.amount),0)===4753500,'现金控制数不符')
 assert(SPEC.receipts.reduce((sum,r)=>sum+r.amount_fen,0)===2737000,'历史现金控制数不符')
 update('crm_customers',t.crm_customers[0],{})
 const plan={run_id:runId,rule_version:VERSION,customer_id:CUSTOMER_ID,source_snapshot_hash:snapshot.snapshot_hash,evidence,summary:{sales_facts_unchanged:37,cash_receipts_created:21,cash_backing_created:27370,cash_received:47535,revenue:46415.5,rounding_total:196.5,receivable_balance:0,prepay_balance:0,allocations_created:newAllocations.length,receipt_dates_corrected:1},writes};plan.plan_hash=digest(plan);return plan
}
function expectedAfter(before, plan) {
  const tables = structuredClone(before.tables)
  for (const write of plan.writes) {
    const rows = tables[write.table], index = rows.findIndex(row => row._id === write.id)
    if (write.before) { assert(index >= 0 && digest(rows[index]) === digest(write.before), `计划原值不符：${write.table}/${write.id}`); rows[index] = structuredClone(write.after) }
    else { assert(index < 0, `确定编号已存在：${write.id}`); rows.push(structuredClone(write.after)) }
  }
  return snapshotHash(tables)
}
module.exports = { TABLES, digest, snapshotHash, batchId, buildPlan, expectedAfter, SPEC, CUSTOMER_ID, VERSION, rowTarget, rowType }
