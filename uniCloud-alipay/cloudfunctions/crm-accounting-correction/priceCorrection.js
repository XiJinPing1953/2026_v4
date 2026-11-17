'use strict'
// Bounded kg bottle repricing. Preserve cash and allocations; only an entirely
// unused negative-sale credit and simple unposted source vouchers can follow.
const { snapshot, digest } = require('./snapshot')
const { snapshotHash, batchId } = require('./plan')
const { readComplete } = require('./financialReadLocal')
const { computeSaleAmountsForDoc } = require('./saleAccountingLocal')
const { executePrepared } = require('./transaction')
const VERSION = 'accounting-sale-price/2026-11-17.1'
const first = r => Array.isArray(r?.data) ? r.data[0] : r?.data
const assert = (v, m) => { if (!v) throw Error(m) }
const active = r => !r.status || r.status === 'posted'
const cents = v => { const n = Number(v); assert(v != null && v !== '' && typeof v !== 'boolean' && Number.isSafeInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, '金额精度或原值无效'); return Math.round(n * 100) }
async function priceSnapshot(db, id) {
  const s = await snapshot(db, id), t = s.tables
  const read = (table, where) => readComplete(db.collection(table), where, { command: db.command, source: 'price.' + table, maxRows: 10000 })
  for (const table of ['crm_voucher_entries', 'crm_web_sale_operations', 'crm_mobile_sale_operations', 'crm_periods']) t[table] = []
  const union = async (table, field, ids) => {
    const found = new Map()
    for (let i = 0; i < ids.length; i += 40) for (const row of await read(table, { [field]: db.command.in(ids.slice(i, i + 40)) })) found.set(row._id, row)
    t[table] = [...found.values()]
  }
  await union('crm_voucher_entries', 'voucher_id', t.crm_vouchers.map(r => r._id))
  await union('crm_web_sale_operations', '_id', t.crm_sale_records.map(r => r.web_save_operation_key).filter(Boolean))
  await union('crm_mobile_sale_operations', '_id', t.crm_sale_records.map(r => r.mobile_create_operation_key).filter(Boolean))
  try { await union('crm_periods', 'period', [...new Set(t.crm_sale_records.map(r => r.date.slice(0, 7)))]) }
  catch (error) { if (String(error.message).trim() !== 'not found collection') throw error; s.absent_collections.push('crm_periods') }
  const receiptIds = new Set(t.crm_customer_receipts.map(r => r._id)), saleIds = new Set(t.crm_sale_records.map(r => r._id))
  const refunds = await read('crm_customer_receipts', { source_type: 'customer_cash_refund' })
  assert(!refunds.some(r => r.customer_id !== id && (r.refund_sources || []).some(x => receiptIds.has(x.id))), '存在跨户退款关联')
  const adjustments = await read('crm_customer_opening_debts', { source_type: 'balance_adjustment' })
  assert(!adjustments.some(r => r.customer_id !== id && (receiptIds.has(r.adjustment_source?.receipt_id) || saleIds.has(r.adjustment_source?.target_id))), '存在跨户调整关联')
  for (const rows of Object.values(t)) rows.sort((a, b) => a._id.localeCompare(b._id))
  s.snapshot_hash = snapshotHash(t); s.counts = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.length])); s.read_completed_at = Date.now()
  return s
}
function buildPricePlan(before, request, actor, now) {
  const t = before.tables, id = request.customer_id, e = request.evidence, customer = t.crm_customers[0]
  assert(before.complete && before.customer_id === id && before.snapshot_hash === snapshotHash(t) && request.expected_snapshot_hash === before.snapshot_hash, '备份原值已变化或不完整')
  assert(e?.confirmed_by_user === true && /^[a-f0-9]{64}$/.test(e.approval_sha256 || '') && /^[a-f0-9]{64}$/.test(e.source_sha256 || ''), '缺少用户确认或源码依据')
  assert(actor?._id && Number.isSafeInteger(now) && now > 0, '执行人或时间无效')
  assert(customer._id === id && customer.default_price_unit === 'kg' && !customer.is_hidden && customer.is_active !== false && !customer.settlement_customer_id, '仅支持在用独立kg客户')
  assert(cents(customer.default_unit_price) === cents(request.expected_default_unit_price), '默认价格原值不符')
  const price = cents(request.unit_price); assert(price > 0 && price <= 100000, '单价无效')
  assert(Array.isArray(request.sales) && request.sales.length > 0 && request.sales.length <= 20 && new Set(request.sales.map(r => r.sale_id)).size === request.sales.length, '销售范围重复或无效')
  assert(!t.crm_customer_receipt_adjustments.some(r => r.status === 'pending') && !t.crm_customer_receipts.some(r => r.receipt_adjustment_status === 'pending'), '存在未完成收款调整')
  const runId = batchId(id, request.operation_id), writes = [], seen = new Set()
  const audit = { run_id: runId, rule_version: VERSION, source_snapshot_hash: before.snapshot_hash, approval_sha256: e.approval_sha256 }
  const patch = (table, row, values) => {
    assert(!seen.has(table + '/' + row._id) && (!row.updated_at || now > row.updated_at), '重复原单或时间版本冲突'); seen.add(table + '/' + row._id)
    const changes = { ...values, updated_at: now, accounting_reconciliation: audit }
    writes.push({ table, id: row._id, before: row, patch: changes, after: { ...row, ...changes } })
  }
  const allocations = t.crm_customer_allocations.filter(active), summary = []
  let debtDelta = 0, creditDelta = 0, revenueDelta = 0
  for (const item of request.sales) {
    const sale = t.crm_sale_records.find(r => r._id === item.sale_id)
    assert(sale && active(sale) && sale.customer_id === id && sale.date === item.date && sale.date >= '2026-08-01' && sale.price_unit === 'kg' && sale.settlement_mode === 'sale' && sale.biz_mode === 'bottle', '销售日期、客户或计价方式不符')
    assert(cents(sale.unit_price) === cents(item.expected_unit_price) && cents(sale.unit_price) !== price, '销售价格原值不符或无需修改')
    assert([sale.out_items, sale.back_items].every(rows => Array.isArray(rows) && rows.every(r => typeof r.net === 'number' && Number.isFinite(r.net))), '缺少明确重量')
    assert(!sale.offset_use_revision || sale.offset_use_status === 'completed', '冲抵使用结果待核')
    assert(!sale.offset_sync_revision || sale.offset_sync_status === 'completed', '冲抵同步结果待核')
    if (sale.web_save_operation_key) assert(t.crm_web_sale_operations.some(r => r._id === sale.web_save_operation_key && r.status === 'complete'), '销售后台任务未完成')
    if (sale.mobile_create_operation_key) assert(t.crm_mobile_sale_operations.some(r => r._id === sale.mobile_create_operation_key && ['completed', 'pending_review'].includes(r.status)), '手机销售任务待核')
    assert(!t.crm_customer_opening_debts.some(r => active(r) && r.adjustment_source?.target_id === sale._id), '销售有关联调整')
    assert(!t.crm_periods.some(r => r.period === sale.date.slice(0, 7) && r.status !== 'open'), '账期非开放状态')
    const old = computeSaleAmountsForDoc(sale).amounts, next = computeSaleAmountsForDoc({ ...sale, unit_price: price / 100 }).amounts
    const oldAmount = cents(old.effective_should_receive), nextAmount = cents(next.effective_should_receive)
    const cash = cents(sale.amount_received || 0), rounding = cents(sale.receipt_rounding_amount || 0)
    assert(cents(sale.rounding_amount || 0) === 0 && oldAmount !== 0 && Math.sign(oldAmount) === Math.sign(nextAmount) && cash >= 0 && rounding >= 0, '不支持跨零、源单优惠或负实收')
    const own = allocations.filter(a => (a.target_id || a.sale_id) === sale._id)
    assert(own.every(a => a.customer_id === id && (!a.target_type || a.target_type === 'sale') && ['receipt', 'rounding'].includes(a.allocate_kind || 'receipt')), '未知分配关系')
    const sum = kind => own.filter(a => (a.allocate_kind || 'receipt') === kind).reduce((s, a) => s + cents(a.allocate_amount), 0)
    assert(sum('receipt') === cash && sum('rounding') === rounding, '销售实收或抹零缺少完整分配依据')
    for (const a of own) {
      const r = t.crm_customer_receipts.find(r => r._id === a.receipt_id)
      assert(r && r.status === 'posted' && r.entry_kind === 'prepay' && ['cashier_intake', 'customer_statement', 'manual', 'legacy_received_confirmation'].includes(r.source_type), '分配来源不是有效现金收款')
      const related = allocations.filter(x => x.receipt_id === r._id)
      assert(related.every(x => ['receipt', 'rounding'].includes(x.allocate_kind || 'receipt')), '未知收款分配类型')
      assert(related.filter(x => (x.allocate_kind || 'receipt') === 'receipt').reduce((s, x) => s + cents(x.allocate_amount), 0) === cents(r.allocated_amount) && cents(r.amount) === cents(r.allocated_amount) + cents(r.unallocated_amount), '现金分配不守恒')
      assert(related.filter(x => x.allocate_kind === 'rounding').reduce((s, x) => s + cents(x.allocate_amount), 0) === cents(r.rounding_allocated_amount || 0), '收款抹零分配不守恒')
    }
    const credits = t.crm_customer_receipts.filter(r => r.source_id === sale._id)
    if (oldAmount < 0) {
      assert(sale.offset_enabled === true && cash === 0 && rounding === 0 && own.length === 0 && credits.length === 1, '负销售冲抵来源不唯一')
      const r = credits[0]
      assert(r.status === 'posted' && r.source_type === 'sale_offset_credit' && r.entry_kind === 'offset_credit' && r.biz_date === sale.date && cents(r.amount) === -oldAmount && cents(r.unallocated_amount) === -oldAmount && cents(r.allocated_amount) === 0 && cents(r.rounding_amount || 0) === 0 && cents(r.rounding_allocated_amount || 0) === 0, '退气来源已使用或不守恒')
      assert(!allocations.some(a => a.receipt_id === r._id) && !r.cash_refunded_amount && !r.offset_cash_refunded_amount && !t.crm_customer_receipts.some(x => x.source_id === r._id || x.offset_source_receipt_id === r._id || (x.refund_sources || []).some(y => y.id === r._id)) && !t.crm_customer_opening_debts.some(x => active(x) && x.adjustment_source?.receipt_id === r._id), '退气额度存在退款或后续依赖')
      patch('crm_customer_receipts', r, { amount: -nextAmount / 100, unallocated_amount: -nextAmount / 100 })
      creditDelta += oldAmount - nextAmount
    } else {
      assert(credits.length === 0 && sale.payment_method === 'on_account' && oldAmount >= cash + rounding && nextAmount >= cash + rounding, '正销售有冲抵来源、现金科目或超额分配，须单独核实')
      debtDelta += nextAmount - oldAmount
    }
    const vouchers = t.crm_vouchers.filter(v => v.source === 'sale:' + sale._id || v.source_key === 'sale:' + sale._id)
    assert(vouchers.length === 1, '销售草稿凭证缺失或重复')
    const v = vouchers[0], entries = t.crm_voucher_entries.filter(x => x.voucher_id === v._id)
    assert(v.status === 'draft' && !v.reviewed_at && !v.posted_at && v.date === sale.date && v.period === sale.date.slice(0, 7) && cents(v.total_debit) === Math.abs(oldAmount) && cents(v.total_credit) === Math.abs(oldAmount), '凭证已审核、已过账或原金额不符')
    assert(entries.length === 2 && entries.every(x => x.aux?.customer_id === id && x.aux?.source_id === sale._id && cents(x.amount) === Math.abs(oldAmount)) && entries.some(x => x.account_code === '1122' && x.direction === (oldAmount > 0 ? 'debit' : 'credit')) && entries.some(x => x.account_code === '6001' && x.direction === (oldAmount > 0 ? 'credit' : 'debit')), '凭证分录结构或金额不符')
    patch('crm_vouchers', v, { total_debit: Math.abs(nextAmount) / 100, total_credit: Math.abs(nextAmount) / 100 })
    for (const entry of entries) patch('crm_voucher_entries', entry, { amount: Math.abs(nextAmount) / 100 })
    patch('crm_sale_records', sale, { unit_price: price / 100, payment_status: nextAmount <= cash + rounding ? 'paid' : cash + rounding > 0 ? 'partial' : 'unpaid' })
    revenueDelta += nextAmount - oldAmount
    summary.push({ sale_id: sale._id, date: sale.date, before: oldAmount / 100, after: nextAmount / 100, difference: (nextAmount - oldAmount) / 100, cash_preserved: cash / 100, receipt_rounding_preserved: rounding / 100 })
  }
  const changes = { default_unit_price: price / 100, receipt_allocation_revision: runId }
  for (const [key, delta] of Object.entries({ should_receive_total: revenueDelta, receivable_balance: debtDelta, prepay_balance: creditDelta, offset_credit_balance: creditDelta, net_balance: debtDelta - creditDelta })) changes[key] = (cents(customer[key]) + delta) / 100
  assert(cents(customer.net_balance) === cents(customer.receivable_balance) - cents(customer.prepay_balance), '客户汇总原值不守恒')
  patch('crm_customers', customer, changes)
  const plan = { run_id: runId, customer_id: id, rule_version: VERSION, source_snapshot_hash: before.snapshot_hash, request_hash: digest(request), evidence: e,
    summary: { sales: summary, net_receivable_delta: revenueDelta / 100, debt_delta: debtDelta / 100, available_credit_delta: creditDelta / 100, default_unit_price: price / 100, cash_changed: 0, allocations_changed: 0, writes: writes.length }, writes }
  plan.plan_hash = digest(plan); return plan
}
async function run(db, user, action, data) {
  const id = data.customer_id
  if (action === 'inspectPriceV1') return { code: 0, data: await priceSnapshot(db, id), rule_version: VERSION }
  const runId = batchId(id, data.operation_id), logId = 'accounting_price_' + runId, logs = db.collection('crm_operation_logs'), existing = first(await logs.doc(logId).get())
  if (action === 'statusPriceV1') return { code: 0, data: { run_id: runId, status: existing?.status || 'not_prepared', plan_hash: existing?.detail?.plan?.plan_hash, after_snapshot_hash: existing?.after_snapshot_hash }, rule_version: VERSION }
  if (action === 'preparePriceV1') {
    if (existing) { assert(existing.detail?.plan?.request_hash === digest(data), '操作号已绑定其他计划'); return { code: 0, data: { status: existing.status, ...existing.detail.plan } } }
    const before = await priceSnapshot(db, id), plan = buildPricePlan(before, data, user, Date.now())
    await logs.add({ _id: logId, action: 'protected_sale_price_correction', customer_id: id, request_id: runId, user_id: user._id, created_at: Date.now(), status: 'prepared', detail: { before, plan } })
    return { code: 0, data: plan, rule_version: VERSION }
  }
  assert(['rehearsePriceV1', 'executePriceV1'].includes(action), '不支持的操作')
  assert(existing && data.plan_hash === existing.detail?.plan?.plan_hash, '批次不存在或计划不符')
  if (existing.status === 'committed') return { code: 0, data: { status: 'committed', idempotent: true, after_snapshot_hash: existing.after_snapshot_hash, summary: existing.detail.plan.summary } }
  assert(existing.status === 'prepared' && existing.detail.plan.rule_version === VERSION, '批次或工具版本变化')
  if (action === 'executePriceV1') assert(existing.rehearsed_at, '本批尚未通过完整回滚演练')
  const readSnapshot = () => priceSnapshot(db, id), current = await readSnapshot()
  assert(current.snapshot_hash === existing.detail.before.snapshot_hash, '原值或范围已变化')
  const result = await executePrepared({ db, logId, run: existing, rehearse: action === 'rehearsePriceV1', failAfterWrites: Number(data.fail_after_writes || 0), readSnapshot,
    checkMembership: async () => assert((await readSnapshot()).snapshot_hash === current.snapshot_hash, '事务期间原值或范围变化') })
  if (action === 'rehearsePriceV1') {
    assert((await readSnapshot()).snapshot_hash === current.snapshot_hash, '回滚后原值不符')
    if (result.status === 'rehearsed_rolled_back') await logs.doc(logId).update({ rehearsed_at: Date.now(), rehearsal_snapshot_hash: current.snapshot_hash })
    result.snapshot_unchanged = true
  }
  return { code: 0, data: result, rule_version: VERSION }
}
module.exports = { priceSnapshot, buildPricePlan, run, VERSION }
