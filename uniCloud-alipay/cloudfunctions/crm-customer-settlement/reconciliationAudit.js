'use strict'

// The only write in this service is a guarded replacement of six customer
// summary fields. Receipt availability and target paid amounts remain facts.
const { digest } = require('./depositModel')
const { isOffsetCreditReceipt, isDepositTransferReceipt, isSettlementFeeReceipt } = require('./receiptSource')
const VERSION = 'reconciliation-audit/2026-10-14.1'
const TABLES = { sales: 'crm_sale_records', flows: 'crm_customer_flow_settlements', debts: 'crm_customer_opening_debts',
  receipts: 'crm_customer_receipts', allocations: 'crm_customer_allocations', intakes: 'crm_cashier_intakes' }
const CACHE_FIELDS = ['receivable_balance', 'prepay_balance', 'prepay_manual_balance', 'receipt_unallocated_balance', 'offset_credit_balance', 'net_balance']
const text = x => String(x ?? '').trim()
const hasOwn = (row, key) => Object.prototype.hasOwnProperty.call(row, key)
const sorted = rows => [...rows].sort((a, b) => text(a._id).localeCompare(text(b._id)))
const active = row => row && (!row.status || row.status === 'posted')
const first = result => Array.isArray(result?.data) ? result.data[0] || null : result?.data || null
const fail = (message, code = 409, details = {}) => { throw Object.assign(new Error(message), { code, details }) }
const targetKey = row => `${text(row.target_type || 'sale')}:${text(row.target_id || row.sale_id || row.flow_settlement_id)}`
const debtType = row => row.source_type === 'balance_adjustment' ? 'balance_adjustment' : text(row.source_type).includes('other_fee') ? 'other_fee' : 'opening_debt'
const dateValid = x => /^\d{4}-\d{2}-\d{2}$/.test(text(x)) && Number.isFinite(Date.parse(x)) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x
const operationKey = (cid, operation) => digest(['reconciliation-cache', cid, operation]).slice(0, 24)
const cacheValues = row => Object.fromEntries(CACHE_FIELDS.map(k => [k, row?.[k] ?? null]))
const saleOffsetSource = row => ['sale_offset_credit', 'sale_offset_credit_repair'].includes(text(row?.source_type))
// Match the established enabled values, but keep unrecognized legacy flags
// pending instead of treating a guessed default as financial evidence.
const offsetEnabled = row => row.offset_enabled == null || row.offset_enabled === '' || row.offset_enabled === true ||
  row.offset_enabled === 1 || ['true', '1', 'yes', 'y', 'on'].includes(text(row.offset_enabled).toLowerCase())
const factAmount = value => ['string', 'number'].includes(typeof value) && text(value) !== '' && Number.isFinite(Number(value))
  ? Number(value) : null
// Display facts are yuan values from the same read, never integer minor units.
// should_receive means the authoritative amount BEFORE the source's own discount;
// effective_should_receive means the amount AFTER it. Both may be negative.
function sourceFacts(row = {}, sourceType = '', snapshot, unavailable = {}) {
  const amounts = {}
  for (const key of ['amount', 'should_receive', 'rounding_amount', 'amount_received', 'receipt_rounding_amount', 'unallocated_amount'])
    if (hasOwn(row, key)) amounts[key] = factAmount(row[key])
  if (snapshot || unavailable.gross) {
    amounts.should_receive = unavailable.gross ? null : factAmount(snapshot?.should_receive ?? snapshot?.amount)
    amounts.effective_should_receive = unavailable.gross || unavailable.effective ? null
      : factAmount(snapshot?.should_receive_effective ?? snapshot?.should_receive)
    if (!hasOwn(row, 'rounding_amount')) amounts.rounding_amount = factAmount(snapshot?.rounding_amount)
  }
  const bizDate = sourceType === 'sale' ? row.date : row.biz_date
  const result = { biz_date: dateValid(bizDate) ? bizDate : null, source_type: text(row.source_type) || sourceType,
    entry_kind: text(row.entry_kind), amounts }
  for (const key of ['source_number', 'status', 'receipt_adjustment_status']) if (text(row[key])) result[key] = text(row[key])
  return result
}
function customerSource(row) {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !CACHE_FIELDS.includes(k) &&
    !['updated_at', 'reconciliation_cache_operation_id', 'reconciliation_cache_checked_at'].includes(k)))
}
function scopeHash(scope) { return digest({ ...scope, customer: customerSource(scope.customer) }) }

