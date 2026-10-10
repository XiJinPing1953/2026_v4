'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createClosureReader } = require('../uniCloud-alipay/cloudfunctions/crm-bottle-movement/closureRead')
const { withFinancialEvidence } = require('../uniCloud-alipay/cloudfunctions/crm-bottle-movement/financialReadLocal')

// Same query shape as the existing financial-read tests, with array-path matching and field projection.
function makeDb(tables, hooks = {}) {
	const calls = []
	const condition = operations => ({ operations, and(other) { return condition([...operations, ...other.operations]) } })
	const command = Object.fromEntries(['gt', 'gte', 'lt', 'lte', 'in'].map(op => [op, value => condition([[op, value]])]))
	command.and = rows => ({ $and: rows })
	command.or = rows => ({ $or: rows })
	function values(row, path) {
		if (Array.isArray(row)) return row.flatMap(item => values(item, path))
		if (!path.length) return [row]
		return values(row?.[path[0]], path.slice(1))
	}
	function matches(row, where) {
		if (!where) return true
		if (where.$and) return where.$and.every(item => matches(row, item))
		if (where.$or) return where.$or.some(item => matches(row, item))
		return Object.entries(where).every(([key, expected]) => values(row, key.split('.')).some(value => {
			if (!expected?.operations) return value === expected
			return expected.operations.every(([op, operand]) => {
				if (op === 'gt') return value > operand
				if (op === 'gte') return value >= operand
				if (op === 'lt') return value < operand
				if (op === 'lte') return value <= operand
				if (op === 'in') return operand.includes(value)
				throw new Error(`Unsupported query operator: ${op}`)
			})
		}))
	}
	function query(name, options = {}) {
		return {
			where: where => query(name, { ...options, where }),
			orderBy: (key, direction) => query(name, { ...options, order: [key, direction] }),
			limit: limit => query(name, { ...options, limit }),
			skip: skip => query(name, { ...options, skip }),
			field: field => query(name, { ...options, field }),
			count: async () => {
				calls.push({ name, operation: 'count', ...options })
				const total = (tables[name] || []).filter(row => matches(row, options.where)).length
				return hooks.count ? hooks.count(name, total, options) : { total }
			},
			get: async () => {
				calls.push({ name, operation: 'get', ...options })
				let rows = (tables[name] || []).filter(row => matches(row, options.where))
				if (options.order) {
					const [key, direction] = options.order
					rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === 'desc' ? -1 : 1))
				}
				rows = rows.slice(options.skip || 0, (options.skip || 0) + (options.limit || 100))
				if (options.field) rows = rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => options.field[key])))
				return hooks.get ? hooks.get(name, structuredClone(rows), options) : { data: structuredClone(rows) }
			}
		}
	}
	return { collection: query, command, calls }
}

const options = { dateStart: '2026-09-01', dateEnd: '2026-09-01', cutoffDay: '2026-09-10', pageSize: 100 }
const filling = (id, bottle, date = '2026-09-01', start = 120, end = 220) => ({
	_id: id, bottle_no: bottle, date, record_type: 'normal_fill', tare: 100,
	weight_start: start, weight_end: end, fill_weight: end - start, created_at: 1, updated_at: 1
})
const sale = (id, bottle, date, type, net, extra = {}) => ({
	_id: id, date, biz_mode: 'bottle', customer_id: 'visible', created_at: 1, updated_at: 1,
	[`${type}_items`]: [{ bottle_no: bottle, gross: net + 100, tare: 100, net }], ...extra
})
function fixture(count = 1) {
	const tables = { crm_fillings: [], crm_sale_records: [], crm_customers: [], crm_bottle_movements: [], crm_operation_logs: [] }
	for (let index = 0; index < count; index++) {
		const key = String(index).padStart(4, '0')
		tables.crm_fillings.push(filling(`fill-${key}`, `B${key}`))
		tables.crm_sale_records.push(sale(`return-${key}`, `B${key}`, '2026-08-31', 'back', 20))
		tables.crm_sale_records.push(sale(`sale-${key}`, `B${key}`, '2026-09-03', 'out', 118))
	}
	return tables
}

