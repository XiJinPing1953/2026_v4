'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')
const copy = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setImmediate(resolve))
function load(file, names, globals = {}) {
	const source = fs.readFileSync(file, 'utf8').replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '').replace(/^export /gm, '')
	return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, { Date, Math, Promise, console, ...globals })
}
const trace = load('src/services/pda/weighTrace.js', ['createWeighTrace', 'exportWeighTrace'], { setTimeout, clearTimeout })
const autoWeight = load('src/services/pda/autoReturnWeight.js', ['createAutoReturnWeight'])
const draft = load('src/services/pda/reweighDraft.js', ['createReweighDraftStore', 'createReweighId', 'cloneReweigh', 'reweighReceipt'])
function harness(t, options = {}) {
	let clock = Date.now(), diagnostic
	class TestDate extends Date { static now() { return clock } }
	const storage = options.storage || new Map()
	const requests = [], previews = [], confirmations = [], roundRequests = []
	let round = options.round === null ? null : { _id: 'round-1', created_at: Date.now(), bottle_count: 0, ...options.round }
	const countedBottles = new Set()
	let owner = options.owner || 'u1', listener, scanner, sequence = 0, stopped = 0
	let latest = { is_connected: false, is_online: false, is_stable: false, weight_kg: null, session_id: '', stable_seq: 0 }
	const modalResults = [...(options.modalResults || [])]
	const emit = value => { latest = { ...latest, ...value }; listener?.(latest) }
	const scale = {
		onSnapshot(fn) { listener = fn; fn(latest); return () => { listener = null } },
		beginMeasurement() { const id = `sample-${++sequence}`; emit({ session_id: id, measurement_started_at: Date.now() - 10, stable_seq: 0, is_stable: false, is_online: false }); return id },
		async stop() { stopped++; emit({ is_connected: false, is_online: false, session_id: `stopped-${++sequence}` }) },
		async disconnect() { emit({ is_connected: false, is_online: false, session_id: `stopped-${++sequence}` }) },
		updateProfile() {}, async connect() { emit({ is_connected: true }); return { code: 0 } },
		async discoverDevices() { return { code: 0, data: [{ deviceId: 'AA:BB:CC:DD:EE:FF', name: 'NVK' }] } }
	}
	function preview(params) {
		const gross = params.gross_weight ?? null
		return { code: 0, data: { mode: options.mode || 'create', date: '2026-10-19-14', bottle: { _id: 'b1', bottle_no: params.bottle_no, tare_weight: 100 },
			basis: { sale_id: 's1', item_index: 0, date: '2026-10-18', gross_weight: 105, source_updated_at: 1 }, context_hash: 'context-1',
			filling: options.mode === 'correct' ? { _id: 'f1', source_version: 'v2', weight_end: 119, actual_net_weight: 14, fill_weight: 14, reweigh: { gross_weight: 119, net_weight: 19 } } : null,
			gross_weight: gross, net_weight: gross == null ? null : gross - 100, fill_weight: gross == null ? null : gross - 105,
			label: gross == null ? null : { company: '新拓能源', bottle_no: params.bottle_no, tare_weight: 100, gross_weight: gross, net_weight: gross - 100 } } }
	}
	const onDestroy = []
	const stateModule = load('src/composables/pda/usePdaReweigh.js', ['usePdaReweigh', 'usableReweighSample', 'reweighChangeText'], {
		...draft, ...trace, ...autoWeight, Date: options.returnMode ? TestDate : Date, ref: vue.ref, computed: vue.computed, onBeforeUnmount: fn => onDestroy.push(fn),
		getUser: () => ({ _id: owner }), canPageAction: () => options.canCreate !== false,
		getPdaBleScaleCapabilities: () => ({ transport: options.web ? 'web' : 'native', supported: true }),
		createPdaBleScaleSession: profile => { diagnostic = profile.onDiagnosticFrame; return scale }, createEmptyPdaBleScaleSnapshot: () => ({ ...latest }),
		ensurePdaBleRuntimePermission: async () => ({ code: 0 }), quantizeBleScaleWeightKg: value => Math.round(value * 2) / 2,
		normalizeBottleNo: value => String(value || '').trim().toUpperCase(),
		enterBarcodeSession: async ({ onResult }) => { scanner = onResult; return { code: 0 } }, leaveBarcodeSession: async () => {},
		resolvePdaBottleByQrCode: options.resolveQr || (async text => ({ code: 0, data: { bottle_no: text } })),
		previewReweighV1: async params => { previews.push(copy(params)); return options.preview ? options.preview(params, previews.length, preview(params)) : preview(params) },
		createReweighV1: async payload => { requests.push({ mode: 'create', payload: copy(payload) }); return options.send ? options.send(payload, requests.length) : { code: 0, data: { operation_id: payload.operation_id, complete: true, saved_total: 1, _id: 'f1' } } },
		correctReweighV1: async payload => { requests.push({ mode: 'correct', payload: copy(payload) }); return { code: 0, data: { operation_id: payload.operation_id, complete: true, saved_total: 1, _id: payload.filling_id } } },
		getReweighOperationV1: options.query || (async () => ({ code: 404, msg: '操作未找到' })),
		retryReweighOperationV1: options.retry || (async operationId => ({ code: 0, data: { operation_id: operationId, complete: true, saved_total: 1, _id: 'f1' } })),
		getReturnReweighRoundV1: async () => ({ code: 0, data: { round: copy(round) } }),
		startReturnReweighRoundV1: async payload => {
			roundRequests.push(copy(payload))
			if (options.startRound) return options.startRound(payload, roundRequests.length)
			round = { _id: payload.round_id, created_at: Date.now(), bottle_count: 0 }; countedBottles.clear()
			return { code: 0, data: { round: copy(round) } }
		},
		previewReturnReweighV1: async params => {
			previews.push(copy(params))
			const result = preview(params); delete result.data.basis; delete result.data.label; delete result.data.fill_weight
			result.data.round = copy(round); result.data.previous = options.previous || null
			return options.preview ? options.preview(params, previews.length, result) : result
		},
		saveReturnReweighV1: async payload => {
			requests.push({ mode: 'return', payload: copy(payload) })
			if (options.send) return options.send(payload, requests.length)
			countedBottles.add(payload.bottle_no); round.bottle_count = countedBottles.size
			return { code: 0, data: { operation_id: payload.operation_id, complete: true, saved_total: 1, _id: 'r1', round: copy(round) } }
		},
		getReturnReweighV1: options.query || (async () => ({ code: 404, msg: '操作未找到' })),
		uni: {
			getStorageSync: key => storage.get(key), setStorageSync: (key, value) => { if (options.storageFails) throw new Error('quota'); storage.set(key, value) },
			showModal: params => { confirmations.push({ title: params.title, content: params.content }); params.success({ confirm: modalResults.length ? modalResults.shift() : true }) },
			showActionSheet: params => params.success({ tapIndex: 0 })
		}
	})
	const form = stateModule.usePdaReweigh({ mode: options.returnMode ? 'return' : 'filling' })
	t.after(() => onDestroy.forEach(fn => fn()))
	async function start() { await form.activate(); emit({ is_connected: true }) }
	function frames(weight, duration = 3100) { for (let i = 0; i <= duration; i += 100) { clock += 100; diagnostic({ session_id: latest.session_id, sampled_at: clock, display_kg: weight, device_id: 'NVK-1', raw: String(weight) }) } }
	async function measure(bottle = '101', gross = 120) {
		await start(); await form.selectBottle(bottle)
		emit({ weight_kg: gross, sampled_at: Date.now(), is_connected: true, is_online: true, is_stable: true, stable_seq: 1, device_id: 'NVK-1', frame_raw: 'ST,+01200kg' })
		if (options.returnMode) frames(gross)
		await tick()
	}
	return { frames, form, storage, requests, previews, confirmations, roundRequests, emit, start, measure, module: stateModule, scan: text => scanner({ rawText: text }), setOwner: value => { owner = value }, stopped: () => stopped }
}

