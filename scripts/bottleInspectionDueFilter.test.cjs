'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')

function dateAtOffset(days) {
	const todayInChina = new Date(Date.now() + 8 * 60 * 60 * 1000)
	const day = Date.UTC(todayInChina.getUTCFullYear(), todayInChina.getUTCMonth(), todayInChina.getUTCDate() + days)
	return new Date(day).toISOString().slice(0, 10)
}

function bottle(id, bottleDate, extra = {}) {
	return {
		_id: id,
		bottle_no: id,
		bottle_no_sort_key: id,
		is_active: true,
		bottle_next_check_date: bottleDate,
		bottle_check_cycle_months: 12,
		pressure_gauge_cycle_months: 12,
		safety_valve_cycle_months: 12,
		...extra
	}
}

const selector = { inspection_due_module: 'bottle', inspection_due_state: 'overdue_or_due_60d', is_active: true }

test('combined due filter uses the same bottle scope for list and batch preview', async () => {
	const tables = {
		crm_users: [{ _id: 'user-1', token: 'test', role: 'superadmin' }],
		crm_customers: [],
		crm_operation_logs: [],
		crm_bottles: [
			bottle('01-overdue', dateAtOffset(-1)),
			bottle('02-today', dateAtOffset(0)),
			bottle('03-day-60', dateAtOffset(60)),
			bottle('04-day-61', dateAtOffset(61)),
			bottle('05-invalid', 'not-a-date'),
			bottle('06-inactive', dateAtOffset(-1), { is_active: false }),
			bottle('07-other-module', dateAtOffset(61), {
				pressure_gauge_next_check_date: dateAtOffset(-1),
				safety_valve_next_check_date: dateAtOffset(60)
			})
		]
	}
	const db = makeDb(tables)
	const handler = loadHandler('crm-bottle', db)
	const list = await invoke(handler, 'listV1', { ...selector, page: 1, pageSize: 50, include_summary: false })
	assert.equal(list.code, 0, list.msg)
	assert.deepEqual(list.data.map((row) => row._id), ['01-overdue', '02-today', '03-day-60'])
	assert.equal(list.paging.total, 3)

	const preview = await invoke(handler, 'batchUpdateInspectionV2', {
		preview: true,
		inspection_date: dateAtOffset(0),
		modules: ['bottle'],
		scope_mode: 'filter',
		selector
	})
	assert.equal(preview.code, 0, preview.msg)
	assert.equal(preview.data.target_total, list.paging.total)
	assert.equal(preview.data.found_total, list.paging.total)
	assert.equal(preview.data.can_execute, true)
	assert.equal(db.writes.filter((write) => write.name === 'crm_bottles').length, 0)

	const gaugeList = await invoke(handler, 'listV1', {
		...selector, inspection_due_module: 'gauge', page: 1, pageSize: 50, include_summary: false
	})
	assert.equal(gaugeList.code, 0, gaugeList.msg)
	assert.deepEqual(gaugeList.data.map((row) => row._id), ['07-other-module'])
	const valveList = await invoke(handler, 'listV1', {
		...selector, inspection_due_module: 'valve', page: 1, pageSize: 50, include_summary: false
	})
	assert.equal(valveList.code, 0, valveList.msg)
	assert.deepEqual(valveList.data.map((row) => row._id), ['07-other-module'])
})

test('old overdue and upcoming states remain separate', async () => {
	const db = makeDb({
		crm_users: [{ _id: 'user-1', token: 'test', role: 'superadmin' }],
		crm_customers: [],
		crm_bottles: [bottle('overdue', dateAtOffset(-1)), bottle('today', dateAtOffset(0)), bottle('day-60', dateAtOffset(60)), bottle('day-61', dateAtOffset(61))]
	})
	const handler = loadHandler('crm-bottle', db)
	for (const [state, expected] of [
		['overdue', ['overdue']],
		['due_60d', ['day-60', 'today']]
	]) {
		const result = await invoke(handler, 'listV1', { ...selector, inspection_due_state: state, page: 1, pageSize: 50, include_summary: false })
		assert.equal(result.code, 0, result.msg)
		assert.deepEqual(result.data.map((row) => row._id), expected)
	}
})
