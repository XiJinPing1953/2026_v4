'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { mutableDb } = require('./lib/mutableAccountingDb.cjs')
const { readComplete } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/financialReadLocal')
const accounting = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/saleAccountingLocal')
const { createSaleOffsetSyncService } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/saleOffsetSync')
const cid = 'customer-1', sid = 'sale-1', op = 'sale-save-0001'
const user = { _id: 'user-1', username: '合成操作员', role: 'user' }
const sale = extra => ({ _id: sid, customer_id: cid, customer_name: '合成客户', date: '2026-10-30',
	settlement_mode: 'sale', biz_mode: 'bottle', price_unit: 'kg', unit_price: 1, out_items: [],
	back_items: [{ net: 88 }], amount_received: 0, rounding_amount: 0, offset_enabled: true,
	updated_at: 1, offset_sync_revision: op, offset_sync_status: 'pending', ...extra })
const receipt = extra => ({ _id: 'credit-1', customer_id: cid, source_id: sid, source_type: 'sale_offset_credit',
	entry_kind: 'offset_credit', status: 'posted', amount: 88, allocated_amount: 0, unallocated_amount: 88,
	rounding_allocated_amount: 0, offset_cash_refunded_amount: 0, updated_at: 1, biz_date: '2026-10-30', ...extra })
function harness({ salePatch = {}, receipts = [], allocations = [], debts = [], hooks = {}, refreshBalances, dbTransform, dbFactory = mutableDb, readCompleteFn = readComplete } = {}) {
	const state = { crm_customers: [{ _id: cid, name: '合成客户', default_price_unit: 'kg', updated_at: 1 }],
		crm_sale_records: [sale(salePatch)], crm_customer_receipts: receipts,
		crm_customer_allocations: allocations, crm_customer_opening_debts: debts, crm_operation_logs: [] }
	const base = dbFactory(state, hooks)
	const db = dbTransform ? dbTransform(base) : base
	const service = createSaleOffsetSyncService({ db, command: db.command, readComplete: readCompleteFn,
		saleSnapshot: row => {
			const { amounts } = accounting.computeSaleAmountsForDoc(row)
			return { amount_received: row.amount_received, should_receive_effective: amounts.effective_should_receive }
		}, refreshBalances })
	const request = { customer_id: cid, sale_id: sid, operation_id: op, expected_updated_at: 1 }
	return { state, db, request, run: (extra = {}, actor = user) => service.run('syncSaleOffsetCreditV1', { ...request, ...extra }, actor),
		query: (extra = {}) => service.run('getSaleOffsetSyncOperationV1', { ...request, ...extra }, user) }
}

test('one saved sale creates its credit once; query is read-only and retry returns the original result', async () => {
	const h = harness()
	const saleBefore = { ...h.state.crm_sale_records[0] }
	assert.equal((await h.query()).status, 'pending')
	assert.equal(h.db.writes.length, 0)
	const first = await h.run()
	assert.equal(first.status, 'completed')
	assert.equal(first.expected_offset_credit, 88)
	assert.equal(first.delta, 88)
	assert.equal(h.state.crm_customer_receipts.length, 1)
	assert.equal(h.state.crm_customer_receipts[0].unallocated_amount, 88)
	assert.equal(h.state.crm_sale_records[0].amount_received, saleBefore.amount_received)
	assert.equal(h.state.crm_sale_records[0].updated_at, saleBefore.updated_at)
	assert.equal((await h.query()).balance_refresh_pending, false)
	const count = h.db.writes.length
	assert.equal((await h.run()).idempotent, true)
	assert.equal(h.db.writes.length, count)
	assert.equal(h.state.crm_operation_logs.length, 1)
})

test('an old retry cannot overwrite a later sale revision or recreate credit', async () => {
	const h = harness()
	await h.run()
	h.state.crm_sale_records[0].offset_sync_revision = 'sale-save-0002'
	h.state.crm_sale_records[0].updated_at = 2
	h.state.crm_sale_records[0].back_items = [{ net: 100 }]
	h.state.crm_sale_records[0].offset_sync_status = 'pending'
	assert.equal((await h.run()).idempotent, true)
	assert.equal(h.state.crm_customer_receipts[0].amount, 88)
	assert.equal(h.state.crm_sale_records[0].offset_sync_status, 'pending')
	const next = await h.run({ operation_id: 'sale-save-0002', expected_updated_at: 2 })
	assert.equal(next.delta, 12)
	assert.equal(h.state.crm_customer_receipts.length, 1)
	assert.equal(h.state.crm_customer_receipts[0].amount, 100)
	await assert.rejects(h.run({ expected_updated_at: 2 }), /不同请求/)
})