test('one bottle gets its own window, half-kilogram gross and server-derived two distinct weights', async t => {
	const h = harness(t); await h.measure('101', 120.1)
	assert.equal(h.form.current.value.grossWeight, 120)
	assert.equal(h.form.current.value.preview.net_weight, 20)
	assert.equal(h.form.current.value.preview.fill_weight, 15)
	assert.equal(h.form.current.value.capture.stable, true)
	assert.equal(h.form.pendingSession.value, '')
	assert.equal(await h.form.submit(), true)
	assert.equal(h.requests[0].payload.capture.measurement_id, 'sample-1')
	assert.equal(h.form.current.value.receipt.complete, true)
})

test('same-weight next bottle cannot consume previous stable snapshot; duplicate scan preserves first measurement', async t => {
	const h = harness(t); await h.measure()
	const capture = copy(h.form.current.value.capture)
	await h.scan('101'); await h.form.selectBottle('102')
	assert.deepEqual(copy(h.form.current.value.capture), capture)
	assert.equal(h.form.current.value.bottleNo, '101')
	await h.form.submit(); await h.form.nextBottle(); await h.form.selectBottle('102')
	assert.equal(h.form.current.value.capture, null)
	assert.equal(h.form.pendingSession.value, 'sample-2')
	h.emit({ sampled_at: Date.now(), is_online: true, is_stable: true, stable_seq: 1, weight_kg: 120 }); await tick()
	assert.equal(h.form.current.value.grossWeight, 120)
	assert.equal(h.form.current.value.capture.measurement_id, 'sample-2')
})

