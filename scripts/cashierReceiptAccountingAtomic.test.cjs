'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler } = require('./lib/accountingTestHarness.cjs')

function sale(id = 'sale-1', amountReceived = 40, extra = {}) {
	return {
		_id: id,
		customer_id: 'customer-1',
		customer_name: '合成客户',
		date: '2026-09-01',
		biz_mode: 'truck',
		price_unit: 'kg',
		unit_price: 1,
		truck_out_gross: 1000,
		truck_back_gross: 0,
		amount_received: amountReceived,
		receipt_rounding_amount: 0,
		payment_status: amountReceived > 0 ? 'partial' : 'unpaid',
		created_at: 1,
		updated_at: 1,
		...extra
	}
}

function cashierReceipt(extra = {}) {
	return {
		_id: 'receipt-1',
		customer_id: 'customer-1',
		customer_name: '合成客户',
		biz_date: '2026-09-20',
		amount: 100,
		rounding_amount: 0,
		allocated_amount: 40,
		rounding_allocated_amount: 0,
		unallocated_amount: 60,
		payment_method: 'bank',
		entry_kind: 'prepay',
		allocation_mode: 'period',
		allocation_start_date: '2026-09-01',
		allocation_end_date: '2026-09-30',
		allocation_targets: [],
		note: '原到账备注',
		source_type: 'cashier_intake',
		source_id: 'intake-1',
		intake_id: 'intake-1',
		purpose: 'settlement',
		proof_images: ['cloud://synthetic/proof'],
		proof_images_count: 1,
		status: 'posted',
		created_by_name: '合成出纳',
		created_at: 1,
		updated_at: 1,
		...extra
	}
}

function allocation(id = 'allocation-1', targetId = 'sale-1', amount = 40, extra = {}) {
	return {
		_id: id,
		receipt_id: 'receipt-1',
		customer_id: 'customer-1',
		customer_name: '合成客户',
		sale_id: targetId,
		target_type: 'sale',
		target_id: targetId,
		target_title: `销售单 ${targetId}`,
		allocate_kind: 'receipt',
		allocate_amount: amount,
		seq: 1,
		created_at: 1,
		...extra
	}
}

function tables(extra = {}) {
	return {
		crm_users: [{ _id: 'admin-1', token: 'test', role: 'superadmin', username: '合成管理员' }],
		crm_customers: [{
			_id: 'customer-1',
			name: '合成客户',
			default_price_unit: 'kg',
			receivable_balance: 960,
			prepay_balance: 60,
			prepay_manual_balance: 0,
			receipt_unallocated_balance: 60,
			offset_credit_balance: 0,
			net_balance: 900,
			updated_at: 1
		}, { _id: 'customer-2', name: '其他客户', default_price_unit: 'kg', updated_at: 1 }],
		crm_sale_records: [sale()],
		crm_customer_flow_settlements: [],
		crm_customer_opening_debts: [],
		crm_customer_receipts: [cashierReceipt()],
		crm_customer_allocations: [allocation()],
		crm_customer_receipt_adjustments: [],
		crm_cashier_intake_operations: [],
		crm_operation_logs: [],
		crm_collection_tasks: [],
		crm_collection_followups: [],
		...extra
	}
}

function harness(extra = {}, hooks = {}) {
	const state = tables(extra)
	const db = makeDb(state, { mutate: true, transaction: true, ...hooks })
	if (hooks.logAddError) {
		const baseCollection = db.collection.bind(db)
		db.collection = (name) => {
			const collection = baseCollection(name)
			if (name !== 'crm_operation_logs') return collection
			return { ...collection, add: async () => { throw new Error('synthetic committed log failure') } }
		}
	}
	const main = loadHandler('crm-customer-settlement', db)
	let request = 0
	const invoke = (action, data = {}) => main({ action, token: 'test', data }, { requestId: `atomic-request-${++request}` })
	return { state, db, invoke }
}

function financialState(state) {
	return structuredClone({
		customers: state.crm_customers,
		sales: state.crm_sale_records,
		receipts: state.crm_customer_receipts,
		allocations: state.crm_customer_allocations,
		operations: state.crm_cashier_intake_operations
	})
}

