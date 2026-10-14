'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
const { depositDb } = require('./lib/customerDepositTestHarness.cjs')
const { readComplete } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/financialReadLocal')
const { createAuditService, CACHE_FIELDS } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/reconciliationAudit')
const saleAccounting = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/saleAccountingLocal')
const { prepayPatch } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/depositTransactionLocal')
const actor = { _id: 'finance-test', username: '合成会计', role: 'finance' }
const cid = 'customer-test'
const saleSnapshot = row => {
  const { amounts } = saleAccounting.computeSaleAmountsForDoc(row)
  return { should_receive: amounts.should_receive, should_receive_effective: amounts.effective_should_receive, rounding_amount: amounts.rounding_amount,
    outstanding: Math.max(0, amounts.effective_should_receive - row.amount_received - (row.receipt_rounding_amount || 0)) }
}
const debtSnapshot = row => ({ should_receive_effective: row.amount - (row.rounding_amount || 0), rounding_amount: row.rounding_amount || 0,
  outstanding: Math.max(0, row.amount - (row.rounding_amount || 0) - row.amount_received - (row.receipt_rounding_amount || 0)) })
function harness(hooks = {}, overrides = {}) {
  const state = {
    crm_customers: [{ _id: cid, name: '合成客户', default_price_unit: 'kg',
      ...Object.fromEntries(CACHE_FIELDS.map(k => [k, 999])), amount_received_total: 999, updated_at: 1 }],
    crm_sale_records: [{ _id: 'sale-test', customer_id: cid, date: '2026-08-18', biz_mode: 'truck', price_unit: 'kg',
      unit_price: 1, truck_out_gross: 22942.5, truck_back_gross: 0, rounding_amount: 2.5, amount_received: 22940, updated_at: 1 }],
    crm_customer_receipts: [{ _id: 'receipt-test', customer_id: cid, biz_date: '2026-08-18', amount: 23900,
      allocated_amount: 22940, unallocated_amount: 960, status: 'posted', payment_method: 'bank', updated_at: 1 }],
    crm_customer_allocations: [{ _id: 'allocation-test', customer_id: cid, receipt_id: 'receipt-test', target_type: 'sale', target_id: 'sale-test',
      allocate_kind: 'receipt', allocate_amount: 22940, request_id: 'arrival-operation', seq: 1, updated_at: 1 }],
    crm_customer_flow_settlements: [], crm_customer_opening_debts: [], crm_cashier_intakes: [], crm_customer_receipt_adjustments: [], crm_operation_logs: []
  }
  // Match the established Alipay failure mode: transaction doc(id).get throws
  // when the deterministic ID has never existed. Existing rows return objects.
  const db = depositDb(state, { transactionDocumentObject: true, ...hooks })
  const service = createAuditService({ db, command: db.command, readComplete, moneyScale: () => 2,
    saleSnapshot, flowSnapshot: debtSnapshot, debtSnapshot, computeBalances: s => {
      const receivable = [...s.sales.map(saleSnapshot), ...s.flows.filter(r => r.status === 'posted').map(debtSnapshot),
        ...s.debts.filter(r => r.status === 'posted').map(debtSnapshot)].reduce((a, r) => a + r.outstanding, 0)
      const prepay = prepayPatch(s.receipts)
      return { ...prepay, receivable_balance: receivable, net_balance: receivable - prepay.prepay_balance,
        amount_received_total: -123, receipt_allocation_revision: 'must-not-write', updated_at: 999 }
    }, ...overrides })
  return { state, db, run: (action, data = {}, user = actor) => service.run(action, { customer_id: cid, ...data }, user) }
}
const inspect = h => h.run('inspectReconciliationCustomerV1')
const refresh = (h, hash, op = 'cache-operation-test') => h.run('refreshReconciliationCacheV1', { expected_source_hash: hash, operation_id: op })

