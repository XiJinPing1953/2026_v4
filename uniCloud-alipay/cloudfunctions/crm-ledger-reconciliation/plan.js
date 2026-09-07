'use strict'
const crypto = require('crypto')
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
function scaled(value, digits) {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match) throw Error('无效十进制依据')
  const fraction = match[3] || ''
  if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) throw Error('依据精度超过许可范围')
  return BigInt(`${match[2]}${fraction.padEnd(digits, '0').slice(0, digits)}`) * (match[1] ? -1n : 1n)
}
const money = value => scaled(value, 3)
const num = value => Number(value) / 1000
const assert = (ok, message) => { if (!ok) throw Error(message) }
function buildPlan(snapshot, evidence, actor, now) {
  assert(snapshot.complete === true, '备份未完整')
  const tables = snapshot.tables
  const customer = tables.crm_customers[0]
  const id = customer._id
  assert(customer.is_active === false, '仅修正已停用客户')
  assert(evidence.customer_id === id && evidence.confirmed_by_user === true, '缺少客户确认依据')
  assert(Array.isArray(evidence.proof_sha256) && evidence.proof_sha256.length >= 3 && evidence.proof_sha256.every(x => /^[a-f0-9]{64}$/.test(x)), '缺少来源图片校验值')
  assert(tables.crm_customer_flow_settlements.length === 0 && tables.crm_customer_opening_debts.length === 0, '发现已有结算覆盖，禁止重复建账')
  assert(tables.crm_vouchers.length === 0, '已有凭证须单独核对')
  assert(tables.crm_sale_records.length === evidence.expected_sale_count, '销售数量发生变化')
  const runId = digest({ id, evidence }).slice(0, 24)
  const stableId = key => digest(`${runId}:${key}`).slice(0, 24)
  const base = { customer_id: id, customer_name: customer.name, request_id: runId,
    created_at: now, updated_at: now, created_by: actor._id, created_by_name: actor.username || '' }
  const writes = []
  const update = (table, row, patch) => writes.push({ table, id: row._id, before: row, after: { ...row, ...patch }, patch })
  const add = (table, key, row) => {
    const after = { ...base, _id: stableId(key), ...row }
    writes.push({ table, id: after._id, before: null, after }); return after
  }
  const unitPrice = scaled(evidence.unit_price, 4)
  assert(unitPrice > 0n && evidence.intervals.length > 0, '缺少流量期间')
  const patchedSales = tables.crm_sale_records.map(row => ({ ...row }))
  const sourceChanges = []
  for (const fix of evidence.meter_corrections) {
    const row = patchedSales.find(row => row._id === fix.sale_id)
    assert(row && row.price_unit === 'm3', '表数修正源单不匹配')
    const before = tables.crm_sale_records.find(source => source._id === row._id)
    assert(digest(before) === fix.expected_source_hash, '表数源单已变化')
    row.flow_index_prev = fix.flow_index_prev
    if (fix.flow_volume_m3 !== undefined) row.flow_volume_m3 = fix.flow_volume_m3
    assert(scaled(row.flow_index_curr, 4) - scaled(row.flow_index_prev, 4) === scaled(row.flow_volume_m3, 4), '表差与气量不一致')
    sourceChanges.push(row._id)
  }
  const sources = patchedSales.filter(row => row.settlement_mode !== 'customer_flow')
  assert(sources.length === evidence.expected_legacy_count, '历史分类范围已变化')
  assert(sources.every(row => row.price_unit === 'm3' && scaled(row.unit_price, 4) === unitPrice), '发现其他计价规则')
  const used = new Set(); const flows = []
  let totalVolume = 0n; let flowMoney = 0n
  for (const [index, period] of evidence.intervals.entries()) {
    const prev = scaled(period.reading_start, 4), curr = scaled(period.reading_end, 4)
    assert(curr > prev && (!index || prev === scaled(evidence.intervals[index - 1].reading_end, 4)), '流量区间不连续')
    const included = sources.filter(row => Number(row.flow_volume_m3) > 0 && scaled(row.flow_index_curr, 4) > prev && scaled(row.flow_index_curr, 4) <= curr)
    included.sort((a, b) => Number(a.flow_index_curr) - Number(b.flow_index_curr))
    let cursor = prev
    for (const row of included) {
      assert(!used.has(row._id), '源单重复覆盖')
      assert(scaled(row.flow_index_prev, 4) === cursor, '源单表数链存在空档或重叠')
      cursor = scaled(row.flow_index_curr, 4); used.add(row._id)
    }
    assert(cursor === curr, '期间缺少原始销售表数覆盖')
    const volume = curr - prev
    const amount = volume * unitPrice / 100000n // 4 + 4 decimals -> truncate money to 3.
    totalVolume += volume; flowMoney += amount
    const flow = add('crm_customer_flow_settlements', `flow-${index}`, {
      biz_date: period.end_date, period_start_date: period.start_date, period_end_date: period.end_date,
      previous_flow_settlement_id: flows.at(-1)?._id || null,
      flow_index_prev: Number(prev) / 10000, flow_index_curr: Number(curr) / 10000,
      flow_volume_m3: Number(volume) / 10000, flow_theory_ratio: null,
      theory_weight_kg: null, actual_weight_kg: null, loss_weight_kg: null,
      unit_price: Number(unitPrice) / 10000, should_receive: num(amount), amount_received: num(amount),
      receipt_rounding_amount: 0, payment_status: 'paid', status: 'posted', sale_ids: included.map(row => row._id),
      note: `依据用户确认的会计流量表修正；表数保留4位，金额按系统3位截断。原销售仅保留送气及表数，防止重复计费。核对批次 ${runId}`
    })
    flows.push(flow)
  }
  assert(sources.filter(row => Number(row.flow_volume_m3) > 0).length === used.size, '有计费源单未覆盖')
  const openingVolume = scaled(evidence.opening.reading_end, 4) - scaled(evidence.opening.reading_start, 4)
  assert(openingVolume > 0n && scaled(evidence.opening.reading_end, 4) === scaled(evidence.intervals[0].reading_start, 4), '历史期初与本期区间不连续')
  const openingAmount = openingVolume * unitPrice / 100000n
  const opening = add('crm_customer_opening_debts', 'opening', { biz_date: evidence.opening.end_date,
    amount: num(openingAmount), rounding_amount: 0, amount_received: num(openingAmount), receipt_rounding_amount: 0,
    outstanding: 0, payment_status: 'paid', status: 'posted', money_scale: 3,
    source_type: 'accountant_reconciliation_opening', source_id: runId,
    note: `系统启用前历史用气，${evidence.opening.start_date} 至 ${evidence.opening.end_date}，表数 ${evidence.opening.reading_start}→${evidence.opening.reading_end}，单价 ${evidence.unit_price}。原值 ${evidence.opening.exact_amount} 元，按3位截断登记，已由首笔会计收款结清；不计入本期营收。` })
  assert(evidence.receipts.length === 3 && evidence.receipts.every(row => money(row.amount) > 0n), '会计收款依据不完整')
  const receiptsTotal = evidence.receipts.reduce((sum, row) => sum + money(row.amount), 0n)
  const tail = receiptsTotal - openingAmount - flowMoney
  assert(tail >= 0n && tail <= 100n, '差额超出结算尾差范围')
  const adjustment = add('crm_customer_opening_debts', 'tail', { biz_date: evidence.receipts[0].date,
    amount: num(tail), rounding_amount: 0, amount_received: num(tail), receipt_rounding_amount: 0,
    outstanding: 0, payment_status: 'paid', status: 'posted', money_scale: 3,
    source_type: 'accountant_reconciliation_other_fee', source_id: runId,
    note: `会计结清尾差 ${num(tail)} 元：完整流量原值 ${evidence.full_meter_amount} 元，对比会计实收 ${num(receiptsTotal)} 元；含期初金额截断差。单独列示，不修改表数、单价或虚增用气量。` })
  const targets = { opening, tail: adjustment, ...Object.fromEntries(flows.map((row, i) => [`flow-${i}`, row])) }
  const allocated = new Map()
  for (const [index, receipt] of evidence.receipts.entries()) {
    assert(['bank', 'unknown'].includes(receipt.method), '收款渠道依据无效')
    const allocationTotal = receipt.allocations.reduce((sum, item) => sum + money(item.amount), 0n)
    assert(allocationTotal === money(receipt.amount), '收款分配不平')
    const row = add('crm_customer_receipts', `receipt-${index}`, { biz_date: receipt.date, amount: receipt.amount,
      rounding_amount: 0, allocated_amount: receipt.amount, unallocated_amount: 0, rounding_allocated_amount: 0,
      payment_method: receipt.method, status: 'posted', entry_kind: 'prepay', source_type: 'accountant_reconciliation', source_id: runId,
      allocation_mode: 'checked', allocation_start_date: evidence.opening.end_date,
      allocation_end_date: evidence.intervals.at(-1).end_date,
      allocation_targets: receipt.allocations.map(item => ({ target_type: item.target === 'opening' ? 'opening_debt' : item.target === 'tail' ? 'other_fee' : 'flow_settlement', target_id: targets[item.target]._id })),
      note: `会计凭证 ${receipt.voucher}，实际收款日 ${receipt.date}；${receipt.method === 'unknown' ? '会计截图未注明收款渠道，渠道待核' : receipt.method_note}。替代原系统集中补记及销售内嵌已收，避免重复计款。核对批次 ${runId}` })
    receipt.allocations.forEach((item, seq) => {
      const target = targets[item.target]; assert(target, '分配对象不存在')
      const type = item.target === 'opening' ? 'opening_debt' : item.target === 'tail' ? 'other_fee' : 'flow_settlement'
      allocated.set(target._id, (allocated.get(target._id) || 0n) + money(item.amount))
      add('crm_customer_allocations', `allocation-${index}-${seq}`, { receipt_id: row._id, sale_id: '', sale_date: target.biz_date,
        flow_settlement_id: type === 'flow_settlement' ? target._id : null,
        target_type: type, target_id: target._id, target_title: `${type === 'flow_settlement' ? '流量结算' : type === 'opening_debt' ? '历史欠款' : '会计结清尾差'} ${target.biz_date}`,
        biz_date: receipt.date, allocate_kind: 'receipt', allocate_amount: item.amount, seq: seq + 1,
        note: row.note, source_type: 'accountant_reconciliation', source_id: runId,
        allocation_mode: 'checked', allocation_start_date: row.allocation_start_date, allocation_end_date: row.allocation_end_date,
        allocation_targets: row.allocation_targets })
    })
  }
  for (const target of Object.values(targets)) assert(allocated.get(target._id) === money(target.should_receive ?? target.amount), '应收未全额匹配会计收款')
  for (const row of sources) {
    const before = tables.crm_sale_records.find(source => source._id === row._id)
    const covered = flows.find(flow => flow.sale_ids.includes(row._id))
    const patch = { settlement_mode: 'customer_flow', amount_received: 0, payment_status: 'unpaid', rounding_amount: 0,
      payment_method: '', payment_note: `已核对会计收款并转入客户流量结算，原已收 ${before.amount_received || 0} 元保留于修正备份；不是退款。核对批次 ${runId}`,
      flow_index_prev: row.flow_index_prev, flow_volume_m3: row.flow_volume_m3, updated_at: now,
      accounting_reconciliation: { run_id: runId, source_hash: digest(before), flow_settlement_id: covered?._id || null,
        previous_settlement_mode: before.settlement_mode || null, previous_amount_received: before.amount_received || 0,
        confirmed_at: now, evidence_hash: digest(evidence) } }
    update('crm_sale_records', before, patch)
  }
  assert(tables.crm_customer_receipts.length === 1 && tables.crm_customer_receipts[0]._id === evidence.superseded_receipt_id, '待替代收款范围变化')
  const prior = tables.crm_customer_receipts[0]
  update('crm_customer_receipts', prior, { status: 'void', allocated_amount: 0, unallocated_amount: 0, updated_at: now,
    note: `${prior.note || ''}\n会计核对作废：本记录为集中补记，已替代为实际三笔收款；不新增退款。核对批次 ${runId}` })
  for (const row of tables.crm_customer_allocations) {
    assert(row.receipt_id === prior._id, '存在其他收款分配，禁止覆盖')
    update('crm_customer_allocations', row, { allocate_amount: 0, note: `${row.note || ''}\n旧分配已撤销；原金额 ${row.allocate_amount}，备份批次 ${runId}`, status: 'void', updated_at: now })
  }
  update('crm_customers', customer, { should_receive_total: num(flowMoney + tail), amount_received_total: num(receiptsTotal - openingAmount),
    receivable_balance: 0, prepay_balance: 0, net_balance: 0, offset_credit_balance: 0, prepay_manual_balance: 0,
    receipt_unallocated_balance: 0, last_receipt_at: Date.parse(`${evidence.receipts.at(-1).date}T00:00:00+08:00`), updated_at: now })
  const summary = { sales_retained: patchedSales.length, sales_reclassified: sources.length, meter_corrections: sourceChanges.length,
    new_flow_settlements: flows.length, volume_m3: Number(totalVolume) / 10000, meter_receivable: num(flowMoney),
    opening_amount: num(openingAmount), tail_adjustment: num(tail), receipts_total: num(receiptsTotal),
    business_receivable: num(flowMoney + tail), ending_balance: 0, write_count: writes.length }
  return { run_id: runId, plan_hash: digest({ writes, evidence }), writes, summary, evidence }
}
module.exports = { buildPlan, digest, canonical, scaled }
