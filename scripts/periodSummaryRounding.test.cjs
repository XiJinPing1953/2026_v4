'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { makeDb, loadHandler, saleDoc, tablesFor, invoke } = require('./lib/accountingTestHarness.cjs')
const base = { customer_id: 'customer-1', status: 'posted', created_at: 1, updated_at: 1 }
const sale = (id, date, extra = {}) => saleDoc({ _id: id, date, settlement_mode: 'sale', unit_price: 1, flow_volume_m3: 100, ...extra })
const receipt = (id, date, rounding, extra = {}) => ({ ...base, _id: id, biz_date: date, amount: 0, rounding_allocated_amount: rounding, ...extra })
const allocation = (id, target, receiptId, amount, extra = {}) => ({ ...base, _id: id, target_type: 'sale', target_id: target,
	receipt_id: receiptId, allocate_kind: 'rounding', allocate_amount: amount, biz_date: '2026-03-01', ...extra })
function harness(sales = []) {
	const tables = tablesFor(sales[0]); tables.crm_sale_records = sales
	tables.crm_customer_receipts = []; tables.crm_customer_allocations = []
	const db = makeDb(tables), main = loadHandler('crm-customer-settlement', db)
	return { tables, db, main }
}
async function summaries(h, from = '2026-01-01', to = '2026-09-12') {
	const results = []
	for (const action of ['getCustomerStatementV1', 'exportCustomerStatementV1', 'exportCustomerAccountingLedgerV1']) {
		const result = await invoke(h.main, action, { customer_id: 'customer-1', date_from: from, date_to: to, summary_only: true })
		assert.equal(result.code, 0, result.msg)
		results.push(result.data)
	}
	const removeReadTime = p => JSON.parse(JSON.stringify({ ...p, read_started_at: undefined, read_completed_at: undefined }))
	for (const result of results.slice(1)) assert.deepEqual(removeReadTime(result.period_summary), removeReadTime(results[0].period_summary))
	assert.equal(h.db.writes.length, 0)
	return { summary: results[0].period_summary, daily: results[1], ledger: results[2] }
}

test('sale rounding and receipt rounding are distinct events, but receipt, allocations and target copies are counted only once', async () => {
	const h = harness([sale('a', '2025-12-31', { rounding_amount: 3, write_off: 3, receipt_rounding_amount: 7 }),
		sale('b', '2026-01-02', { rounding_amount: 5, receipt_rounding_amount: 5 })])
	h.tables.crm_customer_receipts = [receipt('r', '2026-02-01', 12, { amount: 100 })]
	h.tables.crm_customer_allocations = [allocation('a1', 'a', 'r', 7), allocation('a2', 'b', 'r', 5)]
	const before = structuredClone(h.tables)
	for (const [from, to, expected, cash] of [
		['2025-12-01', '2026-03-31', 20, 100], ['2025-12-01', '2025-12-31', 3, 0],
		['2026-01-01', '2026-01-31', 5, 0], ['2026-02-01', '2026-02-28', 12, 100], ['2026-03-01', '2026-03-31', 0, 0]
	]) {
		const { summary: p, daily } = await summaries(h, from, to)
		assert.equal(p.rounding_total, expected); assert.equal(p.cash_received, cash)
		assert.equal(p.rounding_complete, true); assert.equal(p.legacy_rounding_total, 0)
		assert.equal(daily.totals.rounding, expected, 'new summary agrees with the unchanged ledger/daily rounding events')
	}
	assert.deepEqual(h.tables, before)
})

test('legacy embedded rounding uses the source date with explicit provenance; historical write_off alias is not added twice', async () => {
	const h = harness([sale('old', '2025-12-31', { receipt_rounding_amount: 9, write_off: 2 }),
		sale('current', '2026-01-02', { rounding_amount: 4, write_off: 4, receipt_rounding_amount: 3 })])
	const previous = await summaries(h, '2025-12-01', '2025-12-31')
	assert.equal(previous.summary.rounding_total, 11)
	const { summary: p, daily } = await summaries(h)
	assert.equal(p.rounding_total, 7); assert.equal(daily.totals.rounding, 7)
	assert.equal(p.legacy_rounding_total, 3); assert.equal(p.cash_received, 0)
	assert.equal(p.rounding_sources.find(row => row.date_basis === 'legacy_source_date').biz_date, '2026-01-02')
	assert.match(p.source_notes.find(row => row.source_type === 'legacy_rounding').text, /按源单业务日期.*缺少独立抹零日期/)
})