test('first refresh and same-operation replay work with Alipay absent-transaction-document errors and cache-only writes', async () => {
  const h = harness(), original = structuredClone(h.state), before = await inspect(h)
  assert.equal(before.complete, true)
  assert.equal(before.cache.stale, true)
  assert.equal(before.cache.expected.prepay_balance, 960)
  assert.equal(before.cache.expected.receivable_balance, 0)
  const result = await refresh(h, before.source_hash)
  assert.equal(result.status, 'refreshed')
  assert.equal(result.verified, true)
  for (const table of Object.keys(original).filter(k => !['crm_customers', 'crm_operation_logs'].includes(k)))
    assert.deepEqual(h.state[table], original[table], `original ${table} unchanged`)
  assert.equal(h.state.crm_customers[0].amount_received_total, 999)
  assert.equal(h.state.crm_customers[0].updated_at, 1)
  assert.equal(h.state.crm_customers[0].receipt_allocation_revision, undefined)
  assert.equal((await inspect(h)).source_hash, before.source_hash)
  const writes = h.db.writes.length
  assert.equal((await refresh(h, before.source_hash)).idempotent, true)
  assert.equal(h.db.writes.length, writes)
  assert.equal((await h.run('getReconciliationCacheOperationV1', { operation_id: 'cache-operation-test' })).verified, true)
})

test('audit harness rejects a missing transaction document by default', async () => {
  const h = harness(), tx = await h.db.startTransaction()
  await assert.rejects(tx.collection('crm_operation_logs').doc('never-created-operation').get(), /missing transaction document/)
  await tx.rollback()
  assert.equal(h.db.writes.length, 0)
})

test('same generic path handles another customer without customer-name rules', async () => {
  const h = harness()
  for (const rows of Object.values(h.state)) for (const row of rows) {
    if (row.customer_id === cid) row.customer_id = 'another-customer'
    if (row._id === cid) row._id = 'another-customer'
  }
  const audit = await h.run('inspectReconciliationCustomerV1', { customer_id: 'another-customer' })
  assert.equal(audit.complete, true)
  assert.equal((await h.run('refreshReconciliationCacheV1', { customer_id: 'another-customer', expected_source_hash: audit.source_hash,
    operation_id: 'second-customer-operation' })).status, 'refreshed')
})

test('unbacked legacy cash and nonconserved receipt availability remain issues, never repaired as caches', async () => {
  const h = harness()
  h.state.crm_customer_allocations = []
  h.state.crm_customer_receipts[0].unallocated_amount = 950
  const audit = await inspect(h)
  assert.equal(audit.complete, false)
  assert.equal(audit.read_complete, true)
  assert.equal(audit.cache.expected, null)
  assert.ok(audit.issues.some(i => i.code === 'embedded_receipt_without_backing'))
  assert.ok(audit.issues.some(i => i.code === 'receipt_not_conserved'))
  await assert.rejects(refresh(h, audit.source_hash), /待核问题/)
  assert.equal(h.db.writes.length, 0)
})

test('linked actual refunds conserve source balances; pending or missing reverse evidence prevents refresh', async () => {
  const h = harness(), source = h.state.crm_customer_receipts[0]
  source.cash_refunded_amount = 100; source.unallocated_amount -= 100
  h.state.crm_customer_receipts.push({ _id: 'refund-test', customer_id: cid, amount: -100, biz_date: '2026-08-19',
    allocated_amount: 0, unallocated_amount: 0, rounding_amount: 0, rounding_allocated_amount: 0,
    status: 'posted', source_type: 'customer_cash_refund', refund_source_status: 'linked', refund_sources: [{ id: source._id, amount: 100 }] })
  let audit = await inspect(h)
  assert.equal(audit.complete, true)
  assert.equal(audit.cache.expected.prepay_balance, 860)
  h.state.crm_customer_receipts[1].refund_source_status = 'pending'
  audit = await inspect(h)
  assert.equal(audit.complete, false)
  assert.ok(audit.issues.some(i => i.code === 'refund_source_pending'))
  h.state.crm_customer_receipts.pop()
  assert.ok((await inspect(h)).issues.some(i => i.code === 'refund_backing_mismatch'))
})