test('old, future, disconnected and mismatched-session samples never count as a measurement', async t => {
	const h = harness(t); const check = h.module.usableReweighSample
	const snapshot = { session_id: 'a', is_connected: true, is_online: true, is_stable: true, weight_kg: 120, stable_seq: 1, sampled_at: 10000, measurement_started_at: 9999 }
	assert.equal(check(snapshot, 'a', 10000), true)
	assert.equal(check(snapshot, 'a', 13001), false)
	assert.equal(check(snapshot, 'a', 9999), false)
	assert.equal(check({ ...snapshot, is_connected: false }, 'a', 10000), false)
	assert.equal(check(snapshot, 'b', 10000), false)
})

test('hiding native page stops scale and scan; restored completed measurement survives without a pending window', async t => {
	const h = harness(t); await h.measure(); await h.form.deactivate()
	assert.equal(h.stopped(), 1); assert.equal(h.form.pendingSession.value, '')
	const restored = harness(t, { storage: h.storage }); await restored.start()
	assert.equal(restored.form.current.value.grossWeight, 120)
	assert.equal(restored.form.pendingSession.value, '')
	assert.equal(restored.form.current.value.capture.measurement_id, 'sample-1')
})

test('late QR lookup after page hidden cannot select a replacement bottle', async t => {
	let resolve
	const h = harness(t, { resolveQr: () => new Promise(done => { resolve = done }) }); await h.start()
	const pending = h.scan('101'); await h.form.deactivate(); resolve({ code: 0, data: { bottle_no: '101' } }); await pending
	assert.equal(h.form.current.value.bottleNo, '')
})

test('reweigh requires confirmation and starts fresh while cancelled confirmation preserves the measurement', async t => {
	const h = harness(t, { modalResults: [false, true] }); await h.measure()
	assert.equal(await h.form.startMeasurement(), false); assert.equal(h.form.current.value.grossWeight, 120)
	assert.equal(await h.form.startMeasurement(), true); assert.equal(h.form.current.value.capture, null); assert.equal(h.form.pendingSession.value, 'sample-2')
})

test('correction shows old/new/delta and submits original ID/version only after confirmation', async t => {
	const h = harness(t, { mode: 'correct', modalResults: [false, true] }); await h.measure()
	assert.equal(await h.form.submit(), false); assert.equal(h.requests.length, 0)
	assert.match(h.confirmations[0].content, /119\.0 kg → 120\.0 kg（\+1\.0 kg）/)
	assert.match(h.confirmations[0].content, /14\.0 kg → 15\.0 kg/)
	assert.match(h.confirmations[0].content, /标签净重：19\.0 kg → 20\.0 kg/)
	assert.equal(await h.form.submit(), true)
	assert.equal(h.requests[0].mode, 'correct'); assert.equal(h.requests[0].payload.filling_id, 'f1'); assert.equal(h.requests[0].payload.expected_source_version, 'v2')
})