test('void receipts and allocations do not reappear as legacy rounding; ambiguous stale target copies remain pending', async () => {
	const h = harness([sale('target', '2026-01-01')])
	h.tables.crm_customer_receipts = [receipt('void', '2026-01-02', 9, { status: 'void' })]
	h.tables.crm_customer_allocations = [allocation('void-a', 'target', 'void', 9, { status: 'void' })]
	let p = (await summaries(h)).summary
	assert.equal(p.rounding_total, 0); assert.equal(p.complete, true)
	h.tables.crm_sale_records[0].receipt_rounding_amount = 9
	p = (await summaries(h)).summary
	assert.equal(p.rounding_total, null); assert.equal(p.known_rounding_total, 0)
	assert.equal(p.cash_received, 0); assert.equal(p.rounding_complete, false)
	assert.ok(p.unresolved_sources.some(row => row.reason === 'rounding_void_allocation_residual'))
})

test('missing dates, invalid receipt links and mismatched rounding allocations never report a certain total or hide known cash', async () => {
	for (const [reason, mutate] of [
		['rounding_date_missing', h => { h.tables.crm_customer_receipts[0].biz_date = '' }],
		['rounding_allocation_without_posted_receipt', h => { h.tables.crm_customer_receipts[0].status = 'void' }],
		['rounding_allocation_without_posted_receipt', h => { h.tables.crm_customer_receipts.splice(0, 1) }],
		['rounding_allocation_mismatch', h => { h.tables.crm_customer_receipts[0].rounding_allocated_amount = 8 }],
		['rounding_exceeds_target', h => { h.tables.crm_sale_records[0].receipt_rounding_amount = 1 }],
		['rounding_target_missing', h => { h.tables.crm_customer_allocations[0].target_id = 'missing-target' }]
	]) {
		const h = harness([sale('target', '2026-01-01', { receipt_rounding_amount: 9 })])
		h.tables.crm_customer_receipts = [receipt('r', '2026-01-02', 9), receipt('cash', '2026-01-03', 0, { amount: 100 })]
		h.tables.crm_customer_allocations = [allocation('a', 'target', 'r', 9)]
		mutate(h)
		const p = (await summaries(h)).summary
		assert.equal(p.rounding_total, null, reason); assert.equal(p.complete, false, reason)
		assert.equal(p.cash_received, 100, reason)
		assert.equal(p.cash_complete, true, reason)
		assert.ok(p.unresolved_sources.some(row => row.reason === reason), reason)
	}
	const h = harness([sale('legacy-without-date', '', { receipt_rounding_amount: 3 })])
	const p = (await summaries(h)).summary
	assert.equal(p.rounding_total, null); assert.ok(p.unresolved_sources.some(row => row.reason === 'rounding_date_missing'))
})

test('three-decimal flow and debt receipt rounding uses integer sums; existing own debt discount remains disclosure only', async () => {
	const h = harness([])
	h.tables.crm_customer_flow_settlements = [{ ...base, _id: 'flow', biz_date: '2026-01-01', should_receive: 1, receipt_rounding_amount: .018 }]
	h.tables.crm_customer_opening_debts = [{ ...base, _id: 'debt', biz_date: '2026-01-01', source_type: 'opening', amount: 1,
		rounding_amount: .001, receipt_rounding_amount: .002, money_scale: 3 }]
	h.tables.crm_customer_receipts = [receipt('r', '2026-01-02', .02)]
	h.tables.crm_customer_allocations = [allocation('a1', 'flow', 'r', .018, { target_type: 'flow_settlement' }),
		allocation('a2', 'debt', 'r', .002, { target_type: 'opening_debt' })]
	const { summary: p, daily } = await summaries(h)
	assert.equal(p.rounding_total, .021); assert.equal(p.rounding_complete, true)
	assert.equal(p.cash_received, 0); assert.equal(p.historical_receivable, .999)
	assert.equal(daily.totals.rounding, .02, 'own debt discount is already embedded in debt effective amount')
	assert.equal(daily.closing_balance, 1.979, 'new disclosure never subtracts the debt discount again')
})