test('complete reads cross 200-row pages for selected fills and historical source rows', async () => {
	const tables = fixture(205)
	for (let index = 0; index < 205; index++) tables.crm_sale_records.push(sale(`old-${String(index).padStart(4, '0')}`, 'B0000', '2026-08-01', 'back', 10))
	const db = makeDb(tables)
	const result = await createClosureReader(db).fillingClosureV1(options)
	assert.equal(result.code, 0)
	assert.equal(result.data.total, 205)
	assert.equal(result.data.summary.closed_count, 205)
	assert.equal(result.data.summary.total_fill_kg, 20500)
	assert.equal(result.data.summary.out_net_kg, 24190)
	assert.equal(result.data.days[0].fill_count, 205)
	assert.equal(result.data.scope.read_complete, true)
	assert.ok(db.calls.filter(call => call.name === 'crm_fillings' && call.order && call.limit === 200).length >= 5)
	assert.ok(db.calls.filter(call => call.name === 'crm_sale_records' && call.order && call.limit === 200).length >= 4)
	assert.deepEqual(result.data.cycles[0].evidence.map(row => row.event_day), ['2026-08-31', '2026-09-01', '2026-09-03'])
})

test('display pagination leaves the complete summary and daily totals unchanged', async () => {
	const reader = createClosureReader(makeDb(fixture(205)))
	const first = await reader.fillingClosureV1({ ...options, page: 1, pageSize: 17 })
	const second = await reader.fillingClosureV1({ ...options, page: 2, pageSize: 17 })
	assert.equal(first.data.cycles.length, 17)
	assert.equal(second.data.cycles.length, 17)
	assert.equal(new Set([...first.data.cycles, ...second.data.cycles].map(row => row.id)).size, 34)
	assert.deepEqual(first.data.summary, second.data.summary)
	assert.deepEqual(first.data.days, second.data.days)
	assert.equal(second.data.total, 205)
})

test('cross-date later fills stay in the same cohort and current source edits are reread', async () => {
	const tables = fixture()
	tables.crm_fillings.push(filling('top-up', 'B0000', '2026-09-04', 218, 228))
	tables.crm_sale_records[1].date = '2026-09-05'
	tables.crm_sale_records[1].out_items[0] = { bottle_no: 'B0000', gross: 227, tare: 100, net: 127 }
	const reader = createClosureReader(makeDb(tables))
	let result = await reader.fillingClosureV1(options)
	assert.equal(result.data.total, 1)
	assert.deepEqual(result.data.cycles[0].source_fill_ids, ['fill-0000', 'top-up'])
	assert.equal(result.data.summary.selected_fill_kg, 100)
	assert.equal(result.data.summary.later_fill_kg, 10)
	assert.equal(result.data.summary.total_fill_kg, 110)
	assert.equal(result.data.cycles[0].status, 'closed')
	tables.crm_fillings[1].weight_end = 233
	tables.crm_fillings[1].fill_weight = 15
	result = await reader.fillingClosureV1(options)
	assert.equal(result.data.summary.total_fill_kg, 115)
	assert.equal(result.data.cycles[0].post_fill_difference_kg, 6)
	assert.equal(result.data.cycles[0].status, 'closed')
})

test('observation cutoff excludes later sale then closes that same cycle when extended', async () => {
	const reader = createClosureReader(makeDb(fixture()))
	const before = await reader.fillingClosureV1({ ...options, cutoffDay: '2026-09-02' })
	const after = await reader.fillingClosureV1(options)
	assert.equal(before.data.cycles[0].status, 'unsold')
	assert.equal(before.data.cycles[0].out_net_kg, null)
	assert.equal(before.data.summary.out_net_kg, 0)
	assert.equal(after.data.cycles[0].id, before.data.cycles[0].id)
	assert.equal(after.data.cycles[0].status, 'closed')
})

test('hidden sale becomes an anonymous barrier and cannot be bridged to a later visible sale', async () => {
	const tables = fixture()
	tables.crm_customers.push({ _id: 'private-customer', is_hidden: true, name: 'SECRET_CUSTOMER_NAME' })
	tables.crm_sale_records.push(sale('SECRET_SALE_ID', 'B0000', '2026-09-02', 'out', 978.423, {
		customer_id: 'private-customer', customer_name: 'SECRET_CUSTOMER_NAME', note: 'SECRET_NOTE'
	}))
	const result = await createClosureReader(makeDb(tables)).fillingClosureV1(options)
	const cycle = result.data.cycles[0]
	assert.equal(cycle.status, 'pending')
	assert.equal(cycle.source_out_id, null)
	assert.equal(cycle.out_net_kg, null)
	assert.equal(cycle.evidence.find(row => row.type === 'boundary').source_id, null)
	assert.ok(result.data.scope.warnings.length)
	const serialized = JSON.stringify(result)
	for (const secret of ['SECRET_SALE_ID', 'private-customer', 'SECRET_CUSTOMER_NAME', 'SECRET_NOTE', '978.423']) assert.ok(!serialized.includes(secret))
})

