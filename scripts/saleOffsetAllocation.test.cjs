'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { mutableDb } = require('./lib/mutableAccountingDb.cjs')
const { optimisticDb } = require('./lib/optimisticAccountingDb.cjs')
const { readComplete } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/financialReadLocal')
const accounting = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/saleAccountingLocal')
const { computeSaleSnapshot } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/customerBalanceLocal').createCustomerBalance(accounting)
const { createService } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/saleOffsetAllocation')
const user = { _id: 'actor', username: '合成用户', role: 'user' }
const request = { customer_id: 'customer', sale_id: 'target', operation_id: 'sale-use-op' }
const sale = extra => ({ _id: 'target', customer_id: 'customer', date: '2026-10-30', settlement_mode: 'sale', biz_mode: 'bottle', price_unit: 'kg', unit_price: 1,
	out_items: [{ net: 100 }], back_items: [], amount_received: 0, receipt_rounding_amount: 0, rounding_amount: 0,
	apply_offset_credit: true, offset_use_revision: request.operation_id, offset_use_status: 'pending', updated_at: 1, ...extra })
const credit = extra => ({ _id: 'credit-1', customer_id: 'customer', source_id: 'source-1', source_type: 'sale_offset_credit', entry_kind: 'offset_credit',
	status: 'posted', amount: 40, allocated_amount: 0, unallocated_amount: 40, rounding_allocated_amount: 0, offset_cash_refunded_amount: 0, biz_date: '2026-10-01', created_at: 1, updated_at: 1, ...extra })
function harness(options = {}) {
	const receipts = options.receipts || [credit(), credit({ _id: 'credit-2', source_id: 'source-2', amount: 80, unallocated_amount: 80, biz_date: '2026-10-02' })]
	const sources = [...new Set(receipts.filter(row => row.source_type?.startsWith('sale_offset_credit')).map(row => row.source_id))].filter(Boolean).map(id => sale({ _id: id, out_items: [], back_items: [{ net: 100 }], offset_use_revision: undefined, apply_offset_credit: false }))
	const state = { crm_customers: [{ _id: 'customer', name: '合成客户', updated_at: 1 }], crm_sale_records: [sale(options.salePatch), ...sources],
		crm_customer_receipts: receipts, crm_customer_allocations: options.links || [], crm_customer_opening_debts: options.adjustments || [], crm_operation_logs: [] }
	if (options.transformState) options.transformState(state)
	const base = (options.dbFactory || mutableDb)(state, options.hooks || {})
	const db = options.dbTransform ? options.dbTransform(base) : base
	const service = createService({ db, readComplete: options.readCompleteFn || readComplete, saleSnapshot: computeSaleSnapshot, moneyScale: () => options.scale || 2, refreshBalances: options.refreshBalances })
	return { state, db, service, run: data => service.run({ ...request, ...data }, user), query: data => service.getOperation({ ...request, ...data }) }
}

test('one transaction uses FIFO sources, updates the sale once, and query/retry returns the saved original total', async () => {
	const h = harness(), first = await h.run()
	assert.equal(first.applied_amount, 100)
	assert.deepEqual(first.applied_receipts.map(row => row.allocated_amount), [40, 60])
	assert.equal(first.payment_status, 'paid')
	assert.equal(first.outstanding, 0)
	assert.equal(h.state.crm_sale_records[0].amount_received, 100)
	assert.equal(h.state.crm_sale_records[0].apply_offset_credit, false)
	assert.equal(h.state.crm_sale_records[0].offset_use_status, 'completed')
	assert.equal(h.db.writes.filter(row => row.table === 'crm_sale_records').length, 1)
	const before = structuredClone(h.state), count = h.db.writes.length
	assert.equal((await h.query()).status, 'saved')
	assert.equal((await h.run()).applied_amount, 100)
	assert.equal(h.db.writes.length, count)
	assert.deepEqual(h.state, before)
})

test('failure at each write stage rolls back every source and cannot leave a partial use operation', async () => {
	for (const table of ['crm_customers', 'crm_sale_records', 'crm_customer_receipts', 'crm_customer_allocations', 'crm_operation_logs']) {
		let failed = false
		const h = harness({ hooks: { txWrite(name) { if (!failed && name === table) { failed = true; throw Error('synthetic write failure') } } } })
		const before = structuredClone(h.state)
		await assert.rejects(h.run(), /synthetic/)
		assert.deepEqual(h.state, before)
		assert.equal((await h.query()).status, 'not_found')
		assert.equal((await h.run()).applied_amount, 100)
		assert.equal(h.state.crm_customer_allocations.length, 2)
	}
})

