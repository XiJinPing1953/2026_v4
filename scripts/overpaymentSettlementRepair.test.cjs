'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const compile = require('../uniCloud-alipay/cloudfunctions/crm-accounting-correction/overpaymentSettlementRepair')
const { digest } = require('../uniCloud-alipay/cloudfunctions/crm-accounting-correction/snapshot')
const { computeSaleAmountsForDoc } = require('../uniCloud-alipay/cloudfunctions/crm-accounting-correction/saleAccountingLocal')
const fen = value => {
  const n = Number(value), cents = Math.round(n * 100)
  assert.ok(Number.isFinite(n) && Number.isSafeInteger(cents) && Math.abs(n * 100 - cents) < 0.00001, '金额精度')
  return cents
}
function fixture(prefix = '') {
  const id = name => prefix + name, cid = id('customer'), rid = id('receipt'), sid = id('sale'), fid = id('fee')
  const t = { crm_customers: [{ _id: cid, name: '样例', default_price_unit: 'kg', should_receive_total: 1060 }],
    crm_sale_records: [{ _id: sid, customer_id: cid, date: '2026-01-02', price_unit: 'kg', settlement_mode: 'sale',
      out_items: [{ net: 100 }], back_items: [], unit_price: 10, amount_received: 1000, rounding_amount: 0,
      receipt_rounding_amount: 0, payment_status: 'paid' }],
    crm_customer_opening_debts: [{ _id: fid, customer_id: cid, status: 'posted', source_type: 'customer_other_fee_manual',
      biz_date: '2026-01-03', amount: 60, amount_received: 58, receipt_rounding_amount: 2, rounding_amount: 0,
      outstanding: 0, payment_status: 'paid' }],
    crm_customer_receipts: [{ _id: rid, customer_id: cid, status: 'posted', source_type: 'cashier_intake', entry_kind: 'prepay',
      biz_date: '2026-01-04', payment_method: 'wechat', proof_images: ['evidence'], amount: 1058, allocated_amount: 1058,
      unallocated_amount: 0, rounding_amount: 2, rounding_allocated_amount: 2, allocation_mode: 'period',
      receipt_adjustment_status: 'pending', receipt_adjustment_id: 'original-pending', receipt_adjustment_snapshot: null,
      receipt_adjustment_rollback_strategy: 'deferred', receipt_adjustment_started_at: 100 }],
    crm_customer_allocations: [
      { _id: id('sale-cash'), customer_id: cid, receipt_id: rid, target_type: 'sale', target_id: sid, sale_id: sid, allocate_kind: 'receipt', allocate_amount: 1000, seq: 1 },
      { _id: id('fee-cash'), customer_id: cid, receipt_id: rid, target_type: 'other_fee', target_id: fid, sale_id: fid, biz_date: '2026-01-04', allocate_kind: 'receipt', allocate_amount: 58, seq: 2 },
      { _id: id('fee-round'), customer_id: cid, receipt_id: rid, target_type: 'other_fee', target_id: fid, sale_id: fid, biz_date: '2026-01-04', allocate_kind: 'rounding', allocate_amount: 2, seq: 3 }
    ], crm_customer_receipt_adjustments: [], crm_cashier_intakes: [], crm_vouchers: [] }
  const request = { customer_id: cid, operation_id: 'settlement-reclass-test', evidence: { approval_sha256: 'a'.repeat(64) },
    corrections: [{ type: 'reclassify_overpayment_settlement', receipt_id: rid, fee_id: fid, discount_sale_id: sid,
      settlement_date: '2026-01-04', settlement_amount: 60, rounding_amount: 2, expected_pending_adjustment_id: 'original-pending' }] }
  return { t, request }
}
function run(input) {
  const { t, request } = input, writes = [], projected = structuredClone(t), seen = new Set()
  const patch = (table, row, changes) => {
    assert.ok(!seen.has(table + row._id)); seen.add(table + row._id)
    const after = { ...row, ...changes }; writes.push({ table, id: row._id, before: row, after })
    projected[table][projected[table].findIndex(item => item._id === row._id)] = after
  }
  const runId = digest({ customerId: request.customer_id, operationId: request.operation_id }).slice(0, 24)
  const add = (key, fields, table = 'crm_customer_allocations') => {
    const row = { _id: digest(runId + ':' + key).slice(0, 24), customer_id: request.customer_id, status: 'posted', ...fields }
    assert.ok(!projected[table].some(item => item._id === row._id)); projected[table].push(row)
    writes.push({ table, id: row._id, before: null, after: row }); return row._id
  }
  const summary = compile({ t, request, allocations: t.crm_customer_allocations.filter(row => !row.status || row.status === 'posted'),
    patch, add, fen, assert: (ok, message) => assert.ok(ok, message), computeSaleAmountsForDoc,
    actor: { _id: 'actor', username: 'reviewer' }, now: 1000 })
  return { summary, projected, writes }
}
test('通用重分类保留到账，撤销旧费用，优惠归销售并形成标准结清关联', () => {
  const input = fixture(), before = structuredClone(input), { summary, projected: t, writes } = run(input)
  assert.deepEqual(input, before, '编译不能改原输入')
  assert.equal(summary.settlement_income, 60); assert.equal(summary.sales_cash_after, 998)
  assert.equal(summary.rounding_moved, 2); assert.equal(summary.cash_amount_changed, 0)
  const receipt = t.crm_customer_receipts[0]
  for (const key of ['amount', 'biz_date', 'payment_method', 'proof_images', 'allocated_amount', 'unallocated_amount', 'rounding_amount', 'rounding_allocated_amount'])
    assert.deepEqual(receipt[key], before.t.crm_customer_receipts[0][key], key)
  assert.equal(receipt.receipt_adjustment_status, '')
  assert.equal(receipt.receipt_adjustment_completed_by_correction.previous_adjustment_id, 'original-pending')
  assert.equal(receipt.receipt_adjustment_snapshot, null)
  const oldFee = t.crm_customer_opening_debts[0], debt = t.crm_customer_opening_debts[1]
  assert.equal(oldFee.status, 'void'); assert.equal(oldFee.amount, 60); assert.equal(oldFee.amount_received, 0)
  assert.equal(debt.adjustment_kind, 'prepay_writeoff'); assert.equal(debt.amount_received, 60); assert.equal(debt.outstanding, 0)
  const cash = t.crm_customer_allocations.filter(row => row.status !== 'void' && row.allocate_kind === 'receipt')
  const round = t.crm_customer_allocations.filter(row => row.status !== 'void' && row.allocate_kind === 'rounding')
  assert.equal(cash.reduce((sum, row) => sum + fen(row.allocate_amount), 0), 105800)
  assert.equal(round.reduce((sum, row) => sum + fen(row.allocate_amount), 0), 200)
  assert.equal(t.crm_sale_records[0].amount_received, 998); assert.equal(t.crm_sale_records[0].receipt_rounding_amount, 2)
  const settlementAllocation = cash.find(row => row.target_type === 'balance_adjustment')
  assert.equal(settlementAllocation._id, debt.adjustment_allocation_id)
  assert.equal(settlementAllocation.target_id, debt._id); assert.equal(debt.adjustment_source.receipt_id, receipt._id)
  assert.equal(debt.adjustment_source.source_key, 'receipt_credit:' + receipt._id)
  assert.equal(t.crm_customer_allocations.filter(row => row.status === 'void').length, 2)
  assert.equal(writes.length, 9); assert.deepEqual(run(input), run(input), '计划和新增编号可重复')
})
test('同类另一客户直接复用，非pending原单亦可处理', () => {
  const a = run(fixture()), other = fixture('other-')
  other.t.crm_customer_receipts[0].receipt_adjustment_status = ''
  other.request.corrections[0].expected_pending_adjustment_id = ''
  const b = run(other)
  assert.equal(b.summary.settlement_income, a.summary.settlement_income)
  assert.notEqual(b.summary.adjustment_id, a.summary.adjustment_id)
  assert.ok(b.writes.every(row => row.after.customer_id === 'other-customer'))
})
test('金额、原分配、目标内嵌已收、来源或日期冲突均拒绝', () => {
  for (const mutate of [
    x => x.request.corrections[0].settlement_amount = 61,
    x => x.request.corrections[0].rounding_amount = 3,
    x => x.request.corrections[0].rounding_amount = 0,
    x => x.request.corrections[0].settlement_date = '2026-01-03',
    x => x.request.corrections[0].settlement_date = '2026-02-30',
    x => x.t.crm_customer_allocations[0].allocate_amount = 999,
    x => x.t.crm_sale_records[0].amount_received = 999,
    x => x.t.crm_sale_records[0].unit_price = 9,
    x => x.t.crm_sale_records[0].date = '2026-01-05',
    x => x.t.crm_customer_receipts[0].unallocated_amount = 1,
    x => x.t.crm_customer_receipts[0].source_type = 'opening_prepay',
    x => x.t.crm_customer_receipts[0].amount = '',
    x => x.t.crm_customer_opening_debts[0].amount_received = 57,
    x => x.t.crm_customer_opening_debts[0].customer_id = 'another',
    x => x.t.crm_customer_allocations[1].receipt_id = 'another',
    x => x.t.crm_customer_allocations[2].biz_date = '2026-01-05',
    x => x.request.corrections[0].arbitrary_patch = { amount: 1 }
  ]) { const input = fixture(); mutate(input); assert.throws(() => run(input)) }
})
test('无效、其他或有真实快照的pending状态不得顺便清除', () => {
  for (const mutate of [
    x => x.request.corrections[0].expected_pending_adjustment_id = 'changed',
    x => x.t.crm_customer_receipts[0].receipt_adjustment_snapshot = {},
    x => x.t.crm_customer_receipts[0].receipt_adjustment_rollback_strategy = 'physical',
    x => x.t.crm_customer_receipts[0].receipt_adjustment_status = '',
    x => x.t.crm_customer_receipt_adjustments.push({ status: 'pending' }),
    x => x.t.crm_customer_receipts.push({ _id: 'other', receipt_adjustment_status: 'pending' })
  ]) { const input = fixture(); mutate(input); assert.throws(() => run(input), /调整|状态/) }
})
test('退款、原费用其他占用或相关已有结清冲回拒绝', () => {
  for (const mutate of [
    x => x.t.crm_customer_receipts[0].cash_refunded_amount = 1,
    x => x.t.crm_customer_receipts[0].refund_source_status = 'pending',
    x => x.t.crm_customer_receipts.push({ _id: 'refund', status: 'posted', refund_sources: [{ id: 'receipt' }] }),
    x => x.t.crm_customer_receipts.push({ _id: 'refund', status: 'posted', source_type: 'customer_cash_refund', source_id: 'receipt' }),
    x => x.t.crm_customer_allocations.push({ ...x.t.crm_customer_allocations[1], _id: 'extra', receipt_id: 'other', allocate_amount: 1 }),
    x => x.t.crm_customer_opening_debts.push({ _id: 'adjustment', status: 'posted', source_type: 'balance_adjustment', adjustment_source: { receipt_id: 'receipt' } }),
    x => x.t.crm_customer_opening_debts.push({ _id: 'adjustment', status: 'posted', source_type: 'balance_adjustment', adjustment_source: { id: 'fee-round' } })
  ]) { const input = fixture(); mutate(input); assert.throws(() => run(input)) }
})
test('销售现金不足或无法解释的其他原分配不被自动调整', () => {
  const input = fixture()
  input.t.crm_customer_allocations[0].allocate_amount = 2
  input.t.crm_sale_records[0].amount_received = 2
  input.t.crm_customer_receipts[0].amount = 60
  input.t.crm_customer_receipts[0].allocated_amount = 60
  assert.throws(() => run(input))
  const other = fixture(); other.t.crm_customer_allocations[0].target_type = 'opening_debt'
  assert.throws(() => run(other), /销售|本版/)
})

