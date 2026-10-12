'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, saleDoc, tablesFor, invoke } = require('./lib/accountingTestHarness.cjs')
const { mutableDb } = require('./lib/mutableAccountingDb.cjs')
const { readComplete } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/financialReadLocal')
const { createAdjustmentService, assertCustomerAdjustmentSourceMutable } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/customerAdjustment')
const saleAccounting = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/saleAccountingLocal')
const user = { _id: 'finance-1', username: '合成会计', role: 'finance' }
const cid = 'customer-1'
const saleSnapshot = row => {
	const { amounts } = saleAccounting.computeSaleAmountsForDoc(row)
	return { should_receive: amounts.should_receive, should_receive_effective: amounts.effective_should_receive,
		rounding_amount: amounts.rounding_amount, receipt_rounding_amount: row.receipt_rounding_amount || 0,
		outstanding: Math.max(0, amounts.effective_should_receive - row.amount_received - (row.receipt_rounding_amount || 0)) }
}
const debtSnapshot = row => ({ should_receive_effective: row.amount - (row.rounding_amount || 0), rounding_amount: row.rounding_amount || 0,
	receipt_rounding_amount: row.receipt_rounding_amount || 0, outstanding: Math.max(0, row.amount - (row.rounding_amount || 0) - row.amount_received - (row.receipt_rounding_amount || 0)) })
function balancePatch(scope, { operationId, now }) {
	const debt = scope.sales.reduce((n, r) => n + saleSnapshot(r).outstanding, 0) + scope.debts.filter(r => r.status === 'posted').reduce((n, r) => n + debtSnapshot(r).outstanding, 0)
	const available = scope.receipts.filter(r => r.status === 'posted').reduce((n, r) => n + r.unallocated_amount, 0)
	return { receivable_balance: Number(debt.toFixed(3)), prepay_balance: Number(available.toFixed(3)), receipt_unallocated_balance: Number(available.toFixed(3)),
		net_balance: Number((debt - available).toFixed(3)), receipt_allocation_revision: operationId, updated_at: now }
}
function harness(hooks = {}) {
	const sale = (id, rounding, received, receiptRounding = 0) => ({ _id: id, customer_id: cid, date: '2026-09-01',
		biz_mode: 'truck', price_unit: 'kg', unit_price: 1, truck_out_gross: 100, truck_back_gross: 0,
		rounding_amount: rounding, amount_received: received, receipt_rounding_amount: receiptRounding, updated_at: 1 })
	const receipt = (id, amount, allocated, rounding = 0) => ({ _id: id, customer_id: cid, biz_date: '2026-09-01', amount,
		allocated_amount: allocated, unallocated_amount: amount - allocated, rounding_amount: rounding, rounding_allocated_amount: rounding,
		source_type: 'cashier_intake', entry_kind: 'prepay', status: 'posted', payment_method: 'bank', updated_at: 1 })
	const state = {
		crm_customers: [{ _id: cid, name: '合成客户', default_price_unit: 'kg', receivable_balance: 0, prepay_balance: 100, net_balance: -100, updated_at: 1 }],
		crm_sale_records: [sale('sale-own', 10, 90), sale('sale-receipt', 0, 95, 5)], crm_customer_flow_settlements: [], crm_customer_opening_debts: [],
		crm_customer_receipts: [receipt('receipt-paid', 95, 95, 5), receipt('receipt-credit', 100, 0)],
		crm_customer_allocations: [
			{ _id: 'allocation-cash', customer_id: cid, receipt_id: 'receipt-paid', target_type: 'sale', target_id: 'sale-receipt', allocate_kind: 'receipt', allocate_amount: 95 },
			{ _id: 'allocation-rounding', customer_id: cid, receipt_id: 'receipt-paid', target_type: 'sale', target_id: 'sale-receipt', allocate_kind: 'rounding', allocate_amount: 5 }
		], crm_operation_logs: []
	}
	const db = makeDb(state, { mutate: true, transaction: true, txDocumentObject: true, ...hooks })
	const service = createAdjustmentService({ db, command: db.command, readComplete, moneyScale: row => row.default_price_unit === 'm3' ? 3 : 2,
		saleSnapshot, flowSnapshot: debtSnapshot, debtSnapshot, balancePatch, resolveCustomer: hooks.resolveCustomer, resolveSalesScope: hooks.resolveSalesScope })
	const run = (action, data = {}, actor = user) => service.run(action, { customer_id: cid, ...data }, actor)
	return { state, db, run }
}
async function input(h, kind, sourceId, amount, extra = {}) {
	const list = await h.run('getCustomerAdjustmentSourcesV1', { kind })
	const source = list.sources.find(r => r.id === sourceId)
	assert.ok(source, `source ${sourceId} exists`)
	return { kind, source_key: source.source_key, source_version: source.version, amount, biz_date: '2026-10-12',
		note: '双方确认的合成调整', evidence: '合成确认凭据', confirm_no_refund_or_offset: kind === 'prepay_writeoff', ...extra }
}
async function post(h, data, operationId = 'operation-create-0001') {
	const preview = await h.run('previewCustomerAdjustmentV1', data)
	return h.run(data.void_id ? 'voidCustomerAdjustmentV1' : 'postCustomerAdjustmentV1', { ...data, operation_id: operationId, plan_hash: preview.plan_hash })
}

