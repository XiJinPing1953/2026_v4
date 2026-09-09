'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const accounting = require('../uniCloud-alipay/cloudfunctions/common/saleAccounting')
const { readComplete, withFinancialEvidence } = require('../uniCloud-alipay/cloudfunctions/common/financialRead')
const { buildReport } = require('./reportLegacyM3Correspondence.cjs')

function makeDb(tables = {}, hooks = {}) {
	const writes = []
	const command = Object.fromEntries(['gt', 'gte', 'lt', 'lte', 'neq', 'in', 'nin', 'exists'].map((op) => [op, (value) => ({ ['$' + op]: value })]))
	command.and = (value) => ({ $and: value }); command.or = (value) => ({ $or: value })
	function matches(doc, where) {
		if (!where) return true
		if (where.$and) return where.$and.every((part) => matches(doc, part))
		if (where.$or) return where.$or.some((part) => matches(doc, part))
		return Object.entries(where).every(([key, cond]) => {
			const value = doc[key]
			if (cond instanceof RegExp) return cond.test(String(value || ''))
			if (!cond || typeof cond !== 'object') return value === cond
			return Object.entries(cond).every(([op, expected]) => {
				if (op === '$gt') return value > expected
				if (op === '$gte') return value >= expected
				if (op === '$lt') return value < expected
				if (op === '$lte') return value <= expected
				if (op === '$neq') return value !== expected
				if (op === '$in') return expected.includes(value)
				if (op === '$nin') return !expected.includes(value)
				if (op === '$exists') return (value !== undefined) === expected
				throw new Error('Unsupported mock operator ' + op)
			})
		})
	}
	function query(name, opts = {}) {
		return {
			where: (where) => query(name, { ...opts, where }),
			doc: (id) => query(name, { ...opts, where: { _id: id } }),
			orderBy: (key, dir) => query(name, { ...opts, order: [...(opts.order || []), [key, dir]] }),
			field: (field) => query(name, { ...opts, field }), skip: (skip) => query(name, { ...opts, skip }),
			limit: (limit) => query(name, { ...opts, limit }),
			count: async () => {
				const total = (tables[name] || []).filter((doc) => matches(doc, opts.where)).length
				return hooks.count ? hooks.count(name, total, opts) : { total }
			},
			get: async () => {
				let rows = (tables[name] || []).filter((doc) => matches(doc, opts.where))
				for (const [key, dir] of [...(opts.order || [])].reverse()) rows.sort((a, b) => a[key] < b[key] ? (dir === 'asc' ? -1 : 1) : a[key] > b[key] ? (dir === 'asc' ? 1 : -1) : 0)
				rows = rows.slice(opts.skip || 0, (opts.skip || 0) + (opts.limit || 100))
				if (opts.field) rows = rows.map((doc) => Object.fromEntries(Object.entries(doc).filter(([key]) => key === '_id' || opts.field[key])))
				if (hooks.get) return hooks.get(name, rows, opts)
				return { data: structuredClone(rows) }
			},
			update: async (data) => { writes.push({ name, opts, data }); return { updated: 1 } },
			add: async (data) => { writes.push({ name, data }); return { id: 'new' } },
			remove: async () => { writes.push({ name, opts, remove: true }); return { deleted: 1 } }
		}
	}
	return { command, collection: query, writes, RegExp: ({ regexp, options }) => new RegExp(regexp, options) }
}

function loadHandler(name, db) {
	const filename = path.resolve(__dirname, '../uniCloud-alipay/cloudfunctions', name, 'index.js')
	const localRequire = createRequire(filename)
	const context = { exports: {}, require: localRequire, uniCloud: { database: () => db }, console: { log() {}, warn() {}, error() {} }, Date, Math, Set, Map, Buffer, process }
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename })
	return context.exports.main
}

const saleDoc = (extra = {}) => ({ _id: 'sale-1', customer_id: 'customer-1', customer_name: '测试客户', date: '2026-08-01',
	created_at: 1, updated_at: 1, biz_mode: 'bottle', price_unit: 'm3', unit_price: 10, flow_volume_m3: 100, amount_received: 0, ...extra })
