'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const rule = require(path.resolve(__dirname, '../uniCloud-alipay/cloudfunctions/crm-customer-settlement/offsetCreditRefund.js'))
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')

const source = (extra = {}) => ({ _id: 'offset-1', customer_id: 'customer-1', customer_name: '通用客户', status: 'posted',
	source_type: 'sale_offset_credit', entry_kind: 'offset_credit', amount: 1260, allocated_amount: 270,
	rounding_allocated_amount: 0, unallocated_amount: 990, updated_at: 12, biz_date: '2026-02-02', ...extra })
const input = (extra = {}) => ({ source: source(), customerId: 'customer-1', refundAmount: 990, refundDate: '2026-02-02',
	operationId: 'op-fixed-1', expected: { updated_at: 12, amount: 1260, allocated_amount: 270,
		rounding_allocated_amount: 0, unallocated_amount: 990, offset_cash_refunded_amount: 0 }, moneyScale: 2, ...extra })

{
	const plan = rule.buildOffsetCreditRefundPlan(input())
	assert.equal(plan.ok, true)
	assert.equal(plan.before.allocated_amount, 270)
	assert.equal(plan.after.unallocated_amount, 0)
	assert.equal(plan.refund_receipt.amount, -990)
}
{
	const second = rule.buildOffsetCreditRefundPlan(input({
		source: source({ unallocated_amount: 490, offset_cash_refunded_amount: 500 }), refundAmount: 490,
		operationId: 'op-fixed-2', expected: { ...input().expected, unallocated_amount: 490, offset_cash_refunded_amount: 500 }
	}))
	assert.equal(second.ok, true); assert.equal(second.after.unallocated_amount, 0); assert.equal(second.after.offset_cash_refunded_amount, 990)
}
for (const [reason, patch] of [
	['refund_exceeds_unallocated_offset', { refundAmount: 991 }],
	['offset_source_not_posted', { source: source({ status: 'void' }) }],
	['source_version_conflict', { expected: { ...input().expected, allocated_amount: 0 } }],
	['expected_unallocated_amount_required', { expected: { ...input().expected, unallocated_amount: undefined } }],
	['offset_source_balance_incomplete', { source: source({ unallocated_amount: 989 }) }],
	['operation_id_required', { operationId: '' }]
]) assert.equal(rule.buildOffsetCreditRefundPlan(input(patch)).reason, reason)

const tables = {
	crm_users: [{ _id: 'sa', token: 'test', role: 'superadmin', username: 'sa' }],
	crm_customers: [{ _id: 'customer-1', name: '通用客户', default_price_unit: 'kg' }],
	crm_sale_records: [], crm_customer_receipts: [source()], crm_customer_allocations: [],
	crm_customer_receipt_adjustments: [], crm_customer_flow_settlements: [], crm_customer_opening_debts: [],
	crm_collection_tasks: [], crm_collection_followups: [], crm_operation_logs: []
}
const db = makeDb(tables, { mutate: true, transaction: true })
const handler = loadHandler('crm-customer-settlement', db)
const payload = { customer_id: 'customer-1', receipt_id: 'offset-1', refund_amount: 990, refund_date: '2026-02-02',
	operation_id: 'op-fixed-1', confirm_text: rule.CONFIRM_TEXT, expected_source: input().expected, payment_method: 'bank' }

;(async () => {
	const preview = await invoke(handler, 'previewOffsetCreditCashRefundV1', payload)
	assert.equal(preview.code, 0)
	assert.equal(tables.crm_operation_logs.length, 0, 'preview must be read-only')
	const done = await invoke(handler, 'convertOffsetCreditToCashRefundV1', payload)
	assert.equal(done.code, 0)
	assert.equal(tables.crm_customer_receipts.find(row => row._id === 'offset-1').unallocated_amount, 0)
	assert.equal(tables.crm_customer_receipts.find(row => row._id === 'offset-1').allocated_amount, 270)
	const refunds = tables.crm_customer_receipts.filter(row => row.source_type === rule.SOURCE_TYPE)
	assert.equal(refunds.length, 1); assert.equal(refunds[0].amount, -990)
	const repeated = await invoke(handler, 'convertOffsetCreditToCashRefundV1', payload)
	assert.equal(repeated.code, 0); assert.equal(repeated.data.idempotent, true)
	assert.equal(tables.crm_customer_receipts.filter(row => row.source_type === rule.SOURCE_TYPE).length, 1)
	const reusedWithDifferentAmount = await invoke(handler, 'convertOffsetCreditToCashRefundV1', { ...payload, refund_amount: 989 })
	assert.equal(reusedWithDifferentAmount.code, 409)
	const summary = await invoke(handler, 'getCustomerStatementV1', { customer_id: 'customer-1', date_from: '2026-02-01', date_to: '2026-02-28' })
	assert.equal(summary.data.period_summary.refund_total, 990)
	assert.equal(summary.data.period_summary.net_cash_received, -990)
	assert.equal(summary.data.period_summary.cash_received, 0)
	for (const action of ['exportCustomerStatementV1', 'exportCustomerAccountingLedgerV1']) {
		const exported = await invoke(handler, action, { customer_id: 'customer-1', date_from: '2026-02-01', date_to: '2026-02-28' })
		assert.equal(exported.data.period_summary.refund_total, 990)
		assert.equal(exported.data.period_summary.net_cash_received, -990)
	}
	const audit = tables.crm_operation_logs.find(row => row.action === 'offset_credit_cash_refund_execute_v1')
	assert.equal(audit.detail.before.unallocated_amount, 990); assert.equal(audit.detail.after.unallocated_amount, 0)
	tables.crm_users.push({ _id: 'finance', token: 'finance', role: 'finance', username: 'finance' })
	const denied = await handler({ action: 'convertOffsetCreditToCashRefundV1', token: 'finance', data: { ...payload, operation_id: 'op-denied' } }, {})
	assert.equal(denied.code, 403)
	const failedTables = structuredClone({ ...tables,
		crm_customer_receipts: [source()], crm_operation_logs: [] })
	let txWrites = 0
	const failedDb = makeDb(failedTables, { mutate: true, transaction: true,
		txWrite: () => { if (++txWrites === 2) throw new Error('simulated transaction failure') } })
	const failed = await invoke(loadHandler('crm-customer-settlement', failedDb), 'convertOffsetCreditToCashRefundV1', { ...payload, operation_id: 'op-failed' })
	assert.equal(failed.code, 500)
	assert.equal(failedTables.crm_customer_receipts.length, 1)
	assert.equal(failedTables.crm_customer_receipts[0].unallocated_amount, 990)
	assert.equal(failedTables.crm_operation_logs.length, 0)
	console.log('offset credit cash refund tests passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