test('source listing distinguishes own rounding from uniquely backed receipt rounding and excludes legacy residuals', async () => {
	const h = harness()
	let list = await h.run('getCustomerAdjustmentSourcesV1', { kind: 'rounding_reversal' })
	assert.deepEqual(list.sources.map(r => [r.type, r.amount]), [['target_rounding', 10], ['receipt_rounding_allocation', 5]])
	h.state.crm_sale_records[1].receipt_rounding_amount = 7
	list = await h.run('getCustomerAdjustmentSourcesV1', { kind: 'rounding_reversal' })
	assert.equal(list.sources.length, 1)
	assert.match(list.pending[0].reason, /背书不一致/)
})

test('partial rounding reversal preserves originals, increases receivable once, and retries recover the same result', async () => {
	const h = harness(), original = structuredClone(h.state.crm_sale_records)
	const data = await input(h, 'rounding_reversal', 'sale-own', 4)
	const preview = await h.run('previewCustomerAdjustmentV1', data)
	assert.equal(h.db.writes.length, 0)
	assert.deepEqual(preview.effects, { receivable_delta: 4, available_delta: 0, income_delta: 0, cash_delta: 0 })
	const request = { ...data, operation_id: 'rounding-partial-0001', plan_hash: preview.plan_hash }
	const first = await h.run('postCustomerAdjustmentV1', request)
	assert.equal(first.status, 'saved')
	assert.deepEqual(h.state.crm_sale_records, original)
	assert.equal(h.state.crm_customers[0].receivable_balance, 4)
	assert.equal(h.state.crm_customers[0].prepay_balance, 100)
	const retry = await h.run('postCustomerAdjustmentV1', request)
	assert.equal(retry.idempotent, true)
	assert.equal(h.state.crm_customer_opening_debts.length, 1)
	const source = (await h.run('getCustomerAdjustmentSourcesV1', { kind: 'rounding_reversal' })).sources.find(r => r.id === 'sale-own')
	assert.deepEqual([source.processed, source.available], [4, 6])
	await assert.rejects(h.run('postCustomerAdjustmentV1', { ...request, amount: 5 }), /操作号已用于不同/)
	await assert.rejects(post(h, await input(h, 'rounding_reversal', 'sale-own', 6.01), 'rounding-excess-0002'), /超过/)
	assert.equal((await h.run('getCustomerAdjustmentOperationV1', { operation_id: request.operation_id })).adjustment_id, first.adjustment_id)
})

test('receipt rounding reversal leaves cash, original receipt, allocation and sale untouched', async () => {
	const h = harness(), receipts = structuredClone(h.state.crm_customer_receipts), allocations = structuredClone(h.state.crm_customer_allocations)
	await post(h, await input(h, 'rounding_reversal', 'allocation-rounding', 2))
	assert.deepEqual(h.state.crm_customer_receipts, receipts)
	assert.deepEqual(h.state.crm_customer_allocations, allocations)
	assert.equal(h.state.crm_sale_records[1].receipt_rounding_amount, 5)
	assert.equal(h.state.crm_customers[0].receivable_balance, 2)
})

