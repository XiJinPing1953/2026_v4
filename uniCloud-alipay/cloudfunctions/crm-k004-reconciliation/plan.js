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
 const runId=batchId(), stable=key=>digest(`${runId}:${key}`).slice(0,24),writes=[]
 const audit={run_id:runId,rule_version:VERSION,source_snapshot_hash:snapshot.snapshot_hash}
 const base={customer_id:CUSTOMER_ID,customer_name:CUSTOMER_NAME,source_type:'k004_accountant_reconciliation',source_id:runId,request_id:runId,created_at:now,created_by:actor._id,created_by_name:actor.username||'',updated_at:now,accounting_reconciliation:audit,status:'posted'}
 const add=(table,key,row)=>{const after={...base,_id:stable(key),...row}; if(table==='crm_customer_opening_debts')delete after.accounting_reconciliation; writes.push({table,id:after._id,before:null,after});return after}
 const update=(table,row,patch)=>{patch={...patch,updated_at:now,accounting_reconciliation:audit};writes.push({table,id:row._id,before:row,patch,after:{...row,...patch}})}
 const aggregate=t.crm_customer_receipts.find(r=>r._id===SPEC.aggregate_id)
 update('crm_customer_receipts',aggregate,{status:'void',allocated_amount:0,unallocated_amount:0,note:`历史归并款退出现金；原值见批次 ${runId}`})
 const allocations=[]
 for(const a of t.crm_customer_allocations) {
  if(a.receipt_id===aggregate._id && active(a))update('crm_customer_allocations',a,{status:'void'})
  else if(active(a)) {
   const correction=SPEC.retain_receipts.find(r=>r.receipt_id===a.receipt_id&&r.old_date!==r.target_date)
   if(correction){const patch={receipt_biz_date:correction.target_date,biz_date:correction.target_date>a.sale_date?correction.target_date:a.sale_date};update('crm_customer_allocations',a,patch);allocations.push({...a,...patch})}else allocations.push(a)
  }
 }
 for(const r of SPEC.retain_receipts)if(r.old_date!==r.target_date)update('crm_customer_receipts',t.crm_customer_receipts.find(x=>x._id===r.receipt_id),{biz_date:r.target_date})
 const receipt=(key,date,amount_fen,extra={})=>add('crm_customer_receipts',key,{biz_date:date,amount:amount_fen/100,allocated_amount:amount_fen/100,unallocated_amount:0,rounding_amount:0,rounding_allocated_amount:0,payment_method:'unknown',entry_kind:'prepay',...extra})
 const adjustment=add('crm_customer_opening_debts','balance_adjustment',{biz_date:'2026-05-12',source_type:'balance_adjustment',amount:21,amount_received:21,outstanding:0,payment_status:'paid',note:'会计核准增加应收21元，由04-05多付余额抵扣，不计收入或现金'})
 const alloc=(receipt,targetId,amount_fen)=>{
  const target=targetId==='balance_adjustment'?adjustment:t.crm_sale_records.find(s=>s._id===targetId);assert(target,'分配目标不存在')
  const type=targetId==='balance_adjustment'?'balance_adjustment':'sale',date=target.date||target.biz_date
  const a=add('crm_customer_allocations',`allocation:${receipt._id}:${target._id}`,{receipt_id:receipt._id,target_type:type,target_id:target._id,sale_id:type==='sale'?target._id:'',opening_debt_id:type==='balance_adjustment'?target._id:'',sale_date:date,biz_date:receipt.biz_date>date?receipt.biz_date:date,receipt_biz_date:receipt.biz_date,receipt_source_type:receipt.source_type,receipt_entry_kind:receipt.entry_kind,allocate_kind:'receipt',allocate_amount:amount_fen/100,allocation_mode:'checked',seq:allocations.length+1});allocations.push(a)
 }
 const opening=receipt('opening','2026-01-01',107100,{entry_kind:'opening_prepay',source_type:'opening_prepay',note:'用户确认期初预收1071元，非本期现金'})
 alloc(opening,SPEC.opening_target_id,107100)
 const offset=receipt('offset:1127','2026-02-12',112700,{entry_kind:'offset_credit',source_type:'sale_offset_credit',source_id:SPEC.offset_sale_id,offset_cash_refunded_amount:0,note:'退气1127元转非现金冲抵，不退款'})
 alloc(offset,SPEC.offset_target_id,112700)
 for(const r of SPEC.receipts){const cash=receipt(`cash:${r.row}`,r.date,r.amount_fen,{accounting_voucher:r.voucher,note:`会计凭证 ${r.voucher} 第${r.row}行核准真实收款`});for(const [id,amount]of r.targets)alloc(cash,id,amount)}
 for(const sale of t.crm_sale_records){
  const aa=allocations.filter(a=>rowTarget(a)===sale._id),cash=aa.filter(a=>a.allocate_kind!=='rounding').reduce((s,a)=>s+fen(a.allocate_amount),0),rounding=aa.filter(a=>a.allocate_kind==='rounding').reduce((s,a)=>s+fen(a.allocate_amount),0)
  const expected=fen(sale.amount_received)+(sale._id===SPEC.offset_sale_id?112700:0)
  assert(cash===expected,`销售分配与已收不等价：${sale._id} ${cash}/${expected}`)
  assert(rounding===fen(sale.receipt_rounding_amount),`销售抹零不等价：${sale._id}`)
  update('crm_sale_records',sale,{amount_received:cash/100,receipt_allocated_amount:cash/100,receipt_rounding_amount:rounding/100})
 }
 const receipts=[...t.crm_customer_receipts.filter(r=>active(r)&&r._id!==aggregate._id),...writes.filter(w=>w.table==='crm_customer_receipts'&&!w.before).map(w=>w.after)]
 for(const r of receipts)for(const kind of ['receipt','rounding']){const sum=allocations.filter(a=>a.receipt_id===r._id&&(a.allocate_kind||'receipt')===kind).reduce((s,a)=>s+fen(a.allocate_amount),0);assert(sum===fen(kind==='receipt'?r.amount:r.rounding_amount),`收款供需不平：${r._id}/${kind}`)}
 const cash=receipts.filter(r=>!['offset_credit','opening_prepay'].includes(r.entry_kind));assert(cash.length===39&&cash.reduce((s,r)=>s+fen(r.amount),0)===16890300,'现金控制数不符')
 const revenue=SPEC.sales.reduce((s,r)=>s+r[2],0),rounding=allocations.filter(a=>a.allocate_kind==='rounding').reduce((s,a)=>s+fen(a.allocate_amount),0)
 assert(revenue+2100-16890300-107100-rounding===745500,'最终余额不符')
 assert(SPEC.sales.filter(s=>s[1]<='2026-09-06').reduce((n,s)=>n+s[2],0)+2100-16890300-107100-rounding===276000,'同截止余额不符')
 update('crm_customers',t.crm_customers[0],{should_receive_total:revenue/100,amount_received_total:168903,receivable_balance:7455,net_balance:7455,prepay_balance:0,prepay_manual_balance:0,receipt_unallocated_balance:0,offset_credit_balance:0})
 const plan={run_id:runId,rule_version:VERSION,customer_id:CUSTOMER_ID,source_snapshot_hash:snapshot.snapshot_hash,evidence,summary:{sales_facts_unchanged:110,cash_receipts:39,cash_received:168903,opening_prepay:1071,offset_credit_created:1127,balance_adjustment:21,receivable_balance:7455,cutoff_balance:2760,prepay_balance:0,allocations_created:writes.filter(w=>w.table==='crm_customer_allocations'&&!w.before).length},writes};plan.plan_hash=digest(plan);return plan
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