test('query is read-only; old unsaved revisions and absent use choice fail, while old saved revisions cannot change new state', async () => {
	for (const salePatch of [{ offset_use_revision: undefined }, { offset_use_revision: 'newer' }, { apply_offset_credit: false }]) {
		const h = harness({ salePatch }), before = structuredClone(h.state)
		assert.equal((await h.query()).status, 'not_found')
		await assert.rejects(h.run(), error => error.code === 409)
		assert.deepEqual(h.state, before)
	}
	const h = harness(); await h.run()
	Object.assign(h.state.crm_sale_records[0], { offset_use_revision: 'next', offset_use_status: 'pending', apply_offset_credit: true, out_items: [{ net: 120 }] })
	const before = structuredClone(h.state)
	assert.equal((await h.run()).idempotent, true)
	assert.deepEqual(h.state, before)
	await assert.rejects(h.run({ sale_id: 'source-1' }), /不同/)
})

test('partial available pool is still one completed atomic result; later credits never join its retry', async () => {
	const h = harness({ receipts: [credit()] })
	const first = await h.run(); assert.equal(first.applied_amount, 40); assert.equal(first.outstanding, 60)
	h.state.crm_customer_receipts.push(credit({ _id: 'later', source_id: 'source-later', amount: 70, unallocated_amount: 70 }))
	const before = structuredClone(h.state)
	assert.equal((await h.run()).applied_amount, 40)
	assert.deepEqual(h.state, before)
})

test('no outstanding or no usable pool commits a queryable zero-use result without applying the preference again', async () => {
	for (const options of [{ salePatch: { amount_received: 100 } }, { receipts: [] }, { salePatch: { out_items: [], back_items: [{ net: 24 }] } }]) {
		const h = harness(options)
		assert.equal((await h.run()).applied_amount, 0)
		assert.equal(h.state.crm_customer_allocations.length, 0)
		assert.equal(h.state.crm_sale_records[0].apply_offset_credit, false)
		assert.equal((await h.query()).status, 'saved')
	}
})

test('source refund evidence preserves refunded funds and rejects missing, duplicate or wrong-direction backing', async () => {
	const source = credit({ amount: 88, unallocated_amount: 68, offset_cash_refunded_amount: 20 })
	const refund = { _id: 'refund', customer_id: 'customer', source_type: 'customer_cash_refund', status: 'posted', amount: -20, refund_source_status: 'linked', refund_sources: [{ id: source._id, amount: 20 }] }
	const valid = harness({ receipts: [source, refund] })
	assert.equal((await valid.run()).applied_amount, 68)
	assert.equal(valid.state.crm_customer_receipts[0].offset_cash_refunded_amount, 20)
	assert.equal(valid.state.crm_customer_receipts[0].unallocated_amount, 0)
	for (const evidence of [[], [{ ...refund, amount: 20 }], [{ ...refund, amount: -10 }], [{ ...refund, refund_sources: [...refund.refund_sources, ...refund.refund_sources] }]]) {
		const h = harness({ receipts: [source, ...evidence] }), before = structuredClone(h.state)
		await assert.rejects(h.run(), /背书|方向|重复/)
		assert.deepEqual(h.state, before)
	}
	const legacy = harness({ receipts: [source, { ...refund, source_type: 'offset_credit_cash_refund', offset_source_receipt_id: source._id }] })
	assert.equal((await legacy.run()).applied_amount, 68)
})

test('pending refunds, protected sources and invalid source balances fail before any write', async () => {
	const cases = [
		{ receipts: [credit(), { _id: 'pending', customer_id: 'customer', source_type: 'customer_cash_refund', status: 'posted', amount: -1, refund_source_status: 'pending' }] },
		{ receipts: [credit({ receipt_adjustment_status: 'pending' })] },
		{ receipts: [credit({ allocated_amount: -1, unallocated_amount: 41 })] },
		{ receipts: [credit({ unallocated_amount: 39 })] },
		{ receipts: [credit({ unallocated_amount: NaN })] },
		{ adjustments: [{ _id: 'adjust', customer_id: 'customer', source_type: 'balance_adjustment', adjustment_kind: 'prepay_writeoff', status: 'posted', adjustment_source: { receipt_id: 'credit-1' } }] },
		{ adjustments: [{ _id: 'adjust', customer_id: 'customer', source_type: 'balance_adjustment', adjustment_kind: 'rounding_reversal', status: 'posted', adjustment_source: { target_type: 'sale', target_id: 'target' } }] }
	]
	for (const options of cases) {
		const h = harness(options), before = structuredClone(h.state)
		await assert.rejects(h.run(), error => error.code === 409)
		assert.deepEqual(h.state, before)
		assert.equal(h.db.writes.length, 0)
	}
})

