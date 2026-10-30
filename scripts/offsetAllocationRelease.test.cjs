'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb } = require('./lib/accountingTestHarness.cjs')
const { createService } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/offsetAllocationRelease')
const { sourceVersion } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/offsetOperation')
const { readComplete } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/financialReadLocal')
const user = { _id: 'finance', username: '隔离测试', role: 'finance' }
function fixture(hooks = {}, refreshBalances = async () => {}) {
	const state = { crm_customers: [{ _id: 'customer', updated_at: 1 }],
		crm_customer_receipts: [{ _id: 'credit', customer_id: 'customer', amount: 88, allocated_amount: 50, unallocated_amount: 38, rounding_allocated_amount: 0, source_type: 'sale_offset_credit', status: 'posted', updated_at: 1 }],
		crm_sale_records: [{ _id: 'sale', customer_id: 'customer', should: 100, amount_received: 50, receipt_rounding_amount: 0, payment_status: 'partial', updated_at: 1 }],
		crm_customer_allocations: [{ _id: 'allocation', customer_id: 'customer', receipt_id: 'credit', target_type: 'sale', target_id: 'sale', sale_id: 'sale', allocate_kind: 'receipt', allocate_amount: 50 }],
		crm_customer_opening_debts: [], crm_customer_flow_settlements: [], crm_operation_logs: [] }
	const db = makeDb(state, { mutate: true, transaction: true, txDocumentObject: true, ...hooks })
	const snapshot = row => ({ should_receive: row.should, should_receive_effective: row.should })
	const service = createService({ db, command: db.command, readComplete, saleSnapshot: snapshot, flowSnapshot: snapshot, debtSnapshot: snapshot, moneyScale: () => 2, refreshBalances })
	const request = () => ({ customer_id: 'customer', receipt_id: 'credit', operation_id: 'release-001', expected_source_version: sourceVersion(state.crm_customer_receipts[0]) })
	return { state, db, service, request }
}
test('release returns the full allocation to the original credit atomically and repeats return the old result', async () => {
	const h = fixture(), request = h.request()
	const result = await h.service.run(request, user)
	assert.equal(result.released_total, 50)
	assert.equal(h.state.crm_customer_receipts[0].unallocated_amount, 88)
	assert.equal(h.state.crm_sale_records[0].amount_received, 0)
	assert.equal(h.state.crm_sale_records[0].payment_status, 'unpaid')
	assert.equal(h.state.crm_customer_allocations.length, 0)
	assert.equal(h.state.crm_customer_receipts.length, 1)
	h.state.crm_sale_records[0].amount_received = 20
	const retry = await h.service.run(request, user)
	assert.equal(retry.idempotent, true)
	assert.equal(h.state.crm_sale_records[0].amount_received, 20)
	assert.equal((await h.service.getOperation(request)).status, 'saved')
	await assert.rejects(h.service.run({ ...request, reason: 'changed' }, user), /操作号/)
})
test('a failure after target updates and allocation removal rolls back all source and target changes', async () => {
	const h = fixture({ txWrite(kind, table) { if (table === 'crm_operation_logs') throw Error('injected after mutations') } })
	const before = structuredClone(h.state)
	await assert.rejects(h.service.run(h.request(), user), /injected/)
	assert.deepEqual(h.state, before)
})
test('changing the source before the transaction refuses the stale operation without overwriting it', async () => {
	const h = fixture(), original = h.db.startTransaction
	h.db.startTransaction = async () => { h.state.crm_customer_receipts[0].updated_at = 2; return original() }
	await assert.rejects(h.service.run(h.request(), user), /已变化/)
	assert.equal(h.state.crm_customer_receipts[0].allocated_amount, 50)
	assert.equal(h.state.crm_customer_allocations.length, 1)
})
test('refresh failure preserves committed release and its operation query', async () => {
	const h = fixture({}, async () => { throw Error('cache failed') }), request = h.request()
	const result = await h.service.run(request, user)
	assert.equal(result.balance_refresh_pending, true)
	assert.equal((await h.service.getOperation(request)).result.released_total, 50)
	assert.equal(h.state.crm_customer_allocations.length, 0)
})
test('retrying a committed release refreshes pending summaries without releasing later funds', async () => {
	let attempts = 0
	const h = fixture({}, async () => { if (++attempts === 1) throw Error('cache failed') }), request = h.request()
	assert.equal((await h.service.run(request, user)).balance_refresh_pending, true)
	h.state.crm_sale_records[0].amount_received = 20
	const moneyBefore = structuredClone({ sales: h.state.crm_sale_records, receipts: h.state.crm_customer_receipts, allocations: h.state.crm_customer_allocations })
	const query = await h.service.getOperation(request)
	assert.equal(query.result.balance_refresh_pending, true); assert.equal(attempts, 1)
	const retry = await h.service.run(request, user)
	assert.equal(retry.idempotent, true); assert.equal(retry.balance_refresh_pending, false); assert.equal(attempts, 2)
	assert.deepEqual({ sales: h.state.crm_sale_records, receipts: h.state.crm_customer_receipts, allocations: h.state.crm_customer_allocations }, moneyBefore)
	assert.equal((await h.service.getOperation(request)).result.balance_refresh_pending, false)
})
test('foreign or inconsistent reverse allocation references fail closed without mutation', async () => {
	for (const mutate of [
		h => { h.state.crm_customer_allocations.push({ _id: 'foreign', customer_id: 'other', receipt_id: 'credit', target_type: 'sale', target_id: 'sale', allocate_amount: 1 }) },
		h => { h.state.crm_customer_allocations.push({ _id: 'foreign-target', customer_id: 'other', receipt_id: 'other-source', target_type: 'sale', target_id: 'sale', allocate_amount: 1 }) },
		h => { h.state.crm_customer_allocations[0].allocate_amount = 49 },
		h => { h.state.crm_sale_records[0].amount_received = 49 },
		h => { h.state.crm_customer_receipts[0].unallocated_amount = 39 }
	]) {
		const h = fixture(); mutate(h); const before = structuredClone(h.state)
		await assert.rejects(h.service.run(h.request(), user), error => error.code === 409)
		assert.deepEqual(h.state, before)
	}
})
test('refund, pending adjustment, and protected accounting adjustment cannot be bypassed by release', async () => {
	for (const mutate of [
		h => { h.state.crm_customer_receipts[0].offset_cash_refunded_amount = 1 },
		h => { h.state.crm_customer_receipts[0].receipt_adjustment_status = 'pending' },
		h => { h.state.crm_customer_receipts.push({ _id: 'refund', customer_id: 'customer', status: 'posted', source_type: 'customer_cash_refund', refund_source_status: 'pending' }) },
		h => { h.state.crm_customer_receipts.push({ _id: 'refund', customer_id: 'customer', status: 'posted', source_type: 'offset_credit_cash_refund', offset_source_receipt_id: 'credit' }) },
		h => { h.state.crm_customer_opening_debts.push({ _id: 'adjust', customer_id: 'customer', source_type: 'balance_adjustment', adjustment_kind: 'rounding_reversal', status: 'posted', adjustment_source: { type: 'receipt_rounding_allocation', id: 'allocation' } }) }
	]) {
		const h = fixture(); mutate(h); const before = structuredClone(h.state)
		await assert.rejects(h.service.run(h.request(), user), error => error.code === 409)
		assert.deepEqual(h.state, before)
	}
})
test('all target types restore only their own backed amount, including separate rounding', async () => {
	const h = fixture()
	h.state.crm_customer_receipts[0] = { ...h.state.crm_customer_receipts[0], allocated_amount: 48, rounding_allocated_amount: 2 }
	h.state.crm_customer_allocations = []
	h.state.crm_sale_records[0].amount_received = 12
	for (const [type, table] of [['sale', 'crm_sale_records'], ['flow_settlement', 'crm_customer_flow_settlements'], ['opening_debt', 'crm_customer_opening_debts'], ['other_fee', 'crm_customer_opening_debts']]) {
		const id = type === 'sale' ? 'sale' : type
		if (type !== 'sale') h.state[table].push({ _id: id, customer_id: 'customer', status: 'posted', should: 100, amount_received: 12 })
		h.state.crm_customer_allocations.push({ _id: 'allocation-'+id, customer_id: 'customer', receipt_id: 'credit', target_type: type, target_id: id, allocate_amount: 12 })
	}
	h.state.crm_sale_records[0].receipt_rounding_amount = 2
	h.state.crm_customer_allocations.push({ _id: 'rounding', customer_id: 'customer', receipt_id: 'credit', target_type: 'sale', target_id: 'sale', allocate_kind: 'rounding', allocate_amount: 2 })
	const result = await h.service.run(h.request(), user)
	assert.equal(result.released_total, 50)
	assert.equal(h.state.crm_sale_records[0].receipt_rounding_amount, 0)
	assert.equal(h.state.crm_customer_opening_debts[0].outstanding, 100)
	assert.equal(h.state.crm_customer_receipts[0].unallocated_amount, 88)
})