test('known rounding dates outside the period cannot invalidate current totals; undated evidence still needs review', async () => {
	const h = harness([sale('old', '2025-01-01', { receipt_rounding_amount: 9 }), sale('current', '2026-01-01', { rounding_amount: 2 })])
	h.tables.crm_customer_receipts = [receipt('old-r', '2025-01-02', 9)]
	h.tables.crm_customer_allocations = [allocation('old-a', 'old', 'old-r', 8)]
	let p = (await summaries(h)).summary
	assert.equal(p.rounding_total, 2); assert.equal(p.rounding_complete, true)
	p = (await summaries(h, '2025-01-01', '2025-01-31')).summary
	assert.equal(p.rounding_total, null); assert.equal(p.rounding_complete, false)
	h.tables.crm_customer_receipts[0].biz_date = ''
	p = (await summaries(h)).summary
	assert.equal(p.rounding_total, null); assert.ok(p.unresolved_sources.some(row => row.reason === 'rounding_date_missing'))
})

test('later rounding follows the registered allocation business date with an explicit accounting-date note, not the operation timestamp', async () => {
	for (const [source, allocationSource] of [['opening_prepay', 'prepay_manual_allocate'], ['customer_prepay_manual', 'prepay_manual_allocate'], ['cashier_intake', 'receipt_unallocated_allocate']]) {
		const h = harness([sale('target', '2026-01-01', { amount_received: 50, receipt_rounding_amount: 2 })])
		h.tables.crm_customer_receipts = [receipt('opening', '2025-12-31', 2, { source_type: source, amount: 500 })]
		h.tables.crm_customer_allocations = [allocation('principal-a', 'target', 'opening', 50, { allocate_kind: 'receipt' }),
			allocation('rounding-a', 'target', 'opening', 2, { source_type: allocationSource, biz_date: '2025-12-31', created_at: Date.parse('2026-02-01') })]
		for (const from of ['2025-01-01', '2026-01-01']) {
			const p = (await summaries(h, from)).summary
			assert.equal(p.rounding_total, from === '2025-01-01' ? 2 : 0); assert.equal(p.rounding_complete, true)
			if (from === '2025-01-01') {
				assert.equal(p.rounding_sources[0].date_basis, 'allocation_biz_date')
				assert.equal(p.rounding_sources[0].biz_date, '2025-12-31')
				assert.match(p.source_notes.find(row => row.source_type === 'allocation_rounding').text, /已登记业务日期.*可能沿用原收款日.*不代表实际操作日/)
			}
			assert.equal(p.cash_received, source !== 'opening_prepay' && from === '2025-01-01' ? 500 : 0)
			assert.equal(p.opening_prepay_transferred, source === 'opening_prepay' && from === '2025-01-01' ? 500 : 0)
		}
		h.tables.crm_customer_allocations[1].biz_date = '2026-03-01'
		assert.equal((await summaries(h, '2026-03-01', '2026-03-31')).summary.rounding_total, 2)
		assert.equal((await summaries(h, '2026-02-01', '2026-02-28')).summary.rounding_total, 0)
		h.tables.crm_customer_allocations[1].biz_date = ''
		const pending = (await summaries(h)).summary
		assert.equal(pending.rounding_total, null); assert.equal(pending.known_rounding_total, 0)
		assert.ok(pending.unresolved_sources.some(row => row.reason === 'rounding_allocation_date_missing'))
	}
})

test('initial and subsequent rounding on one receipt split across dates without double counting receipt and target totals', async () => {
	const h = harness([sale('target', '2025-12-01', { receipt_rounding_amount: 9 })])
	h.tables.crm_customer_receipts = [receipt('r', '2025-12-31', 9)]
	h.tables.crm_customer_allocations = [allocation('initial', 'target', 'r', 5, { source_type: 'cashier_intake', biz_date: '2025-12-31' }),
		allocation('later', 'target', 'r', 4, { source_type: 'receipt_unallocated_allocate', biz_date: '2026-02-01' })]
	for (const [from, to, expected] of [['2025-12-01', '2025-12-31', 5], ['2026-01-01', '2026-09-12', 4], ['2025-12-01', '2026-09-12', 9]]) {
		const p = (await summaries(h, from, to)).summary
		assert.equal(p.rounding_total, expected); assert.equal(p.rounding_complete, true)
		assert.equal(p.legacy_rounding_total, 0); assert.equal(p.cash_received, 0)
	}
})