test('basis changes during measurement remain visible for explicit pre-submit confirmation', async t => {
	const h = harness(t, { modalResults: [false, true], preview: (params, count, result) => {
		if (count > 1) { result.data.context_hash = 'context-2'; result.data.basis.gross_weight = 106; result.data.fill_weight = params.gross_weight - 106 }
		return result
	} }); await h.measure()
	assert.equal(h.form.current.value.previousBasis.context_hash, 'context-1')
	assert.equal(await h.form.submit(), false); assert.equal(h.requests.length, 0)
	assert.match(h.confirmations[0].content, /105\.0 kg → 106\.0 kg/)
	assert.equal(await h.form.submit(), true); assert.equal(h.requests[0].payload.context_hash, 'context-2')
})

test('unknown result and query 404 freeze original payload; retry never re-previews or changes operation ID', async t => {
	const h = harness(t, { send: () => { throw new Error('timeout') } }); await h.measure(); await h.form.submit()
	const frozen = copy(h.form.current.value.frozen), previewCount = h.previews.length
	assert.equal(await h.form.nextBottle(), false)
	await h.form.query(); assert.deepEqual(copy(h.form.current.value.frozen), frozen)
	await h.form.query(undefined, true)
	assert.equal(h.requests.length, 2); assert.deepEqual(h.requests[0], h.requests[1]); assert.equal(h.previews.length, previewCount)
	assert.equal(h.form.current.value.receipt.status, 'unknown')
})

test('reload keeps uncertain operation and refuses a new operation before saved evidence exists', async t => {
	const first = harness(t, { send: () => { throw new Error('timeout') } }); await first.measure(); await first.form.submit()
	const recovered = harness(t, { storage: first.storage }); await recovered.start()
	assert.equal(recovered.form.current.value.frozen.payload.operation_id, first.requests[0].payload.operation_id)
	assert.equal(await recovered.form.nextBottle(), false)
	await recovered.form.query(undefined, true)
	assert.deepEqual(recovered.requests[0].payload, first.requests[0].payload)
})

test('restored unknown submission retires only its matching rejected query and never retries the rejected operation', async t => {
	const first = harness(t, { send: () => { throw new Error('timeout') } }); await first.measure(); await first.form.submit()
	const originalId = first.form.current.value.operationId
	let reads = 0, retries = 0
	const recovered = harness(t, { storage: first.storage,
		query: async operationId => ({ code: 0, data: { operation_id: ++reads === 1 ? 'different-operation' : operationId, saved_total: 0, rejected: true, last_error: '事务已回滚' } }),
		retry: async () => { retries++; throw new Error('must not retry a rejected operation') } })
	await recovered.start(); await recovered.form.query(originalId, true)
	assert.equal(recovered.form.current.value.operationId, originalId)
	assert.ok(recovered.form.current.value.frozen)
	assert.equal(await recovered.form.query(originalId, true), false)
	assert.equal(recovered.form.current.value.frozen, null)
	assert.notEqual(recovered.form.current.value.operationId, originalId)
	assert.equal(recovered.form.current.value.grossWeight, 120)
	assert.equal(retries, 0)
	assert.match(recovered.form.error.value, /事务已回滚/)
	assert.equal(await recovered.form.submit(), true)
	assert.notEqual(recovered.requests[0].payload.operation_id, originalId)
})

test('saved pending record permits next bottle and retains recoverable operation in account history', async t => {
	const h = harness(t, { send: payload => ({ code: 0, data: { operation_id: payload.operation_id, saved_total: 1, complete: false, _id: 'f1', status: 'pending' } }),
		query: async operationId => ({ code: 0, data: { operation_id: operationId, complete: false, saved_total: 1, source_records: [{ _id: 'f1', saved: true }] } }) })
	await h.measure(); await h.form.submit()
	const id = h.form.current.value.operationId
	assert.equal(h.form.current.value.receipt.status, 'pending'); assert.equal(await h.form.nextBottle(), true)
	assert.equal(h.form.history.value[0].operationId, id)
	await h.form.query(id, true)
	assert.equal(h.form.history.value[0].receipt.complete, true)
	assert.equal(h.form.current.value.bottleNo, '')
})

