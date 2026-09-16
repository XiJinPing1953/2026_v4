'use strict'
const { digest } = require('./snapshot')
const { computeSaleAmountsForDoc } = require('./saleAccountingLocal')
const VERSION = 'accounting-correction/2026-09-13.1'
const assert = (ok, message) => { if (!ok) throw Error(message) }
const active = row => !row.status || row.status === 'posted'
const target = row => row.target_id || row.sale_id
const fen = value => {
  const n = Number(value ?? 0), cents = Math.round(n * 100)
  assert(value !== '' && typeof value !== 'boolean' && Number.isFinite(n) && Number.isSafeInteger(cents) && Math.abs(n * 100 - cents) < 0.00001, '仅支持明确的两位金额')
  return cents
}
const date = value => {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value, '业务日期无效')
  return value
}
function snapshotHash(tables) {
  return digest(Object.fromEntries(Object.entries(tables).map(([name, rows]) => {
    assert(Array.isArray(rows) && rows.every(r => r._id) && new Set(rows.map(r => r._id)).size === rows.length, '原值编号缺失或重复')
    return [name, [...rows].sort((a, b) => a._id.localeCompare(b._id))]
  })))
}
function batchId(customerId, operationId) {
  assert(/^[a-f0-9]{24}$/.test(customerId || '') && /^[a-zA-Z0-9_-]{8,80}$/.test(operationId || ''), '客户或固定批次号无效')
  return digest({ customerId, operationId }).slice(0, 24)
}
function buildPlan(before, request, actor, now) {
  const t = before.tables, customerId = request.customer_id, evidence = request.evidence
  assert(before.complete === true && before.customer_id === customerId && before.snapshot_hash === snapshotHash(t), '原值不完整或客户不符')
  assert(request.expected_snapshot_hash === before.snapshot_hash, '备份后原值变化')
  assert(evidence?.confirmed_by_user === true && /^[a-f0-9]{64}$/.test(evidence.approval_sha256 || '') && /^[a-f0-9]{40}$/.test(evidence.source_commit || ''), '缺少业务确认及源码依据')
  assert(actor?._id && Number.isSafeInteger(now) && now > 0, '执行人或时间无效')
  const customer = t.crm_customers[0]
  assert(t.crm_customers.length === 1 && customer._id === customerId && customer.default_price_unit !== 'm3', '本版仅支持独立两位金额客户')
  for (const [table, rows] of Object.entries(t)) if (!['crm_customers', 'crm_vouchers'].includes(table)) assert(rows.every(r => r.customer_id === customerId), '跨客户原值')
  assert(!t.crm_customer_receipt_adjustments.some(r => r.status === 'pending'), '存在未完成的收款调整')
  assert(Array.isArray(request.corrections) && request.corrections.length > 0 && request.corrections.length <= 20, '修正范围无效')
  const runId = batchId(customerId, request.operation_id), writes = [], touched = new Set(), receiptSet = new Set()
  const audit = { run_id: runId, rule_version: VERSION, source_snapshot_hash: before.snapshot_hash, approval_sha256: evidence.approval_sha256 }
  const patch = (table, row, changes) => {
    const key = table + '/' + row._id
    assert(!touched.has(key), '同批重复修正原单')
    assert(!row.updated_at || now > Number(row.updated_at), '修正时间早于源版本')
    touched.add(key)
    const update = { ...changes, updated_at: now, accounting_reconciliation: audit }
    writes.push({ table, id: row._id, before: row, patch: update, after: { ...row, ...update } })
  }
  const add = (key, fields) => {
    const id = digest(runId + ':' + key).slice(0, 24)
    assert(!t.crm_customer_allocations.some(a => a._id === id) && !touched.has('crm_customer_allocations/' + id), '分配编号已存在')
    touched.add('crm_customer_allocations/' + id)
    const after = { _id: id, customer_id: customerId, customer_name: customer.name, created_at: now, updated_at: now,
      created_by: actor._id, created_by_name: actor.username || '', request_id: runId, status: 'posted', accounting_reconciliation: audit, ...fields }
    writes.push({ table: 'crm_customer_allocations', id, before: null, after })
  }
  const allocations = t.crm_customer_allocations.filter(active)
  const cashReceipt = receipt => {
    assert(receipt && receipt.customer_id === customerId && receipt.status === 'posted' && fen(receipt.amount) > 0, '原收款无效')
    assert(['customer_statement', 'cashier_intake', 'legacy_received_confirmation', 'manual'].includes(receipt.source_type) && receipt.entry_kind === 'prepay', '不支持期初、冲抵、退款或押金来源')
    assert(!receiptSet.has(receipt._id), '同批重复收款')
    receiptSet.add(receipt._id)
    const own = allocations.filter(a => a.receipt_id === receipt._id)
    assert(own.every(a => ['receipt', 'rounding'].includes(a.allocate_kind || 'receipt')), '未知分配类型')
    const sum = kind => own.filter(a => (a.allocate_kind || 'receipt') === kind).reduce((s, a) => s + fen(a.allocate_amount), 0)
    assert(sum('receipt') === fen(receipt.allocated_amount) && sum('rounding') === fen(receipt.rounding_allocated_amount), '收款与分配原值不守恒')
    assert(fen(receipt.amount) === fen(receipt.allocated_amount) + fen(receipt.unallocated_amount), '收款可用余额不守恒')
    return own
  }
  let cashAdded = 0, roundingMoved = 0
  for (const change of request.corrections) {
    assert(['complete_receipt_backing', 'correct_receipt_date'].includes(change.type), '不支持的修正类型')
    const receipt = t.crm_customer_receipts.find(r => r._id === change.receipt_id), own = cashReceipt(receipt)
    const newDate = date(change.biz_date)
    if (change.type === 'correct_receipt_date') {
      assert(newDate !== receipt.biz_date, '收款日期未变化')
      patch('crm_customer_receipts', receipt, { biz_date: newDate })
      for (const a of own) {
        // A later manual allocation may have its own registered date. Do not silently move that date.
        const inherited = a.biz_date === receipt.biz_date || a.biz_date === (receipt.biz_date > a.sale_date ? receipt.biz_date : a.sale_date)
        assert(inherited, '分配有独立业务日期，需另行核实')
        date(a.sale_date)
        patch('crm_customer_allocations', a, { receipt_biz_date: newDate, biz_date: newDate > a.sale_date ? newDate : a.sale_date })
      }
      continue
    }
    assert(receipt.biz_date === newDate && fen(receipt.unallocated_amount) === 0, '补齐必须沿用已确认原收款日期且原款已分完')
    assert(receipt.allocation_mode === 'checked', '本版补齐仅支持已明确目标的原收款')
    assert(Array.isArray(change.targets) && change.targets.length > 0 && change.targets.length <= 50, '缺少补齐目标')
    let cash = 0, rounding = 0
    const targets = [...(receipt.allocation_targets || [])]
    for (const item of change.targets) {
      const sale = t.crm_sale_records.find(r => r._id === item.sale_id)
      assert(sale && active(sale) && sale.price_unit !== 'm3' && sale.settlement_mode !== 'customer_flow', '仅支持普通销售旧实收')
      const cashFen = fen(item.cash_amount), roundFen = fen(item.move_sale_rounding || 0)
      assert(cashFen > 0 && roundFen >= 0, '补齐金额须为正数')
      date(sale.date)
      const related = allocations.filter(a => target(a) === sale._id)
      assert(related.every(a => t.crm_customer_receipts.some(r => r._id === a.receipt_id && r.status === 'posted')), '销售分配缺少有效来源')
      const backed = related.filter(a => (a.allocate_kind || 'receipt') === 'receipt').reduce((s, a) => s + fen(a.allocate_amount), 0)
      assert(backed + cashFen === fen(sale.amount_received), '补齐不能增加源单已收或重复已有分配')
      assert(fen(sale.rounding_amount) >= roundFen, '迁移抹零超过源单原值')
      const salePatch = roundFen ? { rounding_amount: (fen(sale.rounding_amount) - roundFen) / 100,
        receipt_rounding_amount: (fen(sale.receipt_rounding_amount) + roundFen) / 100 } : {}
      const oldCalc = computeSaleAmountsForDoc(sale).amounts, newCalc = computeSaleAmountsForDoc({ ...sale, ...salePatch }).amounts
      assert(fen(oldCalc.should_receive) > 0 && fen(oldCalc.should_receive) === fen(newCalc.should_receive), '销售原价变化')
      assert(fen(oldCalc.effective_should_receive) - fen(sale.amount_received) - fen(sale.receipt_rounding_amount) === fen(newCalc.effective_should_receive) - fen(sale.amount_received) - fen(salePatch.receipt_rounding_amount ?? sale.receipt_rounding_amount), '抹零迁移改变欠款')
      patch('crm_sale_records', sale, salePatch)
      const common = { receipt_id: receipt._id, target_type: 'sale', target_id: sale._id, sale_id: sale._id, sale_date: sale.date,
        receipt_biz_date: newDate, biz_date: newDate > sale.date ? newDate : sale.date,
        source_type: 'legacy_received_confirmation', source_id: runId, receipt_source_type: receipt.source_type,
        receipt_entry_kind: receipt.entry_kind, allocation_mode: 'checked', note: '按已确认同笔收款补齐依据，不增加销售已收' }
      add(receipt._id + ':' + sale._id + ':receipt', { ...common, allocate_kind: 'receipt', allocate_amount: cashFen / 100 })
      if (roundFen) add(receipt._id + ':' + sale._id + ':rounding', { ...common, allocate_kind: 'rounding', allocate_amount: roundFen / 100 })
      if (!targets.some(a => a.target_type === 'sale' && a.target_id === sale._id)) targets.push({ target_type: 'sale', target_id: sale._id })
      cash += cashFen; rounding += roundFen
    }
    assert(fen(change.confirmed_total_amount) === fen(receipt.amount) + cash, '确认的同笔总额与补齐目标不一致')
    patch('crm_customer_receipts', receipt, { amount: (fen(receipt.amount) + cash) / 100,
      allocated_amount: (fen(receipt.allocated_amount) + cash) / 100,
      rounding_amount: (fen(receipt.rounding_amount) + rounding) / 100,
      rounding_allocated_amount: (fen(receipt.rounding_allocated_amount) + rounding) / 100, allocation_targets: targets })
    cashAdded += cash; roundingMoved += rounding
  }
  patch('crm_customers', customer, {})
  const plan = { run_id: runId, customer_id: customerId, rule_version: VERSION, source_snapshot_hash: before.snapshot_hash,
    request_hash: digest(request), evidence, summary: { existing_receipts_changed: receiptSet.size, cash_backing_completed: cashAdded / 100,
      sale_rounding_reclassified: roundingMoved / 100, new_receipts: 0, writes: writes.length }, writes }
  plan.plan_hash = digest(plan)
  return plan
}
function expectedAfter(before, plan) {
  const tables = structuredClone(before.tables)
  for (const w of plan.writes) {
    const i = tables[w.table].findIndex(r => r._id === w.id)
    if (w.before) { assert(i >= 0 && digest(tables[w.table][i]) === digest(w.before), '计划原值不符'); tables[w.table][i] = structuredClone(w.after) }
    else { assert(i < 0, '编号已存在'); tables[w.table].push(structuredClone(w.after)) }
  }
  return snapshotHash(tables)
}
module.exports = { buildPlan, expectedAfter, digest, snapshotHash, batchId, VERSION }
