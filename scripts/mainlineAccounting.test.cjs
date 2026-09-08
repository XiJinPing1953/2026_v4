'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, saleDoc, tablesFor, invoke } = require('./lib/accountingTestHarness.cjs')
const { readComplete } = require('../uniCloud-alipay/cloudfunctions/common/financialRead')

const actions = ['getCustomerStatementV1', 'exportCustomerStatementV1', 'exportCustomerAccountingLedgerV1']
const dates = { date_from: '2026-01-01', date_to: '2026-09-08' }

test('historical balances are not receipt evidence and pending cash cannot have complete outer evidence', async () => {
	const tables = tablesFor(saleDoc({ settlement_mode: 'sale', amount_received: 25 }))
	Object.assign(tables.crm_customers[0], { should_receive_total: 1000, receivable_balance: 975, amount_received_total: 25 })
	const db = makeDb(tables), handler = loadHandler('crm-customer-settlement', db)
	for (const action of actions) {
		const r = await invoke(handler, action, { customer_id: 'customer-1', ...dates, summary_only: true })
		assert.equal(r.code, 0, r.msg)
		assert.equal(r.data.period_summary.cash_received, null)
		assert.equal(r.data.period_summary.known_cash.cash_received, 0)
		assert.ok(r.data.period_summary.unresolved_sources.some(row => row.source_id === 'sale-1' && row.reason === 'receipt_date_missing'))
		assert.equal(r.financial_evidence.read_complete, true)
		assert.equal(r.financial_evidence.complete, false, action)
		if (action === 'exportCustomerAccountingLedgerV1') {
			const fallback = r.data.rows.find(row => row.source_type === 'sale_received_fallback')
			assert.equal(fallback.credit, 25)
			assert.match(fallback.summary, /到账日期待核.*非独立收款凭证/)
		}
	}
	assert.equal(db.writes.filter(write => write.name !== 'crm_operation_logs').length, 0)
})

test('mill-scale receipts plus receipt rounding settle flow and historical debt without a phantom balance', async () => {
	const tables = tablesFor(saleDoc({ settlement_mode: 'customer_flow' }))
	const base = { customer_id: 'customer-1', status: 'posted', biz_date: '2026-08-02', created_at: 1, updated_at: 1,
		amount_received: 12.344, receipt_rounding_amount: 0.001 }
	tables.crm_customer_flow_settlements = [{ ...base, _id: 'flow', should_receive: 12.345 }]
	tables.crm_customer_opening_debts = [{ ...base, _id: 'debt', source_type: 'opening', amount: 12.345, money_scale: 3 }]
	const db = makeDb(tables)
	const r = await invoke(loadHandler('crm-customer-settlement', db), 'listCustomerStatementRowsV1', { customer_id: 'customer-1' })
	assert.equal(r.code, 0, r.msg)
	for (const id of ['flow', 'debt']) {
		const row = r.data.find(row => row.row_id === id)
		assert.ok(row, id)
		assert.equal(row.outstanding, 0, id)
		assert.equal(row.meta.payment_status, 'paid', id)
	}
	assert.equal(db.writes.length, 0)
})

test('unavailable counts before or after an empty read must not establish a trustworthy zero', async () => {
	for (const invalid of [null, '', false, undefined, -1, 0.5]) {
		for (const phase of ['before', 'after']) {
			let calls = 0
			const db = makeDb({}, { count: () => ({ total: ++calls === (phase === 'before' ? 1 : 2) ? invalid : 0 }) })
			await assert.rejects(readComplete(db.collection('empty'), {}, { command: db.command }),
				{ code: 'FINANCIAL_READ_INCOMPLETE' }, `${phase}: ${String(invalid)}`)
		}
	}
})

test('financial entry points reject incomplete reads without exposing totals or writing collection tasks', async () => {
	const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
	for (const [name, action, data] of [
		['crm-sale', 'listV2', { page: 1, pageSize: 20 }],
		...actions.map(action => ['crm-customer-settlement', action, { customer_id: 'customer-1', ...dates, summary_only: true }]),
		['crm-dashboard', 'summaryV1', { days: 7 }],
		['crm-collection', 'recalcTaskV1', { id: 'task-1' }]
	]) {
		const tables = tablesFor(saleDoc({ date: today, settlement_mode: 'sale' }))
		tables.crm_collection_tasks = [{ _id: 'task-1', customer_id: 'customer-1', date_from: today, date_to: today, status: 'open' }]
		const db = makeDb(tables, { count: (table, total) => ({ total: table === 'crm_sale_records' ? null : total }) })
		const r = await invoke(loadHandler(name, db), action, data)
		assert.equal(r.code, 409, name + '.' + action)
		assert.equal(r.error_code, 'FINANCIAL_READ_INCOMPLETE')
		assert.equal(r.data.period_summary, undefined)
		assert.equal(r.data.kpi, undefined)
		assert.equal(r.summary, undefined)
		assert.equal(db.writes.length, 0)
	}
})

test('dashboard keeps mill precision and excludes carried-in credits and offsets from cash', async () => {
	const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
	const tables = tablesFor(saleDoc({ date: today, settlement_mode: 'customer_flow' }))
	const base = { customer_id: 'customer-1', biz_date: today, status: 'posted', created_at: 1, updated_at: 1 }
	// Two amounts expose both two-decimal rounding and repeated floating-point truncation.
	tables.crm_customer_flow_settlements = [12.345, 0.001].map((amount, i) => ({ ...base, _id: `flow-${i}`, should_receive: amount, amount_received: 0 }))
		tables.crm_customer_receipts = [
		{ ...base, _id: 'opening', source_type: 'opening_prepay', entry_kind: 'prepay', amount: 50.123, unallocated_amount: 50.123 },
		{ ...base, _id: 'offset-source', source_type: 'sale_offset_credit_repair', amount: 30 },
		{ ...base, _id: 'offset-kind', entry_kind: 'offset_credit', amount: 20 },
		{ ...base, _id: 'offset-legacy', entry_kind: ' OFFSET ', amount: 20 },
		{ ...base, _id: 'cash', entry_kind: 'prepay', amount: 10.123, unallocated_amount: 10.123 },
		{ ...base, _id: 'refund', amount: -2.001 },
		{ ...base, _id: 'void-cash', status: 'void', amount: 100 }
	]
	const db = makeDb(tables), r = await invoke(loadHandler('crm-dashboard', db), 'summaryV1', { days: 7 })
	assert.equal(r.code, 0, r.msg)
	assert.equal(r.data.kpi.sales_month, 12.346)
	assert.equal(r.data.receivable.total_receivable, 12.346)
	// Existing signed receipt series is net cash, not gross cash_received.
	assert.equal(r.data.receivable.total_received, 8.122)
	assert.equal(r.data.receivable.gap_amount, 4.224)
	const statement = await invoke(loadHandler('crm-customer-settlement', db), 'getCustomerStatementV1', {
		customer_id: 'customer-1', date_from: today, date_to: today, summary_only: true
	})
	assert.equal(statement.data.period_summary.business_revenue, r.data.kpi.sales_month)
	assert.equal(statement.data.period_summary.net_cash_received, r.data.receivable.total_received)
	assert.equal(statement.data.period_summary.opening_prepay_transferred, 50.123)
	assert.equal(db.writes.filter(write => write.name !== 'crm_operation_logs').length, 0)
})