test('invalid count or invalid source page returns incomplete evidence with no complete summary', async () => {
	for (const hooks of [
		{ count: (name, total) => ({ total: name === 'crm_sale_records' ? null : total }) },
		{ get: (name, rows, query) => ({ data: name === 'crm_sale_records' && query.order ? null : rows }) }
	]) {
		const reader = createClosureReader(makeDb(fixture(), hooks))
		const handler = withFinancialEvidence(() => reader.fillingClosureV1(options), 'test')
		const result = await handler({}, {})
		assert.equal(result.code, 409)
		assert.equal(result.error_code, 'FINANCIAL_READ_INCOMPLETE')
		assert.equal(result.data.financial_evidence.complete, false)
		assert.equal(result.data.summary, undefined)
		assert.equal(result.data.cycles, undefined)
	}
})

test('a write during the multi-source read cannot produce a successful aggregate', async () => {
	const tables = fixture()
	let changed = false
	const db = makeDb(tables, { get: (name, rows, query) => {
		if (!changed && name === 'crm_sale_records' && query.order) {
			changed = true
			tables.crm_fillings[0].updated_at = Date.now() + 1000
			tables.crm_fillings[0].fill_weight = 105
			tables.crm_fillings[0].weight_end = 225
		}
		return { data: rows }
	} })
	await assert.rejects(createClosureReader(db).fillingClosureV1(options), { code: 'FINANCIAL_READ_INCOMPLETE' })
	assert.equal(changed, true)
})

test('final cross-source validation must reject an unavailable count even for an empty collection', async () => {
	let customerCounts = 0
	const db = makeDb(fixture(), { count: (name, total) => {
		if (name === 'crm_customers' && ++customerCounts === 3) return { total: null }
		return { total }
	} })
	await assert.rejects(createClosureReader(db).fillingClosureV1(options), { code: 'FINANCIAL_READ_INCOMPLETE' })
})

test('tank reader preserves action projection, reads 500+ rows and provides full-day coverage', async () => {
	const day = '2026-09-01'
	const start = Date.parse(`${day}T00:00:00+08:00`)
	const tables = fixture()
	tables.crm_operation_logs = Array.from({ length: 720 }, (_, index) => ({
		_id: `tank-${String(index).padStart(4, '0')}`, action: 'tank_gateway_ingest', created_at: start + index * 5000,
		detail: { gateway_id: 'gateway', tank_id: 'main', level_kpa: index < 60 ? 41.28 : Math.max(40, 41.28 - (index - 59) * 0.02),
			pressure_mpa: 0.25, lng_weight_t: index < 60 ? 21.42 : 20.5 }
	}))
	tables.crm_operation_logs.push({ ...tables.crm_operation_logs[0], _id: 'before-day', created_at: start - 1 })
	tables.crm_operation_logs.push({ ...tables.crm_operation_logs[0], _id: 'other-action', action: 'other_action' })
	const db = makeDb(tables)
	const result = await createClosureReader(db).tankBeforeFillingV1({ day })
	assert.equal(result.code, 0)
	assert.equal(result.data.status, 'candidate')
	assert.equal(result.data.quantity_t, 21.42)
	assert.equal(result.data.calibrated, false)
	assert.equal(result.data.source_basis, 'tank_gateway_ingest')
	assert.equal(result.data.issues.some(row => ['query_incomplete', 'day_start_missing'].includes(row.code)), false)
	const pages = db.calls.filter(call => call.name === 'crm_operation_logs' && call.order)
	assert.equal(pages.length, 2)
	assert.ok(pages.every(call => call.limit === 500 && call.field.action === true && call.field._id === true))
})

test('invalid dates and a future tank day are rejected before source queries', async () => {
	const db = makeDb(fixture())
	const reader = createClosureReader(db)
	assert.equal((await reader.fillingClosureV1({ ...options, dateStart: '2026-02-31' })).code, 400)
	assert.equal((await reader.fillingClosureV1({ ...options, cutoffDay: '2026-08-31' })).code, 400)
	assert.equal((await reader.tankBeforeFillingV1({ day: '2099-01-01' })).code, 400)
	assert.equal(db.calls.length, 0)
})