test('到账主记录必须完全一致，相关有效凭证须停止另行处理', () => {
  const input = fixture()
  input.t.crm_customer_receipts[0].intake_id = 'intake'
  assert.throws(() => run(input), /主记录/)
  input.t.crm_cashier_intakes.push({ _id: 'intake', customer_id: 'customer', receipt_id: 'receipt', status: 'posted',
    gas_amount: 1058, deposit_amount: 0, amount: 1058, biz_date: '2026-01-04', payment_method: 'wechat' })
  assert.equal(run(input).summary.cash_amount_changed, 0)
  for (const mutate of [x => x.t.crm_cashier_intakes[0].gas_amount++, x => x.t.crm_cashier_intakes[0].amount++,
    x => x.t.crm_cashier_intakes[0].biz_date = '2026-01-03', x => x.t.crm_cashier_intakes[0].payment_method = 'cash',
    x => x.t.crm_cashier_intakes.push({ ...x.t.crm_cashier_intakes[0], _id: 'duplicate' })]) {
    const changed = structuredClone(input); mutate(changed); assert.throws(() => run(changed), /主记录/)
  }
  input.t.crm_vouchers.push({ _id: 'voucher', source: 'sale:sale', status: 'draft' })
  assert.throws(() => run(input), /凭证/)
})