test('legacy calls without the saved revision, stale timestamps and foreign customers cause no writes', async () => {
	for (const [salePatch, request, pattern] of [
		[{ offset_sync_revision: undefined }, {}, /未登记本次同步/],
		[{ offset_sync_revision: 'later' }, {}, /版本已变化/],
		[{ updated_at: 2 }, {}, /源单已变化/],
		[{}, { customer_id: 'foreign' }, /不属于该客户/]
	]) {
		const h = harness({ salePatch }), before = structuredClone(h.state)
		await assert.rejects(h.run(request), pattern)
		assert.deepEqual(h.state, before)
		assert.equal(h.db.writes.length, 0)
	}
})

test('disabled and customer-flow sales generate no credit; positive overcollection retains the explicit switch', async () => {
	for (const salePatch of [{ offset_enabled: false }, { settlement_mode: 'customer_flow' }]) {
		const h = harness({ salePatch })
		assert.equal((await h.run()).expected_offset_credit, 0)
		assert.equal(h.state.crm_customer_receipts.length, 0)
	}
	const h = harness({ salePatch: { out_items: [{ net: 100 }], back_items: [], amount_received: 125 } })
	assert.equal((await h.run()).expected_offset_credit, 25)
	assert.equal(h.state.crm_customer_receipts[0].amount, 25)
})

test('partial cash refund recorded in the source reduces the new credit; m3 classification remains authoritative', async () => {
	const h = harness({ salePatch: { amount_received: -20 } })
	assert.equal((await h.run()).expected_offset_credit, 68)
	const unresolved = harness({ salePatch: { price_unit: 'm3', settlement_mode: undefined } })
	await assert.rejects(unresolved.run(), error => error.code === 'FINANCIAL_CLASSIFICATION_REQUIRED')
	assert.equal(unresolved.state.crm_customer_receipts.length, 0)
})

test('a linked cash refund is never replenished; amount conservation is checked against refund evidence', async () => {
	for (const refund of [
		{ _id: 'refund-1', customer_id: cid, status: 'posted', source_type: 'customer_cash_refund', amount: -20,
			refund_source_status: 'linked', refund_sources: [{ id: 'credit-1', amount: 20 }] },
		{ _id: 'refund-1', customer_id: cid, status: 'posted', source_type: 'offset_credit_cash_refund', amount: -20, offset_source_receipt_id: 'credit-1' }
	]) {
		const h = harness({ receipts: [receipt({ unallocated_amount: 68, offset_cash_refunded_amount: 20 }), refund] })
		assert.equal((await h.run()).delta, 0)
		assert.equal(h.state.crm_customer_receipts[0].unallocated_amount, 68)
		assert.equal(h.state.crm_customer_receipts.length, 2)
	}
	const h = harness({ receipts: [receipt({ unallocated_amount: 68, offset_cash_refunded_amount: 20 })] })
	await assert.rejects(h.run(), /背书不一致/)
	assert.equal(h.db.writes.length, 0)
})

test('allocated or refunded sources cannot be increased or reduced by ordinary synchronization', async () => {
	for (const shouldReturn of [40, 100]) {
		const h = harness({ salePatch: { back_items: [{ net: shouldReturn }] }, receipts: [receipt({ allocated_amount: 50, unallocated_amount: 38 })],
			allocations: [{ _id: 'allocation-1', customer_id: cid, receipt_id: 'credit-1', target_type: 'sale', target_id: 'target-1', allocate_amount: 50 }] })
		const before = structuredClone(h.state)
		await assert.rejects(h.run(), /已有分配或退款/)
		assert.deepEqual(h.state, before)
	}
	const h = harness({ salePatch: { back_items: [{ net: 40 }] }, receipts: [receipt({ unallocated_amount: 68, offset_cash_refunded_amount: 20 }),
		{ _id: 'refund-1', customer_id: cid, status: 'posted', source_type: 'offset_credit_cash_refund', amount: -20, offset_source_receipt_id: 'credit-1' }] })
	await assert.rejects(h.run(), /已有分配或退款/)
})