test('code zero accepted but zero saved is not saved; definitive rejection retires its ID before a new submission', async t => {
	const h = harness(t, { send: () => ({ code: 0, data: { saved_total: 0, status: 'pending', complete: false } }) }); await h.measure(); await h.form.submit()
	assert.equal(h.form.current.value.receipt.saved, false); assert.equal(await h.form.nextBottle(), false)
	const rejected = harness(t, { send: (payload, attempt) => attempt === 1
		? { code: 409, msg: '事务已回滚，本次提交未保存', data: { rejected: true } }
		: { code: 0, data: { operation_id: payload.operation_id, complete: true, saved_total: 1, _id: 'f1' } } })
	await rejected.measure(); await rejected.form.submit()
	assert.equal(rejected.form.current.value.frozen, null); assert.equal(rejected.form.current.value.grossWeight, 120)
	const nextId = rejected.form.current.value.operationId
	assert.notEqual(nextId, rejected.requests[0].payload.operation_id)
	assert.equal(JSON.parse(rejected.storage.get('crm_pda_reweigh_v1:u1')).current.operationId, nextId)
	assert.equal(await rejected.form.submit(), true)
	assert.equal(rejected.requests[1].payload.operation_id, nextId)
	assert.equal(rejected.form.current.value.receipt.complete, true)
})

test('quota failure, account switch and stale local draft block network creation', async t => {
	const quota = harness(t, { storageFails: true }); await quota.measure(); await quota.form.submit(); assert.equal(quota.requests.length, 0)
	const switched = harness(t); await switched.measure(); switched.setOwner('u2'); await switched.form.submit(); assert.equal(switched.requests.length, 0)
	const shared = new Map(), first = harness(t, { storage: shared }), stale = harness(t, { storage: shared }); await first.measure(); await stale.measure(); await stale.form.submit()
	assert.equal(stale.requests.length, 0); assert.match(stale.form.storageError.value, /另一页面/)
})

test('unsent discard needs confirmation; web runtime and missing create permission cannot create', async t => {
	const h = harness(t, { modalResults: [false, true] }); await h.measure()
	assert.equal(await h.form.nextBottle(), false); assert.equal(h.form.current.value.bottleNo, '101')
	assert.equal(await h.form.nextBottle(), true); assert.equal(h.form.current.value.bottleNo, '')
	const web = harness(t, { web: true }); await web.measure(); await web.form.submit(); assert.equal(web.requests.length, 0)
	const denied = harness(t, { canCreate: false }); await denied.measure(); await denied.form.submit(); assert.equal(denied.requests.length, 0)
})

test('saved receipt survives a later query error and completed state is not inferred from code alone', () => {
	const previous = draft.reweighReceipt({ code: 0, data: { operation_id: 'a', _id: 'f1', saved_total: 1, complete: false } }, 'a')
	assert.equal(previous.status, 'pending')
	assert.equal(draft.reweighReceipt({ code: 500, msg: '网络错误' }, 'a', previous).saved, true)
	assert.equal(draft.reweighReceipt({ code: 0, data: { operation_id: 'other', saved_total: 1, complete: true } }, 'a').saved, false)
})

test('return reweigh saves signed net with its server round and server distinct-bottle count', async t => {
	const h = harness(t, { returnMode: true }); await h.measure('282', 99.5)
	assert.equal(h.form.current.value.preview.net_weight, -0.5)
	assert.equal(h.form.current.value.preview.basis, undefined)
	assert.equal(await h.form.submit(), true)
	assert.equal(h.requests[0].payload.round_id, 'round-1')
	assert.equal(h.requests[0].payload.capture_method, 'ble')
	assert.equal(h.form.round.value.bottle_count, 1)
	assert.match(h.form.current.value.receipt.message, /回瓶复秤已保存/)
	await h.form.nextBottle(); await h.measure('282', 100); await h.form.submit()
	assert.equal(h.form.current.value.preview.net_weight, 0)
	assert.equal(h.form.round.value.bottle_count, 1)
	await h.form.nextBottle(); await h.measure('283', 101); await h.form.submit()
	assert.equal(h.form.round.value.bottle_count, 2)
})

