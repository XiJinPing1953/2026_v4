'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, saleDoc, tablesFor, invoke } = require('./lib/accountingTestHarness.cjs')

test('meter reconciliation summary and both exports retain identical three-decimal totals', async () => {
	const base = { customer_id: 'customer-1', customer_name: '测试客户', status: 'posted', created_at: 1, updated_at: 1 }
	const tables = tablesFor(saleDoc({ settlement_mode: 'customer_flow', amount_received: 0 }))
	tables.crm_customer_flow_settlements = [2561.886, 5586.299, 64518.318, 14042.28].map((amount, i) => ({
		...base, _id: `flow-${i}`, biz_date: ['2026-01-04','2026-01-05','2026-02-02','2026-03-13'][i],
		should_receive: amount, amount_received: amount, receipt_rounding_amount: 0, payment_status: 'paid', sale_ids: []
	}))
	tables.crm_customer_opening_debts = [
		{ ...base, _id: 'opening', biz_date: '2025-12-31', source_type: 'opening', amount: 77823.297, amount_received: 77823.297, money_scale: 3 },
		{ ...base, _id: 'tail', biz_date: '2026-01-06', source_type: 'reconciliation_other_fee', amount: .02, amount_received: .02, money_scale: 3 }
	]
	tables.crm_customer_receipts = [85971.5, 64517.95, 14042.65].map((amount, i) => ({ ...base,
		_id: `receipt-${i}`, biz_date: ['2026-01-06','2026-02-03','2026-04-01'][i], amount, allocated_amount: amount, unallocated_amount: 0
	}))
	tables.crm_customer_allocations = [[0,'opening_debt','opening',77823.297],[0,'flow_settlement','flow-0',2561.886],
		[0,'flow_settlement','flow-1',5586.299],[0,'other_fee','tail',.018],[1,'flow_settlement','flow-2',64517.95],
		[2,'flow_settlement','flow-2',.368],[2,'flow_settlement','flow-3',14042.28],[2,'other_fee','tail',.002]]
		.map(([r, target_type, target_id, allocate_amount], i) => ({ ...base, _id: `allocation-${i}`, receipt_id: `receipt-${r}`,
			target_type, target_id, allocate_amount, allocate_kind: 'receipt' }))
	const handler = loadHandler('crm-customer-settlement', makeDb(tables))
	const summary = await invoke(handler, 'getCustomerStatementV1', { customer_id: 'customer-1', summary_only: false })
	assert.equal(summary.data.summary.should_receive_total, 86708.803)
	assert.equal(summary.data.summary.amount_received_total, 86708.803)
	assert.equal(summary.data.summary.net_balance, 0)
	const period = { customer_id: 'customer-1', date_from: '2026-01-01', date_to: '2026-12-31' }
	const detail = await invoke(handler, 'exportCustomerStatementV1', period)
	const ledger = await invoke(handler, 'exportCustomerAccountingLedgerV1', period)
	assert.equal(detail.data.totals.amount, 86708.803)
	assert.equal(ledger.data.totals.debit, 86708.803)
	assert.equal(detail.data.totals.receipt, 164532.1)
	assert.equal(ledger.data.totals.credit, 164532.1)
	assert.equal(detail.data.closing_balance, 0)
	assert.equal(ledger.data.closing_balance, 0)
})

test('multiple prior-period sources retain fractional opening balances in both exports', async () => {
 const tables = tablesFor(saleDoc({settlement_mode: 'customer_flow'}))
 tables.crm_customer_opening_debts = [.018,.002].map((amount,i)=>({_id:`opening-${i}`,customer_id:'customer-1',biz_date:'2025-12-31',source_type:'opening',status:'posted',amount,amount_received:0,money_scale:3}))
 const handler = loadHandler('crm-customer-settlement', makeDb(tables))
 for(const action of ['exportCustomerStatementV1','exportCustomerAccountingLedgerV1']) {
  const result=await invoke(handler,action,{customer_id:'customer-1',date_from:'2026-01-01',date_to:'2026-12-31'})
  assert.equal(result.code,0)
  assert.equal(result.data.opening_balance,.02)
  assert.equal(result.data.closing_balance,.02)
 }
})