test('unused legacy fragments are adjusted without deleting evidence or changing their identifiers', async () => {
	const h = harness({ salePatch: { back_items: [{ net: 10 }] }, receipts: [receipt({ amount: 20, unallocated_amount: 20 }), receipt({ _id: 'credit-2', source_type: 'sale_offset_credit_repair', amount: 68, unallocated_amount: 68 })] })
	const result = await h.run()
	assert.equal(result.delta, -78)
	assert.equal(h.state.crm_customer_receipts.length, 2)
	assert.deepEqual(h.state.crm_customer_receipts.map(r => [r._id, r.amount]), [['credit-1', 10], ['credit-2', 0]])
	assert.equal(result.changed_receipts.length, 2)
})

test('inconsistent balances, foreign reverse links and void sources fail without mutation', async () => {
	const fixtures = [
		{ receipts: [receipt({ unallocated_amount: 87 })] },
		{ receipts: [receipt({ allocated_amount: 10, unallocated_amount: 78 })] },
		{ receipts: [receipt({ customer_id: 'foreign' })] },
		{ receipts: [receipt({ status: 'void' })] },
		{ receipts: [receipt({ allocated_amount: 10, unallocated_amount: 78 })], allocations: [{ _id: 'bad-link', customer_id: 'foreign', receipt_id: 'credit-1', allocate_amount: 10 }] }
	]
	for (const fixture of fixtures) {
		const h = harness(fixture), before = structuredClone(h.state)
		await assert.rejects(h.run(), error => error.code === 409)
		assert.deepEqual(h.state, before)
	}
})

test('related adjustments and unlinked real refunds block changes, but unrelated adjustments do not block a new source', async () => {
	const adjustment = { _id: 'adjustment-1', customer_id: cid, status: 'posted', source_type: 'balance_adjustment', adjustment_kind: 'rounding_reversal',
		adjustment_source: { target_type: 'sale', target_id: sid } }
	const related = harness({ debts: [adjustment] })
	await assert.rejects(related.run(), /关联调整/)
	assert.equal(related.db.writes.length, 0)
	const unrelated = harness({ debts: [{ ...adjustment, adjustment_source: { target_type: 'sale', target_id: 'another-sale' } }] })
	assert.equal((await unrelated.run()).delta, 88)
	const pending = harness({ receipts: [{ _id: 'refund-1', customer_id: cid, status: 'posted', source_type: 'customer_cash_refund', amount: -88, refund_source_status: 'pending' }] })
	await assert.rejects(pending.run(), /来源待核/)
	assert.equal(pending.db.writes.length, 0)
})

test('mid-transaction failure rolls back customer, source metadata, credit and operation log together', async () => {
	for (const failTable of ['crm_sale_records', 'crm_customer_receipts', 'crm_operation_logs']) {
		const h = harness({ hooks: { txWrite(name) { if (name === failTable) throw Error('synthetic interrupted write') } } }), before = structuredClone(h.state)
		await assert.rejects(h.run(), /synthetic interrupted write/)
		assert.deepEqual(h.state, before)
	}
})

test('cache refresh failure does not turn a committed credit into a failed operation; retry resumes only refresh', async () => {
	let failing = true, refreshed = 0
	const h = harness({ refreshBalances: async () => { refreshed++; if (failing) throw Error('synthetic cache failure') } })
	const result = await h.run()
	assert.equal(result.status, 'completed')
	assert.equal(result.balance_refresh_pending, true)
	assert.equal((await h.query()).balance_refresh_pending, true)
	failing = false
	const repeated = await h.run()
	assert.equal(repeated.idempotent, true)
	assert.equal(repeated.balance_refresh_pending, false)
	assert.equal(refreshed, 2)
	assert.equal(h.state.crm_customer_receipts.length, 1)
	assert.equal((await h.query()).balance_refresh_pending, false)
})

