'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler } = require('./lib/accountingTestHarness.cjs')

const ids = { customer_id: 'customer-1', receipt_id: 'receipt-1' }
function sale(id, received) {
	return { _id: id, customer_id: ids.customer_id, date: '2026-09-20', biz_mode: 'truck',
		price_unit: 'kg', unit_price: 1, truck_out_gross: 1000, truck_back_gross: 0,
		amount_received: received, receipt_rounding_amount: 0, payment_status: received ? 'partial' : 'unpaid',
		created_at: 1, updated_at: 1 }
}
function allocation(id = 'allocation-1', target = 'sale-old', amount = 37.5) {
	// Historical allocations did not carry a status field.
	return { _id: id, ...ids, sale_id: target, target_type: 'sale', target_id: target,
		target_title: target, target_date: '2026-09-20', allocate_kind: 'receipt', allocate_amount: amount, seq: 1, created_at: 1 }
}
function harness({ unallocated = false, get } = {}) {
	const state = {
		crm_users: [{ _id: 'admin-1', token: 'test', role: 'superadmin', username: '合成管理员' }],
		crm_customers: [{ _id: ids.customer_id, name: '合成客户', default_price_unit: 'kg', updated_at: 1 }],
		crm_sale_records: [sale('sale-old', unallocated ? 0 : 37.5), sale('sale-new', 0)],
		crm_customer_receipts: [{ _id: ids.receipt_id, customer_id: ids.customer_id, customer_name: '合成客户',
			biz_date: '2026-09-20', amount: 37.5, rounding_amount: 0, allocated_amount: unallocated ? 0 : 37.5,
			rounding_allocated_amount: 0, unallocated_amount: unallocated ? 37.5 : 0,
			payment_method: 'bank', entry_kind: 'offset_credit', allocation_mode: 'checked',
			allocation_start_date: '', allocation_end_date: '', allocation_targets: [], note: '退气冲抵',
			source_type: 'sale_offset_credit', source_id: 'negative-sale', status: 'posted', created_at: 1, updated_at: 1 }],
		crm_customer_allocations: unallocated ? [] : [allocation()],
		crm_customer_flow_settlements: [], crm_customer_opening_debts: [], crm_customer_receipt_adjustments: [],
		crm_operation_logs: [], crm_collection_tasks: [], crm_collection_followups: []
	}
	const db = makeDb(state, { mutate: true, get })
	const main = loadHandler('crm-customer-settlement', db)
	const invoke = (action, data = {}) => main({ action, token: 'test', data: { ...ids, ...data } }, { requestId: 'synthetic-request' })
	return { state, db, invoke }
}
const checked = { allocation_mode: 'checked', allocation_targets: [{ target_type: 'sale', target_id: 'sale-new' }] }

test('automatic IDs omitted by batch lookup are read individually before moving an offset allocation', async () => {
	let fallbackReads = 0
	const h = harness({ get(name, rows, opts) {
		if (name === 'crm_sale_records' && opts.where?._id?.$in) return { data: [] }
		if (name === 'crm_sale_records' && opts.where?._id === 'sale-old') {
			fallbackReads += 1
			return { data: structuredClone(rows[0] || null) }
		}
		return { data: structuredClone(rows) }
	} })
	assert.equal((await h.invoke('beginReceiptAdjustmentV1')).code, 0)
	const result = await h.invoke('updateReceiptV1', checked)
	assert.equal(result.code, 0, result.msg)
	assert.ok(fallbackReads > 0)
	assert.equal(h.state.crm_sale_records[0].amount_received, 0)
	assert.equal(h.state.crm_sale_records[1].amount_received, 37.5)
	assert.equal(h.state.crm_customer_allocations.length, 1)
	assert.equal(h.state.crm_customer_allocations[0].target_id, 'sale-new')
	assert.equal(h.state.crm_customer_receipts[0].source_type, 'sale_offset_credit')
	assert.equal(h.state.crm_operation_logs.at(-1).detail?.rollback_total ?? h.state.crm_operation_logs.at(-1).payload?.rollback_total, 37.5)
})

for (const broken of ['missing target', 'foreign target', 'insufficient received', 'one-cent shortfall', 'insufficient rounding', 'invalid amount']) {
	test(`a later ${broken} blocks the whole rollback before any write`, async () => {
		const h = harness()
		h.state.crm_customer_allocations.push(allocation('allocation-bad', 'sale-bad', 5))
		if (broken !== 'missing target') h.state.crm_sale_records.push(sale('sale-bad', 5))
		if (broken === 'foreign target') h.state.crm_sale_records.at(-1).customer_id = 'other-customer'
		if (broken === 'insufficient received') h.state.crm_sale_records.at(-1).amount_received = 4
		if (broken === 'one-cent shortfall') h.state.crm_sale_records.at(-1).amount_received = 4.99
		if (broken === 'insufficient rounding') h.state.crm_customer_allocations.at(-1).allocate_kind = 'rounding'
		if (broken === 'invalid amount') h.state.crm_customer_allocations.at(-1).allocate_amount = 'not-money'
		const before = structuredClone(h.state)
		const result = await h.invoke('updateReceiptV1', checked)
		assert.equal(result.code, 409, result.msg)
		assert.equal(result.error_code, 'RECEIPT_ADJUSTMENT_INTEGRITY')
		assert.deepEqual(h.state, before)
		assert.equal(h.db.writes.length, 0)
	})
}

