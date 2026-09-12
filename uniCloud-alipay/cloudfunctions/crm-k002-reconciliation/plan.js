'use strict'
const crypto = require('crypto')
const accounting = require('./saleAccountingLocal')
const { CUSTOMER_ID, CUSTOMER_NAME, VERSION, SPEC } = require('./spec')
const TABLES = ['crm_customers', 'crm_sale_records', 'crm_customer_receipts', 'crm_customer_allocations',
  'crm_customer_flow_settlements', 'crm_customer_opening_debts', 'crm_customer_receipt_adjustments']
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
function buildPlan(snapshot, evidence, actor, now) {
  assert(snapshot?.complete === true && snapshot.customer_id === CUSTOMER_ID, '快照客户或完整性不符')
  assert(snapshot.snapshot_hash === snapshotHash(snapshot.tables), '快照哈希不符')
  assert(evidence?.confirmed_by_user === true && evidence.customer_id === CUSTOMER_ID && evidence.source_snapshot_hash === snapshot.snapshot_hash, '用户确认或原值依据不符')
  assert(/^[a-f0-9]{64}$/.test(evidence.approval_sha256 || '') && /^[a-f0-9]{40}$/.test(evidence.source_commit || ''), '缺少确认材料或源码版本校验值')
  assert(actor?._id && Number.isSafeInteger(now) && now > 0, '缺少执行人或时间')
  const t = snapshot.tables, customer = t.crm_customers[0]
  assert(t.crm_customers.length === 1 && customer._id === CUSTOMER_ID && customer.name === CUSTOMER_NAME, '客户身份不符')
  for (const name of TABLES.slice(1)) assert(t[name].every(row => row.customer_id === CUSTOMER_ID), `存在跨客户数据：${name}`)
  assert(t.crm_customer_receipt_adjustments.every(row => row.status !== 'pending'), '存在进行中的收款调整')
  assert(t.crm_customer_flow_settlements.filter(active).length === 0, 'K002存在有效流量单，超出本批范围')
  const sales = SPEC.sales.map(([id, date, amount]) => {
    const row = t.crm_sale_records.find(item => item._id === id)
    assert(row && row.date === date && fix(accounting.computeSaleAmountsForDoc(row).amounts.should_receive) === amount && fix(row.amount_received) === (amount > 0 ? amount : 0) && fix(row.rounding_amount) === 0 && fix(row.receipt_rounding_amount) === 0 && row.price_unit === 'kg', `销售原值不符：${id}`)
    return row
  })
  assert(t.crm_sale_records.length === sales.length, '销售范围出现新增或遗漏')
  const offsetRows = t.crm_customer_receipts.filter(row => active(row) && fix(row.amount) === 1260 &&
    (String(row.source_type || '').startsWith('sale_offset_credit') || ['offset_credit','offset'].includes(String(row.entry_kind || '').toLowerCase())))
  assert(offsetRows.length === 1, '1260元退液冲抵来源不唯一')
  const offset = offsetRows[0]
  assert(t.crm_customer_receipts.length === 1 && offset.source_id === sales[2]._id && fix(offset.allocated_amount) === 1260 && fix(offset.unallocated_amount) === 0 && fix(offset.offset_cash_refunded_amount) === 0, '收款范围或冲抵来源已变化')
  const oldFees = t.crm_customer_opening_debts.filter(row => active(row) &&
    (row.entry_type === 'other_fee' || String(row.source_type || '').includes('other_fee')))
  assert(oldFees.length === 1 && fix(oldFees[0].amount) === 1260, '旧1260元其他费用不唯一或原值不符')
  const oldFee = oldFees[0]
  assert(t.crm_customer_opening_debts.length === 1 && fix(oldFee.amount_received) === 1260, '存在额外历史款或费用')
  assert(t.crm_customer_allocations.length === 1 && active(t.crm_customer_allocations[0]) && t.crm_customer_allocations[0].receipt_id === offset._id && rowTarget(t.crm_customer_allocations[0]) === oldFee._id && rowType(t.crm_customer_allocations[0]) === 'other_fee' && fix(t.crm_customer_allocations[0].allocate_amount) === 1260, '旧分配范围不符')
  const existingRefunds = t.crm_customer_receipts.filter(row => row.source_type === SPEC.refund.source_type)
  assert(existingRefunds.length === 0, '已存在冲抵现金退款，禁止重复生成')
  const runId = batchId(), stable = key => digest(`${runId}:${key}`).slice(0, 24)
  const base = { customer_id: CUSTOMER_ID, customer_name: CUSTOMER_NAME, source_type: 'k002_accountant_reconciliation',
    source_id: runId, request_id: runId, created_at: now, created_by: actor._id, created_by_name: actor.username || '' }
  const audit = { run_id: runId, rule_version: VERSION, source_snapshot_hash: snapshot.snapshot_hash }
  const writes = [], add = (table, key, row) => { const after = { ...base, _id: stable(key), ...row }; writes.push({ table, id: after._id, before: null, after }); return after }
  const update = (table, row, patch) => writes.push({ table, id: row._id, before: row, patch, after: { ...row, ...patch } })
  for (const row of t.crm_customer_allocations.filter(active)) update('crm_customer_allocations', row, {
    status: 'void', updated_at: now,
    accounting_reconciliation: { ...audit, previous_allocate_amount: row.allocate_amount },
    note: `${row.note || ''}\nK002核准批次退出旧分配，原值保留于完整快照；批次 ${runId}`
  })
  update('crm_customer_opening_debts', oldFee, { status: 'void', updated_at: now,
    accounting_reconciliation: { ...audit, previous_amount: oldFee.amount, previous_amount_received: oldFee.amount_received || 0 },
    note: `${oldFee.note || ''}\n旧1260元合并费用作废，改按900元和270元瓶租分别登记；批次 ${runId}` })
  const fees = SPEC.fees.map(([date, amount, note], index) => add('crm_customer_opening_debts', `fee:${index}`, {
    biz_date: date, debt_date: date, entry_type: 'other_fee', amount, should_receive: amount, amount_received: amount,
    payment_status: 'paid', source_type: 'customer_other_fee_reconciliation', status: 'posted', note: `${note}；依据K002核准；批次 ${runId}`,
    updated_at: now, accounting_reconciliation: audit
  }))
  const cash = SPEC.receipts.map(([biz_date, amount], i) => add('crm_customer_receipts', `cash:${i}`, {
    biz_date, amount, allocated_amount: amount, unallocated_amount: 0, rounding_amount: 0, rounding_allocated_amount: 0,
    payment_method: 'unknown', entry_kind: 'prepay', status: 'posted', updated_at: now,
    note: `用户确认的既有收款补充正式凭据，不增加销售已收；批次 ${runId}` }))
  const alloc = (key, receipt, targetType, target, amount, seq) => add('crm_customer_allocations', key, {
    receipt_id: receipt._id, sale_id: targetType === 'sale' ? target._id : '', sale_date: target.date || target.biz_date,
    target_type: targetType, target_id: target._id, opening_debt_id: targetType === 'other_fee' ? target._id : '',
    target_title: targetType === 'sale' ? `销售单 ${target.date}` : `其他费用 ${target.biz_date}`,
    biz_date: receipt.biz_date > (target.date || target.biz_date) ? receipt.biz_date : (target.date || target.biz_date),
    receipt_biz_date: receipt.biz_date, receipt_source_type: receipt.source_type || 'manual', receipt_entry_kind: receipt.entry_kind || 'prepay',
    allocate_kind: 'receipt', allocate_amount: amount, status: 'posted', seq, allocation_mode: 'checked',
    allocation_start_date: target.date || target.biz_date, allocation_end_date: receipt.biz_date,
    note: `K002会计依据核准分配；批次 ${runId}`, updated_at: now, accounting_reconciliation: audit
  })
  alloc('allocation:cash0:sale0', cash[0], 'sale', sales[0], 5540, 1)
  alloc('allocation:cash1:sale1', cash[1], 'sale', sales[1], 4130, 2)
  alloc('allocation:cash1:fee0', cash[1], 'other_fee', fees[0], 900, 3)
  alloc('allocation:offset:fee1', offset, 'other_fee', fees[1], 270, 4)
  update('crm_customer_receipts', offset, { allocated_amount: 270, unallocated_amount: 0, rounding_allocated_amount: 0,
    offset_cash_refunded_amount: 990, status: 'posted', updated_at: now, accounting_reconciliation: audit })
  const refund = add('crm_customer_receipts', 'refund:990', { amount: -990, allocated_amount: 0, unallocated_amount: 0,
    rounding_amount: 0, rounding_allocated_amount: 0, biz_date: '2026-02-02', payment_method: 'unknown', status: 'posted', entry_kind: 'refund',
    source_type: SPEC.refund.source_type, source_id: offset._id, offset_source_receipt_id: offset._id,
    offset_refund_operation_id: `${runId}:refund`, operation_version: 'offset-credit-cash-refund/2026-09-12.1',
    note: `退液冲抵1260元扣除瓶租270元后，正式退款990元；退款渠道待核；批次 ${runId}`, updated_at: now, accounting_reconciliation: audit
  })
  update('crm_customers', customer, { should_receive_total: 9580, amount_received_total: 9580, receivable_balance: 0,
    prepay_balance: 0, prepay_manual_balance: 0, receipt_unallocated_balance: 0, offset_credit_balance: 0, net_balance: 0,
    last_receipt_at: Date.parse('2026-01-22T00:00:00+08:00'), updated_at: now, accounting_reconciliation: audit })
  const plan = { run_id: runId, rule_version: VERSION, customer_id: CUSTOMER_ID, source_snapshot_hash: snapshot.snapshot_hash,
    evidence, summary: { sales_unchanged: 3, old_other_fee_voided: 1, old_allocations_voided: t.crm_customer_allocations.filter(active).length,
      fees_created: 2, allocations_created: 4, refund_receipt_id: refund._id, business_revenue: 9580, cash_received: 10570,
      refund_total: 990, net_cash_received: 9580, receivable_balance: 0, prepay_balance: 0 }, writes }
  plan.plan_hash = digest(plan); return plan
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