test('source and target reverse allocations reject cross-customer, missing and inconsistent evidence', async () => {
	for (const options of [
		{ links: [{ _id: 'foreign', receipt_id: 'credit-1', customer_id: 'another', allocate_amount: 1 }] },
		{ receipts: [credit({ allocated_amount: 10, unallocated_amount: 30 })] },
		{ links: [{ _id: 'invalid', receipt_id: 'credit-1', customer_id: 'customer', allocate_amount: -1 }] },
		{ links: [{ _id: 'target-link', customer_id: 'customer', target_id: 'target', sale_id: 'target', allocate_amount: 1 }] },
		{ transformState(state) { state.crm_sale_records = state.crm_sale_records.filter(row => row._id !== 'source-1') } },
		{ transformState(state) { state.crm_sale_records.find(row => row._id === 'source-1').customer_id = 'foreign' } }
	]) {
		const h = harness(options), before = structuredClone(h.state)
		await assert.rejects(h.run(), error => error.code === 409)
		assert.deepEqual(h.state, before)
	}
})

test('existing proven allocations remain intact and new totals are based on available balance only', async () => {
	const h = harness({ receipts: [credit({ allocated_amount: 10, unallocated_amount: 30 })], links: [{ _id: 'old-link', receipt_id: 'credit-1', customer_id: 'customer', target_id: 'old-target', sale_id: 'old-target', target_type: 'sale', allocate_amount: 10, seq: 7 }] })
	assert.equal((await h.run()).applied_amount, 30)
	assert.equal(h.state.crm_customer_receipts[0].allocated_amount, 40)
	assert.equal(h.state.crm_customer_allocations[0]._id, 'old-link')
	assert.equal(h.state.crm_customer_allocations[1].seq, 8)
})

test('official manual compensation credits need no inferred source sale, but unknown offset sources fail closed', async () => {
	for (const source_type of ['customer_offset_credit_manual_compensation', 'customer_offset_credit_manual']) {
		const h = harness({ receipts: [credit({ source_type, source_id: null, note: '已登记的补偿款' })] })
		assert.equal((await h.run()).applied_amount, 40)
		assert.equal(h.state.crm_customer_receipts[0].amount, 40)
	}
	for (const row of [credit({ source_type: 'unknown_offset', source_id: null }), credit({ source_type: 'customer_offset_credit_manual_compensation', entry_kind: 'offset' })]) {
		const h = harness({ receipts: [row] }), before = structuredClone(h.state)
		await assert.rejects(h.run(), /类型|销售链/)
		assert.deepEqual(h.state, before)
	}
})

test('source limit applies to the complete intended allocation and never commits only the first 30', async () => {
	const many = Array.from({ length: 31 }, (_, n) => credit({ _id: `credit-${String(n).padStart(2, '0')}`, source_id: `source-${n}`, amount: 1, unallocated_amount: 1 }))
	const h = harness({ receipts: many }), before = structuredClone(h.state)
	await assert.rejects(h.run(), error => error.code === 400 && /30/.test(error.message))
	assert.deepEqual(h.state, before)
	const limited = harness({ receipts: many, salePatch: { out_items: [{ net: 30 }] } })
	assert.equal((await limited.run()).applied_amount, 30)
	assert.equal(limited.state.crm_customer_allocations.length, 30)
})

test('three-decimal sources retain sub-cent remainders and never round up consumption', async () => {
	const h = harness({ scale: 3, receipts: [credit({ amount: 0.015, unallocated_amount: 0.015 })], salePatch: { out_items: [{ net: 0.02 }] } })
	assert.equal((await h.run()).applied_amount, 0.01)
	assert.equal(h.state.crm_customer_receipts[0].unallocated_amount, 0.005)
	assert.equal(h.state.crm_sale_records[0].amount_received, 0.01)
})

test('target precision and negative rounding cannot be hidden by normalized accounting snapshots', async () => {
	for (const salePatch of [{ amount_received: 0.001 }, { receipt_rounding_amount: -1 }, { rounding_amount: -1 }]) {
		const h = harness({ salePatch }), before = structuredClone(h.state)
		await assert.rejects(h.run(), /精度|不一致/)
		assert.deepEqual(h.state, before)
	}
})