test('confirmed two-yuan source discount is preserved; reversal accumulation is deduplicated by actual original', async () => {
  const h = harness(), sale = h.state.crm_sale_records[0], receipt = h.state.crm_customer_receipts[0]
  Object.assign(sale, { truck_out_gross: 472, rounding_amount: 2, amount_received: 470 })
  Object.assign(receipt, { amount: 470, allocated_amount: 470, unallocated_amount: 0 })
  h.state.crm_customer_allocations[0].allocate_amount = 470
  assert.equal((await inspect(h)).complete, true)
  const source = { type: 'target_rounding', id: sale._id, target_type: 'sale', target_id: sale._id, source_key: 'target_rounding:sale:sale-test' }
  const reversal = { _id: 'reverse-one', customer_id: cid, source_type: 'balance_adjustment', adjustment_kind: 'rounding_reversal',
    adjustment_source: source, status: 'posted', amount: 1.5, amount_received: 0, biz_date: '2026-10-01' }
  h.state.crm_customer_opening_debts.push(reversal)
  assert.equal((await inspect(h)).cache.expected.receivable_balance, 1.5)
  h.state.crm_customer_opening_debts.push({ ...reversal, _id: 'reverse-two', adjustment_source: { ...source, source_key: 'forged-different-key' } })
  const audit = await inspect(h)
  assert.ok(audit.issues.some(i => i.code === 'adjustment_source_identity_mismatch'))
  assert.ok(audit.issues.some(i => i.code === 'rounding_reversal_exceeded'))
})

test('多收款结清 consumes existing money without an additional cash event', async () => {
  const h = harness(), receipt = h.state.crm_customer_receipts[0]
  receipt.allocated_amount += 960; receipt.unallocated_amount = 0
  h.state.crm_customer_opening_debts.push({ _id: 'writeoff-test', customer_id: cid, source_type: 'balance_adjustment',
    adjustment_kind: 'prepay_writeoff', adjustment_source: { type: 'receipt_credit', id: receipt._id, receipt_id: receipt._id, source_key: 'receipt_credit:receipt-test' },
    adjustment_allocation_id: 'allocation-writeoff', amount: 960, amount_received: 960, biz_date: '2026-10-01', status: 'posted' })
  h.state.crm_customer_allocations.push({ _id: 'allocation-writeoff', customer_id: cid, receipt_id: receipt._id,
    target_type: 'balance_adjustment', target_id: 'writeoff-test', source_type: 'prepay_writeoff', allocate_kind: 'receipt', allocate_amount: 960 })
  const audit = await inspect(h)
  assert.equal(audit.complete, true)
  assert.equal(audit.cache.expected.net_balance, 0)
  assert.equal(audit.sources.receipts.length, 1)
  assert.equal(audit.sources.receipts[0].amount, 23900)
})

test('past-period source date changes invalidate hashes and operation ids cannot be reused for new inputs', async () => {
  const h = harness(), initial = await inspect(h)
  await refresh(h, initial.source_hash)
  h.state.crm_customer_receipts[0].biz_date = '2026-07-31'
  const changed = await inspect(h)
  assert.notEqual(changed.source_hash, initial.source_hash)
  await assert.rejects(refresh(h, initial.source_hash, 'new-operation-test'), /来源已经变化/)
  await assert.rejects(refresh(h, changed.source_hash), /已有不同来源版本/)
  const prior = await h.run('getReconciliationCacheOperationV1', { operation_id: 'cache-operation-test' })
  assert.equal(prior.status, 'needs_recheck')
  assert.equal(prior.verified, false)
})

