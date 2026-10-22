'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const response = (ids, cursor = null) => ({ code: 0, data: { rows: ids.map(id => ({ id, bottle_no: id })), has_more: Boolean(cursor), next_cursor: cursor } })
function harness(t, options = {}) {
	let owner = 'u1', callback, leaves = 0
	const requests = [], hooks = [], registrations = []
	const source = fs.readFileSync('src/composables/pda/usePdaReweighRecords.js', 'utf8').replace(/^import.*\n/gm, '').replace(/^export /gm, '')
	const request = type => async data => { requests.push({ type, ...data }); return options.request ? options.request(data, requests.length, type) : response([type]) }
	const module = vm.runInNewContext(`${source}\n;({usePdaReweighRecords})`, {
		Date, String, Boolean, Array, Map, Promise, ...vue, onBeforeUnmount: fn => hooks.push(fn),
		getUser: () => ({ _id: owner }), canViewPage: url => !options.onlyFilling || url === '/pages/pda/reweigh',
		isPdaAppMode: () => true, normalizeBottleNo: value => String(value || '').trim().toUpperCase(),
		localFillingRounds: () => options.localRounds || [], uni: { getStorageSync: () => '' },
		listReturnReweighRoundRecordsV1: request('round'),
		listReturnReweighRecordsV1: request('return'), listFillingReweighRecordsV1: request('filling'),
		resolvePdaBottleByQrCode: options.resolveQr || (async rawText => ({ code: 0, data: { bottle_no: rawText } })),
		enterBarcodeSession: async params => { registrations.push(params.page); callback = params.onResult; return options.enter ? options.enter(params) : { code: 0 } },
		leaveBarcodeSession: async () => { leaves++ }
	})
	const form = module.usePdaReweighRecords()
	t.after(async () => { for (const hook of hooks) await hook() })
	return { form, requests, registrations, setOwner: value => { owner = value }, scan: text => callback({ rawText: text }), leaves: () => leaves }
}

test('defaults to business today and restricts record types to existing view permission', async t => {
	const h = harness(t, { onlyFilling: true }); await h.form.activate(); await tick()
	assert.equal(h.form.date.value, new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))
	assert.equal(h.form.type.value, 'filling'); assert.equal(h.form.types.value.length, 1)
	assert.equal(h.requests[0].type, 'filling'); assert.equal(h.requests[0].page_size, 30)
	h.form.setFilter('type', 'return'); assert.equal(h.form.type.value, 'filling')
})

test('edited filter invalidates in-flight rows; next query uses normalized bottle and latest date', async t => {
	const first = deferred()
	const h = harness(t, { request: (data, count) => count === 1 ? first.promise : response([data.bottle_no]) })
	await h.form.activate()
	h.form.setFilter('date', '2026-10-21'); h.form.setFilter('bottle', ' x282 ')
	await h.form.search(); first.resolve(response(['stale'])); await tick()
	assert.deepEqual(Array.from(h.form.rows.value, row => row.id), ['X282'])
	assert.equal(h.requests[1].date, '2026-10-21'); assert.equal(h.form.loading.value, false)
})

test('pagination is cursor based, deduplicates IDs and refuses duplicate concurrent loads without a total cap', async t => {
	const next = deferred()
	const h = harness(t, { request: (data, count) => count === 1 ? response(Array.from({ length: 30 }, (_, i) => String(i)), 'c1') : count === 2 ? next.promise : response(['31']) })
	await h.form.activate(); await tick()
	const loading = h.form.loadMore(); await h.form.loadMore()
	assert.equal(h.requests.length, 2); assert.equal(h.requests[1].cursor, 'c1')
	next.resolve(response(['29', '30'], 'c2')); await loading; await h.form.loadMore()
	assert.equal(h.form.rows.value.length, 32); assert.equal(h.requests[2].cursor, 'c2')
	assert.equal(h.form.hasMore.value, false)
})

test('changing type during pagination discards the prior type response and resets cursor', async t => {
	const next = deferred()
	const h = harness(t, { request: (data, count, type) => count === 1 ? response(['return'], 'c1') : count === 2 ? next.promise : response([type]) })
	await h.form.activate(); await tick(); const pending = h.form.loadMore()
	h.form.setFilter('type', 'filling'); await h.form.search()
	next.resolve(response(['old-return'])); await pending
	assert.deepEqual(Array.from(h.form.rows.value, row => row.id), ['filling']); assert.equal(h.requests[2].cursor, null)
})

test('newest scan wins and a hidden page cannot accept a late QR lookup', async t => {
	const scans = []
	const h = harness(t, { resolveQr: () => { const pending = deferred(); scans.push(pending); return pending.promise } })
	await h.form.activate(); await tick()
	const oldScan = h.scan('old'); const newScan = h.scan('new')
	scans[1].resolve({ code: 0, data: { bottle_no: '282' } }); await newScan
	scans[0].resolve({ code: 0, data: { bottle_no: '97' } }); await oldScan
	assert.equal(h.form.bottleNo.value, '282'); assert.equal(h.requests.length, 2)
	const hiddenScan = h.scan('hidden'); await h.form.deactivate()
	scans[2].resolve({ code: 0, data: { bottle_no: '66' } }); await hiddenScan
	assert.equal(h.form.bottleNo.value, '282'); assert.equal(h.form.rows.value.length, 0); assert.equal(h.requests.length, 2)
})