test('writeoff consumes only selected available credit, creates a fully settled target and can be voided atomically', async () => {
	const h = harness(), original = structuredClone(h.state.crm_customer_receipts[1])
	const result = await post(h, await input(h, 'prepay_writeoff', 'receipt-credit', 7))
	const receipt = h.state.crm_customer_receipts[1], debt = h.state.crm_customer_opening_debts[0]
	assert.equal(receipt.amount, original.amount)
	assert.equal(receipt.biz_date, original.biz_date)
	assert.equal(receipt.payment_method, original.payment_method)
	assert.deepEqual([receipt.allocated_amount, receipt.unallocated_amount, debt.amount_received, debt.outstanding], [7, 93, 7, 0])
	assert.equal(h.state.crm_customers[0].receivable_balance, 0)
	assert.equal(h.state.crm_customers[0].prepay_balance, 93)
	assert.deepEqual(result.effects, { receivable_delta: 0, available_delta: -7, income_delta: 7, cash_delta: 0 })
	const history = (await h.run('getCustomerAdjustmentSourcesV1', { kind: 'prepay_writeoff' })).adjustments[0]
	const voided = await post(h, { void_id: result.adjustment_id, source_version: history.version, note: '合成错误登记作废', evidence: '重新核对凭据' }, 'writeoff-void-0002')
	assert.equal(voided.status, 'voided')
	assert.equal(h.state.crm_customer_opening_debts[0].status, 'void')
	assert.deepEqual([h.state.crm_customer_receipts[1].allocated_amount, h.state.crm_customer_receipts[1].unallocated_amount], [0, 100])
	assert.equal(h.state.crm_customer_allocations.length, 2)
	assert.equal(h.state.crm_customers[0].prepay_balance, 100)
})

test('dependent collection blocks rounding-reversal void; dangerous original edits are guarded but void releases the guard', async () => {
	const h = harness()
	const result = await post(h, await input(h, 'rounding_reversal', 'sale-own', 4))
	const check = () => assertCustomerAdjustmentSourceMutable({ db: h.db, command: h.db.command, readComplete, customerId: cid, targetType: 'sale', targetId: 'sale-own' })
	await assert.rejects(check(), /关联调整/)
	const row = (await h.run('getCustomerAdjustmentSourcesV1', { kind: 'rounding_reversal' })).adjustments[0]
	h.state.crm_customer_allocations.push({ _id: 'dependent', customer_id: cid, receipt_id: 'receipt-credit', target_type: 'balance_adjustment', target_id: result.adjustment_id, allocate_kind: 'receipt', allocate_amount: 1 })
	await assert.rejects(post(h, { void_id: row.id, source_version: row.version, note: '撤销', evidence: '凭据' }, 'void-dependent-0002'), /已被收款/)
	h.state.crm_customer_allocations.pop()
	await post(h, { void_id: row.id, source_version: row.version, note: '撤销', evidence: '凭据' }, 'void-clear-0003')
	await check()
	assert.equal(h.state.crm_customers[0].receivable_balance, 0)
})

test('stale source or plan, missing consent, role violation and foreign reverse links cause no writes', async () => {
	const h = harness(), data = await input(h, 'prepay_writeoff', 'receipt-credit', 7)
	await assert.rejects(h.run('previewCustomerAdjustmentV1', { ...data, confirm_no_refund_or_offset: false }), /双方同意/)
	await assert.rejects(h.run('getCustomerAdjustmentSourcesV1', { kind: data.kind }, { _id: 'ordinary', role: 'user' }), { code: 403 })
	const preview = await h.run('previewCustomerAdjustmentV1', data)
	h.state.crm_customer_receipts[1].updated_at = 2
	await assert.rejects(h.run('postCustomerAdjustmentV1', { ...data, plan_hash: preview.plan_hash, operation_id: 'stale-source-0001' }), error => error.details.write_status === 'not_written')
	const fresh = await input(h, 'prepay_writeoff', 'receipt-credit', 7)
	h.state.crm_customer_allocations.push({ _id: 'foreign', customer_id: 'other-customer', receipt_id: 'receipt-credit', target_type: 'sale', target_id: 'foreign-sale', allocate_amount: 1 })
	await assert.rejects(h.run('previewCustomerAdjustmentV1', fresh), /跨客户/)
	assert.equal(h.db.writes.length, 0)
})

