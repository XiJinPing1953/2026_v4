'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, saleDoc, tablesFor, invoke } = require('./lib/accountingTestHarness.cjs')
const { resolveRange } = require('../uniCloud-alipay/cloudfunctions/crm-dashboard/operatingBrief')
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10)
const posted = { customer_id: 'customer-1', status: 'posted', biz_date: today, created_at: 1, updated_at: 1 }
function setup(extra = {}) {
	const tables = tablesFor(saleDoc({ price_unit: 'kg', settlement_mode: 'sale', date: today, unit_price: 10,
		out_items: [{ net: 12 }], back_items: [{ net: 2 }], rounding_amount: 1, amount_received: 99 }))
	Object.assign(tables, extra)
	return tables
}
const run = (db, data = {}) => invoke(loadHandler('crm-dashboard', db), 'summaryV1', { section: 'brief', period: 'today', ...data })

test('UTC+8 periods cross months and leap dates without relying on server timezone', () => {
	const now = Date.parse('2028-02-29T16:00:00Z')
	assert.deepEqual(resolveRange({ period: 'yesterday' }, now), { start: '2028-02-29', end: '2028-02-29', today: '2028-03-01' })
	assert.equal(resolveRange({ period: 'month' }, now).start, '2028-03-01')
	assert.equal(resolveRange({ period: 'bogus' }, now), null)
	for (const [start, end] of [['2028-02-30', '2028-03-01'], ['2028-01-01', '2028-02-02'], ['2028-03-01', '2028-03-02']]) {
		assert.equal(resolveRange({ section: 'daily_report', date_start: start, date_end: end }, now), null)
	}
})

test('real dashboard handler separates billed business, formal cash, refunds and operational vehicle fuel', async () => {
	const tables = setup({
		crm_customer_flow_settlements: [{ ...posted, _id: 'f1', should_receive: 12.345 }, { ...posted, _id: 'f2', should_receive: 0.001 }],
		crm_customer_receipts: [
			{ ...posted, _id: 'cash', amount: 50.123 }, { ...posted, _id: 'refund', amount: -2.001 },
			{ ...posted, _id: 'opening', amount: 70, source_type: 'opening_prepay' },
			{ ...posted, _id: 'deposit', amount: 90, source_type: 'deposit_transfer' },
			{ ...posted, _id: 'fee', amount: 3, source_type: 'settlement_fee' },
			{ ...posted, _id: 'offset', amount: 80, entry_kind: 'offset_credit' },
			{ ...posted, _id: 'void', status: 'void', amount: 100 }
		],
		crm_fillings: [
			{ _id: 'b', date: today, bottle_no: '12', fill_weight: 123.456 },
			{ _id: 'local', date: today, bottle_no: '000', fill_weight: 50 },
			{ _id: 'vehicle', date: today, bottle_no: '000', record_type: 'truck_out_no_sale', fill_weight: 20 },
			{ _id: 'vehicle2', date: today, bottle_no: '000', record_type: 'truck_out_no_sale', fill_weight: 30 },
			{ _id: 'negative', date: today, record_type: 'truck_out_no_sale', fill_weight: -10 }
		]
	})
	tables.crm_sale_records.push(saleDoc({ _id: 'flow-delivery', settlement_mode: 'customer_flow', date: today, out_items: [{ net: 5 }] }))
	const db = makeDb(tables), result = await run(db)
	assert.equal(result.code, 0, result.msg)
	const { business, cash, operations } = result.data
	assert.equal(business.sales, 100, 'source rounding is not deducted from business revenue')
	assert.equal(business.flow, 12.346)
	assert.equal(business.total, 112.346, 'flow delivery does not double count revenue')
	assert.equal(cash.received, 50.123)
	assert.equal(cash.refund, 2.001)
	assert.equal(cash.net, 48.122)
	assert.equal(operations.customer_count, 1)
	assert.equal(operations.sale_weight_kg, 15)
	assert.equal(operations.vehicle_count, 2)
	assert.equal(operations.vehicle_weight_kg, 50)
	assert.equal(operations.local_weight_kg, 50)
	assert.equal(operations.fill_bottle_weight_kg, 123.456)
	assert.equal(operations.recorded_outflow_kg, 223.456, 'server totals the three physical outflow destinations')
	assert.equal(result.financial_evidence.snapshot_consistent, false)
	assert.equal(db.writes.length, 0)
})

test('month deduplicates customers across days and date switching excludes other days', async () => {
	const tables = setup()
	tables.crm_sale_records.push(saleDoc({ _id: 'otherday', date: yesterday, settlement_mode: 'sale', out_items: [{ net: 100 }], back_items: [] }))
	const db = makeDb(tables)
	assert.equal((await run(db, { period: 'today' })).data.business.total, 100)
	assert.equal((await run(db, { period: 'yesterday' })).data.business.total, 1000)
	assert.equal((await run(db, { period: 'month' })).data.operations.customer_count, 1)
})

test('hidden customer and hidden delivery site business are excluded and no balance caches are used', async () => {
	const tables = setup()
	tables.crm_customers.push({ _id: 'hidden', is_hidden: true })
	Object.assign(tables.crm_customers[0], { receivable_balance: 999999, prepay_balance: 888888 })
	tables.crm_sale_records.push(saleDoc({ _id: 'h1', date: today, settlement_mode: 'sale', customer_id: 'hidden' }),
		saleDoc({ _id: 'h2', date: today, settlement_mode: 'sale', delivery_customer_id: 'hidden' }))
	tables.crm_customer_receipts = [{ ...posted, _id: 'hidden-cash', customer_id: 'hidden', amount: 10000 }]
	const r = await run(makeDb(tables))
	assert.equal(r.code, 0)
	assert.equal(r.data.business.total, 100)
	assert.equal(r.data.cash.net, 0)
})