function alipayDocuments(database, transactional = false) {
	function wrap(query, byDocument = false) {
		return new Proxy(query, { get(target, key) {
			if (key === 'doc') return id => wrap(target.doc(id), true)
			if (['where', 'limit', 'field', 'orderBy', 'skip'].includes(key)) return (...args) => wrap(target[key](...args), false)
			if (key === 'count' && transactional) return () => { throw Error('transaction count unsupported in this adapter') }
			if (key === 'get') return async () => {
				const result = await target.get()
				if (!byDocument) return result
				if (!result.data?.length) throw Error('Alipay document does not exist')
				return transactional ? { data: result.data[0] } : result
			}
			return target[key]
		} })
	}
	return { ...database, collection: name => wrap(database.collection(name)),
		startTransaction: async () => alipayDocuments(await database.startTransaction(), true) }
}

test('Alipay missing deterministic documents use equality queries and transactions require no count/paging APIs', async () => {
	const h = harness({ dbTransform: database => alipayDocuments(database) })
	assert.equal((await h.query()).status, 'pending')
	assert.equal((await h.run()).delta, 88)
	assert.equal((await h.query({ expected_updated_at: undefined })).status, 'completed')
	assert.equal((await h.run()).idempotent, true)
})

test('full paging reads every legacy fragment, and incomplete evidence causes no writes', async () => {
	const receipts = Array.from({ length: 205 }, (_, index) => receipt({ _id: `credit-${String(index).padStart(4, '0')}`, amount: 1, unallocated_amount: 1 }))
	const h = harness({ salePatch: { back_items: [{ net: 205 }] }, receipts })
	assert.equal((await h.run()).delta, 0)
	assert.equal(h.state.crm_customer_receipts.length, 205)
	const incomplete = harness({ readCompleteFn: async () => { throw Object.assign(Error('synthetic incomplete read'), { code: 'FINANCIAL_READ_INCOMPLETE' }) } })
	await assert.rejects(incomplete.run(), { code: 'FINANCIAL_READ_INCOMPLETE' })
	assert.equal(incomplete.db.writes.length, 0)
})

test('concurrent source, customer or receipt changes between evidence and transaction are rejected before commit', async () => {
	for (const change of [
		state => { state.crm_sale_records[0].back_items = [{ net: 99 }] },
		state => { state.crm_customers[0].receipt_allocation_revision = 'another-money-operation' },
		state => { state.crm_customer_receipts[0].unallocated_amount = 87 }
	]) {
		const h = harness({ receipts: [receipt()], hooks: { start: change } })
		await assert.rejects(h.run(), /核查后发生变化/)
		assert.equal(h.state.crm_operation_logs.length, 0)
		assert.equal(h.state.crm_sale_records[0].offset_sync_status, 'pending')
	}
})

test('document lookup network errors are propagated, never mistaken for a missing source or operation', async () => {
	const h = harness({ dbTransform(database) {
		return { ...database, collection(name) {
			const collection = database.collection(name)
			if (name !== 'crm_operation_logs') return collection
			return { ...collection, where() { return { limit() { return { get: async () => { throw Error('synthetic connection lost') } } } } } }
		} }
	} })
	await assert.rejects(h.run(), /synthetic connection lost/)
	assert.equal(h.db.writes.length, 0)
})

test('concurrent retries create one source under optimistic transaction conflicts, then both can query the saved operation', async () => {
	const { optimisticDb } = require('./lib/optimisticAccountingDb.cjs')
	const h = harness({ dbFactory: optimisticDb })
	const results = await Promise.allSettled([h.run(), h.run()])
	assert.ok(results.some(result => result.status === 'fulfilled'))
	assert.equal(h.state.crm_customer_receipts.length, 1)
	assert.equal(h.state.crm_customer_receipts[0].amount, 88)
	assert.equal(h.state.crm_operation_logs.length, 1)
	assert.equal((await h.query()).status, 'completed')
	assert.equal((await h.run()).idempotent, true)
})

test('a lost commit response remains queryable and replay cannot create another credit', async () => {
	let lost = true
	const h = harness({ dbTransform(database) {
		return { ...database, startTransaction: async () => {
			const tx = await database.startTransaction()
			return { ...tx, commit: async () => { await tx.commit(); if (lost) { lost = false; throw Error('synthetic commit response lost') } } }
		} }
	} })
	await assert.rejects(h.run(), /commit response lost/)
	assert.equal(h.state.crm_customer_receipts.length, 1)
	assert.equal((await h.query()).status, 'completed')
	assert.equal((await h.run()).idempotent, true)
	assert.equal(h.state.crm_customer_receipts.length, 1)
})