const tablesFor = (sale) => ({ crm_users: [{ _id: 'user-1', token: 'test', role: 'superadmin' }],
	crm_customers: [{ _id: 'customer-1', name: '测试客户', default_price_unit: 'm3', default_unit_price: 10 }], crm_sale_records: [sale] })
const invoke = (main, action, data) => main({ action, token: 'test', data }, {})

test('sale removal checks target and full customer classification before any business write', async () => {
	for (const sibling of [false, true]) {
		const sale = saleDoc({ _id: 'remove-me', ...(sibling ? { price_unit: 'kg', settlement_mode: 'sale' } : {}) })
		const tables = tablesFor(sale)
		if (sibling) tables.crm_sale_records.push(saleDoc({ _id: 'unresolved-sibling' }))
		const db = makeDb(tables)
		const result = await invoke(loadHandler('crm-sale', db), 'removeV2', { id: sale._id })
		assert.equal(result.code, 409)
		assert.equal(result.error_code, 'FINANCIAL_CLASSIFICATION_REQUIRED')
		assert.deepEqual(db.writes.filter((write) => write.name !== 'crm_operation_logs'), [])
	}
})

test('sale removal rejects an incomplete customer ledger before touching source or allocations', async () => {
	const sale = saleDoc({ price_unit: 'kg', settlement_mode: 'sale' })
	const db = makeDb(tablesFor(sale), { count: (name, total) => ({ total: name === 'crm_sale_records' ? null : total }) })
	const result = await invoke(loadHandler('crm-sale', db), 'removeV2', { id: sale._id })
	assert.equal(result.code, 409)
	assert.equal(result.error_code, 'FINANCIAL_READ_INCOMPLETE')
	assert.deepEqual(db.writes.filter((write) => write.name !== 'crm_operation_logs'), [])
})

test('explicit settlement modes remain distinct; unknown m3 is never zero', () => {
	assert.equal(accounting.computeSaleAmountsForDoc(saleDoc({ settlement_mode: 'sale' })).amounts.should_receive, 1000)
	assert.equal(accounting.computeSaleAmountsForDoc(saleDoc({ settlement_mode: 'customer_flow' })).amounts.should_receive, 0)
	assert.throws(() => accounting.computeSaleAmountsForDoc(saleDoc()), { code: 'FINANCIAL_CLASSIFICATION_REQUIRED' })
	const unresolved = accounting.computeSaleAmountsForDoc(saleDoc(), { allowUnresolved: true })
	assert.equal(unresolved.amounts.should_receive, null)
	assert.equal(unresolved.accounting.candidate_sale_amount, 1000)
})

test('all sales billing modes, truck settlement scale and refund rounding retain expected amounts', () => {
	const cases = [
		[{ price_unit: 'kg', out_items: [{ net: 100 }], back_items: [{ net: 20 }], rounding_amount: 1 }, 799],
		[{ price_unit: 'bottle', out_items: [{}, {}] }, 20],
		[{ biz_mode: 'agent_sale', price_unit: 'kg', agent_sale_items: [{ fill_weight: 50 }] }, 500],
		[{ biz_mode: 'truck', price_unit: 'kg', truck_out_gross: 1000, truck_back_gross: 700, truck_settle_tare: 400, truck_settle_gross: 650, truck_sale_net: 290 }, 2500],
		[{ price_unit: 'kg', back_items: [{ net: 10 }], rounding_amount: 1 }, -99]
	]
	for (const [input, expected] of cases) assert.equal(accounting.computeSaleAmountsForDoc(saleDoc({ ...input, settlement_mode: 'sale' })).amounts.effective_should_receive, expected)
})