test('mid-transaction failure rolls back the target, receipt, customer cache and audit together', async () => {
	const h = harness({ txWrite(kind, table) { if (kind === 'add' && table === 'crm_customer_opening_debts') throw Error('synthetic write failure') } })
	const data = await input(h, 'prepay_writeoff', 'receipt-credit', 7), before = structuredClone(h.state)
	await assert.rejects(post(h, data), error => error.message === 'synthetic write failure' && error.details.write_status === 'not_written')
	assert.deepEqual(h.state, before)
	assert.equal((await h.run('getCustomerAdjustmentOperationV1', { operation_id: 'operation-create-0001' })).status, 'not_found')
})

test('three-decimal balances stay exact and opening prepayment is eligible without creating cash', async () => {
	const h = harness()
	h.state.crm_customers[0].default_price_unit = 'm3'
	Object.assign(h.state.crm_customer_receipts[1], { source_type: 'opening_prepay', amount: 0.013, unallocated_amount: 0.013 })
	await post(h, await input(h, 'prepay_writeoff', 'receipt-credit', 0.012))
	assert.deepEqual([h.state.crm_customer_receipts[1].allocated_amount, h.state.crm_customer_receipts[1].unallocated_amount], [0.012, 0.001])
	assert.equal(h.state.crm_customer_opening_debts[0].money_scale, 3)
})

test('writeoff allocation sequence follows existing source allocations and keeps required audit labels', async () => {
	const h = harness()
	Object.assign(h.state.crm_customer_receipts[1], { allocated_amount: 20, unallocated_amount: 80 })
	h.state.crm_customer_allocations.push({ _id: 'credit-previous', customer_id: cid, receipt_id: 'receipt-credit', target_type: 'sale', target_id: 'sale-own', allocate_kind: 'receipt', allocate_amount: 20, seq: 1 })
	await post(h, await input(h, 'prepay_writeoff', 'receipt-credit', 7))
	const row = h.state.crm_customer_allocations.find(r => r.source_type === 'prepay_writeoff')
	assert.equal(row.seq, 2)
	assert.equal(row.note, '双方确认的合成调整')
	assert.equal(row.created_by_name, user.username)
})

test('fully discounted original debts remain reversible; ordinary reversal and void do not require extra evidence', async () => {
	const h = harness()
	h.state.crm_customer_opening_debts.push({ _id: 'fully-rounded-debt', customer_id: cid, source_type: 'manual', status: 'posted', biz_date: '2026-09-01',
		amount: 10, rounding_amount: 10, amount_received: 0, receipt_rounding_amount: 0, updated_at: 1 })
	const data = await input(h, 'rounding_reversal', 'fully-rounded-debt', 10)
	delete data.evidence
	const result = await post(h, data)
	const row = (await h.run('getCustomerAdjustmentSourcesV1', { kind: data.kind })).adjustments[0]
	await post(h, { void_id: result.adjustment_id, source_version: row.version, note: '撤销错误登记' }, 'rounding-void-0002')
	const writeoff = await input(h, 'prepay_writeoff', 'receipt-credit', 7)
	await assert.rejects(h.run('previewCustomerAdjustmentV1', { ...writeoff, evidence: '' }), /补充双方确认/)
})

test('hidden customers and transaction-time original-value conflicts cannot be written', async () => {
	const hidden = harness({ resolveCustomer: async () => null })
	await assert.rejects(hidden.run('getCustomerAdjustmentSourcesV1', { kind: 'rounding_reversal' }), { code: 404 })
	const h = harness(), begin = h.db.startTransaction.bind(h.db)
	h.db.startTransaction = async () => {
		const tx = await begin(), collection = tx.collection.bind(tx)
		tx.collection = name => {
			const store = collection(name)
			return name === 'crm_customer_receipts' ? { ...store, doc: id => ({ ...store.doc(id), get: async () => {
				const result = await store.doc(id).get()
				return id === 'receipt-credit' ? { data: { ...result.data, unallocated_amount: 99 } } : result
			} }) } : store
		}
		return tx
	}
	const before = structuredClone(h.state)
	await assert.rejects(post(h, await input(h, 'prepay_writeoff', 'receipt-credit', 7)), /原值已变化/)
	assert.deepEqual(h.state, before)
})