test('source changes during transaction and write failure roll back both cache and audit log', async () => {
  let h = harness({ txWrite: (kind, name) => {
    if (name === 'crm_customers') h.state.crm_customer_receipts[0].biz_date = '2026-08-20'
  } })
  let before = await inspect(h)
  await assert.rejects(refresh(h, before.source_hash), /范围或客户原值变化/)
  assert.equal(h.state.crm_customers[0].prepay_balance, 999)
  assert.equal(h.state.crm_operation_logs.length, 0)
  h = harness({ txWrite: (kind, name) => { if (name === 'crm_operation_logs') throw Error('synthetic write failure') } })
  before = await inspect(h)
  await assert.rejects(refresh(h, before.source_hash), /synthetic write failure/)
  assert.equal(h.state.crm_customers[0].prepay_balance, 999)
  assert.equal(h.state.crm_operation_logs.length, 0)
})

test('unknown/missing values, foreign references and merged scopes stay pending', async () => {
  const h = harness()
  delete h.state.crm_sale_records[0].amount_received
  h.state.crm_customers.push({ _id: 'alias-test', settlement_customer_id: cid })
  h.state.crm_customer_allocations.push({ _id: 'foreign-allocation', customer_id: 'foreign-customer', receipt_id: 'receipt-test', allocate_amount: 1 })
  const audit = await inspect(h)
  assert.equal(audit.complete, false)
  assert.ok(audit.issues.some(i => i.code === 'invalid_amount'))
  assert.ok(audit.issues.some(i => i.code === 'settlement_scope_requires_review'))
  assert.ok(audit.issues.some(i => i.code === 'cross_customer_reference'))
  assert.equal(audit.cache.stale, null)
})

test('incomplete collection reads are not represented as zero or a successful audit', async () => {
  const h = harness({ count: name => { if (name === 'crm_customer_receipts') throw Error('synthetic missing page'); return { total: 0 } } })
  const audit = await inspect(h)
  assert.equal(audit.complete, false)
  assert.equal(audit.read_complete, false)
  assert.equal(audit.source_hash, null)
  assert.equal(audit.cache.expected, null)
  assert.equal(h.db.writes.length, 0)
})

test('missing original price is not turned into a valid zero-value unpaid sale', async () => {
  const h = harness()
  delete h.state.crm_sale_records[0].unit_price
  Object.assign(h.state.crm_sale_records[0], { amount_received: 0, rounding_amount: 0 })
  h.state.crm_customer_receipts = []; h.state.crm_customer_allocations = []
  const audit = await inspect(h)
  assert.equal(audit.complete, false)
  assert.ok(audit.issues.some(i => i.code === 'sale_price_missing'))
  assert.equal(audit.cache.expected, null)
})

test('cashier header is a reference, not another receipt, and must conserve its split', async () => {
  const h = harness(), receipt = h.state.crm_customer_receipts[0]
  Object.assign(receipt, { source_type: 'cashier_intake', intake_id: 'header-test' })
  h.state.crm_cashier_intakes.push({ _id: 'header-test', customer_id: cid, status: 'posted', amount: 23900,
    gas_amount: 23900, deposit_amount: 0, receipt_id: receipt._id, biz_date: receipt.biz_date, payment_method: receipt.payment_method })
  assert.equal((await inspect(h)).complete, true)
  h.state.crm_cashier_intakes[0].amount = 23901
  assert.ok((await inspect(h)).issues.some(i => i.code === 'cashier_split_mismatch'))
})

test('equal amounts alone are not duplicates; duplicate operation identities are flagged', async () => {
  const h = harness()
  const second = { ...h.state.crm_customer_allocations[0], _id: 'another-partial', allocate_amount: 11470 }
  h.state.crm_customer_allocations[0].allocate_amount = 11470
  h.state.crm_customer_allocations.push({ ...second, request_id: 'other-operation' })
  assert.equal((await inspect(h)).complete, true)
  h.state.crm_customer_allocations[1].request_id = 'arrival-operation'
  assert.ok((await inspect(h)).issues.some(i => i.code === 'duplicate_allocation_operation'))
})

