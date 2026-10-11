'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')
const source = fs.readFileSync('src/composables/gas/useGasClosure.js', 'utf8')

function deferred() {
	let resolve, reject
	const promise = new Promise((yes, no) => { resolve = yes; reject = no })
	return { promise, resolve, reject }
}
function harness() {
	const calls = [], tanks = [], intervals = new Map()
	let nextTimer = 0
	const sandbox = {
		ref: vue.ref, reactive: vue.reactive, computed: vue.computed,
		onBeforeUnmount: () => {}, Date, Number, Object, Boolean, Math, Error,
		getFillingClosureV1: query => { const d = deferred(); calls.push({ query, ...d }); return d.promise },
		getTankBeforeFillingV1: day => { const d = deferred(); tanks.push({ day, ...d }); return d.promise },
		setInterval: (fn, delay) => { assert.equal(delay, 60000); intervals.set(++nextTimer, fn); return nextTimer },
		clearInterval: id => intervals.delete(id)
	}

	vm.runInNewContext(source.replace(/^import .*\n/gm, '').replace(/export function /g, 'function ') + '\nthis.api = { useGasClosure, validateClosureFilters, businessToday };', sandbox)
	return { ...sandbox.api, state: sandbox.api.useGasClosure(), calls, tanks, intervals }
}
function response(id = 'one', overrides = {}) {
	return { code: 0, data: { cycles: [{ id, bottle_no: '1' }], summary: { total_fill_kg: 150, out_net_kg: null }, days: [{ day: '2026-10-10', fill_count: 2 }], total: 42, page: 1, scope: { read_complete: true }, ...overrides } }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('business date is UTC+8 and invalid or reversed ranges never query', () => {
	const h = harness()
	assert.equal(h.businessToday(Date.parse('2026-10-09T16:00:00Z')), '2026-10-10')
	assert.ok(h.validateClosureFilters({ dateStart: '2026-02-30', dateEnd: '2026-10-10', cutoffDay: '2026-10-10' }))
	assert.ok(h.validateClosureFilters({ dateStart: '2026-13-01', dateEnd: '2026-10-10', cutoffDay: '2026-10-10' }))
	h.state.filters.dateStart = '2026-10-11'; h.state.filters.dateEnd = '2026-10-10'
	h.state.search()
	assert.equal(h.calls.length, 0)
	assert.ok(h.state.formError.value)
	h.state.dispose()
})

test('late response cannot replace newer query and server summary is not paginated locally', async () => {
	const h = harness(); h.state.setVisible(true)
	h.state.filters.bottle_no = ' 198 '; h.state.search()
	assert.equal(h.calls[1].query.bottle_no, '198')
	h.calls[1].resolve(response('new')); await settle()
	h.calls[0].resolve(response('old')); await settle()
	assert.equal(h.state.cycles.value[0].id, 'new')
	assert.equal(h.state.summary.value.total_fill_kg, 150)
	assert.equal(h.state.summary.value.out_net_kg, null)
	assert.equal(h.state.totalPages.value, 3)
	h.state.changePage(2)
	assert.equal(h.calls[2].query.page, 2)
	assert.equal(h.calls[2].query.bottle_no, '198')
	h.state.dispose()
})

test('failed or incomplete refresh retains prior data and marks it stale', async () => {
	const h = harness(); h.state.setVisible(true)
	h.calls[0].resolve(response()); await settle()
	h.state.refresh(); h.calls[1].reject(new Error('连接中断')); await settle()
	assert.equal(h.state.cycles.value[0].id, 'one')
	assert.equal(h.state.stale.value, true)
	assert.match(h.state.error.value, /连接中断/)
	h.state.refresh(); h.calls[2].resolve(response('incomplete', { scope: { read_complete: false } })); await settle()
	assert.equal(h.state.cycles.value[0].id, 'one')
	assert.equal(h.state.stale.value, true)
	h.state.dispose()
})

test('hidden page stops polling, ignores running reads, and reloads upon return', async () => {
	const h = harness(); h.state.setVisible(true)
	assert.equal(h.intervals.size, 1)
	const poll = [...h.intervals.values()][0]; poll()
	assert.equal(h.calls.length, 1, 'a running background request is not duplicated')
	h.state.setVisible(false)
	assert.equal(h.intervals.size, 0)
	h.calls[0].resolve(response()); await settle()
	assert.equal(h.state.result.value, null)
	h.state.setVisible(true)
	assert.equal(h.calls.length, 2)
	h.calls[1].resolve(response('return')); await settle()
	;[...h.intervals.values()][0]()
	assert.equal(h.calls.length, 3)
	h.state.dispose(); assert.equal(h.intervals.size, 0)
})

test('tank refresh retains visible evidence through loading and failure, then replaces it on retry', async () => {
	const h = harness(); h.state.setVisible(true)
	h.calls[0].resolve(response()); await settle()
	assert.equal(h.tanks.length, 0)
	h.state.toggleDay('2026-10-10')
	h.tanks[0].resolve({ code: 0, data: { day: '2026-10-10', quantity_t: 21.42 } }); await settle()
	const updatedAt = h.state.tankResults['2026-10-10'].updatedAt
	assert.ok(updatedAt)
	h.state.refresh()
	assert.equal(h.state.tankResults['2026-10-10'].data.quantity_t, 21.42)
	assert.equal(h.state.tankResults['2026-10-10'].stale, true)
	h.calls[1].resolve(response()); await settle()
	assert.equal(h.tanks.length, 2, 'only the explicitly opened day is refreshed')
	assert.equal(h.state.tankResults['2026-10-10'].loading, true)
	assert.equal(h.state.tankResults['2026-10-10'].data.quantity_t, 21.42)
	h.tanks[1].reject(new Error('日志读取超时')); await settle()
	assert.equal(h.state.tankResults['2026-10-10'].data.quantity_t, 21.42)
	assert.equal(h.state.tankResults['2026-10-10'].loading, false)
	assert.equal(h.state.tankResults['2026-10-10'].stale, true)
	assert.equal(h.state.tankResults['2026-10-10'].updatedAt, updatedAt)
	assert.match(h.state.tankResults['2026-10-10'].error, /日志读取超时/)
	h.state.toggleDay('2026-10-10'); h.state.toggleDay('2026-10-10')
	assert.equal(h.tanks.length, 3, 'reopening expired evidence retries the failed read')
	h.tanks[2].resolve({ code: 0, data: { day: '2026-10-10', status: 'pending', quantity_t: null } }); await settle()
	assert.equal(h.state.tankResults['2026-10-10'].data.quantity_t, null)
	assert.equal(h.state.tankResults['2026-10-10'].stale, false)
	assert.equal(h.state.tankResults['2026-10-10'].error, '')
	h.state.dispose()
})

test('tank replies cannot overwrite newer reads or return after hide; new day groups prune old evidence', async () => {
	const h = harness(); h.state.setVisible(true)
	h.calls[0].resolve(response()); await settle()
	h.state.toggleDay('2026-10-10')
	h.state.refresh(); h.calls[1].resolve(response()); await settle()
	assert.equal(h.tanks.length, 2)
	h.tanks[1].resolve({ code: 0, data: { quantity_t: 21.42 } }); await settle()
	h.tanks[0].resolve({ code: 0, data: { quantity_t: 123 } }); await settle()
	assert.equal(h.state.tankResults['2026-10-10'].data.quantity_t, 21.42)
	h.state.filters.dateStart = '2026-10-11'; h.state.filters.dateEnd = '2026-10-11'; h.state.filters.cutoffDay = '2026-10-11'
	h.state.search()
	h.calls[2].resolve(response('next', { days: [{ day: '2026-10-11' }] })); await settle()
	assert.equal(h.state.tankResults['2026-10-10'], undefined)
	h.state.toggleDay('2026-10-11')
	h.state.setVisible(false)
	h.tanks[2].resolve({ code: 0, data: { quantity_t: 99 } }); await settle()
	assert.equal(h.state.tankResults['2026-10-11'].data, null)
	assert.equal(h.state.tankResults['2026-10-11'].loading, false)
	h.state.setVisible(true)
	h.calls[3].resolve(response('return', { days: [{ day: '2026-10-11' }] })); await settle()
	assert.equal(h.tanks.length, 4)
	h.state.dispose()
	h.tanks[3].resolve({ code: 0, data: { quantity_t: 77 } }); await settle()
	assert.equal(h.state.tankResults['2026-10-11'].data, null)
})

test('service actions and evidence links remain read-only and use existing source parameters', () => {
	const service = fs.readFileSync('src/services/gasClosure.js', 'utf8')
	assert.match(service, /action: 'fillingClosureV1'/)
	assert.match(service, /action: 'tankBeforeFillingV1'/)
	assert.doesNotMatch(service, /action: '(create|update|remove|sync)/)
	const view = fs.readFileSync('src/components/domain/gas/GasClosureView.vue', 'utf8')
	assert.match(view, /row\.type === 'boundary'/)
	assert.match(view, /canViewPage\(path\)/)
	assert.match(view, /\?_id=\$\{encodeURIComponent\(row\.source_id\)\}/)
	assert.match(view, /document\.visibilityState !== 'hidden'/)
	assert.match(view, /尚未出瓶重量为末次账面值/)
	assert.match(view, /本批在选期灌入/)
	assert.match(view, /kg\(result\.scope\.selected_prior_fill_kg\)/)
	assert.match(view, /归属于更早首灌批次，未计入上方汇总/)
	assert.match(view, /day\.unknown_count > 0/)
})