test('a lost commit response recovers by operation ID and an unknown commit is never labelled not-written', async () => {
	for (const committed of [true, false]) {
		const h = harness(), begin = h.db.startTransaction.bind(h.db)
		h.db.startTransaction = async () => {
			const tx = await begin(), commit = tx.commit.bind(tx)
			tx.commit = async () => { if (committed) await commit(); throw Error('synthetic lost commit response') }
			return tx
		}
		const data = await input(h, 'prepay_writeoff', 'receipt-credit', 7)
		if (committed) {
			const result = await post(h, data)
			assert.equal(result.commit_recovered, true)
			assert.equal(h.state.crm_customer_opening_debts.length, 1)
		} else {
			await assert.rejects(post(h, data), error => error.details.commit_status_unknown === true && error.details.write_status === undefined)
		}
	}
})

test('operation lookup and same-command retry do not depend on rereading unrelated full ledgers', async () => {
	let blocked = false
	const h = harness({ count(name, total) { if (blocked && name === 'crm_sale_records') throw Error('synthetic unavailable ledger'); return { total } } })
	const data = await input(h, 'prepay_writeoff', 'receipt-credit', 7), preview = await h.run('previewCustomerAdjustmentV1', data)
	const request = { ...data, plan_hash: preview.plan_hash, operation_id: 'saved-operation-0001' }
	const saved = await h.run('postCustomerAdjustmentV1', request)
	blocked = true
	assert.equal((await h.run('getCustomerAdjustmentOperationV1', { operation_id: request.operation_id })).adjustment_id, saved.adjustment_id)
	assert.equal((await h.run('postCustomerAdjustmentV1', request)).idempotent, true)
})

test('void fails closed when the adjustment no longer has its original fully settled or zero-rounding state', async () => {
	for (const [kind, id, patch] of [
		['prepay_writeoff', 'receipt-credit', { amount_received: 6.99 }],
		['rounding_reversal', 'sale-own', { rounding_amount: 0.01 }]
	]) {
		const h = harness(), result = await post(h, await input(h, kind, id, 7))
		Object.assign(h.state.crm_customer_opening_debts[0], patch)
		const history = (await h.run('getCustomerAdjustmentSourcesV1', { kind })).adjustments[0], before = structuredClone(h.state)
		await assert.rejects(post(h, { void_id: result.adjustment_id, source_version: history.version, note: '撤销错误登记' }, 'corrupt-void-0002'), /不能.*作废/)
		assert.deepEqual(h.state, before)
	}
})

async function paidReversalFixture(hooks = {}) {
	const h = harness(hooks)
	Object.assign(h.state.crm_customer_receipts[0], { amount: 105, unallocated_amount: 10 })
	await post(h, await input(h, 'prepay_writeoff', 'receipt-paid', 4), 'kept-writeoff-0001')
	const result = await post(h, await input(h, 'rounding_reversal', 'allocation-rounding', 4), 'reversal-paid-0002')
	const debt = h.state.crm_customer_opening_debts.find(row => row._id === result.adjustment_id)
	Object.assign(debt, { amount_received: 2, receipt_rounding_amount: 1, outstanding: 1, payment_status: 'partial' })
	Object.assign(h.state.crm_customer_receipts[0], { allocated_amount: 101, unallocated_amount: 4, rounding_amount: 6, rounding_allocated_amount: 6 })
	h.state.crm_customer_allocations.push(
		{ _id: 'later-cash', customer_id: cid, receipt_id: 'receipt-paid', target_type: 'balance_adjustment', target_id: debt._id, allocate_kind: 'receipt', allocate_amount: 2, biz_date: '2026-10-12' },
		{ _id: 'later-rounding', customer_id: cid, receipt_id: 'receipt-paid', target_type: 'balance_adjustment', target_id: debt._id, allocate_kind: 'rounding', allocate_amount: 1, biz_date: '2026-10-12' })
	const history = (await h.run('getCustomerAdjustmentSourcesV1', { kind: 'rounding_reversal' })).adjustments.find(row => row.id === debt._id)
	return { ...h, debt, value: { void_id: debt._id, source_version: history.version, note: '先解除所列分配，再作废', release_dependent_allocations: true } }
}