test('source hash tracks cashier headers and visibility changes; nonfinancial users cannot inspect or refresh', async () => {
  let visibility = 'scope-one'
  const h = harness({}, { resolveSalesScope: async () => ({ where: { customer_id: cid }, version: visibility }) })
  const a = await inspect(h)
  visibility = 'scope-two'
  const b = await inspect(h)
  assert.notEqual(a.source_hash, b.source_hash)
  h.state.crm_cashier_intakes.push({ _id: 'header-test', customer_id: cid, status: 'posted', gas_amount: 23900, receipt_id: 'receipt-test', biz_date: '2026-08-18' })
  assert.notEqual(b.source_hash, (await inspect(h)).source_hash)
  await assert.rejects(h.run('inspectReconciliationCustomerV1', {}, { _id: 'sales-user', role: 'sales' }), /仅会计/)
})

test('real settlement handler uses authoritative snapshots, preserves two-yuan discount and validates cache writeback', async () => {
  const h = harness()
  h.state.crm_users = [{ _id: actor._id, token: 'test', role: 'superadmin' }]
  Object.assign(h.state.crm_sale_records[0], { truck_out_gross: 472, rounding_amount: 2, amount_received: 470 })
  Object.assign(h.state.crm_customer_receipts[0], { amount: 470, allocated_amount: 470, unallocated_amount: 0 })
  h.state.crm_customer_allocations[0].allocate_amount = 470
  const originalSales = structuredClone(h.state.crm_sale_records), handler = loadHandler('crm-customer-settlement', h.db)
  const first = await invoke(handler, 'inspectReconciliationCustomerV1', { customer_id: cid })
  assert.equal(first.code, 0, first.msg)
  assert.equal(first.data.complete, true, JSON.stringify(first.data.issues))
  assert.equal(first.data.cache.expected.net_balance, 0)
  const saved = await invoke(handler, 'refreshReconciliationCacheV1', { customer_id: cid, expected_source_hash: first.data.source_hash,
    operation_id: 'real-handler-operation' })
  assert.equal(saved.code, 0, saved.msg)
  assert.equal(saved.data.status, 'refreshed')
  assert.deepEqual(h.state.crm_sale_records, originalSales)
  assert.equal(h.state.crm_operation_logs[0].detail.before.prepay_balance, 999)
})

test('real handler handles three-decimal flow and opening-debt amounts without using sales precision', async () => {
  const h = harness()
  h.state.crm_users = [{ _id: actor._id, token: 'test', role: 'superadmin' }]
  h.state.crm_customers[0].default_price_unit = 'm3'
  h.state.crm_customer_flow_settlements.push({ _id: 'flow-test', customer_id: cid, status: 'posted', biz_date: '2026-09-01', should_receive: 123.456, amount_received: 0 })
  h.state.crm_customer_opening_debts.push({ _id: 'opening-test', customer_id: cid, status: 'posted', biz_date: '2026-01-01', amount: 0.123, money_scale: 3, amount_received: 0 })
  const handler = loadHandler('crm-customer-settlement', h.db)
  const result = await invoke(handler, 'inspectReconciliationCustomerV1', { customer_id: cid })
  assert.equal(result.code, 0, result.msg)
  assert.equal(result.data.complete, true, JSON.stringify(result.data.issues))
  assert.equal(result.data.money_scale, 3)
  assert.equal(result.data.cache.expected.receivable_balance, 123.579)
})

test('post-commit change returns needs_recheck and committed evidence, never a false repaired result', async () => {
  const h = harness(), start = h.db.startTransaction
  h.db.startTransaction = async () => {
    const tx = await start(), commit = tx.commit
    tx.commit = async () => { await commit(); h.state.crm_customer_receipts[0].biz_date = '2026-08-20' }
    return tx
  }
  const audit = await inspect(h), result = await refresh(h, audit.source_hash)
  assert.equal(result.committed, true)
  assert.equal(result.verified, false)
  assert.equal(result.status, 'needs_recheck')
  assert.equal(h.state.crm_operation_logs.length, 1)
})