for (const unallocated of [false, true]) {
	test(`deferred cancel with ${unallocated ? 'zero' : 'existing'} allocations preserves the original money and source`, async () => {
		const h = harness({ unallocated })
		const original = structuredClone(h.state.crm_customer_receipts[0])
		assert.equal((await h.invoke('beginReceiptAdjustmentV1')).code, 0)
		const moneyBeforeCancel = structuredClone(h.state.crm_sale_records)
		const allocationsBeforeCancel = structuredClone(h.state.crm_customer_allocations)
		const writeOffset = h.db.writes.length
		const result = await h.invoke('cancelReceiptAdjustmentV1')
		assert.equal(result.code, 0, result.msg)
		const receipt = h.state.crm_customer_receipts[0]
		for (const field of Object.keys(original).filter((key) => key !== 'updated_at')) assert.deepEqual(receipt[field], original[field], field)
		assert.equal(receipt.receipt_adjustment_status, '')
		assert.deepEqual(h.state.crm_sale_records, moneyBeforeCancel)
		assert.deepEqual(h.state.crm_customer_allocations, allocationsBeforeCancel)
		assert.ok(h.db.writes.slice(writeOffset).every((write) => ['crm_customer_receipts', 'crm_operation_logs'].includes(write.name)))
	})
}

for (const defect of ['missing snapshot', 'missing receipt field', 'missing allocation rows', 'changed money', 'changed allocations']) {
	test(`cancel refuses ${defect} without altering the receipt or allocations`, async () => {
		const h = harness({ unallocated: true })
		assert.equal((await h.invoke('beginReceiptAdjustmentV1')).code, 0)
		const receipt = h.state.crm_customer_receipts[0]
		if (defect === 'missing snapshot') receipt.receipt_adjustment_snapshot = null
		if (defect === 'missing receipt field') delete receipt.receipt_adjustment_snapshot.receipt.amount
		if (defect === 'missing allocation rows') delete receipt.receipt_adjustment_snapshot.allocation_rows
		if (defect === 'changed money') receipt.amount = 38
		if (defect === 'changed allocations') h.state.crm_customer_allocations.push(allocation())
		const before = structuredClone(h.state)
		const writes = h.db.writes.length
		const result = await h.invoke('cancelReceiptAdjustmentV1')
		assert.equal(result.code, 409, result.msg)
		assert.equal(result.error_code, 'RECEIPT_ADJUSTMENT_INTEGRITY')
		assert.deepEqual(h.state, before)
		assert.equal(h.db.writes.length, writes)
	})
}

for (const targetState of ['recoverable', 'missing', 'invalid received', 'insufficient capacity', 'inconsistent snapshot totals']) {
	test(`legacy physical cancel requires a complete ${targetState} restore target`, async () => {
		const h = harness()
		assert.equal((await h.invoke('beginReceiptAdjustmentV1')).code, 0)
		const receipt = h.state.crm_customer_receipts[0]
		receipt.receipt_adjustment_rollback_strategy = 'physical'
		receipt.allocated_amount = 0
		receipt.unallocated_amount = 37.5
		h.state.crm_customer_allocations = []
		h.state.crm_sale_records[0].amount_received = targetState === 'insufficient capacity' ? 990 : 0
		if (targetState === 'missing') h.state.crm_sale_records.shift()
		if (targetState === 'invalid received') h.state.crm_sale_records[0].amount_received = 'not-money'
		if (targetState === 'inconsistent snapshot totals') {
			receipt.receipt_adjustment_snapshot.receipt.allocated_amount = 0
			receipt.receipt_adjustment_snapshot.allocation_rows = []
		}
		const before = structuredClone(h.state)
		const writes = h.db.writes.length
		const result = await h.invoke('cancelReceiptAdjustmentV1')
		if (targetState === 'recoverable') {
			assert.equal(result.code, 0, result.msg)
			assert.equal(h.state.crm_sale_records[0].amount_received, 37.5)
			assert.equal(h.state.crm_customer_allocations.length, 1)
			assert.equal(h.state.crm_customer_allocations[0].allocate_amount, 37.5)
			assert.equal(receipt.amount, 37.5)
			assert.equal(receipt.source_type, 'sale_offset_credit')
		} else {
			assert.equal(result.code, 409, result.msg)
			assert.deepEqual(h.state, before)
			assert.equal(h.db.writes.length, writes)
		}
	})
}

test('a target update matching no document cannot delete the original allocation or reallocate', async () => {
	const h = harness()
	const collection = h.db.collection.bind(h.db)
	h.db.collection = (name) => {
		const source = collection(name)
		return name === 'crm_sale_records' ? { ...source, doc: (id) => ({ ...source.doc(id), update: async () => ({ updated: 0 }) }) } : source
	}
	const main = loadHandler('crm-customer-settlement', h.db)
	const before = structuredClone(h.state)
	const result = await main({ action: 'updateReceiptV1', token: 'test', data: { ...ids, ...checked } }, {})
	assert.equal(result.code, 409, result.msg)
	assert.deepEqual(h.state, before)
	assert.equal(h.db.writes.length, 0)
})