test('posted non-cash rounding is pending by provenance, not falsely reported as a missing receipt', async () => {
	const h = harness([sale('target', '2026-01-01', { receipt_rounding_amount: 9 })])
	h.tables.crm_customer_receipts = [receipt('offset', '2026-01-02', 9, { amount: 100, entry_kind: 'offset' })]
	h.tables.crm_customer_allocations = [allocation('a', 'target', 'offset', 9, { source_type: 'offset_credit_allocate' })]
	const p = (await summaries(h)).summary
	assert.equal(p.rounding_total, null)
	assert.ok(p.unresolved_sources.some(row => row.reason === 'rounding_noncash_origin_unverified'))
	assert.ok(!p.unresolved_sources.some(row => row.reason === 'rounding_allocation_without_posted_receipt'))
})

test('anonymized regression controls retain K003 41 yuan non-cash rounding and K002 zero rounding', async () => {
	// Amounts/dates reproduce the verified API projections; synthetic ids and allocations are not raw evidence.
	for (const [hasRounding, cash, refund, expected] of [[true, 118060, 0, 41], [false, 10570, 990, 0]]) {
		const sourceRounding = hasRounding ? [['2026-01-20', 12], ['2026-02-04', 2], ['2026-03-06', 1], ['2026-03-24', 5]] : []
		const formalRounding = hasRounding ? [['2026-04-15', '2026-04-21', 5], ['2026-05-08', '2026-05-13', 3.5], ['2026-06-02', '2026-06-18', 12.5]] : []
		const h = harness(sourceRounding.map(([date, amount], i) => sale(`source-${i}`, date, { rounding_amount: amount })))
		h.tables.crm_customer_receipts = [receipt('cash', '2026-01-02', 0, { amount: cash }), receipt('refund', '2026-02-02', 0, { amount: -refund })]
		for (const [i, [sourceDate, receiptDate, amount]] of formalRounding.entries()) {
			h.tables.crm_sale_records.push(sale(`target-${i}`, sourceDate, { receipt_rounding_amount: amount }))
			h.tables.crm_customer_receipts.push(receipt(`r-${i}`, receiptDate, amount, { rounding_amount: amount, source_type: 'cashier_intake' }))
			h.tables.crm_customer_allocations.push(allocation(`a-${i}`, `target-${i}`, `r-${i}`, amount,
				{ source_type: i === 2 ? 'receipt_unallocated_allocate' : 'cashier_intake', biz_date: receiptDate }))
		}
		const p = (await summaries(h)).summary
		assert.equal(p.rounding_total, expected); assert.equal(p.cash_received, cash)
		assert.equal(p.refund_total, refund); assert.equal(p.net_cash_received, cash - refund)
		assert.equal(p.rounding_sources.length, hasRounding ? 7 : 0)
		assert.equal(p.allocation_rounding_total, hasRounding ? 12.5 : 0)
	}
})

test('page mapper and both exported summary sheets preserve 0.021, pending and old-service missing states', async () => {
	const context = {}; vm.createContext(context)
	const read = file => fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')
	vm.runInContext(read('services/mappers/customerPeriodSummary.js') + '\nthis.normalize=normalizeCustomerPeriodSummary;this.rows=customerPeriodSummaryRows', context)
	vm.runInContext(read('services/mappers/customerDeposit.js'), context)
	vm.runInContext(read('components/domain/customer/statement/exportWorkbook.js') + '\nthis.builders=[buildCustomerStatementWorkbookXml,buildCustomerAccountingLedgerWorkbookXml]', context)
	const p = (await summaries(harness([]))).summary
	assert.equal(context.normalize({ ...p, rounding_total: undefined }), null)
	assert.equal(context.rows({ ...p, rule_version: 'customer-period-summary/2026-09-08.2', rounding_total: undefined }).find(row => row.key === 'rounding_total').value, null)
	for (const build of context.builders) {
		const xml = build({ period_summary: { ...p, rounding_total: .021 } })
		assert.match(xml, /期间抹零汇总（不计实际收款）/); assert.match(xml, /0\.021/)
		assert.match(build({ period_summary: { ...p, rounding_total: null, rounding_complete: false } }), /期间抹零汇总（不计实际收款）<\/Data><\/Cell><Cell><Data ss:Type="String">待核/)
		assert.match(build({}), /期间抹零汇总（不计实际收款）<\/Data><\/Cell><Cell><Data ss:Type="String">未完成/)
	}
})