function createAuditService({ db, command, readComplete, resolveCustomer, moneyScale, saleSnapshot, flowSnapshot, debtSnapshot, computeBalances, resolveSalesScope }) {
  const read = async (table, where = {}, options = {}) => sorted(await readComplete(db.collection(table), where,
    { command, source: `reconciliation_audit.${table}`, ...options }))
  const fixed = async (store, id) => first(await store.where({ _id: id }).limit(1).get())
  const operationLog = async key => {
    const rows = await read('crm_operation_logs', { _id: key })
    if (rows.length > 1) fail('操作记录编号重复，不能判定原结果')
    return rows[0] || null
  }
  async function unionRead(table, clauses) {
    const found = new Map()
    for (let offset = 0; offset < clauses.length; offset += 40) {
      for (const row of await read(table, command.or(clauses.slice(offset, offset + 40)))) {
        if (found.has(row._id) && digest(found.get(row._id)) !== digest(row)) fail('反向关联在读取期间变化')
        found.set(row._id, row)
      }
    }
    return sorted([...found.values()])
  }
  async function scope(cid) {
    const customer = resolveCustomer ? await resolveCustomer(cid) : await fixed(db.collection('crm_customers'), cid)
    if (!customer || customer._id !== cid) fail('客户不存在或不可访问', 404)
    const s = { customer }
    await Promise.all(Object.entries(TABLES).map(async ([key, table]) => { s[key] = await read(table, { customer_id: cid }) }))
    s.related_customers = await read('crm_customers', command.or([{ settlement_customer_id: cid },
      ...[...new Set(s.sales.map(r => text(r.delivery_customer_id)).filter(Boolean))].map(_id => ({ _id }))]),
    { field: { _id: true, settlement_customer_id: true, is_hidden: true } })
    s.sales_scope_version = 'all_customer_sources'
    if (resolveSalesScope) {
      const visibility = await resolveSalesScope(cid)
      if (!visibility?.where || !text(visibility.version)) fail('销售范围依据不完整')
      s.sales_scope_version = visibility.version
      const visible = new Set((await read(TABLES.sales, visibility.where)).map(r => r._id))
      s.excluded_sales = s.sales.filter(r => !visible.has(r._id)).map(r => r._id)
    } else s.excluded_sales = []
    const receiptIds = s.receipts.map(r => r._id)
    const targetIds = [...s.sales, ...s.flows, ...s.debts].map(r => r._id)
    s.reverse_allocations = await unionRead(TABLES.allocations, [
      ...receiptIds.map(receipt_id => ({ receipt_id })),
      ...targetIds.flatMap(id => [{ target_id: id }, { sale_id: id }, { flow_settlement_id: id }])
    ])
    s.reverse_receipts = await unionRead(TABLES.receipts, [
      ...[...receiptIds, ...s.sales.map(r => r._id)].map(source_id => ({ source_id })),
      ...receiptIds.map(offset_source_receipt_id => ({ offset_source_receipt_id }))
    ])
    // refund_sources is an array; inspect actual links, rather than depending on
    // provider-specific dotted-array filtering that could silently omit one.
    const refundRows = await read(TABLES.receipts, { source_type: 'customer_cash_refund' })
    const ids = new Set(receiptIds)
    s.refund_links = refundRows.filter(r => r.customer_id === cid || (r.refund_sources || []).some(link => ids.has(link.id)))
    const targetSet = new Set(targetIds), adjustmentRows = await read(TABLES.debts, { source_type: 'balance_adjustment' })
    s.reverse_adjustments = adjustmentRows.filter(r => ids.has(r.adjustment_source?.receipt_id) || targetSet.has(r.adjustment_source?.target_id))
    const legacyTable = 'crm_customer_receipt_adjustments'
    s.legacy_adjustment_store = 'present'
    try { await db.collection(legacyTable).where({ customer_id: cid }).count() }
    catch (error) {
      if (text(error.message) !== 'not found collection') throw error
      s.legacy_adjustment_store = 'provider_confirmed_absent'
    }
    s.legacy_adjustments = s.legacy_adjustment_store === 'present'
      ? await unionRead(legacyTable, [{ customer_id: cid }, ...receiptIds.map(receipt_id => ({ receipt_id }))]) : []
    return s
  }
  function check(s) {
    const issues = [], cid = s.customer._id, scale = Number(moneyScale(s.customer)) === 3 ? 3 : 2, divisor = 10 ** scale
    const issueSources = new Map()
    const issue = (type, code, message, sourceType, row, details = {}, diagnostic = {}) => {
      const problem = { type, code, message, source_type: sourceType, source_id: text(row?._id), blocking: true, details }
      issues.push(problem); issueSources.set(problem, { row, sourceType, diagnostic })
    }
    const units = (value, sourceType, row, field, optional = false, signed = false) => {
      if (optional && value == null) return 0
      const n = Number(value), result = Math.round(n * divisor)
      if (!['string', 'number'].includes(typeof value) || text(value) === '' || !Number.isFinite(n) ||
          !Number.isSafeInteger(result) || Math.abs(n * divisor - result) > 0.00001 || (!signed && result < 0)) {
        const validationFailure = value == null || typeof value === 'string' && text(value) === '' ? 'missing'
          : !['string', 'number'].includes(typeof value) || !Number.isFinite(n) ? 'invalid'
            : !Number.isSafeInteger(result) ? 'out_of_range'
              : Math.abs(n * divisor - result) > 0.00001 ? 'precision' : 'negative'
        issue('evidence_missing', 'invalid_amount', '金额缺失、为负或超出允许精度，须核对原单', sourceType, row, { field },
          { field, validation_failure: validationFailure }); return null
      }
      return result
    }
    const sum = (rows, type, field = 'allocate_amount') => {
      const values = rows.map(r => units(r[field], type, r, field)); return values.includes(null) ? null : values.reduce((a, b) => a + b, 0)
    }
    const compare = (actual, expected, code, message, type, row) => {
      if (actual !== null && expected !== null && actual !== expected) issue('amount_difference', code, message, type, row,
        { actual: actual / divisor, expected: expected / divisor, difference: (actual - expected) / divisor })
    }
    if (s.customer.is_hidden || (s.customer.settlement_customer_id && s.customer.settlement_customer_id !== cid) ||
        s.related_customers.some(r => r._id !== cid && r.settlement_customer_id === cid))
      issue('evidence_missing', 'settlement_scope_requires_review', '隐藏客户或合并结算范围需先核实，不能自动刷新汇总', 'customer', s.customer)
    if (s.excluded_sales.length || s.related_customers.some(r => r.is_hidden))
      issue('evidence_missing', 'hidden_delivery_scope', '存在被展示范围排除的销售来源，须先核对范围', 'customer', s.customer, { excluded_sales: s.excluded_sales })
    for (const row of s.legacy_adjustments.filter(r => r.status === 'pending'))
      issue('evidence_missing', 'pending_receipt_adjustment', '来源收款存在未完成的整单调整', 'receipt_adjustment', row)
    for (const row of s.sales.filter(r => !active(r)))
      issue('evidence_missing', 'sale_status_requires_review', '销售状态不在当前可自动核验范围内', 'sale', row)
    for (const key of ['receipts', 'flows', 'debts', 'intakes']) for (const row of s[key].filter(r => !['posted', 'void'].includes(r.status)))
      issue('evidence_missing', 'source_status_missing', '原单状态缺失或尚未完成，不能按已作废忽略', key, row)
    for (const row of [...s.reverse_allocations, ...s.reverse_receipts, ...s.refund_links, ...s.reverse_adjustments].filter(r => active(r) && r.customer_id !== cid))
      issue('evidence_missing', 'cross_customer_reference', '存在跨客户反向关联，须核实资金归属', 'reference', row)

    const receipts = new Map(s.receipts.filter(r => r.status === 'posted').map(r => [r._id, r]))
    const allocations = s.allocations.filter(active), targets = new Map(), sourceSnapshots = new Map(), seen = new Map()
    for (const [name, rows] of Object.entries(TABLES).map(([key]) => [key, s[key]])) {
      for (const row of rows) {
        if (!row._id || seen.has(`${name}:${row._id}`)) issue('suspected_duplicate', 'duplicate_source_id', '来源编号重复或缺失', name, row)
        seen.set(`${name}:${row._id}`, true)
      }
    }
    const rawTargets = [
      ...s.sales.filter(active).map(row => ({ type: 'sale', row, snapshot: saleSnapshot })),
      ...s.flows.filter(r => r.status === 'posted').map(row => ({ type: 'flow_settlement', row, snapshot: flowSnapshot })),
      ...s.debts.filter(r => r.status === 'posted').map(row => ({ type: debtType(row), row, snapshot: r => debtSnapshot(r, Number(r.money_scale) === 3 ? 3 : scale) }))
    ]
    for (const item of rawTargets) {
      const { row, type } = item
      if (!dateValid(type === 'sale' ? row.date : row.biz_date)) issue('evidence_missing', 'source_date_missing', '原单业务日期不完整', type, row)
      if (type === 'sale' && row.settlement_mode !== 'customer_flow') {
        const numeric = value => ['number', 'string'].includes(typeof value) && text(value) !== '' && Number.isFinite(Number(value))
        if (!numeric(row.unit_price) || Number(row.unit_price) < 0)
          issue('evidence_missing', 'sale_price_missing', '销售单价缺失或无效，不能按零元销售核对', type, row)
        const unit = row.price_unit || 'kg', mode = row.biz_mode || 'bottle'
        let quantityKnown = true
        if (!['kg', 'bottle', 'm3'].includes(unit) || !['truck', 'bottle', 'agent_sale'].includes(mode)) quantityKnown = false
        else if (mode === 'truck') quantityKnown = ['truck_sale_net', 'truck_gross_diff'].some(k => numeric(row[k])) ||
          ['truck_out_gross', 'truck_back_gross'].every(k => numeric(row[k])) || ['truck_settle_gross', 'truck_settle_tare'].every(k => numeric(row[k]))
        else if (mode === 'agent_sale') quantityKnown = Array.isArray(row.agent_sale_items) && row.agent_sale_items.every(r => numeric(r.fill_weight))
        else if (unit === 'm3') quantityKnown = numeric(row.flow_volume_m3) || ['flow_index_curr', 'flow_index_prev'].every(k => numeric(row[k]))
        else quantityKnown = (Array.isArray(row.out_items) || Array.isArray(row.back_items)) &&
          [row.out_items, row.back_items].filter(r => r != null).every(rows => Array.isArray(rows) &&
            (unit === 'bottle' || rows.every(r => numeric(r.net) && Number(r.net) >= 0)))
        if (!quantityKnown) issue('evidence_missing', 'sale_quantity_missing', '销售计价依据缺失或无效，不能按零数量核对', type, row)
      }
      if ((type === 'flow_settlement' && row.should_receive == null) || (type !== 'sale' && type !== 'flow_settlement' && row.amount == null))
        issue('evidence_missing', 'source_amount_missing', '原单应收金额缺失，不能按零元核对', type, row)
      try { item.value = item.snapshot(row) }
      catch (error) { issue('evidence_missing', 'source_classification_required', '原单金额或销售归属尚未核实', type, row, { reason: error.message }); continue }
      sourceSnapshots.set(row, item.value)
      targets.set(`${type}:${row._id}`, item)
      const cash = units(row.amount_received, type, row, 'amount_received')
      const rounding = units(row.receipt_rounding_amount, type, row, 'receipt_rounding_amount', true)
      const own = units(row.rounding_amount ?? item.value.rounding_amount, type, row, 'rounding_amount', true)
      const gross = item.value.should_receive ?? item.value.amount ?? row.amount
      const effective = units(item.value.should_receive_effective ?? item.value.should_receive, type, row, 'effective_should_receive', false,
        type === 'sale' && Number(gross) < 0 && own === 0)
      item.returnCredit = type === 'sale' && effective !== null && effective < 0 && Number(gross) < 0 &&
        cash === 0 && rounding === 0 && own === 0 ? -effective : null
      if (own !== null && gross != null && own > Math.max(0, Math.round(Number(gross) * divisor)))
        issue('amount_difference', 'source_rounding_exceeded', '原单自身减免超过原应收金额', type, row)
      const linked = allocations.filter(r => targetKey(r) === `${type}:${row._id}`)
      const allocated = sum(linked.filter(r => (r.allocate_kind || 'receipt') === 'receipt'), 'allocation')
      compare(cash, allocated, cash > allocated ? 'embedded_receipt_without_backing' : 'target_receipt_mismatch',
        cash > allocated ? '原单内嵌已收缺少同笔正式分配依据，不能判定现金已核清' : '原单已收与正式分配不一致', type, row)
      compare(rounding, sum(linked.filter(r => r.allocate_kind === 'rounding'), 'allocation'), 'target_rounding_mismatch', '原单收款抹零与分配依据不一致', type, row)
      if (effective !== null && cash !== null && rounding !== null && cash + rounding > Math.max(0, effective))
        issue('amount_difference', 'target_overallocated', '原单收款与抹零超过应收', type, row)
      if (own !== null && own > 0 && row.source_type === 'balance_adjustment')
        issue('classification_difference', 'adjustment_own_rounding', '余额调整单包含额外抹零，须核对来源', type, row)
    }
    const allocationKeys = new Map()
    for (const row of allocations) {
      const key = targetKey(row), receipt = receipts.get(row.receipt_id)
      if (!receipt) issue('evidence_missing', 'allocation_receipt_missing', '分配缺少有效正式收款', 'allocation', row)
      if (!targets.has(key)) issue('evidence_missing', 'allocation_target_missing', '分配目标不存在、已作废或归属待核', 'allocation', row)
      if (!['receipt', 'rounding'].includes(row.allocate_kind || 'receipt')) issue('classification_difference', 'allocation_kind_unknown', '分配类型不受支持', 'allocation', row)
      // Repeated partial allocations are legal; only the same operation/sequence
      // identity is considered a duplicate, never equal amounts alone.
      const identity = row.request_id ? [row.receipt_id, key, row.allocate_kind || 'receipt', row.request_id, row.seq ?? ''] : null
      if (identity) {
        const duplicateKey = JSON.stringify(identity)
        if (allocationKeys.has(duplicateKey)) issue('suspected_duplicate', 'duplicate_allocation_operation', '同一操作重复生成分配，请核查', 'allocation', row,
          { other_id: allocationKeys.get(duplicateKey) })
        allocationKeys.set(duplicateKey, row._id)
      }
    }
    const offsetGroups = new Map()
    for (const row of receipts.values()) if (saleOffsetSource(row)) {
      const key = text(row.source_id), group = offsetGroups.get(key) || []
      group.push(row); offsetGroups.set(key, group)
      const source = targets.get(`sale:${key}`)
      if (!source || source.returnCredit === null || !offsetEnabled(source.row))
        issue('evidence_missing', 'offset_source_requires_review', '退气抵款缺少可核实的原退气单，或原单不是已启用抵款的纯退气业务', 'receipt', row)
      else if (row.biz_date !== source.row.date)
        issue('date_difference', 'offset_source_date_mismatch', '退气抵款日期与原退气单日期不一致', 'receipt', row,
          { source_date: source.row.date, receipt_date: row.biz_date })
    }
    for (const item of targets.values()) if (item.returnCredit !== null) {
      if (!offsetEnabled(item.row))
        issue('evidence_missing', 'negative_sale_requires_review', '退气单未明确启用抵款，须核实退款或抵款依据', 'sale', item.row)
      else compare(sum(offsetGroups.get(item.row._id) || [], 'receipt', 'amount'), item.returnCredit,
        'offset_source_amount_mismatch', '原退气金额与生成的有效抵款额度合计不一致', 'sale', item.row)
    }
    const refunds = new Map(), duplicateReceipts = new Map()
    for (const row of receipts.values()) {
      if (!dateValid(row.biz_date)) issue('evidence_missing', 'receipt_date_missing', '实际收款或余额来源日期不完整', 'receipt', row)
      if (row.receipt_adjustment_status === 'pending') issue('evidence_missing', 'pending_receipt_adjustment', '收款正在调整中', 'receipt', row)
      if (row.source_type === 'customer_cash_refund' || row.source_type === 'offset_credit_cash_refund') {
        const amount = units(row.amount, 'refund', row, 'amount', false, true)
        if (amount !== null && amount >= 0) issue('amount_difference', 'invalid_cash_refund', '实际退款必须是负数现金事件', 'refund', row)
        const offsetRefund = row.source_type === 'offset_credit_cash_refund'
        if (!offsetRefund && row.refund_source_status !== 'linked') issue('evidence_missing', 'refund_source_pending', '已退款但余额来源待核，不能自动刷新', 'refund', row)
        if (offsetRefund && (!row.source_id || row.source_id !== row.offset_source_receipt_id || !saleOffsetSource(receipts.get(row.source_id))))
          issue('evidence_missing', 'offset_refund_source_missing', '退气退款缺少一致的正式抵款来源关联', 'refund', row)
        const links = offsetRefund ? (amount !== null ? [{ id: row.source_id, amount: -amount / divisor }] : [])
          : Array.isArray(row.refund_sources) ? row.refund_sources : []
        compare(amount === null ? null : -amount, sum(links, 'refund_source', 'amount'), 'refund_link_mismatch', '退款金额与来源分摊不一致', 'refund', row)
        if (new Set(links.map(l => l.id)).size !== links.length) issue('suspected_duplicate', 'duplicate_refund_source', '一笔退款重复引用同一来源', 'refund', row)
        for (const link of links) {
          const source = receipts.get(link.id), value = units(link.amount, 'refund', row, 'source_amount')
          if (!source || Number(source.amount) <= 0 || isDepositTransferReceipt(source) || isSettlementFeeReceipt(source))
            issue('evidence_missing', 'refund_source_missing', '退款关联来源不存在或不可退款', 'refund', row, { receipt_id: link.id })
          if (value !== null) refunds.set(link.id, (refunds.get(link.id) || 0) + value)
        }
        for (const field of ['allocated_amount', 'unallocated_amount', 'rounding_amount', 'rounding_allocated_amount'])
          compare(units(row[field], 'refund', row, field, true), 0, 'refund_has_balance', '退款单不能同时保留可用或已分配余额', 'refund', row)
        continue
      }
      if (Number(row.amount) < 0) { issue('evidence_missing', 'legacy_refund_requires_review', '旧退款路径须核实反向关联后处理', 'receipt', row); continue }
      if (isOffsetCreditReceipt(row) && !saleOffsetSource(row) || isDepositTransferReceipt(row) || isSettlementFeeReceipt(row))
        issue('evidence_missing', 'noncash_source_requires_review', '冲抵、押金转款或手续费来源须核对独立来源账，暂不自动刷新', 'receipt', row)
      const own = allocations.filter(r => r.receipt_id === row._id)
      const amount = units(row.amount, 'receipt', row, 'amount'), allocated = units(row.allocated_amount, 'receipt', row, 'allocated_amount')
      const available = units(row.unallocated_amount, 'receipt', row, 'unallocated_amount')
      const refunded = units(row.cash_refunded_amount, 'receipt', row, 'cash_refunded_amount', true)
      const offsetRefunded = units(row.offset_cash_refunded_amount, 'receipt', row, 'offset_cash_refunded_amount', true)
      const rounding = units(row.rounding_amount, 'receipt', row, 'rounding_amount', true)
      const roundingAllocated = units(row.rounding_allocated_amount, 'receipt', row, 'rounding_allocated_amount', true)
      compare(allocated, sum(own.filter(r => (r.allocate_kind || 'receipt') === 'receipt'), 'allocation'), 'receipt_allocation_mismatch', '收款已分配额与分配流水不一致', 'receipt', row)
      compare(roundingAllocated, sum(own.filter(r => r.allocate_kind === 'rounding'), 'allocation'), 'receipt_rounding_mismatch', '收款抹零分配与流水不一致', 'receipt', row)
      compare(rounding, roundingAllocated, 'receipt_rounding_unallocated', '收款抹零尚未完整对应原单', 'receipt', row)
      if (![amount, allocated, available, refunded].includes(null) && !isOffsetCreditReceipt(row))
        compare(amount, allocated + available + refunded, 'receipt_not_conserved', '原到账金额不等于已分配、可用及已退款之和', 'receipt', row)
      if (isOffsetCreditReceipt(row)) {
        compare(refunded, 0, 'offset_cash_refund_field_mismatch', '退气抵款使用了现金收款的退款字段，须核实分类', 'receipt', row)
        if (![amount, allocated, roundingAllocated, available, offsetRefunded].includes(null))
          compare(amount, allocated + roundingAllocated + available + offsetRefunded, 'offset_receipt_not_conserved',
            '退气抵款总额不等于已分配、抹零分配、可用及已退款之和', 'receipt', row)
      } else compare(offsetRefunded, 0, 'cash_offset_refund_field_mismatch', '现金收款使用了退气抵款的退款字段，须核实分类', 'receipt', row)
      const unique = row.intake_id ? `intake:${row.intake_id}` : row.source_id && row.source_type ? `source:${row.source_type}:${row.source_id}` : ''
      if (unique) {
        if (duplicateReceipts.has(unique)) issue('suspected_duplicate', 'duplicate_receipt_source', '同一来源关联多笔有效收款，须确认是否重复到账', 'receipt', row, { other_id: duplicateReceipts.get(unique) })
        duplicateReceipts.set(unique, row._id)
      }
      if (row.intake_id) {
        const header = s.intakes.find(r => r._id === row.intake_id)
        if (!header || header.status !== 'posted' || header.receipt_id !== row._id || header.customer_id !== cid ||
            Number(header.gas_amount) !== Number(row.amount) || header.biz_date !== row.biz_date || header.payment_method !== row.payment_method)
          issue('classification_difference', 'cashier_intake_mismatch', '到账登记与气款收款事实不一致', 'receipt', row)
      }
    }
    for (const row of receipts.values()) if (Number(row.amount) >= 0)
      compare(units(row[isOffsetCreditReceipt(row) ? 'offset_cash_refunded_amount' : 'cash_refunded_amount'], 'receipt', row,
        isOffsetCreditReceipt(row) ? 'offset_cash_refunded_amount' : 'cash_refunded_amount', true), refunds.get(row._id) || 0,
        'refund_backing_mismatch', '来源已退款金额缺少相符的实际退款事件', 'receipt', row)
    for (const row of s.intakes.filter(r => r.status === 'posted')) {
      const gas = units(row.gas_amount, 'cashier_intake', row, 'gas_amount'), deposit = units(row.deposit_amount, 'cashier_intake', row, 'deposit_amount')
      if (gas !== null && deposit !== null) compare(units(row.amount, 'cashier_intake', row, 'amount'), gas + deposit,
        'cashier_split_mismatch', '到账总额与气款、押金拆分不一致', 'cashier_intake', row)
      if (Number(row.gas_amount) > 0) {
        const receipt = receipts.get(row.receipt_id)
        if (!receipt || receipt.intake_id !== row._id || receipt.source_type !== 'cashier_intake')
          issue('evidence_missing', 'cashier_receipt_missing', '到账登记缺少唯一对应气款收款，不能确定到账是否漏记或重复', 'cashier_intake', row)
      }
    }

    const reversed = new Map()
    for (const row of s.debts.filter(r => r.status === 'posted' && r.source_type === 'balance_adjustment')) {
      const source = row.adjustment_source, amount = units(row.amount, 'balance_adjustment', row, 'amount')
      if (!['rounding_reversal', 'prepay_writeoff'].includes(row.adjustment_kind) || !source?.source_key) {
        issue('evidence_missing', 'legacy_adjustment_requires_review', '历史余额调整缺少通用业务类型或来源关联', 'balance_adjustment', row); continue
      }
      if (row.adjustment_kind === 'rounding_reversal') {
        let limit = null, canonicalKey = ''
        if (source.type === 'target_rounding') {
          const target = targets.get(`${source.target_type}:${source.target_id}`)
          canonicalKey = `target_rounding:${source.target_type}:${source.target_id}`
          if (target && source.id === source.target_id) limit = units(target.value.rounding_amount ?? target.row.rounding_amount ?? 0, target.type, target.row, 'rounding_amount')
        } else if (source.type === 'receipt_rounding_allocation') {
          const original = allocations.find(a => a._id === source.id && a.allocate_kind === 'rounding' && a.receipt_id === source.receipt_id && targetKey(a) === `${source.target_type}:${source.target_id}`)
          canonicalKey = `receipt_rounding_allocation:${source.target_type}:${source.id}`
          if (original) limit = units(original.allocate_amount, 'allocation', original, 'allocate_amount')
        }
        if (canonicalKey !== source.source_key) issue('evidence_missing', 'adjustment_source_identity_mismatch', '调整来源键与实际原单不一致', 'balance_adjustment', row)
        const total = (reversed.get(canonicalKey) || 0) + (amount || 0); reversed.set(canonicalKey, total)
        if (limit === null) issue('evidence_missing', 'rounding_reversal_source_missing', '抹零冲回原始来源不存在或已变化', 'balance_adjustment', row)
        else if (total > limit) issue('amount_difference', 'rounding_reversal_exceeded', '累计抹零冲回超过原减免', 'balance_adjustment', row,
          { reversed: total / divisor, original: limit / divisor })
      } else {
        const linked = allocations.filter(a => targetKey(a) === `balance_adjustment:${row._id}`)
        if (source.type !== 'receipt_credit' || source.source_key !== `receipt_credit:${source.receipt_id}` || source.id !== source.receipt_id ||
            !receipts.has(source.receipt_id) || linked.length !== 1 || linked[0]._id !== row.adjustment_allocation_id ||
            linked[0].receipt_id !== source.receipt_id || linked[0].source_type !== 'prepay_writeoff' || Number(linked[0].allocate_amount) !== Number(row.amount))
          issue('classification_difference', 'writeoff_source_mismatch', '多收款结清与指定原收款分配不一致', 'balance_adjustment', row)
      }
    }
    // Enrich only after all original checks; these fields cannot affect their
    // codes, blocking decisions, completeness, source hash or cache eligibility.
    const unavailable = new Map()
    for (const problem of issues) {
      const { row } = issueSources.get(problem), current = unavailable.get(row) || {}
      if (['sale_price_missing', 'sale_quantity_missing', 'source_classification_required', 'source_amount_missing'].includes(problem.code)) current.gross = true
      if (problem.code === 'invalid_amount' && problem.details.field === 'rounding_amount') current.effective = true
      unavailable.set(row, current)
    }
    for (const problem of issues) {
      const { row, sourceType, diagnostic } = issueSources.get(problem)
      const factType = ({ sales: 'sale', flows: 'flow_settlement', debts: debtType(row), receipts: 'receipt',
        intakes: 'cashier_intake', allocations: 'allocation' })[sourceType] || sourceType
      const snapshot = sourceSnapshots.get(row), missing = { ...unavailable.get(row) }
      // Flow/debt adapters retain historical numeric fallbacks. Do not present
      // a computed zero when their original principal is nonnumeric or absent.
      if (snapshot && factType !== 'sale' && factAmount(factType === 'flow_settlement' ? row.should_receive : row.amount) === null) missing.gross = true
      // Inactive or unclassified sales have no authoritative snapshot in this
      // audit; a legacy persisted should_receive must not become display truth.
      if (factType === 'sale' && !snapshot) missing.gross = true
      problem.source_facts = { ...sourceFacts(row, factType, snapshot, missing), ...diagnostic }
      if (diagnostic.field && !hasOwn(problem.source_facts.amounts, diagnostic.field) &&
          ['amount', 'should_receive', 'rounding_amount', 'effective_should_receive', 'amount_received', 'receipt_rounding_amount', 'unallocated_amount'].includes(diagnostic.field))
        problem.source_facts.amounts[diagnostic.field] = null
    }
    return { issues, scale }
  }
  async function inspectScope(s) {
    const { issues, scale } = check(s)
    let expected = null
    if (!issues.length) {
      try {
        const result = await computeBalances(s)
        expected = Object.fromEntries(CACHE_FIELDS.map(k => {
          const value = result[k]
          if (typeof value !== 'number' || !Number.isFinite(value)) fail(`客户汇总计算缺失：${k}`)
          return [k, value]
        }))
      } catch (error) { issues.push({ type: 'evidence_missing', code: 'balance_calculation_incomplete', message: '汇总计算未完成，未返回确定余额',
        source_type: 'customer', source_id: s.customer._id, blocking: true, details: { reason: error.message } }) }
    }
    const before = cacheValues(s.customer), complete = issues.length === 0
    const stale = complete ? CACHE_FIELDS.some(k => before[k] === null || Number(before[k]) !== expected[k]) : null
    if (stale) issues.push({ type: 'cache_stale', code: 'customer_summary_cache_stale', message: '原始账务规则校验通过，客户汇总缓存需要刷新',
      source_type: 'customer', source_id: s.customer._id, severity: 'info', blocking: false, details: { before, expected } })
    return { version: VERSION, customer_id: s.customer._id, complete, read_complete: true, source_hash: scopeHash(s), money_scale: scale,
      consistency: 'verified_live_reads_non_atomic', issues, cache: { stale, eligible: complete, before, expected },
      sources: { receipts: s.receipts.map(r => ({ id: r._id, amount: r.amount, date: r.biz_date, source_type: r.source_type, status: r.status,
        available: r.unallocated_amount, version: digest(r), note: r.note || '' })),
      sales: s.sales.map(r => ({ id: r._id, date: r.date, amount_received: r.amount_received, version: digest(r) })),
      adjustments: s.debts.filter(r => r.source_type === 'balance_adjustment').map(r => ({ id: r._id, kind: r.adjustment_kind, amount: r.amount, date: r.biz_date, status: r.status })) } }
  }
  async function inspect(cid) {
    try {
      const s = await scope(cid), result = await inspectScope(s), repeat = await scope(cid)
      if (scopeHash(s) !== scopeHash(repeat)) fail('客户原始资料在核查期间变化，请重新核查')
      return result
    } catch (error) {
      if ([400, 403, 404].includes(error.code)) throw error
      return { version: VERSION, customer_id: cid, complete: false, read_complete: false, source_hash: null,
        issues: [{ type: 'evidence_missing', code: 'source_read_incomplete', message: '原始资料读取未完成或期间发生变化，本次须重新核查',
          source_type: 'customer', source_id: cid, blocking: true, details: { reason: error.message } }],
        cache: { stale: null, eligible: false, before: null, expected: null }, sources: { receipts: [], sales: [], adjustments: [] } }
    }
  }
  async function verifiedResult(log, idempotent = false) {
    const current = await inspect(log.customer_id), saved = log.detail
    const verified = current.complete && current.source_hash === saved.source_hash && digest(current.cache.before) === digest(saved.after)
    return { status: verified ? 'refreshed' : 'needs_recheck', committed: true, verified, idempotent,
      operation_id: log.request_id, customer_id: log.customer_id, source_hash: saved.source_hash,
      before: saved.before, after: saved.after, audit: current }
  }
  async function refresh(data, user) {
    const cid = text(data.customer_id), op = text(data.operation_id), hash = text(data.expected_source_hash)
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(op) || !/^[a-f0-9]{64}$/.test(hash)) fail('固定操作号或来源版本无效', 400)
    const key = operationKey(cid, op), prior = await operationLog(key)
    if (prior) {
      if (prior.detail.source_hash !== hash) fail('该操作号已有不同来源版本，请查询原操作')
      return verifiedResult(prior, true)
    }
    const s = await scope(cid), audit = await inspectScope(s)
    if (!audit.complete) fail('原始账务尚有待核问题，不能自动刷新', 409, { audit })
    if (audit.source_hash !== hash) fail('原始来源已经变化，请重新核查', 409, { audit })
    if (typeof db.startTransaction !== 'function') fail('事务不可用，未刷新汇总', 503)
    const now = Date.now(), patch = { ...audit.cache.expected, reconciliation_cache_operation_id: op, reconciliation_cache_checked_at: now }
    const log = { _id: key, action: 'reconciliation_cache_refresh_v1', customer_id: cid, request_id: op, user_id: user._id,
      username: text(user.username), role: user.role, created_at: now,
      detail: { version: VERSION, source_hash: hash, before: audit.cache.before, after: audit.cache.expected,
        source_counts: Object.fromEntries(Object.keys(TABLES).map(k => [k, s[k].length])), status: 'committed' } }
    const tx = await db.startTransaction(), started = Date.now(); let attempted = false
    const within = async fn => { if (Date.now() - started > 8500) fail('事务校验预算不足，本次未刷新'); return fn() }
    try {
      // Alipay transaction.get may throw for an absent deterministic ID. The
      // complete operation pre-read proves absence; unique add and the existing
      // customer's write contention protect concurrent first submissions.
      const customer = first(await within(() => tx.collection('crm_customers').doc(cid).get()))
      if (digest(customer) !== digest(s.customer)) fail('客户原值已经变化，本次未刷新')
      // Each relevant original is checked inside the transaction. Range changes
      // are independently checked by a complete reread immediately before commit.
      for (const [name, table] of Object.entries(TABLES)) for (const row of s[name]) {
        const current = first(await within(() => tx.collection(table).doc(row._id).get()))
        if (digest(current) !== digest(row)) fail('原始单据已经变化，本次未刷新')
      }
      const result = await within(() => tx.collection('crm_customers').doc(cid).update(patch))
      if (result.updated !== 1) fail('客户汇总更新未命中')
      await within(() => tx.collection('crm_operation_logs').add(log))
      const repeated = await within(() => scope(cid))
      if (scopeHash(repeated) !== hash || digest(repeated.customer) !== digest(s.customer)) fail('提交前账务范围或客户原值变化，本次未刷新')
      await within(async () => { attempted = true; await tx.commit() })
    } catch (error) {
      await tx.rollback().catch(() => {})
      if (attempted) {
        const saved = await operationLog(key).catch(() => null)
        if (saved && saved.detail.source_hash === hash) return verifiedResult(saved, true)
        error.details = { ...(error.details || {}), commit_status_unknown: true, operation_id: op }
        error.message = '提交状态未确定，请查询原操作号，勿重新生成操作号：' + error.message
      } else error.details = { ...(error.details || {}), write_status: 'not_written' }
      throw error
    }
    return verifiedResult(log)
  }
  async function run(action, data = {}, user = {}) {
    if (!user._id || !['finance', 'admin', 'superadmin'].includes(user.role)) fail('仅会计或管理员可核查账务', 403)
    const cid = text(data.customer_id)
    if (!cid) fail('客户编号必填', 400)
    if (action === 'inspectReconciliationCustomerV1') return inspect(cid)
    if (action === 'refreshReconciliationCacheV1') return refresh(data, user)
    if (action === 'getReconciliationCacheOperationV1') {
      const log = await operationLog(operationKey(cid, text(data.operation_id)))
      return log ? verifiedResult(log, true) : { status: 'not_found', operation_id: text(data.operation_id), customer_id: cid }
    }
    fail('不支持的对账自检操作', 400)
  }
  return { run }
}

module.exports = { VERSION, CACHE_FIELDS, createAuditService, scopeHash }