test('account change rejects pending server and QR responses without leaking prior account rows', async t => {
	const pending = deferred(), qr = deferred()
	const h = harness(t, { request: () => pending.promise, resolveQr: () => qr.promise })
	await h.form.activate(); const scan = h.scan('282'); h.setOwner('u2')
	pending.resolve(response(['u1-secret'])); qr.resolve({ code: 0, data: { bottle_no: '282' } }); await scan; await tick()
	assert.equal(h.form.rows.value.length, 0); assert.equal(h.form.bottleNo.value, '')
	assert.match(h.form.error.value, /账号已变更/); assert.equal(h.requests.length, 1)
})

test('scanner startup and hide/show are serialized; late startup cannot mark hidden page ready', async t => {
	const entering = deferred()
	const h = harness(t, { enter: () => entering.promise })
	const started = h.form.activate(); await tick(); const hidden = h.form.deactivate()
	entering.resolve({ code: 0 }); await started; await hidden
	assert.equal(h.form.scannerReady.value, false); assert.equal(h.leaves(), 1)
	await h.form.activate(); assert.equal(h.form.scannerReady.value, true); assert.equal(h.registrations.length, 2)
})

test('failed load-more preserves loaded rows and cursor for retry instead of presenting success', async t => {
	const h = harness(t, { request: (data, count) => count === 1 ? response(['1'], 'c1') : count === 2 ? { code: 500, msg: '暂时不可用' } : response(['2']) })
	await h.form.activate(); await tick(); await h.form.loadMore()
	assert.equal(h.form.rows.value.length, 1); assert.equal(h.form.error.value, '暂时不可用'); assert.equal(h.form.hasMore.value, true)
	await h.form.loadMore(); assert.equal(h.requests[2].cursor, 'c1'); assert.equal(h.form.rows.value.length, 2)
})

test('malformed successful responses are reported as read failures rather than an empty history', async t => {
	const h = harness(t, { request: async () => ({ code: 0, data: {} }) })
	await h.form.activate(); await tick()
	assert.match(h.form.error.value, /响应不完整/); assert.equal(h.form.rows.value.length, 0)
})

function homeHarness() {
	const source = fs.readFileSync('src/components/domain/pda/PdaHomeView.vue', 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import.*\n/gm, '')
	return vm.runInNewContext(`${source}\n;({activate,deactivate,openRecords,closeRecords,showRecords,recordsOpened,recordsRef})`, {
		...vue, onBeforeUnmount: () => {}, defineExpose: () => {},
		getUser: () => ({ _id: 'u1' }), isPdaAppMode: () => true, canViewPage: () => true, canPageAction: () => true
	})
}

test('home retains one query component across close/reopen and consumes Back only while querying', async () => {
	const home = homeHarness(); let starts = 0, stops = 0
	home.recordsRef.value = { activate: async () => { starts++ }, deactivate: () => { stops++ } }
	await home.activate(); assert.equal(home.closeRecords(), false)
	await home.openRecords(); assert.equal(starts, 1); assert.equal(home.showRecords.value, true)
	assert.equal(home.closeRecords(), true); assert.equal(stops, 1)
	assert.equal(home.recordsOpened.value, true); assert.equal(home.showRecords.value, false)
	await home.openRecords(); assert.equal(starts, 2)
})

test('home hide before nextTick prevents late scanner activation and resumes only when visible', async () => {
	const home = homeHarness(); let starts = 0
	home.recordsRef.value = { activate: async () => { starts++ }, deactivate: () => {} }
	await home.activate(); const opening = home.openRecords(); home.deactivate(); await opening
	assert.equal(starts, 0); await home.activate(); assert.equal(starts, 1)
})


test('ended local filling round is selectable without changing or migrating the stored drafts', async t => {
 const localRounds = [{ id: 'old-round', first_time: '2026-10-21 12:00:00', bottle_count: 55, rows: Array.from({ length: 55 }, (_, i) => ({ id: `old-${i}`, bottle_no: String(i) })) }]
 const h = harness(t, { onlyFilling: true, localRounds })
 await h.form.activate(); await tick()
 assert.equal(h.form.rounds.value.length, 1)
 h.form.setFilter('round', 'old-round'); await h.form.search()
 assert.equal(h.form.rows.value.length, 55)
 assert.equal(h.form.summary.value.bottle_count, 55)
 assert.equal(h.requests.length, 1)
 h.setOwner('other'); await h.form.search()
 assert.equal(h.form.rows.value.length, 0); assert.equal(h.form.rounds.value.length, 0)
})

test('return historical round uses server round scope and full summary rather than page length', async t => {
 const h = harness(t, { request: async (data, count) => ({ code: 0, data: { rows: [{ id: 'r', bottle_no: '1' }], has_more: false, summary: { bottle_count: 55, record_count: 57, rounds: [{ id: 'old-round', first_time: '2026-10-21 12:00:00', bottle_count: 55 }] } } }) })
 await h.form.activate(); await tick()
 assert.equal(h.form.summary.value.bottle_count, 55)
 assert.equal(h.requests[0].include_summary, true)
 h.form.setFilter('round', 'old-round'); await h.form.search()
 assert.equal(h.requests[1].type, 'round'); assert.equal(h.requests[1].round_id, 'old-round')
 assert.equal(h.form.summary.value.record_count, 57)
})