test('return repeat weighing requires explicit previous/new weight confirmation before saving', async t => {
	const h = harness(t, { returnMode: true, previous: { gross_weight: 101, net_weight: 1 }, modalResults: [false, true] })
	await h.measure('282', 100)
	assert.equal(await h.form.submit(), false); assert.equal(h.requests.length, 0)
	assert.match(h.confirmations[0].content, /101\.0 kg → 100\.0 kg/)
	assert.match(h.confirmations[0].content, /相同瓶号本轮只统计一次/)
	assert.equal(await h.form.submit(), true)
})

test('return round must start explicitly, lost start receipt survives restart and retries immutable request', async t => {
	const h = harness(t, { returnMode: true, round: null, startRound: () => { throw new Error('timeout') } })
	await h.measure(); assert.equal(h.form.current.value.bottleNo, '')
	assert.equal(await h.form.startRound(), false)
	const frozenRound = copy(h.form.pendingRound.value)
	assert.equal(h.form.locked.value, true)
	const recovered = harness(t, { returnMode: true, storage: h.storage, round: { _id: frozenRound.round_id, bottle_count: 0 } })
	await recovered.start()
	assert.deepEqual(copy(recovered.form.pendingRound.value), frozenRound)
	assert.equal(await recovered.form.startRound(), true)
	assert.deepEqual(recovered.roundRequests[0], frozenRound)
	assert.equal(recovered.form.pendingRound.value, null)
	assert.equal(recovered.form.round.value._id, frozenRound.round_id)
})

test('return uncertain save freezes round switching, survives reload, and 404 retry reuses exact operation', async t => {
	const h = harness(t, { returnMode: true, send: () => { throw new Error('timeout') } })
	await h.measure(); await h.form.submit()
	assert.equal(await h.form.startRound(), false); assert.equal(h.roundRequests.length, 0)
	const recovered = harness(t, { returnMode: true, storage: h.storage }); await recovered.start()
	assert.equal(await recovered.form.nextBottle(), false)
	await recovered.form.query(); assert.ok(recovered.form.current.value.frozen)
	await recovered.form.query(undefined, true)
	assert.deepEqual(recovered.requests[0], h.requests[0])
	assert.equal(recovered.form.current.value.receipt.complete, true)
})

test('return new round confirms completed count and does not alter existing filling draft storage', async t => {
	const filling = harness(t); await filling.measure('100')
	const fillingSaved = filling.storage.get('crm_pda_reweigh_v1:u1')
	const h = harness(t, { returnMode: true, storage: filling.storage, modalResults: [false, true] }); await h.measure('282'); await h.form.submit()
	assert.equal(await h.form.startRound(), false); assert.equal(h.roundRequests.length, 0)
	assert.match(h.confirmations[0].content, /本轮已复秤 1 瓶/)
	assert.equal(await h.form.startRound(), true)
	assert.equal(h.roundRequests[0].expected_round_id, 'round-1')
	assert.equal(h.form.current.value.bottleNo, '')
	assert.equal(h.form.round.value.bottle_count, 0)
	assert.equal(h.form.history.value.length, 1)
	assert.equal(filling.storage.get('crm_pda_reweigh_v1:u1'), fillingSaved)
})

test('local filling round counts confirmed distinct bottles beyond history retention and survives restart', async t => {
	const h = harness(t)
	for (let i = 0; i < 12; i++) {
		await h.measure(String(100 + i)); assert.equal(h.form.round.value.bottle_count, i)
		await h.form.submit(); assert.equal(h.form.round.value.bottle_count, i + 1)
		await h.form.nextBottle()
	}
	assert.equal(h.form.history.value.length, 10)
	await h.form.deactivate()
	const restored = harness(t, { storage: h.storage }); await restored.measure('100')
	await restored.form.submit()
	assert.equal(restored.form.round.value.bottle_count, 12)
	assert.equal(restored.roundRequests.length, 0)
})