test('timeout after successful commit recovers original operation and verifies it without another write', async () => {
  const h = harness(), start = h.db.startTransaction
  h.db.startTransaction = async () => {
    const tx = await start(), commit = tx.commit
    tx.commit = async () => { await commit(); throw Error('synthetic transport timeout') }
    return tx
  }
  const audit = await inspect(h), result = await refresh(h, audit.source_hash)
  assert.equal(result.status, 'refreshed')
  assert.equal(result.idempotent, true)
  assert.equal(h.state.crm_operation_logs.length, 1)
})

test('source facts retain signed authoritative yuan and existing negative-sale issue decisions without changing originals', async () => {
  const h = harness()
  h.state.crm_users = [{ _id: actor._id, token: 'test', role: 'superadmin' }]
  Object.assign(h.state.crm_sale_records[0], { biz_mode: 'bottle', out_items: [], back_items: [{ net: 8 }],
    unit_price: 7.5, should_receive: 9999, rounding_amount: 0, amount_received: 0, source_number: 'SALE-TEST-8' })
  h.state.crm_customer_receipts = []; h.state.crm_customer_allocations = []
  const original = structuredClone(h.state), result = await invoke(loadHandler('crm-customer-settlement', h.db),
    'inspectReconciliationCustomerV1', { customer_id: cid })
  assert.equal(result.code, 0, result.msg)
  const audit = result.data
  assert.equal(audit.read_complete, true)
  assert.equal(audit.complete, false)
  assert.equal(audit.cache.eligible, false)
  assert.deepEqual(Array.from(audit.issues, row => row.code), ['invalid_amount', 'source_rounding_exceeded'])
  for (const problem of audit.issues) {
    assert.equal(problem.blocking, true)
    assert.equal(problem.source_facts.biz_date, '2026-08-18')
    assert.equal(problem.source_facts.source_type, 'sale')
    assert.equal(problem.source_facts.source_number, 'SALE-TEST-8')
    assert.equal(problem.source_facts.amounts.should_receive, -60)
    assert.equal(problem.source_facts.amounts.effective_should_receive, -60)
    assert.equal(problem.source_facts.amounts.rounding_amount, 0)
    assert.equal(problem.source_facts.amounts.amount_received, 0)
  }
  assert.equal(audit.issues[0].source_facts.validation_failure, 'negative')
  assert.equal(audit.issues[0].source_facts.field, 'effective_should_receive')
  assert.deepEqual(h.state, original)
  assert.equal(h.db.writes.length, 0)
})

test('source amount diagnostics distinguish missing, invalid, precision, negative and range without fabricating zero', async () => {
  for (const [value, failure, displayed] of [[undefined, 'missing', null], [null, 'missing', null], ['', 'missing', null],
    ['bad', 'invalid', null], [true, 'invalid', null], [Infinity, 'invalid', null],
    [0.001, 'precision', 0.001], [-0.5, 'negative', -0.5], [Number.MAX_VALUE, 'out_of_range', Number.MAX_VALUE]]) {
    const h = harness()
    h.state.crm_sale_records[0].amount_received = value
    const audit = await inspect(h), problem = audit.issues.find(row => row.code === 'invalid_amount' && row.details.field === 'amount_received')
    assert.ok(problem, failure)
    assert.equal(problem.source_facts.validation_failure, failure)
    assert.equal(problem.source_facts.field, 'amount_received')
    assert.equal(problem.source_facts.amounts.amount_received, displayed)
    assert.equal(problem.blocking, true)
    assert.equal(audit.complete, false)
    assert.equal(audit.cache.eligible, false)
    assert.equal(h.db.writes.length, 0)
  }
})