test('actual sale detail, customer statement and export handlers agree on explicit m3 cases', async () => {
	for (const [mode, expected] of [['sale', 1000], ['customer_flow', 0]]) {
		const db = makeDb(tablesFor(saleDoc({ settlement_mode: mode })))
		const sales = loadHandler('crm-sale', db); const statement = loadHandler('crm-customer-settlement', db)
		const detail = await invoke(sales, 'getV2', { id: 'sale-1' })
		assert.equal(detail.code, 0); assert.equal(detail.data.should_receive, expected)
		const rows = await invoke(statement, 'listCustomerStatementRowsV1', { customer_id: 'customer-1' })
		assert.equal(rows.code, 0); assert.equal(rows.data.find((row) => row.row_type === 'sale').amount, expected)
		const exported = await invoke(statement, 'exportCustomerStatementV1', { customer_id: 'customer-1', date_from: '2026-08-01', date_to: '2026-08-31' })
		assert.equal(exported.code, 0); assert.equal(exported.data.totals.amount, expected)
		assert.equal(exported.financial_evidence.snapshot_consistent, false)
		assert.equal(db.writes.length, 0)
	}
})

test('actual unknown m3 detail is readable; statement/export/update return 409 before writes', async () => {
	const db = makeDb(tablesFor(saleDoc()))
	const sales = loadHandler('crm-sale', db); const statement = loadHandler('crm-customer-settlement', db)
	const detail = await invoke(sales, 'getV2', { id: 'sale-1' })
	assert.equal(detail.code, 0); assert.equal(detail.data.should_receive, null); assert.equal(detail.data.accounting.status, 'unresolved')
	for (const action of ['listCustomerStatementRowsV1', 'getCustomerStatementV1', 'exportCustomerStatementV1', 'exportCustomerAccountingLedgerV1', 'createReceiptV1']) {
		const result = await invoke(statement, action, { customer_id: 'customer-1', date_from: '2026-08-01', date_to: '2026-08-31', summary_only: true })
		assert.equal(result.code, 409, action); assert.equal(result.error_code, 'FINANCIAL_CLASSIFICATION_REQUIRED', action)
		assert.deepEqual(Array.from(result.data.financial_evidence.unresolved_source_ids), ['sale-1'])
	}
	for (const action of ['updateV2', 'updateSettlementV1', 'quickReceiveV1']) {
		const result = await invoke(sales, action, { recordId: 'sale-1', payload: { base: {} } })
		assert.equal(result.code, 409, action)
	}
	assert.equal(db.writes.length, 0)
})

test('sales list keeps unresolved source rows visible while withholding financial totals', async () => {
	const db = makeDb(tablesFor(saleDoc()))
	const sales = loadHandler('crm-sale', db)
	const result = await invoke(sales, 'listV2', { page: 1, pageSize: 20 })
	assert.equal(result.code, 0)
	assert.equal(result.data.length, 1)
	assert.equal(result.data[0].accounting.status, 'unresolved')
	assert.equal(result.data[0].should_receive, null)
	assert.equal(result.summary.accounting_complete, false)
	assert.equal(result.summary.unresolved_count, 1)
	assert.equal(result.summary.should_receive_total, null)
	assert.equal(result.summary.amount_received_total, null)
	assert.equal(result.paging.complete, false)
	assert.equal(db.writes.length, 0)
})

test('raw m3 evidence remains readable with unresolved accounting and includes out-of-period flow links without writes', async () => {
	const tables = tablesFor(saleDoc({ should_receive: 777 }))
	tables.crm_customer_flow_settlements = [{ _id: 'flow-1', customer_id: 'customer-1', date: '2026-09-02',
		status: 'posted', sale_ids: ['sale-1'], period_start_date: '2026-08-01', period_end_date: '2026-08-31' }]
	const db = makeDb(tables)
	const main = loadHandler('crm-customer-settlement', db)
	const data = { customer_id: 'customer-1', date_from: '2026-08-01', date_to: '2026-08-31' }
	const result = await invoke(main, 'getLegacyM3EvidenceV1', data)
	assert.equal(result.code, 0)
	assert.equal(result.data.sales[0].should_receive, 777)
	assert.equal(result.data.flow_settlements[0]._id, 'flow-1')
	assert.equal(result.financial_evidence.read_complete, true)
	assert.equal(db.writes.length, 0)
	tables.crm_users[0].role = 'finance'
	assert.equal((await invoke(main, 'getLegacyM3EvidenceV1', data)).code, 403)
})