test('local filling round ignores unknown acknowledgement and counts original recovery exactly once', async t => {
	let id
	const h = harness(t, { send: payload => { id = payload.operation_id; throw Error('offline') },
		query: async () => ({ code: 0, data: { operation_id: id, complete: true, saved_total: 1, _id: 'f1' } }) })
	await h.measure(); await h.form.submit()
	assert.equal(h.form.round.value.bottle_count, 0)
	assert.equal(await h.form.startRound(), false)
	await h.form.query(); await h.form.query()
	assert.equal(h.form.round.value.bottle_count, 1)
	const before = copy(h.form.round.value)
	h.setOwner('other')
	assert.equal(await h.form.startRound(), false)
	assert.deepEqual(copy(h.form.round.value), before)
})

test('new local filling round clears only its count after confirmation and retains it on storage failure', async t => {
	const options = { modalResults: [false, true, true] }, h = harness(t, options)
	await h.measure(); await h.form.submit()
	const first = copy(h.form.round.value)
	assert.equal(await h.form.startRound(), false)
	assert.deepEqual(copy(h.form.round.value), first)
	options.storageFails = true
	assert.equal(await h.form.startRound(), false)
	assert.deepEqual(copy(h.form.round.value), first)
	options.storageFails = false
	assert.equal(await h.form.startRound(), true)
	assert.equal(h.form.round.value.bottle_count, 0)
	assert.notEqual(h.form.round.value._id, first._id)
	assert.equal(h.requests.length, 1)
	assert.equal(h.roundRequests.length, 0)
})
test('回瓶采样使用实际保存回执，不将成功误标为未保存', async t => {
 const h = harness(t, { returnMode: true }); await h.start(); await h.form.toggleTrace(); await h.measure(); assert.equal(await h.form.submit(), true); await h.form.toggleTrace()
 const rows = [...h.storage.entries()].filter(([key]) => key.startsWith('pda_weigh_trace_v1_u1_')).flatMap(([, rows]) => rows)
 assert.equal(rows.find(row => row.type === 'save_response').saved, true)
})

test('回瓶自动修正不增网络核算或确认，卸瓶保留并冻结提交重量',async t=>{
 let release
 const h=harness(t,{returnMode:true,send:()=>new Promise(resolve=>{release=resolve})})
 await h.measure('23',124);const previews=h.previews.length
 h.frames(122);assert.equal(h.form.current.value.grossWeight,122);assert.equal(h.form.current.value.preview.net_weight,22)
 h.frames(80);h.frames(0);assert.equal(h.form.current.value.grossWeight,122)
 assert.equal(h.previews.length,previews);assert.equal(h.confirmations.length,0)
 const pending=h.form.submit();await tick();h.frames(123);assert.equal(h.requests[0].payload.gross_weight,122);assert.equal(h.form.current.value.grossWeight,122)
 release({code:0,data:{operation_id:h.requests[0].payload.operation_id,saved_total:1,complete:true}});await pending
 h.frames(123);assert.equal(h.form.current.value.grossWeight,122)
})
test('回瓶已取重断线后不得继续自动覆盖，保留采样数据',async t=>{
 const h=harness(t,{returnMode:true});h.storage.set('pda_weigh_trace_v1_u1',{enabled:false,chunks:0,count:2833,started:1})
 await h.measure('23',122);await h.form.disconnect();h.frames(123)
 assert.equal(h.form.current.value.grossWeight,122);assert.equal(h.storage.get('pda_weigh_trace_v1_u1').count,2833)
})
test('回瓶起吊中途稳定后继续上升，再卸瓶时提交最终悬重',async t=>{const h=harness(t,{returnMode:true});await h.measure('23',125);h.frames(148);h.frames(125);await h.form.submit();assert.equal(h.requests[0].payload.gross_weight,148)})
