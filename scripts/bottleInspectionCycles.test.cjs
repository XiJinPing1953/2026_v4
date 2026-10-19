'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
const defaults = require('../uniCloud-alipay/cloudfunctions/crm-bottle/inspectionCycles.json')

function setup(rows) {
	const db = makeDb({ crm_users: [{ _id: 'user-1', token: 'test', role: 'superadmin' }], crm_customers: [], crm_operation_logs: [], crm_bottles: rows }, { mutate: true })
	return { db, handler: loadHandler('crm-bottle', db) }
}
const request = (ids, modules = ['gauge']) => ({ inspection_date: '2026-10-19', modules, scope_mode: 'ids', selector: { ids } })

test('78 legacy bottles pass read-only preview; execution fills only selected gauge cycle and dates', async () => {
	const rows = Array.from({ length: 78 }, (_, i) => ({ _id: `X${i + 1}`, bottle_no: `X${i + 1}`, is_active: true, pressure_gauge_cycle_months: [undefined, null, '', '  '][i % 4], bottle_check_date: '2024-01-25', safety_valve_next_check_date: '2026-10-24' }))
	const { db, handler } = setup(rows)
	const payload = request(rows.map(row => row._id))
	const preview = await invoke(handler, 'batchUpdateInspectionV2', { ...payload, preview: true })
	assert.equal(preview.data.target_total, 78)
	assert.equal(preview.data.invalid_total, 0)
	assert.equal(preview.data.can_execute, true)
	assert.equal(db.writes.filter(write => write.name === 'crm_bottles').length, 0)
	const executed = await invoke(handler, 'batchUpdateInspectionV2', payload)
	assert.equal(executed.code, 0, executed.msg)
	assert.equal(executed.data.success, 78)
	for (const row of rows) {
		assert.equal(row.pressure_gauge_cycle_months, 6)
		assert.equal(row.pressure_gauge_check_date, '2026-10-19')
		assert.equal(row.pressure_gauge_next_check_date, '2027-04-18')
		assert.equal(row.bottle_check_date, '2024-01-25')
		assert.equal(row.safety_valve_next_check_date, '2026-10-24')
		assert.equal(row.bottle_check_cycle_months, undefined)
	}
})

test('filter scope uses 36/6/12 months and clamps leap day; explicit valid cycles remain unchanged', async () => {
	const rows = [{ _id: 'legacy', bottle_no: 'legacy', is_active: true }, { _id: 'configured', bottle_no: 'configured', is_active: true, bottle_check_cycle_months: 24, pressure_gauge_cycle_months: '12', safety_valve_cycle_months: 6 }]
	const { handler } = setup(rows)
	const result = await invoke(handler, 'batchUpdateInspectionV2', { inspection_date: '2024-02-29', modules: ['bottle', 'gauge', 'valve'], scope_mode: 'filter', selector: { is_active: true } })
	assert.equal(result.code, 0, result.msg)
	assert.equal(result.data.success, 2)
	assert.deepEqual([rows[0].bottle_next_check_date, rows[0].pressure_gauge_next_check_date, rows[0].safety_valve_next_check_date], ['2027-02-27', '2024-08-28', '2025-02-27'])
	for (const [field, value] of Object.entries(defaults)) assert.equal(rows[0][field], value)
	assert.deepEqual([rows[1].bottle_next_check_date, rows[1].pressure_gauge_next_check_date, rows[1].safety_valve_next_check_date], ['2026-02-27', '2025-02-27', '2024-08-28'])
	assert.equal(rows[1].pressure_gauge_cycle_months, '12')
})

test('invalid nonempty cycles and missing bottle ids still block all bottle writes', async () => {
	for (const invalid of [0, 5, 'bad', -6]) {
		const { db, handler } = setup([{ _id: 'ok', bottle_no: 'ok' }, { _id: 'bad', bottle_no: 'bad', pressure_gauge_cycle_months: invalid }])
		const result = await invoke(handler, 'batchUpdateInspectionV2', request(['ok', 'bad', 'missing']))
		assert.equal(result.code, 409)
		assert.equal(result.data.invalid_total, 2)
		assert.equal(db.writes.filter(write => write.name === 'crm_bottles').length, 0)
	}
})

function component(name, extra = {}) {
	const source = fs.readFileSync(`src/components/domain/bottle/${name}.vue`, 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*\n/gm, '')
	const context = { ...vue, watch() {}, onMounted() {}, defineProps: () => ({ recordId: '' }), useAuthGuard: () => ({ canPageAction: () => true }), DEFAULT_INSPECTION_CYCLES: defaults, ...extra }
	vm.createContext(context)
	vm.runInContext(source, context)
	return context
}

test('new and legacy edit forms share defaults without changing stored dates; inspection labels distinguish defaults', async () => {
	const edit = component('BottleEditView', { getBottleV1: async () => ({ code: 0, data: { _id: 'X001', pressure_gauge_check_date: '2026-04-18', pressure_gauge_next_check_date: '2026-10-17' } }) })
	for (const [field, value] of Object.entries(defaults)) assert.equal(vm.runInContext(`form.${field}`, edit), value)
	await vm.runInContext("loadRecord('X001')", edit)
	for (const [field, value] of Object.entries(defaults)) assert.equal(vm.runInContext(`form.${field}`, edit), value)
	assert.equal(vm.runInContext('form.pressure_gauge_next_check_date', edit), '2026-10-17')
	const inspection = component('BottleInspectionView')
	for (const [module, months] of [['bottle', 36], ['gauge', 6], ['valve', 12]]) assert.equal(vm.runInContext(`formatModuleCycle({}, '${module}')`, inspection), `${months}个月（默认）`)
	assert.equal(vm.runInContext("formatModuleCycle({ pressure_gauge_cycle_months: 12 }, 'gauge')", inspection), '12个月')
})

// User example and both automatic date entry points must agree.
test('inspection validity ends one day before the cycle anniversary', async () => {
 const rows = [{ _id: 'example', bottle_no: 'example' }]
 const { handler } = setup(rows)
 const result = await invoke(handler, 'batchUpdateInspectionV2', { ...request(['example'], ['bottle', 'gauge', 'valve']), inspection_date: '2026-04-18' })
 assert.equal(result.code, 0, result.msg)
 assert.deepEqual([rows[0].bottle_next_check_date, rows[0].pressure_gauge_next_check_date, rows[0].safety_valve_next_check_date], ['2029-04-17', '2026-10-17', '2027-04-17'])
 const edit = component('BottleEditView')
 for (const [months, wanted] of [[6, '2026-10-17'], [12, '2027-04-17'], [36, '2029-04-17']]) assert.equal(vm.runInContext(`addMonths('2026-04-18', ${months})`, edit), wanted)
 assert.equal(vm.runInContext("addMonths('2026-04-01', 6)", edit), '2026-09-30')
 assert.equal(vm.runInContext("addMonths('2024-08-31', 6)", edit), '2025-02-27')
})