test('explicit release-and-void preserves original rounding and other targets, including writeoff on the same cash source', async () => {
	const h = await paidReversalFixture(), source = structuredClone(h.state.crm_sale_records[1])
	const kept = structuredClone(h.state.crm_customer_allocations.filter(row => !row._id.startsWith('later-')))
	await assert.rejects(h.run('previewCustomerAdjustmentV1', { ...h.value, release_dependent_allocations: false }), error => error.details.requires_allocation_release === true)
	const preview = await h.run('previewCustomerAdjustmentV1', h.value)
	assert.deepEqual(preview.affected_allocations.map(row => [row.allocation_id, row.amount]), [['later-cash', 2], ['later-rounding', 1]])
	assert.deepEqual(preview.effects, { receivable_delta: -1, available_delta: 2, income_delta: 0, cash_delta: 0 })
	assert.deepEqual(preview.receipt_effects, [{ receipt_id: 'receipt-paid', date: '2026-09-01', available_before: 4, available_after: 6, available_delta: 2, rounding_delta: -1 }])
	assert.deepEqual(preview.balances, { before: { receivable_balance: 1, prepay_balance: 104, net_balance: -103 }, after: { receivable_balance: 0, prepay_balance: 106, net_balance: -106 } })
	const request = { ...preview.value, operation_id: 'release-void-0003', plan_hash: preview.plan_hash }
	const saved = await h.run('voidCustomerAdjustmentV1', request)
	assert.equal(saved.status, 'voided')
	assert.deepEqual(h.state.crm_customer_allocations, kept)
	assert.deepEqual(h.state.crm_sale_records[1], source)
	assert.deepEqual([h.state.crm_customer_receipts[0].amount, h.state.crm_customer_receipts[0].allocated_amount, h.state.crm_customer_receipts[0].unallocated_amount,
		h.state.crm_customer_receipts[0].rounding_amount, h.state.crm_customer_receipts[0].rounding_allocated_amount], [105, 99, 6, 5, 5])
	assert.equal(h.state.crm_customer_opening_debts.find(row => row.adjustment_kind === 'prepay_writeoff').status, 'posted')
	assert.equal((await h.run('voidCustomerAdjustmentV1', request)).idempotent, true)
	assert.deepEqual(saved.balances.receivable_balance, preview.balances.after.receivable_balance)
	assert.equal(saved.balances.prepay_balance, preview.balances.after.prepay_balance)
})

test('release-and-void rejects refund, special source, derived reversal, missing backing and changed membership before writes', async () => {
	for (const [mutate, pattern] of [
		[h => { h.state.crm_customer_receipts[0].cash_refunded_amount = 1 }, /退款/],
		[h => { h.state.crm_customer_receipts[0].source_type = 'opening_prepay' }, /非现金/],
		[h => { h.state.crm_customer_opening_debts.push({ _id: 'subsequent-reversal', customer_id: cid, source_type: 'balance_adjustment', adjustment_kind: 'rounding_reversal', status: 'posted',
			adjustment_source: { type: 'receipt_rounding_allocation', id: 'later-rounding' } }) }, /另一笔冲回/],
		[h => { h.debt.amount_received = 1.99 }, /已变化/]
	]) {
		const h = await paidReversalFixture(); mutate(h)
		const before = structuredClone(h.state)
		await assert.rejects(h.run('previewCustomerAdjustmentV1', h.value), pattern)
		assert.deepEqual(h.state, before)
	}
	const h = await paidReversalFixture(), preview = await h.run('previewCustomerAdjustmentV1', h.value)
	h.state.crm_customer_allocations[0].updated_at = 2
	const before = structuredClone(h.state)
	await assert.rejects(h.run('voidCustomerAdjustmentV1', { ...preview.value, plan_hash: preview.plan_hash, operation_id: 'stale-release-0004' }), /预览已变化/)
	assert.deepEqual(h.state, before)
})