test('superadmin can classify one unchanged legacy m3 source with evidence before balance refresh', async () => {
	const db = makeDb(tablesFor(saleDoc()))
	const sales = loadHandler('crm-sale', db)
	const result = await invoke(sales, 'classifyLegacyM3SettlementV1', {
		id: 'sale-1',
		settlement_mode: 'sale',
		classification_basis: '已核对原始销售单与流量结算，无重复覆盖',
		expected_source_version: 1,
		confirm: 'CLASSIFY_M3_SETTLEMENT'
	})
	assert.equal(result.code, 207)
	assert.equal(result.data.settlement_mode, 'sale')
	assert.equal(result.data.balances_refreshed, false)
	const sourceWrite = db.writes.find((item) => item.name === 'crm_sale_records')
	assert.equal(sourceWrite.data.settlement_mode, 'sale')
	assert.equal(sourceWrite.data.accounting_rule_version, accounting.RULE_VERSION)
})

test('legacy m3 classification rejects stale source versions before any write', async () => {
	const db = makeDb(tablesFor(saleDoc()))
	const sales = loadHandler('crm-sale', db)
	const result = await invoke(sales, 'classifyLegacyM3SettlementV1', {
		id: 'sale-1', settlement_mode: 'customer_flow', classification_basis: '已取得直接关联凭据',
		expected_source_version: 0, confirm: 'CLASSIFY_M3_SETTLEMENT'
	})
	assert.equal(result.code, 409)
	assert.equal(result.error_code, 'SOURCE_VERSION_CHANGED')
	assert.equal(db.writes.length, 0)
})

test('live flow settlements retain three decimal money in statement/export', async () => {
	const tables = tablesFor(saleDoc({ settlement_mode: 'customer_flow' }))
	tables.crm_customer_flow_settlements = [{ _id: 'flow-1', customer_id: 'customer-1', status: 'posted', biz_date: '2026-08-02', created_at: 1, should_receive: 12.345, amount_received: 0 }]
	const handler = loadHandler('crm-customer-settlement', makeDb(tables))
	const result = await invoke(handler, 'exportCustomerStatementV1', { customer_id: 'customer-1', date_from: '2026-08-01', date_to: '2026-08-31' })
	assert.equal(result.code, 0); assert.equal(result.data.totals.amount, 12.345)
})

test('complete keyset reads retain 5189 tied-date records and reject caps/changes', async () => {
	const source = Array.from({ length: 5189 }, (_, i) => ({ _id: String(i).padStart(6, '0'), created_at: 1, amount: 1 }))
	const db = makeDb({ money: source })
	const rows = await readComplete(db.collection('money'), {}, { command: db.command, sort: ['created_at'] })
	assert.equal(rows.length, 5189); assert.equal(new Set(rows.map((row) => row._id)).size, 5189)
	await assert.rejects(readComplete(db.collection('money'), {}, { command: db.command, maxRows: 5000 }), { code: 'FINANCIAL_READ_INCOMPLETE' })
	const changing = makeDb({ money: source }, { count: (name, total) => ({ total: total - 1 }) })
	await assert.rejects(readComplete(changing.collection('money'), {}, { command: changing.command }), { code: 'FINANCIAL_READ_INCOMPLETE' })
})