test('explicit release atomically restores targets, keeps arrival facts, and persists an idempotent audit', async () => {
	const h = harness()
	const original = structuredClone(h.state.crm_customer_receipts[0])
	const input = {
		customer_id: 'customer-1', receipt_id: 'receipt-1', operation_id: 'release-operation-0001',
		expected_receipt: structuredClone(h.state.crm_customer_receipts[0])
	}
	const first = await h.invoke('releaseReceiptAllocationsV2', input)
	assert.equal(first.code, 0, first.msg)
	assert.equal(first.data.arrival_preserved, true)
	assert.equal(h.state.crm_sale_records[0].amount_received, 0)
	assert.equal(h.state.crm_customer_allocations.length, 0)
	const receipt = h.state.crm_customer_receipts[0]
	for (const field of ['amount', 'biz_date', 'payment_method', 'note', 'source_type', 'source_id', 'intake_id', 'purpose', 'proof_images_count']) {
		assert.deepEqual(receipt[field], original[field], field)
	}
	assert.equal(receipt.status, 'posted')
	assert.equal(receipt.allocated_amount, 0)
	assert.equal(receipt.unallocated_amount, 100)
	assert.equal(receipt.intake_ever_used, true)
	assert.equal(h.state.crm_cashier_intake_operations.length, 1)
	assert.equal(h.state.crm_cashier_intake_operations[0].before.allocation_rows.length, 1)

	// A retry of the completed operation must not release a later legitimate allocation.
	h.state.crm_customer_allocations.push(allocation('later-allocation', 'sale-1', 10))
	h.state.crm_sale_records[0].amount_received = 10
	receipt.allocated_amount = 10
	receipt.unallocated_amount = 90
	const retry = await h.invoke('releaseReceiptAllocationsV2', input)
	assert.equal(retry.code, 0, retry.msg)
	assert.equal(retry.data.idempotent, true)
	assert.equal(h.state.crm_customer_allocations.length, 1)
	assert.equal(h.state.crm_sale_records[0].amount_received, 10)
	assert.equal(receipt.allocated_amount, 10)
})

test('cashier whole-receipt adjustment plans against virtual rollback and preserves cash facts', async () => {
	const h = harness()
	const original = structuredClone(h.state.crm_customer_receipts[0])
	const begin = await h.invoke('beginReceiptAdjustmentV1', { customer_id: 'customer-1', receipt_id: 'receipt-1' })
	assert.equal(begin.code, 0, begin.msg)
	const updated = await h.invoke('updateReceiptV1', {
		operation_id: begin.data.adjustment_id,
		customer_id: 'customer-1',
		receipt_id: 'receipt-1',
		amount: 100,
		rounding_amount: 0,
		biz_date: '2026-09-20',
		payment_method: 'bank',
		note: '原到账备注',
		allocation_mode: 'period',
		allocation_start_date: '2026-09-01',
		allocation_end_date: '2026-09-30',
		allocation_targets: []
	})
	assert.equal(updated.code, 0, updated.msg)
	assert.equal(h.state.crm_sale_records[0].amount_received, 100)
	assert.equal(h.state.crm_customer_allocations.length, 1)
	assert.equal(h.state.crm_customer_allocations[0].allocate_amount, 100)
	const receipt = h.state.crm_customer_receipts[0]
	for (const field of ['amount', 'biz_date', 'payment_method', 'note', 'source_type', 'source_id', 'intake_id', 'purpose', 'proof_images_count']) {
		assert.deepEqual(receipt[field], original[field], field)
	}
	assert.equal(receipt.allocated_amount, 100)
	assert.equal(receipt.unallocated_amount, 0)
	assert.equal(receipt.receipt_adjustment_status, '')
	assert.equal(h.state.crm_cashier_intake_operations.length, 1)
	assert.equal(h.state.crm_cashier_intake_operations[0].before.allocation_rows[0]._id, 'allocation-1')
	assert.equal(h.state.crm_cashier_intake_operations[0].after.allocation_rows.length, 1)
})