test('missing sale calculation inputs expose unknown principal instead of adapter fallback zero', async () => {
  const h = harness()
  delete h.state.crm_sale_records[0].unit_price
  Object.assign(h.state.crm_sale_records[0], { amount_received: 0, rounding_amount: 0 })
  h.state.crm_customer_receipts = []; h.state.crm_customer_allocations = []
  const audit = await inspect(h), problem = audit.issues.find(row => row.code === 'sale_price_missing')
  assert.equal(problem.source_facts.amounts.should_receive, null)
  assert.equal(problem.source_facts.amounts.effective_should_receive, null)
  assert.equal(problem.source_facts.amounts.amount_received, 0)
  assert.equal(audit.complete, false)
})

test('source facts distinguish principal before and after discount and do not accept an invalid calendar date', async () => {
  const h = harness()
  Object.assign(h.state.crm_sale_records[0], { date: '2026-02-30', should_receive: 9999 })
  const audit = await inspect(h), problem = audit.issues.find(row => row.code === 'source_date_missing')
  assert.equal(problem.source_facts.biz_date, null)
  assert.equal(problem.source_facts.amounts.should_receive, 22942.5)
  assert.equal(problem.source_facts.amounts.rounding_amount, 2.5)
  assert.equal(problem.source_facts.amounts.effective_should_receive, 22940)
  assert.equal(problem.source_facts.amounts.amount_received, 22940)
})

test('sale without an authoritative snapshot does not display a legacy saved principal as authoritative', async () => {
  const h = harness()
  Object.assign(h.state.crm_sale_records[0], { status: 'pending', should_receive: 9999 })
  const audit = await inspect(h), problem = audit.issues.find(row => row.code === 'sale_status_requires_review')
  assert.equal(problem.source_facts.status, 'pending')
  assert.equal(problem.source_facts.amounts.should_receive, null)
  assert.equal(problem.source_facts.amounts.effective_should_receive, null)
  assert.equal(problem.source_facts.amounts.rounding_amount, 2.5)
  assert.equal(audit.complete, false)
})

test('receipt status facts and flow amounts use the same source read and retain three-decimal yuan', async () => {
  const h = harness(), receipt = h.state.crm_customer_receipts[0]
  h.state.crm_users = [{ _id: actor._id, token: 'test', role: 'superadmin' }]
  h.state.crm_customers[0].default_price_unit = 'm3'
  Object.assign(receipt, { source_type: 'cashier_intake', entry_kind: 'prepay', receipt_adjustment_status: 'pending' })
  h.state.crm_customer_flow_settlements.push({ _id: 'flow-test', customer_id: cid, status: 'posted',
    biz_date: '2026-09-01', should_receive: 123.456, amount_received: 1.234 })
  const result = await invoke(loadHandler('crm-customer-settlement', h.db), 'inspectReconciliationCustomerV1', { customer_id: cid })
  assert.equal(result.code, 0, result.msg)
  const pending = result.data.issues.find(row => row.code === 'pending_receipt_adjustment')
  assert.equal(pending.source_facts.amounts.amount, 23900)
  assert.equal(pending.source_facts.amounts.unallocated_amount, 960)
  assert.equal(pending.source_facts.status, 'posted')
  assert.equal(pending.source_facts.receipt_adjustment_status, 'pending')
  assert.equal(pending.source_facts.source_type, 'cashier_intake')
  assert.equal(pending.source_facts.entry_kind, 'prepay')
  const flow = result.data.issues.find(row => row.source_type === 'flow_settlement')
  assert.equal(flow.source_facts.amounts.should_receive, 123.456)
  assert.equal(flow.source_facts.amounts.effective_should_receive, 123.456)
  assert.equal(flow.source_facts.amounts.amount_received, 1.234)
  assert.equal(h.db.writes.length, 0)
})