test('full daily report includes every requested day and vehicle fuel without a rolling-window fallback', async () => {
	const start = new Date(Date.parse(today) - 30 * 86400000).toISOString().slice(0, 10)
	const tables = setup({ crm_fillings: [{ _id: 'oldfuel', date: start, record_type: 'truck_out_no_sale', fill_weight: 10 }] })
	const result = await run(makeDb(tables), { section: 'daily_report', date_start: start, date_end: today })
	assert.equal(result.code, 0)
	assert.equal(result.data.daily_report.rows.length, 31)
	assert.equal(result.data.daily_report.rows.at(-1).vehicle_weight, 10)
	assert.equal(result.data.daily_report.rows[1].fill_total_weight, 0)
	assert.equal(result.data.range.start, start)
})

test('unknown sales ownership or bad financial/physical source fields cannot return a confident zero', async () => {
	for (const [key, rows] of [
		['crm_sale_records', [saleDoc({ date: today })]],
		['crm_customer_flow_settlements', [{ ...posted, _id: 'bad' }]],
		['crm_customer_receipts', [{ ...posted, _id: 'bad', amount: 'unknown' }]],
		['crm_fillings', [{ _id: 'bad', date: today }]]
	]) {
		const result = await run(makeDb(setup({ [key]: rows })))
		assert.equal(result.code, 409, key)
		assert.equal(result.data.business, undefined)
	}
})

test('missing sale price rejects financial brief while a physical daily report keeps known weight', async () => {
	const tables = setup()
	tables.crm_sale_records[0].unit_price = null
	const financial = await run(makeDb(tables))
	assert.equal(financial.code, 409)
	assert.equal(financial.data.business, undefined)
	assert.equal(financial.data.financial_evidence.field, 'unit_price')
	const physical = await run(makeDb(tables), { section: 'daily_report', date_start: today, date_end: today })
	assert.equal(physical.code, 0)
	assert.equal(physical.data.daily_report.rows[0].sale_weight, 10)
})

test('bad bottle, metered-flow, agent and truck physical inputs cannot silently become zero in either section', async () => {
	for (const patch of [
		{ out_items: [{ net: 'unknown' }] },
		{ price_unit: 'm3', flow_volume_m3: 10, out_items: [{ net: null }] },
		{ settlement_mode: 'customer_flow', price_unit: 'm3', unit_price: null, out_items: [{ net: 'unknown' }] },
		{ settlement_mode: 'customer_flow', price_unit: 'm3', out_items: [], back_items: [{ net: true }] },
		{ settlement_mode: 'customer_flow', out_items: null, back_items: null },
		{ biz_mode: 'agent_sale', agent_sale_items: [{ fill_weight: 'unknown' }] },
		{ biz_mode: 'truck', truck_out_gross: 50, truck_back_gross: 'unknown' }
	]) {
		const tables = setup()
		Object.assign(tables.crm_sale_records[0], patch)
		for (const data of [{}, { section: 'daily_report', date_start: today, date_end: today }]) {
			const result = await run(makeDb(tables), data)
			assert.equal(result.code, 409, JSON.stringify({ patch, data }))
			assert.equal(result.data.operations, undefined)
			assert.equal(result.data.daily_report, undefined)
		}
	}
})

test('customer-flow delivery can have no sale price and still contribute verified physical weight', async () => {
	const tables = setup()
	Object.assign(tables.crm_sale_records[0], { settlement_mode: 'customer_flow', price_unit: 'm3', unit_price: null })
	const result = await run(makeDb(tables))
	assert.equal(result.code, 0)
	assert.equal(result.data.business.sales, 0)
	assert.equal(result.data.operations.sale_weight_kg, 10)
})

test('unavailable counts and cross-collection updates reject totals, including visibility reads', async () => {
	for (const name of ['crm_customers', 'crm_sale_records', 'crm_fillings', 'crm_customer_receipts']) {
		const db = makeDb(setup(), { count: (table, total) => ({ total: table === name ? null : total }) })
		const result = await run(db)
		assert.equal(result.code, 409, name)
		assert.equal(result.data.operations, undefined)
	}
	const tables = setup()
	let changed = false
	const db = makeDb(tables, { get: (name, rows, options) => {
		if (name === 'crm_customer_receipts' && !changed) { tables.crm_sale_records[0].updated_at = Date.now() + 1; changed = true }
		return { data: structuredClone(rows) }
	} })
	const result = await run(db)
	assert.equal(result.code, 409)
	assert.equal(result.data.financial_evidence.reason, 'records_changed_during_brief')
})

test('empty successful reads are real zero while invalid ranges and unsigned users are rejected', async () => {
	const tables = setup({ crm_sale_records: [] })
	const db = makeDb(tables), handler = loadHandler('crm-dashboard', db)
	const result = await run(db)
	assert.equal(result.data.cash.net, 0)
	assert.equal(result.data.operations.vehicle_count, 0)
	assert.equal((await run(db, { period: 'lastyear' })).code, 400)
	assert.equal((await handler({ action: 'summaryV1', data: { section: 'brief' } }, {})).code, 401)
})