test('actual statement/export receipts beyond 5000 are included; row budget produces visible 409', async () => {
	const tables = tablesFor(saleDoc({ settlement_mode: 'customer_flow' }))
	tables.crm_customer_receipts = Array.from({ length: 5189 }, (_, i) => ({ _id: 'receipt-' + String(i).padStart(6, '0'), customer_id: 'customer-1', status: 'posted', biz_date: '2026-08-02', created_at: 1, amount: 1, unallocated_amount: 1 }))
	const db = makeDb(tables); const handler = loadHandler('crm-customer-settlement', db)
	const exported = await invoke(handler, 'exportCustomerStatementV1', { customer_id: 'customer-1', date_from: '2026-08-01', date_to: '2026-08-31' })
	assert.equal(exported.code, 0); assert.equal(exported.data.totals.receipt, 5189)
	const limited = loadHandler('crm-customer-settlement', makeDb(tables, { count: (name, total) => ({ total: name === 'crm_customer_receipts' ? 100001 : total }) }))
	const result = await invoke(limited, 'exportCustomerStatementV1', { customer_id: 'customer-1', date_from: '2026-08-01', date_to: '2026-08-31' })
	assert.equal(result.code, 409); assert.equal(result.data.financial_evidence.complete, false)
	assert.equal(db.writes.length, 0)
})

test('concurrent handler evidence stays isolated and never asserts an atomic snapshot', async () => {
	const db = makeDb({ money: [{ _id: 'a' }] })
	const handler = withFinancialEvidence(async (event) => {
		await readComplete(db.collection('money'), {}, { command: db.command, source: event.id })
		return { code: 0, data: {} }
	}, accounting.RULE_VERSION)
	const results = await Promise.all([handler({ id: 'first' }), handler({ id: 'second' })])
	assert.deepEqual(results.map((result) => result.financial_evidence.reads[0].source), ['first', 'second'])
})

test('offline correspondence distinguishes a direct link from coverage and marks missing source evidence', () => {
	const report = buildReport({ sales: [saleDoc()], flow_settlements: [{ _id: 'flow-1', customer_id: 'customer-1', status: 'posted', sale_ids: ['sale-1'], should_receive: 1000 }] })
	assert.equal(report.summary.unresolved, 1); assert.equal(report.rows[0].direct_flow_links.length, 1)
	assert.equal(report.rows[0].coverage_verified, false); assert.equal(report.live_verified, false)
	assert.equal(report.source_evidence.complete, false)
	assert.throws(() => buildReport({ sales: [] }), /flow_settlements/)
})

test('dashboard and collection handlers use explicit m3 ownership and reject unresolved sources', async () => {
	const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
	for (const [mode, expected] of [['sale', 1000], ['customer_flow', 0], ['', null]]) {
		const tables = tablesFor(saleDoc({ date: today, settlement_mode: mode }))
		tables.crm_collection_tasks = [{ _id: 'task-1', customer_id: 'customer-1', date_from: today, date_to: today, status: 'open' }]
		const db = makeDb(tables)
		const dashboard = await invoke(loadHandler('crm-dashboard', db), 'summaryV1', { days: 7 })
		const collection = await invoke(loadHandler('crm-collection', db), 'recalcTaskV1', { id: 'task-1' })
		if (!mode) {
			assert.equal(dashboard.code, 409)
			assert.equal(collection.code, 409)
			assert.equal(db.writes.length, 0)
		} else {
			assert.equal(dashboard.code, 0)
			assert.equal(dashboard.data.kpi.sales_month, expected)
			assert.equal(collection.code, 0)
			assert.equal(collection.data.amount_should, expected)
		}
	}
})

test('opening balance preview never writes; unresolved later customer blocks execute before the first write', async () => {
	const tables = tablesFor(saleDoc({ settlement_mode: 'sale' }))
	let db = makeDb(tables)
	let result = await invoke(loadHandler('crm-customer-settlement', db), 'rebuildOpeningBalancesV1', { execute: false })
	assert.equal(result.code, 0)
	assert.equal(result.data.updated, 0)
	assert.equal(db.writes.length, 0)
	tables.crm_customers.push({ _id: 'customer-2', name: '测试客户二' })
	tables.crm_sale_records.push(saleDoc({ _id: 'sale-2', customer_id: 'customer-2' }))
	db = makeDb(tables)
	result = await invoke(loadHandler('crm-customer-settlement', db), 'rebuildOpeningBalancesV1', { execute: true })
	assert.equal(result.code, 409)
	assert.equal(db.writes.length, 0)
})