test('cashier whole-receipt adjustment uses a stable operation id across a lost response', async () => {
	const h = harness()
	const input = {
		customer_id: 'customer-1', receipt_id: 'receipt-1', operation_id: 'receipt-adjustment-0001',
		amount: 100, rounding_amount: 0, biz_date: '2026-09-20', payment_method: 'bank', note: '原到账备注',
		allocation_mode: 'period', allocation_start_date: '2026-09-01', allocation_end_date: '2026-09-30', allocation_targets: []
	}
	const first = await h.invoke('updateReceiptV1', input)
	assert.equal(first.code, 0, first.msg)
	assert.equal(first.data.operation_id, input.operation_id)

	// A later legitimate state must survive retrying the completed operation.
	h.state.crm_customer_allocations = [allocation('later-allocation', 'sale-1', 10)]
	h.state.crm_sale_records[0].amount_received = 10
	h.state.crm_customer_receipts[0].allocated_amount = 10
	h.state.crm_customer_receipts[0].unallocated_amount = 90
	const beforeRetry = financialState(h.state)
	const retry = await h.invoke('updateReceiptV1', input)
	assert.equal(retry.code, 0, retry.msg)
	assert.equal(retry.data.idempotent, true)
	assert.deepEqual(financialState(h.state), beforeRetry)

	const conflicting = await h.invoke('updateReceiptV1', { ...input, allocation_mode: 'checked', allocation_targets: [{ target_type: 'sale', target_id: 'sale-1' }] })
	assert.notEqual(conflicting.code, 0)
	assert.match(conflicting.msg, /操作号已用于不同/)
	assert.deepEqual(financialState(h.state), beforeRetry)
})

test('post-commit operation log failure is reported as a warning without denying success', async () => {
	const h = harness({}, { logAddError: true })
	const result = await h.invoke('releaseReceiptAllocationsV2', {
		customer_id: 'customer-1', receipt_id: 'receipt-1', operation_id: 'release-log-warning-0001',
		expected_receipt: structuredClone(h.state.crm_customer_receipts[0])
	})
	assert.equal(result.code, 0, result.msg)
	assert.equal(result.data.committed, true)
	assert.equal(result.data.log_pending, true)
	assert.match(result.msg, /日志待补/)
	assert.equal(h.state.crm_cashier_intake_operations.length, 1)
	assert.equal(h.state.crm_customer_allocations.length, 0)
})

test('release rejects a detail snapshot made stale by another accountant', async () => {
	const h = harness()
	const staleReceipt = structuredClone(h.state.crm_customer_receipts[0])
	h.state.crm_customer_allocations[0].allocate_amount = 30
	h.state.crm_sale_records[0].amount_received = 30
	h.state.crm_customer_receipts[0].allocated_amount = 30
	h.state.crm_customer_receipts[0].unallocated_amount = 70
	h.state.crm_customer_receipts[0].updated_at = 2
	const before = financialState(h.state)
	const result = await h.invoke('releaseReceiptAllocationsV2', {
		customer_id: 'customer-1', receipt_id: 'receipt-1', operation_id: 'release-stale-detail-0001',
		expected_receipt: staleReceipt
	})
	assert.notEqual(result.code, 0)
	assert.equal(result.data.stale_receipt, true)
	assert.deepEqual(financialState(h.state), before)
})

test('transaction failure never leaves a partial rollback or a partial reallocation', async () => {
	let transactionWrites = 0
	const h = harness({}, {
		txWrite: () => {
			transactionWrites += 1
			if (transactionWrites === 2) throw new Error('synthetic transaction interruption')
		}
	})
	const before = financialState(h.state)
	const result = await h.invoke('updateReceiptV1', {
		operation_id: 'interrupted-adjustment',
		customer_id: 'customer-1', receipt_id: 'receipt-1', amount: 100, rounding_amount: 0,
		biz_date: '2026-09-20', payment_method: 'bank', note: '原到账备注', allocation_mode: 'period',
		allocation_start_date: '2026-09-01', allocation_end_date: '2026-09-30', allocation_targets: []
	})
	assert.notEqual(result.code, 0)
	assert.match(result.msg, /interruption/)
	assert.deepEqual(financialState(h.state), before)
})