test('release-and-void is all-or-nothing after receipt updates and allocation removals', async () => {
	let failAudit = false
	const h = await paidReversalFixture({ txWrite(kind, table) { if (failAudit && kind === 'add' && table === 'crm_operation_logs') throw Error('synthetic release audit failure') } })
	const before = structuredClone(h.state); failAudit = true
	await assert.rejects(post(h, h.value, 'rollback-release-0005'), error => error.message === 'synthetic release audit failure' && error.details.write_status === 'not_written')
	assert.deepEqual(h.state, before)
})

test('release flag cannot repurpose a post or a writeoff void into another allocation mutation', async () => {
	const h = harness(), value = await input(h, 'prepay_writeoff', 'receipt-credit', 7)
	await assert.rejects(h.run('previewCustomerAdjustmentV1', { ...value, release_dependent_allocations: true }), /仅用于/)
	const result = await post(h, value), history = (await h.run('getCustomerAdjustmentSourcesV1', { kind: value.kind })).adjustments[0]
	await assert.rejects(h.run('previewCustomerAdjustmentV1', { void_id: result.adjustment_id, source_version: history.version, note: '作废', release_dependent_allocations: true }), /仅抹零冲回/)
})

function realHandlerFixture() {
	const tables = tablesFor(saleDoc({ settlement_mode: 'sale', price_unit: 'kg', out_items: [{ net: 100 }], unit_price: 1,
		should_receive: 100, amount_received: 95, receipt_rounding_amount: 5, date: '2026-09-01' }))
	Object.assign(tables.crm_customers[0], { default_price_unit: 'kg' })
	const base = { customer_id: cid, status: 'posted', created_at: 1, updated_at: 1, biz_date: '2026-09-01' }
	tables.crm_customer_receipts = [{ ...base, _id: 'cash', amount: 105, allocated_amount: 95, unallocated_amount: 10,
		rounding_amount: 5, rounding_allocated_amount: 5, source_type: 'manual', entry_kind: 'prepay', payment_method: 'bank' }]
	tables.crm_customer_allocations = [
		{ ...base, _id: 'original-cash', receipt_id: 'cash', target_type: 'sale', target_id: 'sale-1', allocate_kind: 'receipt', allocate_amount: 95, seq: 1 },
		{ ...base, _id: 'original-rounding', receipt_id: 'cash', target_type: 'sale', target_id: 'sale-1', allocate_kind: 'rounding', allocate_amount: 5, seq: 2 }]
	const originals = structuredClone(tables.crm_customer_allocations), handler = loadHandler('crm-customer-settlement', mutableDb(tables))
	const call = async (action, data) => {
		const result = await invoke(handler, action, { customer_id: cid, ...data }); assert.equal(result.code, 0, result.msg)
		return result.data
	}
	return { tables, originals, handler, call }
}

