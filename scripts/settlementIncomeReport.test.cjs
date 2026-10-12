'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')

const range = { date_from: '2026-10-01', date_to: '2026-10-31' }
const source = (id, extra = {}) => ({ _id: id, source_type: 'balance_adjustment', adjustment_kind: 'prepay_writeoff',
	status: 'posted', customer_id: 'customer-1', customer_name: '客户甲', biz_date: '2026-10-12', amount: 960, money_scale: 2,
	adjustment_source: { source_key: 'receipt_credit:receipt-1', type: 'receipt_credit', id: 'receipt-1', receipt_id: 'receipt-1', date: '2026-09-30', label: '期初预付款余款' },
	adjustment_evidence: '客户明确放弃退款与后续抵扣', note: '双方结清', created_by_name: '会计', created_at: 1, ...extra })
function harness(rows = [], user = {}, hooks = {}) {
	const tables = { crm_users: [{ _id: 'user', token: 'test', role: 'finance', ...user }],
		crm_customer_opening_debts: rows, crm_customers: [{ _id: 'customer-1', name: '客户甲', default_price_unit: 'kg' },
			{ _id: 'customer-2', name: '客户乙', default_price_unit: 'm3', status: 'disabled' }] }
	const db = makeDb(tables, hooks)
	return { db, main: loadHandler('crm-report', db) }
}

test('settlement income reads only posted generic writeoffs, keeps source evidence and never touches vouchers/cache/logs', async () => {
	const h = harness([source('a'), source('b', { customer_id: 'customer-2', customer_name: '客户乙', amount: 0.123, money_scale: 3, biz_date: '2026-10-31' }),
		source('void', { status: 'void' }), source('draft', { status: 'draft' }), source('past', { biz_date: '2026-09-30' }),
		source('next', { biz_date: '2026-11-01' }), source('rounding', { adjustment_kind: 'rounding_reversal' }),
		source('k023', { adjustment_kind: undefined }), source('opening', { source_type: 'manual' })], {}, {
		get(name, rows) { if (['crm_accounts', 'crm_voucher_entries', 'crm_reports'].includes(name)) throw Error('voucher report unavailable'); return { data: rows } }
	})
	const result = await invoke(h.main, 'settlementIncomeV1', range)
	assert.equal(result.code, 0, result.msg)
	assert.equal(result.data.total_amount, 960.123); assert.equal(result.data.count, 2)
	assert.equal(result.data.customer_count, 2); assert.equal(result.data.money_scale, 3)
	assert.equal(result.data.customers[0].items[0].adjustment_source.receipt_id, 'receipt-1')
	assert.equal(result.data.customers[0].items[0].adjustment_evidence, '客户明确放弃退款与后续抵扣')
	assert.equal(result.financial_evidence.read_complete, true); assert.equal(result.data.read_complete, true)
	assert.match(result.data.note, /并非公司全部营业外收入/); assert.equal(h.db.writes.length, 0)
})

test('integer thousandths include 5189 rows without floating drift or a 5000-record cutoff', async () => {
	const h = harness(Array.from({ length: 5189 }, (_, i) => source(String(i).padStart(6, '0'), { amount: 0.001, money_scale: 3 })))
	const result = await invoke(h.main, 'settlementIncomeV1', range)
	assert.equal(result.code, 0); assert.equal(result.data.total_amount, 5.189)
	assert.equal(result.data.customers[0].amount, 5.189); assert.equal(result.data.customers[0].items.length, 5189)
	assert.equal(h.db.writes.length, 0)
})

test('incomplete counts, changing records, malformed dates and money refuse a partial or false zero total', async () => {
	for (const hooks of [
		{ count: () => ({}) },
		{ count: (name, total) => ({ total: name === 'crm_customer_opening_debts' ? total + 1 : total }) },
		{ count: () => ({ total: 100001 }) }
	]) {
		const h = harness([source('a')], {}, hooks), result = await invoke(h.main, 'settlementIncomeV1', range)
		assert.equal(result.code, 409); assert.equal(result.error_code, 'FINANCIAL_READ_INCOMPLETE')
		assert.equal(result.data.total_amount, undefined); assert.equal(h.db.writes.length, 0)
	}
	for (const extra of [{ biz_date: '' }, { biz_date: '2026-02-30' }, { amount: -1 }, { amount: 0 }, { amount: 1.001 }, { customer_id: '' }, { updated_at: Date.now() + 100000 }]) {
		const h = harness([source('a', extra)]), result = await invoke(h.main, 'settlementIncomeV1', range)
		assert.equal(result.code, 409, JSON.stringify(extra)); assert.equal(result.data.total_amount, undefined)
		assert.equal(h.db.writes.length, 0)
	}
})