test('foreign reverse allocations, reverse receipt links, and incomplete receipt scopes block release without writes', async () => {
	for (const patch of [
		{ crm_customer_allocations: [allocation('foreign', 'sale-1', 40, { customer_id: 'customer-2' })] },
		{ crm_customer_receipts: [cashierReceipt(), cashierReceipt({ _id: 'refund-link', source_type: 'customer_refund_cash', source_id: 'receipt-1', intake_id: '', amount: 1, allocated_amount: 0, unallocated_amount: 0, status: 'void' })] },
		{ crm_customer_receipts: [cashierReceipt(), cashierReceipt({ _id: 'unknown-status', source_type: 'manual', source_id: '', intake_id: '', amount: 1, allocated_amount: 0, unallocated_amount: 1, status: 'draft' })] },
		{ crm_customer_receipts: [cashierReceipt({ unallocated_amount: undefined })] }
	]) {
		const h = harness(patch)
		const before = financialState(h.state)
		const result = await h.invoke('releaseReceiptAllocationsV2', {
			customer_id: 'customer-1', receipt_id: 'receipt-1', operation_id: `blocked-${Math.random().toString(36).slice(2, 12)}`,
			expected_receipt: structuredClone(h.state.crm_customer_receipts[0])
		})
		assert.notEqual(result.code, 0)
		assert.deepEqual(financialState(h.state), before)
	}
})

test('fifty-target release stays atomic and within the transaction budget guard', async () => {
	const sales = Array.from({ length: 50 }, (_, index) => sale(`sale-${index + 1}`, 2, { truck_out_gross: 2 }))
	const rows = sales.map((row, index) => allocation(`allocation-${index + 1}`, row._id, 2, { seq: index + 1 }))
	const h = harness({
		crm_sale_records: sales,
		crm_customer_receipts: [cashierReceipt({ allocated_amount: 100, unallocated_amount: 0 })],
		crm_customer_allocations: rows
	})
	const started = Date.now()
	const result = await h.invoke('releaseReceiptAllocationsV2', {
		customer_id: 'customer-1', receipt_id: 'receipt-1', operation_id: 'release-operation-0050',
		expected_receipt: structuredClone(h.state.crm_customer_receipts[0])
	})
	assert.equal(result.code, 0, result.msg)
	assert.ok(Date.now() - started < 8500)
	assert.equal(h.state.crm_customer_allocations.length, 0)
	assert.equal(h.state.crm_sale_records.every(row => row.amount_received === 0), true)
	assert.equal(h.state.crm_customer_receipts[0].unallocated_amount, 100)
})

test('ordinary receipt creation cannot forge the cashier intake source and old delete keeps its meaning', async () => {
	const h = harness()
	const create = await h.invoke('createReceiptV1', {
		customer_id: 'customer-1', amount: 1, biz_date: '2026-09-20', payment_method: 'bank',
		allocation_mode: 'period', allocation_start_date: '2026-09-01', allocation_end_date: '2026-09-30',
		source_type: 'cashier_intake'
	})
	assert.notEqual(create.code, 0)
	assert.match(create.msg, /带操作号的出纳到账入口/)
	const remove = await h.invoke('removeReceiptV1', { customer_id: 'customer-1', receipt_id: 'receipt-1' })
	assert.notEqual(remove.code, 0)
	assert.match(remove.msg, /解除分配/)
	assert.equal(h.state.crm_customer_receipts[0].status, 'posted')
})

test('first operation tolerates Alipay missing-doc behavior through a fixed-ID query', async () => {
 const h = harness()
 const collection = h.db.collection.bind(h.db)
 h.db.collection = name => {
  const table = collection(name)
  if (name !== 'crm_cashier_intake_operations') return table
  const doc = table.doc.bind(table)
  table.doc = id => {
   const ref = doc(id)
   ref.get = async () => { throw new Error('not found doc') }
   return ref
  }
  return table
 }
 const main = loadHandler('crm-customer-settlement', h.db)
 const result = await main({token:'test',action:'releaseReceiptAllocationsV2',data:{
  customer_id:'customer-1',receipt_id:'receipt-1',operation_id:'provider-first-op',
  expected_receipt:structuredClone(h.state.crm_customer_receipts[0])
 }})
 assert.equal(result.code,0,result.msg)
 assert.equal(result.data.committed,true)
})

test('old cashier adjustment requests without a durable operation id must upgrade', async () => {
 const h=harness(), before=financialState(h.state)
 const result=await h.invoke('updateReceiptV1',{customer_id:'customer-1',receipt_id:'receipt-1',amount:100})
 assert.equal(result.code,409)
 assert.match(result.msg,/刷新页面/)
 assert.deepEqual(financialState(h.state),before)
})