test('完整保护入口拒绝源冲突，事务中断及演练回滚，正式提交与重试幂等', async () => {
  const { mutableDb } = require('./lib/mutableAccountingDb.cjs')
  const { loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
  const { snapshot } = require('../uniCloud-alipay/cloudfunctions/crm-accounting-correction/snapshot')
  const input = fixture('txn-'), ids = new Map(Object.values(input.t).flat().map(row => [row._id, digest(row._id).slice(0, 24)]))
  const replace = value => Array.isArray(value) ? value.map(replace) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, val]) => [key, replace(val)])) : ids.get(value) || value
  const { t: tables, request } = replace(input)
  for (const table of ['crm_customer_flow_settlements', 'crm_customer_deposit_accounts', 'crm_customer_deposit_entries',
    'crm_collection_tasks', 'crm_collection_followups', 'crm_cashier_intakes', 'crm_vouchers']) tables[table] = []
  const actor = { _id: 'actor', username: 'reviewer', token: 'test', role: 'superadmin' }
  tables.crm_users = [actor]; tables.crm_operation_logs = []
  const other = { _id: 'f'.repeat(24), name: '未涉及客户', prepay_balance: 200 }
  tables.crm_customers.push(other)
  const db = mutableDb(tables), handler = loadHandler('crm-accounting-correction', db)
  const initial = await snapshot(db, request.customer_id)
  request.expected_snapshot_hash = initial.snapshot_hash
  request.evidence = { confirmed_by_user: true, approval_sha256: 'a'.repeat(64), source_commit: 'b'.repeat(40) }
  let response = await invoke(handler, 'prepareV1', request)
  assert.equal(response.code, 0, response.msg)
  assert.equal(response.data.summary.writes, 10)
  const execution = { customer_id: request.customer_id, operation_id: request.operation_id, plan_hash: response.data.plan_hash }
  assert.equal((await invoke(handler, 'executeV1', execution)).code, 409, '未演练不允许提交')
  tables.crm_customer_receipts[0].note = '并发修改'
  assert.equal((await invoke(handler, 'rehearseV1', execution)).code, 409)
  delete tables.crm_customer_receipts[0].note
  response = await invoke(handler, 'rehearseV1', { ...execution, fail_after_writes: 7 })
  assert.equal(response.code, 0, response.msg); assert.equal(response.data.status, 'interruption_rolled_back')
  assert.equal((await snapshot(db, request.customer_id)).snapshot_hash, initial.snapshot_hash)
  response = await invoke(handler, 'rehearseV1', execution)
  assert.equal(response.code, 0, response.msg); assert.equal(response.data.status, 'rehearsed_rolled_back')
  assert.equal((await snapshot(db, request.customer_id)).snapshot_hash, initial.snapshot_hash)
  response = await invoke(handler, 'executeV1', execution)
  assert.equal(response.code, 0, response.msg); assert.equal(response.data.status, 'committed')
  const after = await snapshot(db, request.customer_id)
  assert.notEqual(after.snapshot_hash, initial.snapshot_hash)
  assert.equal(after.tables.crm_customer_receipts[0].amount, 1058)
  assert.equal(after.tables.crm_customer_receipts[0].receipt_adjustment_status, '')
  assert.equal(after.tables.crm_customer_opening_debts.filter(row => row.status === 'posted' && row.adjustment_kind === 'prepay_writeoff').length, 1)
  assert.deepEqual(tables.crm_customers.find(row => row._id === other._id), other)
  response = await invoke(handler, 'executeV1', execution)
  assert.equal(response.code, 0, response.msg); assert.equal(response.data.idempotent, true)
  assert.equal((await snapshot(db, request.customer_id)).snapshot_hash, after.snapshot_hash)
  const changed = structuredClone(request); changed.corrections[0].settlement_amount++
  assert.equal((await invoke(handler, 'prepareV1', changed)).code, 409, '原操作号不得复用到另一金额')
})

module.exports = { fixture, run }