test('real handler can explicitly void a reversal paid from the same protected cash receipt without releasing its original allocations', async () => {
	const { tables, originals, handler, call } = realHandlerFixture()
	const list = await call('getCustomerAdjustmentSourcesV1', { kind: 'rounding_reversal' }), source = list.sources[0]
	const preview = await call('previewCustomerAdjustmentV1', { kind: 'rounding_reversal', source_key: source.source_key,
		source_version: source.version, amount: 4, biz_date: '2026-10-12', note: '真实入口合成冲回' })
	const saved = await call('postCustomerAdjustmentV1', { ...preview.value, plan_hash: preview.plan_hash, operation_id: 'handler-reversal-0001' })
	await call('allocatePrepayReceiptV1', { receipt_id: 'cash', amount: 2, rounding_amount: 1, allocation_mode: 'checked',
		allocation_targets: [{ target_type: 'balance_adjustment', target_id: saved.adjustment_id }] })
	const blocked = await invoke(handler, 'releaseReceiptAllocationsV2', { customer_id: cid, receipt_id: 'cash' })
	assert.equal(blocked.code, 409)
	const history = (await call('getCustomerAdjustmentSourcesV1', { kind: 'rounding_reversal' })).adjustments[0]
	const voidPreview = await call('previewCustomerAdjustmentV1', { void_id: saved.adjustment_id, source_version: history.version,
		note: '明确解除所列分配并作废', release_dependent_allocations: true })
	assert.equal(voidPreview.affected_allocations.length, 2)
	assert.deepEqual(voidPreview.effects, { receivable_delta: -1, available_delta: 2, income_delta: 0, cash_delta: 0 })
	await call('voidCustomerAdjustmentV1', { ...voidPreview.value, plan_hash: voidPreview.plan_hash, operation_id: 'handler-void-0002' })
	assert.deepEqual(tables.crm_customer_allocations, originals)
	assert.deepEqual([tables.crm_customer_receipts[0].allocated_amount, tables.crm_customer_receipts[0].unallocated_amount,
		tables.crm_customer_receipts[0].rounding_allocated_amount, tables.crm_sale_records[0].receipt_rounding_amount], [95, 10, 5, 5])
	assert.deepEqual([tables.crm_customers[0].receivable_balance, tables.crm_customers[0].prepay_balance, tables.crm_customers[0].net_balance], [0, 10, -10])
})

test('real handler excludes hidden delivery-customer sales from sources, preview, persisted balances and statement totals', async () => {
	const { tables, call } = realHandlerFixture()
	tables.crm_customers.push({ _id: 'hidden-delivery', name: '隐藏子客户', is_hidden: true })
	tables.crm_sale_records.push({ ...structuredClone(tables.crm_sale_records[0]), _id: 'hidden-sale', delivery_customer_id: 'hidden-delivery',
		out_items: [{ net: 1000 }], should_receive: 1000, amount_received: 0, rounding_amount: 10, receipt_rounding_amount: 0 })
	const statementInput = { summary_only: true, date_from: '2026-01-01', date_to: '2026-12-31' }
	const before = await call('getCustomerStatementV1', statementInput)
	assert.deepEqual([before.summary.receivable_balance, before.summary.prepay_balance], [0, 10])
	const rounding = await call('getCustomerAdjustmentSourcesV1', { kind: 'rounding_reversal' })
	assert.equal(rounding.sources.some(row => row.target_id === 'hidden-sale'), false)
	const list = await call('getCustomerAdjustmentSourcesV1', { kind: 'prepay_writeoff' }), source = list.sources[0]
	const preview = await call('previewCustomerAdjustmentV1', { kind: 'prepay_writeoff', source_key: source.source_key,
		source_version: source.version, amount: 10, biz_date: '2026-10-12', note: '双方确认清账', evidence: '合成凭据', confirm_no_refund_or_offset: true })
	assert.equal(preview.balances.before.receivable_balance, 0)
	const saved = await call('postCustomerAdjustmentV1', { ...preview.value, plan_hash: preview.plan_hash, operation_id: 'hidden-writeoff-0001' })
	const after = await call('getCustomerStatementV1', statementInput)
	for (const value of [preview.balances.after, saved.balances, tables.crm_customers[0], after.summary]) {
		assert.deepEqual([value.receivable_balance, value.prepay_balance, value.net_balance], [0, 0, 0])
	}
	assert.equal(tables.crm_sale_records.find(row => row._id === 'hidden-sale').amount_received, 0)
})

test('a visibility-scope version change during the transaction aborts even when visible sale rows stay the same', async () => {
	let version = 'visible-list-1'
	const h = harness({ resolveSalesScope: async customerId => ({ where: { customer_id: customerId }, version }) })
	const data = await input(h, 'prepay_writeoff', 'receipt-credit', 7), preview = await h.run('previewCustomerAdjustmentV1', data)
	const begin = h.db.startTransaction.bind(h.db)
	h.db.startTransaction = async () => { version = 'visible-list-2'; return begin() }
	const before = structuredClone(h.state)
	await assert.rejects(h.run('postCustomerAdjustmentV1', { ...data, plan_hash: preview.plan_hash, operation_id: 'hidden-scope-0001' }), /范围已变化/)
	assert.deepEqual(h.state, before)
})