test('complete paging sees later refund evidence and the transaction time budget rolls all writes back', async () => {
	const padding = Array.from({ length: 205 }, (_, index) => ({ _id: `cash-${index}`, customer_id: 'customer', source_type: 'manual', status: 'posted', amount: 1, unallocated_amount: 1 }))
	const h = harness({ receipts: [credit(), ...padding, { _id: 'pending', customer_id: 'customer', source_type: 'customer_cash_refund', status: 'posted', amount: -1, refund_source_status: 'pending' }] })
	await assert.rejects(h.run(), /来源待核退款/)
	assert.equal(h.db.writes.length, 0)
	const originalNow = Date.now
	let clock = originalNow()
	try {
		Date.now = () => clock
		const slow = harness({ hooks: { txWrite() { clock += 3000 } } }), before = structuredClone(slow.state)
		await assert.rejects(slow.run(), error => error.code === 503)
		assert.deepEqual(slow.state, before)
	} finally { Date.now = originalNow }
})

test('cache failure stays completed and pending is durable; retry refreshes without duplicating money', async () => {
	let broken = true, calls = 0
	const h = harness({ refreshBalances: async () => { calls++; if (broken) throw Error('synthetic cache failure') } })
	assert.equal((await h.run()).balance_refresh_pending, true)
	assert.equal((await h.query()).result.balance_refresh_pending, true)
	broken = false
	const result = await h.run()
	assert.equal(result.applied_amount, 100)
	assert.equal(result.idempotent, true)
	assert.equal(result.balance_refresh_pending, false)
	assert.equal(calls, 2)
	assert.equal(h.state.crm_customer_allocations.length, 2)
})

test('source, customer, target and source-sale changes between evidence and transaction refuse commit', async () => {
	for (const mutate of [state => { state.crm_customers[0].updated_at++ }, state => { state.crm_sale_records[0].amount_received++ },
		state => { state.crm_customer_receipts[0].updated_at++ }, state => { state.crm_sale_records[1].customer_id = 'another' }]) {
		const h = harness({ hooks: { start: mutate } })
		await assert.rejects(h.run(), /已变化/)
		assert.equal(h.state.crm_customer_allocations.length, 0)
		assert.equal(h.state.crm_operation_logs.length, 0)
	}
})

test('concurrent requests commit once and an ambiguous commit can be queried without another allocation', async () => {
	const h = harness({ dbFactory: optimisticDb })
	await Promise.allSettled([h.run(), h.run()])
	assert.equal(h.state.crm_customer_allocations.length, 2)
	assert.equal(h.state.crm_sale_records.find(row => row._id === 'target').amount_received, 100)
	assert.equal((await h.run()).applied_amount, 100)
	const lost = harness({ dbTransform(base) { return { ...base, startTransaction: async () => { const tx = await base.startTransaction(); return { ...tx, commit: async () => { await tx.commit(); throw Error('commit reply lost') } } } } } })
	await assert.rejects(lost.run(), /reply lost/)
	assert.equal((await lost.query()).result.applied_amount, 100)
	assert.equal((await lost.run()).applied_amount, 100)
	assert.equal(lost.state.crm_customer_allocations.length, 2)
})

function alipay(database, transactional = false) {
	function wrap(query, document = false) { return new Proxy(query, { get(target, field) {
		if (field === 'doc') return id => wrap(target.doc(id), true)
		if (['where', 'limit', 'field', 'skip', 'orderBy'].includes(field)) return (...args) => wrap(target[field](...args))
		if (transactional && field === 'count') return () => { throw Error('transaction count unsupported') }
		if (field === 'get') return async () => { const result = await target.get(); if (!document) return result; if (!result.data?.length) throw Error('missing Alipay document'); return transactional ? { data: result.data[0] } : result }
		return target[field]
	} }) }
	return { ...database, collection: name => wrap(database.collection(name)), startTransaction: async () => alipay(await database.startTransaction(), true) }
}
test('Alipay missing IDs and object document reads work without transaction paging; read errors fail closed', async () => {
	const h = harness({ dbTransform: alipay })
	assert.equal((await h.query()).status, 'not_found')
	assert.equal((await h.run()).applied_amount, 100)
	const broken = harness({ readCompleteFn: async () => { throw Error('incomplete evidence') } }), before = structuredClone(broken.state)
	await assert.rejects(broken.run(), /incomplete/)
	assert.deepEqual(broken.state, before)
})

test('pending source sync blocks first use but completed use remains queryable',async()=>{
 const h=harness({salePatch:{offset_sync_revision:'pool-op',offset_sync_status:'pending'}}),before=structuredClone(h.state);
 await assert.rejects(h.run(),/先完成本单入池/);assert.deepEqual(h.state,before);assert.equal((await h.query()).status,'not_found')
})
