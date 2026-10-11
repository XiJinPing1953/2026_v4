'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')
const source = fs.readFileSync('src/composables/gas/useTruckQuantityClosure.js', 'utf8')
const settle = () => new Promise(resolve => setImmediate(resolve))

function harness() {
	const calls = [], intervals = new Map()
	let nextTimer = 0
	const sandbox = {
		ref: vue.ref, reactive: vue.reactive, computed: vue.computed, onBeforeUnmount: () => {},
		Date, Number, Object, Boolean, Array, Error, businessToday: () => '2026-10-11',
		getTruckQuantityClosureV1: query => new Promise((resolve, reject) => calls.push({ query, resolve, reject })),
		setInterval: (fn, delay) => { assert.equal(delay, 60000); intervals.set(++nextTimer, fn); return nextTimer },
		clearInterval: id => intervals.delete(id)
	}
	vm.runInNewContext(source.replace(/^import .*\n/gm, '').replace(/export function /g, 'function ') + '\nthis.api = { useTruckQuantityClosure, validateTruckQuantityFilters };', sandbox)
	return { ...sandbox.api, state: sandbox.api.useTruckQuantityClosure(), calls, intervals }
}
function response(id = 'one', overrides = {}) {
	return { code: 0, data: { batches: [{ id, weight: { adopted_station_in_kg: 21080 }, filling: { total: { kg: null, known_kg: 16000, unknown_count: 1 } } }], unassigned_fillings: [{ source_id: 'pending' }], shared_cycles: [], scope: { read_complete: true }, ...overrides } }
}

test('initial read lets the server resolve the current period and validates optional start and required range', () => {
	const h = harness()
	h.state.setVisible(true)
	assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].query)), { dateStart: '', dateEnd: '2026-10-11', cutoffDay: '2026-10-11' })
	assert.equal(h.validateTruckQuantityFilters(h.state.filters), '')
	for (const changes of [{ dateStart: '2026-02-30' }, { dateStart: '2026-10-12' }, { dateEnd: '' }, { cutoffDay: '2026-10-10' }]) {
		assert.ok(h.validateTruckQuantityFilters({ dateStart: '', dateEnd: '2026-10-11', cutoffDay: '2026-10-11', ...changes }))
	}
	h.state.filters.cutoffDay = 'invalid'
	h.state.search()
	assert.equal(h.calls.length, 1)
	assert.ok(h.state.formError.value)
	h.state.dispose()
})

test('new query wins over late replies while retaining server unknowns and complete detail pools', async () => {
	const h = harness(); h.state.setVisible(true)
	h.state.filters.dateStart = '2026-09-01'; h.state.search()
	h.calls[1].resolve(response('new')); await settle()
	h.calls[0].resolve(response('old')); await settle()
	assert.equal(h.state.batches.value[0].id, 'new')
	assert.equal(h.state.batches.value[0].filling.total.kg, null)
	assert.equal(h.state.batches.value[0].filling.total.known_kg, 16000)
	assert.equal(h.state.unassignedFillings.value.length, 1)
	assert.equal(h.state.appliedFilters.value.dateStart, '2026-09-01')
	assert.equal(h.calls[1].query.page, undefined)
	h.state.dispose()
})

test('failed, partial or unconfirmed complete reads keep last result explicitly stale', async () => {
	const h = harness(); h.state.setVisible(true)
	h.calls[0].resolve(response('one', { scope: { read_complete: true, date_start: '2026-08-12' } })); await settle()
	assert.equal(h.state.appliedFilters.value.dateStart, '2026-08-12')
	h.state.expandedBatch.value = 'one'
	h.state.refresh(); h.calls[1].reject(new Error('连接中断')); await settle()
	assert.match(h.state.error.value, /连接中断/)
	assert.equal(h.state.stale.value, true)
	assert.equal(h.state.expandedBatch.value, 'one')
	for (const scope of [{ read_complete: false }, {}]) {
		h.state.refresh(); h.calls.at(-1).resolve(response('partial', { scope })); await settle()
		assert.equal(h.state.batches.value[0].id, 'one')
		assert.equal(h.state.stale.value, true)
	}
	h.state.refresh(); h.calls.at(-1).resolve(response('success')); await settle()
	assert.equal(h.state.stale.value, false)
	assert.equal(h.state.expandedBatch.value, '')
	h.state.dispose()
})

test('visible polling avoids duplicates, pauses hidden and rejects replies after hide or disposal', async () => {
	const h = harness(); h.state.setVisible(true); h.state.setVisible(true)
	assert.equal(h.intervals.size, 1)
	;[...h.intervals.values()][0]()
	assert.equal(h.calls.length, 1)
	h.state.setVisible(false)
	assert.equal(h.intervals.size, 0)
	h.calls[0].resolve(response()); await settle()
	assert.equal(h.state.result.value, null)
	h.state.setVisible(true)
	h.calls[1].resolve(response('return')); await settle()
	;[...h.intervals.values()][0]()
	assert.equal(h.calls.length, 3)
	h.state.dispose()
	h.calls[2].resolve(response('late')); await settle()
	assert.equal(h.state.batches.value[0].id, 'return')
	assert.equal(h.intervals.size, 0)
	h.state.setVisible(true)
	assert.equal(h.calls.length, 3)
})
