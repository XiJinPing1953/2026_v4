'use strict'
const crypto = require('crypto')
const { CUSTOMER_ID, VERSION, SPEC } = require('./spec')
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const assert = (ok, message) => { if (!ok) throw Error(message) }
const scaled = (value, digits) => {
  const m = String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/)
  assert(m && !(m[3] || '').slice(digits).match(/[1-9]/), '无效的精确数值依据')
  return BigInt(m[2] + (m[3] || '').padEnd(digits,'0').slice(0,digits)) * (m[1] ? -1n : 1n)
}
const cents = value => scaled(value, 2)
const number = value => Number(value) / 100
const sum = rows => rows.reduce((total, n) => total + cents(n || 0), 0n)
function buildPlan(snapshot, evidence, actor, now) {
  assert(snapshot.complete === true && snapshot.snapshot_hash === digest(snapshot.tables), '备份不完整或哈希不符')
  assert(evidence?.customer_id === CUSTOMER_ID && evidence.confirmed_by_user === true && evidence.spec_hash === digest(SPEC), '缺少已确认方案或版本不符')
  assert(Array.isArray(evidence.proof_sha256) && evidence.proof_sha256.length === 3 && new Set(evidence.proof_sha256).size === 3 && evidence.proof_sha256.every(v => /^[a-f0-9]{64}$/.test(v)), '缺少三项原始证据校验值')
  assert(/^[a-f0-9]{40}$/.test(evidence.source_commit || ''), '缺少发布源码版本')
  const t = snapshot.tables, customer = t.crm_customers?.[0]
  assert(customer?._id === CUSTOMER_ID && customer.name === '浩诺' && customer.is_active === true, '客户范围或启用状态变化')
  const sales = t.crm_sale_records, existingFinal=t.crm_customer_flow_settlements.find(r=>r._id===SPEC.reuse_final_flow_id)
  assert(existingFinal?.status==='posted' && existingFinal.biz_date==='2026-09-07' && existingFinal.flow_index_prev===613882.9 && existingFinal.flow_index_curr===614935.1 && existingFinal.flow_volume_m3===1052.2 && existingFinal.should_receive===5261 && existingFinal.unit_price===5 && Number(existingFinal.amount_received || 0)===0 && Number(existingFinal.receipt_rounding_amount || 0)===0, '已补9月7日流量单与确认表数不符，停止执行')
  const oldFlows=t.crm_customer_flow_settlements.filter(r=>r._id!==SPEC.reuse_final_flow_id)
  const oldReceipts=t.crm_customer_receipts.filter(r=>r.status==='posted'),oldAllocations=t.crm_customer_allocations
  assert(t.crm_customer_receipts.every(r=>['posted','void'].includes(r.status)), '收款状态未知，停止执行')
  assert(sales.length === SPEC.expected.sales && oldFlows.length === SPEC.expected.old_flows && oldReceipts.length === SPEC.expected.old_receipts && oldAllocations.length === SPEC.expected.old_allocations, '源单数量已变化，停止执行')
  assert(Object.entries(t).every(([name, rows]) => ['crm_customers','crm_vouchers'].includes(name) || rows.every(row => row.customer_id === CUSTOMER_ID)), '存在范围外记录')
  for (const name of ['crm_vouchers','crm_customer_opening_debts','crm_customer_receipt_adjustments','crm_collection_tasks','crm_collection_followups']) assert((t[name] || []).length === 0, `发现须额外核对的关联记录：${name}`)
  assert(oldFlows.every(row => row.status === 'posted') && oldReceipts.every(row => row.status === 'posted'), '旧单状态已变化')
  assert(sum(oldFlows.map(row => row.should_receive)) === cents(SPEC.expected.old_flow_charges), '旧流量金额与核对基线不符')
  assert(sum(sales.map(row => row.amount_received)) === cents(SPEC.expected.embedded_sale_received), '原销售内嵌已收变化')
  assert(sales.every(row => row.price_unit === 'm3' && Number(row.unit_price) === SPEC.unit_price), '存在其他销售计价规则')
  assert(oldAllocations.every(row => (!row.status || row.status === 'posted') && oldReceipts.some(r => r._id === row.receipt_id)), '旧分配范围或状态变化')
  const runId = digest({ customer_id:CUSTOMER_ID, version:VERSION }).slice(0,24)
  const stableId = key => digest(`${runId}:${key}`).slice(0,24)
  const writes = [], sourceHash = snapshot.snapshot_hash, evidenceHash = digest(evidence)
  const base = {customer_id:CUSTOMER_ID,customer_name:customer.name,request_id:runId,created_at:now,updated_at:now,created_by:actor._id,created_by_name:actor.username || ''}
  const audit = {run_id:runId,source_hash:sourceHash,evidence_hash:evidenceHash,confirmed_at:now,rule_version:VERSION}
  const add = (table,key,fields) => { const after = {...base,_id:stableId(key),...fields};writes.push({table,id:after._id,before:null,after});return after }
  const update = (table,before,patch) => writes.push({table,id:before._id,before,patch,after:{...before,...patch}})
  const flows=[],assigned=new Set();let previousDate=SPEC.opening_date,previousReading=SPEC.opening_reading
  for (const [i,[date,reading,volume,amount]] of SPEC.periods.entries()) {
    assert(date > previousDate && scaled(reading,1)-scaled(previousReading,1) === scaled(volume,1), '表数链或日期不连续')
    assert(scaled(volume,1) * BigInt(SPEC.unit_price) * 10n === cents(amount), '表差气款不一致')
    const covered = sales.filter(row => row.date > previousDate && row.date <= date).sort((a,b) => a.date.localeCompare(b.date) || a._id.localeCompare(b._id))
    for (const sale of covered) { assert(!assigned.has(sale._id), '销售重复关联');assigned.add(sale._id) }
    const note = `依据用户表数表、预付余额表和会计收款表重建；抄表区间 (${previousDate}, ${date}]，单价5元/m³。${i === 0 ? '本笔包含2025-12-16至2026-01-12跨年用气，按结算日期计营收，未虚构年末表数。' : ''}${covered.length ? '' : '本区间没有送气源单，以确认表数建单，不补造销售。'}核对批次 ${runId}`
    const fields = {biz_date:date,period_start_date:previousDate,period_end_date:date,
      previous_flow_settlement_id:flows.at(-1)?._id || null,flow_index_prev:previousReading,flow_index_curr:reading,flow_volume_m3:volume,
      flow_theory_ratio:null,theory_weight_kg:null,actual_weight_kg:null,loss_weight_kg:null,unit_price:SPEC.unit_price,
      should_receive:amount,amount_received:amount,receipt_rounding_amount:0,payment_status:'paid',status:'posted',sale_ids:covered.map(r=>r._id),note,
      accounting_reconciliation:audit}
    let row
    if(date===existingFinal.biz_date){
      const patch={...fields,updated_at:now,note:`${fields.note} 保留已有9月7日单据编号；区间按9月5日零表数重新衔接，不沿用原大区间重量。`}
      row={...existingFinal,...patch};update('crm_customer_flow_settlements',existingFinal,patch)
    } else row=add('crm_customer_flow_settlements',`flow-${date}`,fields)
    flows.push(row);previousDate=date;previousReading=reading
  }
  assert(assigned.size===sales.length,'存在重建区间外销售，不可覆盖新增业务')
  const credits=[]
  credits.push(add('crm_customer_receipts','opening-prepay',{biz_date:SPEC.opening_date,amount:SPEC.opening_prepay,
    rounding_amount:0,allocated_amount:0,unallocated_amount:SPEC.opening_prepay,rounding_allocated_amount:0,
    payment_method:'unknown',entry_kind:'prepay',source_type:'opening_prepay',source_id:runId,status:'posted',
    allocation_mode:'checked',allocation_start_date:SPEC.opening_date,allocation_end_date:SPEC.periods.at(-1)[0],allocation_targets:[],
    note:`期初预付款转入 ${SPEC.opening_prepay} 元，基准表底${SPEC.opening_reading}（${SPEC.opening_date}）。由用户确认预付余额表反推并逐行验算；不代表当日新收款，不计收入、退款或非现金冲抵。核对批次 ${runId}`,
    accounting_reconciliation:audit}))
  for (const [i,[date,amount,method,voucher,note]] of SPEC.receipts.entries()) credits.push(add('crm_customer_receipts',`receipt-${i}`,{
    biz_date:date,amount,rounding_amount:0,allocated_amount:0,unallocated_amount:amount,rounding_allocated_amount:0,payment_method:method,
    entry_kind:'prepay',source_type:'accountant_reconciliation',source_id:runId,status:'posted',allocation_mode:'checked',
    allocation_start_date:SPEC.opening_date,allocation_end_date:SPEC.periods.at(-1)[0],allocation_targets:[],
    note:`会计凭证${voucher}，实际收款日期${date}。${note}；替代旧系统合并登记及内嵌已收，不重复收款，不产生退款。核对批次 ${runId}`,accounting_reconciliation:audit
  }))
  const remaining = new Map(credits.map(row => [row._id,cents(row.amount)]));const newAllocations=[]
  // FIFO credit supply and chronological gas demand. Allocation effective date is never before either event.
  for (const flow of flows) {
    let needed = cents(flow.should_receive)
    for (const credit of credits) {
      const available=remaining.get(credit._id);const amount=available < needed ? available : needed
      if (amount<=0n) continue
      remaining.set(credit._id,available-amount);needed-=amount
      credit.allocation_targets.push({target_type:'flow_settlement',target_id:flow._id})
      newAllocations.push(add('crm_customer_allocations',`allocation-${credit._id}-${flow._id}`,{
        receipt_id:credit._id,sale_id:'',sale_date:flow.biz_date,flow_settlement_id:flow._id,target_type:'flow_settlement',target_id:flow._id,
        target_title:`流量结算 ${flow.biz_date}`,biz_date:credit.biz_date>flow.biz_date?credit.biz_date:flow.biz_date,receipt_biz_date:credit.biz_date,
        receipt_source_type:credit.source_type,receipt_entry_kind:'prepay',allocate_kind:'receipt',allocate_amount:number(amount),status:'posted',seq:newAllocations.length+1,
        source_type:'accountant_reconciliation',source_id:runId,allocation_mode:'checked',allocation_start_date:SPEC.opening_date,allocation_end_date:flow.biz_date,
        note:`${credit.source_type==='opening_prepay'?'期初预付款抵扣':'已确认收款抵扣'}；收款统计仅依据来源日期，分配不另算收款。核对批次 ${runId}`
      }))
    }
    assert(needed===0n,'预付及收款不足以结清全部流量单')
  }
  for(const credit of credits){credit.unallocated_amount=number(remaining.get(credit._id));credit.allocated_amount=number(cents(credit.amount)-remaining.get(credit._id))}
  assert(sum(flows.map(r=>r.should_receive))===cents(SPEC.expected.gas_charges),'新流量气款总额不符')
  assert(sum(credits.slice(1).map(r=>r.amount))===cents(SPEC.expected.actual_receipts),'真实收款合计不符')
  assert(sum(credits.map(r=>r.unallocated_amount))===cents(SPEC.expected.remaining_prepay),'余额不符')
  const checkpoints=SPEC.checkpoints.map(([date,expected])=>{
    const balance=cents(SPEC.opening_prepay)+sum(credits.slice(1).filter(r=>r.biz_date<=date).map(r=>r.amount))-sum(flows.filter(r=>r.biz_date<=date).map(r=>r.should_receive))
    assert(balance===cents(expected),'历史余额验算不符');return {date,balance:number(balance)}
  })
  for(const row of oldFlows) update('crm_customer_flow_settlements',row,{status:'void',updated_at:now,accounting_reconciliation:audit,
    note:`${row.note || ''}\n会计依据重建作废；原表底、关联及金额完整保留。核对批次 ${runId}`})
  for(const row of oldReceipts) update('crm_customer_receipts',row,{status:'void',allocated_amount:0,unallocated_amount:0,rounding_allocated_amount:0,updated_at:now,accounting_reconciliation:audit,
    note:`${row.note || ''}\n作废旧合并/错期收款，由四笔会计收款替代；原值在批次备份，不生成退款。核对批次 ${runId}`})
  for(const row of oldAllocations) update('crm_customer_allocations',row,{status:'void',allocate_amount:0,updated_at:now,accounting_reconciliation:{...audit,previous_allocate_amount:row.allocate_amount},
    note:`${row.note || ''}\n重建作废原分配；有效金额置零兼容旧读取，原值保留于审计和完整备份。核对批次 ${runId}`})
  for(const row of sales){
    const flow=flows.find(f=>f.sale_ids.includes(row._id));assert(flow && flow.payment_status==='paid','销售未关联结清流量单')
    update('crm_sale_records',row,{settlement_mode:'customer_flow',amount_received:0,rounding_amount:0,receipt_rounding_amount:0,payment_method:'',payment_status:'paid',updated_at:now,
      payment_note:`气款由${flow.biz_date}流量结算单计费并已结清；销售不重复应收，原内嵌已收${row.amount_received || 0}元退出有效计算，原值保留于审计，不属于退款。核对批次 ${runId}`,
      accounting_reconciliation:{...audit,source_hash:digest(row),flow_settlement_id:flow._id,previous_settlement_mode:row.settlement_mode || null,previous_amount_received:row.amount_received || 0}})
  }
  update('crm_customers',customer,{should_receive_total:SPEC.expected.gas_charges,amount_received_total:SPEC.expected.actual_receipts,receivable_balance:0,
    prepay_balance:SPEC.expected.remaining_prepay,prepay_manual_balance:0,receipt_unallocated_balance:SPEC.expected.remaining_prepay,offset_credit_balance:0,net_balance:-SPEC.expected.remaining_prepay,
    last_receipt_at:Date.parse(SPEC.receipts.at(-1)[0]+'T00:00:00+08:00'),updated_at:now,accounting_reconciliation:audit})
  const summary={write_count:writes.length,sales_retained:sales.length,old_flows_voided:oldFlows.length,flows_created:flows.length-1,flows_reused:1,effective_flows:flows.length,zero_flows:flows.filter(r=>r.should_receive===0).length,
    receipts_created:4,opening_prepay:SPEC.opening_prepay,actual_receipts:SPEC.expected.actual_receipts,gas_charges:SPEC.expected.gas_charges,unpaid_gas:0,remaining_prepay:SPEC.expected.remaining_prepay,
    allocations_created:newAllocations.length,checkpoints,customer_remains_active:true}
  const plan={run_id:runId,rule_version:VERSION,source_snapshot_hash:sourceHash,evidence,summary,writes}
  plan.plan_hash=digest(plan);return plan
}
module.exports={buildPlan,digest,SPEC,CUSTOMER_ID,VERSION}
