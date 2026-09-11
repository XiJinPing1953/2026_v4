'use strict'
const crypto = require('crypto')
const VERSION = 'legacy-cash-backing/2026-09-11.1'
const TABLES = ['crm_customers', 'crm_sale_records', 'crm_customer_receipts', 'crm_customer_allocations',
  'crm_customer_flow_settlements', 'crm_customer_opening_debts', 'crm_customer_receipt_adjustments']
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const assert = (ok, message) => { if (!ok) throw Error(message) }
const cents = value => {
  const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/)
  assert(match, '金额必须为非负、精确至分的原始值')
  return BigInt(match[1] + (match[2] || '').padEnd(2, '0'))
}
const number = value => Number(value) / 100
const active = row => !row.status || row.status === 'posted'
const targetId = row => row.target_id || row.sale_id || row.flow_settlement_id || ''
const targetType = row => row.target_type || 'sale'
function snapshotHash(tables) {
  return digest(Object.fromEntries(TABLES.map(name => {
    assert(Array.isArray(tables[name]), `原始集合缺失：${name}`)
    const rows = [...tables[name]].sort((a, b) => String(a._id).localeCompare(String(b._id)))
    assert(rows.every(row => row._id) && new Set(rows.map(row => row._id)).size === rows.length, `原始编号缺失或重复：${name}`)
    return [name, rows]
  })))
}
function batchId(scope) {
  assert(scope?.customer_id && scope?.conversion_key, '转换范围未锁定')
  return digest({ customer_id: scope.customer_id, conversion_key: scope.conversion_key }).slice(0, 24)
}
function buildPlan(snapshot, evidence, scope, actor, now) {
  assert(scope?.locked === true && Array.isArray(scope.targets) && scope.targets.length === scope.expected_target_count && scope.targets.length > 0, '真实目标未锁定，禁止生成执行计划')
  const ids = scope.targets.map(row => row.sale_id)
  assert(new Set(ids).size === ids.length && ids.every(Boolean), '转换目标编号重复或缺失')
  assert(/^\d{4}-\d{2}-\d{2}$/.test(scope.receipt_date || '') && cents(scope.amount) > 0n, '收款日期或金额未锁定')
  assert(snapshot?.complete === true && snapshot.customer_id === scope.customer_id && snapshot.snapshot_hash === snapshotHash(snapshot.tables), '原始快照不完整或哈希不符')
  assert(evidence?.confirmed_by_user === true && evidence.customer_id === scope.customer_id && evidence.scope_hash === digest(scope) && evidence.source_snapshot_hash === snapshot.snapshot_hash, '确认依据、范围或原值版本不符')
  assert(/^[a-f0-9]{64}$/.test(evidence.approval_sha256 || '') && /^[a-f0-9]{40}$/.test(evidence.source_commit || ''), '缺少用户确认或源码版本依据')
  assert(actor?._id && Number.isSafeInteger(now) && now > 0, '缺少执行人或记录时间')
  const guard = snapshot.scope_guard
  assert(guard?.reverse_link_query_complete === true && guard.cross_customer_link_count === 0 && guard.fixed_id_query_complete === true && guard.fixed_id_existing_count === 0 && guard.same_amount_receipt_query_complete === true && guard.same_amount_receipt_count === 0, '跨客户关联、固定编号或同额收款检查未通过')
  const tables = snapshot.tables
  assert(Object.keys(tables).sort().join('|') === [...TABLES].sort().join('|'), '快照集合范围不符')
  assert(tables.crm_customers.length === 1 && tables.crm_customers[0]._id === scope.customer_id, '客户范围不符')
  for (const name of TABLES.filter(name => name !== 'crm_customers')) assert(tables[name].every(row => row.customer_id === scope.customer_id), `存在范围外原始行：${name}`)
  assert(tables.crm_customer_receipts.every(row => ['posted', 'void'].includes(row.status)), '存在未确认的收款状态')
  assert(tables.crm_customer_allocations.every(row => !row.status || ['posted', 'void'].includes(row.status)), '存在未确认的分配状态')
  assert(!tables.crm_customer_receipt_adjustments.some(row => row.status === 'pending') && !tables.crm_customer_receipts.some(row => row.receipt_adjustment_status === 'pending'), '存在进行中的收款调整')
  const runId = batchId(scope), stableId = key => digest(`${runId}:${key}`).slice(0, 24)
  // Even void same-event candidates require a deliberate review; never silently replace or duplicate them.
  const candidates = tables.crm_customer_receipts.filter(row => row.source_id === runId ||
    (Number(row.amount) >= 0 && cents(row.amount || 0) === cents(scope.amount)))
  assert(candidates.length === 0, `已存在同批次或同额收款，须先核对，禁止重复创建：${candidates.map(row => `${row._id}/${row.status}`).join(',')}`)
  const receiptMap = new Map(tables.crm_customer_receipts.map(row => [row._id, row]))
  const targetSet = new Set(ids), backing = new Map(ids.map(id => [id, 0n]))
  for (const row of tables.crm_customer_allocations.filter(active)) {
    if (targetType(row) !== 'sale' || !targetSet.has(targetId(row))) continue
    assert(['receipt', 'rounding'].includes(row.allocate_kind || 'receipt'), '目标存在未知分配类型')
    const amount = cents(row.allocate_amount || 0)
    if (!amount) continue
    const receipt = receiptMap.get(row.receipt_id)
    assert(receipt?.status === 'posted', `有效目标分配缺少有效原始收款：${row._id}`)
    assert(Number(receipt.amount) >= 0, `目标分配关联负收款，须单独核对：${row._id}`)
    if ((row.allocate_kind || 'receipt') === 'receipt') backing.set(targetId(row), backing.get(targetId(row)) + amount)
  }
  const targets = scope.targets.map(target => {
    const sale = tables.crm_sale_records.find(row => row._id === target.sale_id)
    assert(sale && digest(sale) === target.source_hash, `目标原值已变化：${target.sale_id}`)
    assert(sale.price_unit === scope.price_unit && (!sale.settlement_mode || sale.settlement_mode === 'sale') && sale.date < scope.receipt_date, '目标计价/结算归属或源单日期不符')
    const missing = cents(sale.amount_received || 0) - backing.get(sale._id)
    assert(missing > 0n && missing === cents(target.cash_amount), `确认现金与当前未背书已收不符：${sale._id}`)
    return { sale, amount: missing, existing_backing: number(backing.get(sale._id)) }
  })
  assert(targets.reduce((sum, row) => sum + row.amount, 0n) === cents(scope.amount), '逐单确认现金合计不符')
  const customer = tables.crm_customers[0]
  const base = { customer_id: scope.customer_id, customer_name: customer.name, request_id: runId,
    created_at: now, created_by: actor._id, created_by_name: actor.username || '' }
  const receiptId = stableId('receipt')
  const sourceType = 'legacy_received_confirmation'
  const receipt = { ...base, _id: receiptId, biz_date: scope.receipt_date, amount: number(cents(scope.amount)),
    allocated_amount: number(cents(scope.amount)), unallocated_amount: 0, rounding_amount: 0, rounding_allocated_amount: 0,
    payment_method: 'unknown', entry_kind: 'prepay', source_type: sourceType, source_id: runId, status: 'posted', updated_at: now,
    allocation_mode: 'checked', allocation_start_date: targets.map(row => row.sale.date).sort()[0], allocation_end_date: scope.receipt_date,
    allocation_targets: ids.map(id => ({ target_type: 'sale', target_id: id })),
    note: `依据用户确认及会计凭证${scope.voucher_no || '待填'}转换历史收款并补充关联，到账日期${scope.receipt_date}；未新增实际收款、不重复增加源单已收；渠道待核。销售抹零、非现金冲抵及期初保持原值。转换批次 ${runId}` }
  const allocations = targets.map(({ sale, amount }, index) => ({ ...base,
    _id: stableId(`allocation:${sale._id}`), receipt_id: receiptId, sale_id: sale._id, sale_date: sale.date,
    target_type: 'sale', target_id: sale._id, target_title: `销售单 ${sale.date} / ${sale._id.slice(-6)}`,
    flow_settlement_id: null, biz_date: scope.receipt_date, allocate_kind: 'receipt', allocate_amount: number(amount),
    status: 'posted', seq: index + 1, source_type: sourceType, source_id: runId, allocation_mode: 'checked',
    allocation_start_date: sale.date, allocation_end_date: scope.receipt_date,
    note: `为既有销售内嵌已收补充正式收款关联；不再增加amount_received，不分配抹零或冲抵。转换批次 ${runId}` }))
  const guards = [{ table: 'crm_customers', row: customer }, ...targets.map(({ sale }) => ({ table: 'crm_sale_records', row: sale }))]
  assert(guards.every(({ row }) => !row.updated_at || now > row.updated_at), '版本保护时间必须晚于原版本')
  const writes = [...guards.map(({ table, row }) => ({ table, id: row._id, before: row, patch: { updated_at: now }, after: { ...row, updated_at: now } })),
    { table: 'crm_customer_receipts', id: receiptId, before: null, after: receipt },
    ...allocations.map(row => ({ table: 'crm_customer_allocations', id: row._id, before: null, after: row }))]
  const plan = { run_id: runId, rule_version: VERSION, customer_id: scope.customer_id, scope, evidence,
    source_snapshot_hash: snapshot.snapshot_hash, writes,
    summary: { receipt_id: receiptId, receipt_date: scope.receipt_date, cash_amount: number(cents(scope.amount)),
      receipt_count: 1, allocation_count: allocations.length, source_business_documents_changed: 0, metadata_documents_changed: guards.length, rounding_migrated: 0,
      source_targets: targets.map(row => ({ sale_id: row.sale._id, cash_amount: number(row.amount), existing_backing: row.existing_backing })),
      period_effect: '收款日前的旧源单日推导退出；收款日记现金。收款日后净欠款不变，原抹零日期不迁移。' } }
  plan.plan_hash = digest(plan)
  return plan
}
function expectedAfter(before, plan) {
  const tables = JSON.parse(JSON.stringify(before.tables))
  for (const write of plan.writes) {
    const index = tables[write.table].findIndex(row => row._id === write.id)
    if (write.before) {
      assert(index >= 0 && digest(tables[write.table][index]) === digest(write.before), '计划原始编号或值不符')
      tables[write.table][index] = JSON.parse(JSON.stringify(write.after))
    } else {
      assert(index < 0, '计划新编号已存在')
      tables[write.table].push(JSON.parse(JSON.stringify(write.after)))
    }
  }
  return snapshotHash(tables)
}
module.exports = { VERSION, TABLES, digest, cents, batchId, snapshotHash, buildPlan, expectedAfter }