test('date validation, role and report-page ACL apply to the independent read without denied-operation writes', async () => {
	for (const user of [{ role: 'user', page_permissions: { '/pages/accounting/report-summary': { view: true } } },
		{ role: 'finance', page_permissions: { '/pages/accounting/report-summary': { view: false } } }]) {
		const h = harness([source('a')], user)
		assert.equal((await invoke(h.main, 'settlementIncomeV1', range)).code, 403); assert.equal(h.db.writes.length, 0)
	}
	for (const role of ['finance', 'admin', 'superadmin']) {
		const h = harness([], { role }), result = await invoke(h.main, 'settlementIncomeV1', range)
		assert.equal(result.code, 0); assert.equal(result.data.total_amount, 0); assert.equal(result.data.count, 0)
		assert.equal(h.db.writes.length, 0)
	}
	const h = harness()
	for (const input of [{}, { ...range, date_from: '2026-02-29' }, { ...range, date_to: '2026-09-30' }]) {
		assert.equal((await invoke(h.main, 'settlementIncomeV1', input)).code, 400)
	}
})

function viewHarness(overrides = {}) {
	const sourceText = fs.readFileSync('src/components/domain/accounting/ReportSummaryView.vue', 'utf8')
	const script = sourceText.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
	const context = vm.createContext({ ref: value => ({ value }), reactive: value => value, computed: fn => ({ get value() { return fn() } }),
		getRoleTemplate: () => 'finance', uni: { showToast() {} },
		useQuery: fetcher => ({ loading: { value: false }, run: fetcher }),
		getReportSummaryV1: async () => ({ code: 0, data: { trial_balance: [], totals: { revenue: 321 } } }),
		getSettlementIncomeV1: async args => ({ code: 0, data: { ...args, customers: [], total_amount: 960, read_complete: true } }), ...overrides })
	vm.runInContext(script + '\nthis.view = { filters, onSearch, onReset, settlementIncome, incomeError, incomeLoading, totals, incomeMoney, incomeSource, toggleIncomeCustomer, expandedIncomeCustomers }', context)
	return context.view
}

test('income query remains usable when voucher report fails and converts the selected month inclusively', async () => {
	let received
	const view = viewHarness({ getReportSummaryV1: async () => { throw Error('凭证汇总不可用') }, getSettlementIncomeV1: async args => {
		received = args; return { code: 0, data: { ...args, customers: [], total_amount: 960, read_complete: true } }
	} })
	view.filters.period = '2024-02'; await view.onSearch()
	assert.equal(received.date_from, '2024-02-01'); assert.equal(received.date_to, '2024-02-29')
	assert.equal(view.settlementIncome.value.total_amount, 960); assert.equal(view.incomeError.value, '')
	assert.equal(view.totals.revenue, 0); assert.equal(view.incomeMoney(0.123, 3), '0.123')
	assert.match(view.incomeSource({ receipt_id: 'receipt-1', entry_kind: 'prepay' }), /预付款.*receipt-1/)
	assert.equal(view.incomeSource(source('a').adjustment_source), '期初预付款余款 · 2026-09-30 · receipt-1')
	view.toggleIncomeCustomer('c'); assert.equal(view.expandedIncomeCustomers.value.c, true)
})

test('new income failure clears old totals; reset and newer period reject stale asynchronous results', async () => {
	let fail = false
	const view = viewHarness({ getSettlementIncomeV1: async () => fail ? { code: 409, msg: '读取未完成' } : { code: 0, data: { customers: [], total_amount: 960, read_complete: true } } })
	view.filters.period = '2026-10'; await view.onSearch(); fail = true; await view.onSearch()
	assert.equal(view.settlementIncome.value, null); assert.match(view.incomeError.value, /未完成/)
	let resolveOld
	const stale = viewHarness({ getSettlementIncomeV1: () => new Promise(resolve => { resolveOld = resolve }) })
	stale.filters.period = '2026-10'; const pending = stale.onSearch(); stale.onReset()
	resolveOld({ code: 0, data: { customers: [], total_amount: 960, read_complete: true } }); await pending
	assert.equal(stale.settlementIncome.value, null); assert.equal(stale.incomeLoading.value, false); assert.equal(stale.totals.revenue, 0)
	const resolvers = []
	const switched = viewHarness({ getSettlementIncomeV1: () => new Promise(resolve => { resolvers.push(resolve) }) })
	switched.filters.period = '2026-09'; const oldPeriod = switched.onSearch()
	switched.filters.period = '2026-10'; const newPeriod = switched.onSearch()
	resolvers[1]({ code: 0, data: { customers: [], total_amount: 12, read_complete: true } }); await newPeriod
	resolvers[0]({ code: 0, data: { customers: [], total_amount: 960, read_complete: true } }); await oldPeriod
	assert.equal(switched.settlementIncome.value.total_amount, 12); assert.equal(switched.incomeLoading.value, false)
})
