const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const vue = require('vue')

const moduleSource = fs.readFileSync(path.join(__dirname, '../src/services/pda/cameraScan.js'), 'utf8')
const load = () => import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('a camera frame is accepted once; cancel or another target invalidates late lookup', async () => {
	const { createCameraScanSession } = await load()
	const session = createCameraScanSession()
	const first = session.begin({ rowId: 'out-1' })
	assert.equal(session.accept(first), true)
	assert.equal(session.accept(first), false)
	assert.equal(session.isCurrent(first), true)
	const second = session.begin({ rowId: 'back-1' })
	assert.equal(session.isCurrent(first), false)
	assert.equal(session.accept(first), false)
	assert.equal(session.accept(second), true)
	session.invalidate()
	assert.equal(session.isCurrent(second), false)
})

test('target follows its row through reorder and cannot fall through to a deleted index', async () => {
	const { findScanTargetIndex } = await load()
	assert.equal(findScanTargetIndex([{ rowId: 'b' }, { rowId: 'a' }], { rowId: 'a', index: 0 }), 1)
	assert.equal(findScanTargetIndex([{ rowId: 'b' }], { rowId: 'a', index: 0 }), -1)
	assert.equal(findScanTargetIndex([{}], { index: 0 }), -1)
})

test('capability detection uses actual APIs and secure context, never browser name', async () => {
	const { getMobileCaptureCapabilities } = await load()
	const navigator = { userAgent: 'unknown browser', mediaDevices: { getUserMedia() {} }, bluetooth: { requestDevice() {} } }
	assert.deepEqual(getMobileCaptureCapabilities({ isSecureContext: true, navigator }), { secure: true, camera: true, bluetooth: true })
	assert.deepEqual(getMobileCaptureCapabilities({ isSecureContext: false, navigator }), { secure: false, camera: false, bluetooth: false })
	assert.deepEqual(getMobileCaptureCapabilities({ isSecureContext: true, navigator: { userAgent: 'Chrome Bluefy' } }), { secure: true, camera: false, bluetooth: false })
})

test('camera stops before emitting first QR; repeated frames are ignored and close destroys it', async () => {
	const { createCameraScannerLifecycle } = await load()
	const events = []
	let instance
	class Scanner {
		constructor(video, callback, options) { instance = this; this.callback = callback; assert.equal(options.preferredCamera, 'environment') }
		async start() { events.push('start') }
		stop() { events.push('stop') }
		destroy() { events.push('destroy') }
	}
	const camera = createCameraScannerLifecycle({ loadScanner: async () => Scanner, onResult: (text) => events.push(text), onError: assert.fail })
	await camera.open({})
	instance.callback({ data: '  QR001  ' })
	instance.callback({ data: 'QR002' })
	assert.deepEqual(events, ['start', 'stop', 'QR001'])
	camera.close()
	assert.equal(events.at(-1), 'destroy')
})

test('close during decoder import never requests camera', async () => {
	const { createCameraScannerLifecycle } = await load()
	const pending = deferred()
	let constructed = 0
	const camera = createCameraScannerLifecycle({ loadScanner: () => pending.promise, onResult: assert.fail, onError: assert.fail })
	const opening = camera.open({})
	camera.close()
	pending.resolve(class { constructor() { constructed++ } })
	await opening
	assert.equal(constructed, 0)
})

test('close during camera permission awaits releases instance and suppresses late result', async () => {
	const { createCameraScannerLifecycle } = await load()
	const permission = deferred()
	let instance, destroyed = 0
	class Scanner {
		constructor(video, callback) { instance = this; this.callback = callback }
		start() { return permission.promise }
		stop() {}
		destroy() { destroyed++ }
	}
	const camera = createCameraScannerLifecycle({ loadScanner: async () => Scanner, onResult: assert.fail, onError: assert.fail })
	const opening = camera.open({})
	await Promise.resolve()
	camera.close()
	assert.ok(destroyed > 0)
	instance.callback({ data: 'LATE' })
	permission.resolve()
	await opening
	assert.ok(destroyed > 0)
})

test('permission denial destroys camera and exposes failure once; retry can scan', async () => {
	const { createCameraScannerLifecycle } = await load()
	let attempts = 0, errors = 0, destroyed = 0, instance, accepted = ''
	class Scanner {
		constructor(video, callback) { instance = this; this.callback = callback }
		async start() { if (++attempts === 1) throw new Error('NotAllowedError') }
		stop() {}
		destroy() { destroyed++ }
	}
	const camera = createCameraScannerLifecycle({ loadScanner: async () => Scanner, onResult: (text) => { accepted = text }, onError: () => errors++ })
	await camera.open({})
	assert.equal(errors, 1)
	assert.equal(destroyed, 1)
	await camera.open({})
	instance.callback({ data: 'RETRY' })
	assert.equal(accepted, 'RETRY')
	camera.close()
})

const saleViewSource = fs.readFileSync(path.join(__dirname, '../src/components/domain/pda/PdaSaleCreateView.vue'), 'utf8')
const saleScript = saleViewSource.split('<script setup>')[1].split('</script>')[0].replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '')
const valueRef = value => ({ value })
const usableWeightSource = fs.readFileSync(path.join(__dirname, '../src/composables/pda/usePdaSaleForm.js'), 'utf8')
	.replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '').replace(/export\s+(?=function)/g, '')
const { resolveUsableBleScaleWeight } = vm.runInNewContext(`${usableWeightSource}\n;({resolveUsableBleScaleWeight})`, {
	Date, Number,
	toNumber(value, fallback = null) { if (value === '' || value == null) return fallback; const number = Number(value); return Number.isFinite(number) ? number : fallback }
})

async function saleHarness(overrides = {}) {
	const camera = await load()
	const events = [], writes = [], requests = []
	const valueRef = overrides.reactive ? vue.ref : value => ({ value })
	const scope = vue.effectScope()
	let snapshotListener, sequence = 0
	const scale = {
		onSnapshot(fn) { snapshotListener = fn; return () => {} },
		beginMeasurement() { const id = `session-${++sequence}`; snapshotListener({ is_connected: true, session_id: id, stable_seq: 0 }); return id },
		stop() { events.push('stop-scale'); return { code: 0 } },
		connect: async () => ({ code: 0 }), updateProfile() {}
	}
	const form = valueRef({ customerId: 'customer-1', customerName: '客户', unitPrice: '10', outItems: [{ rowId: 'row-1', bottleNo: '' }, { rowId: 'row-2', bottleNo: '' }], backItems: [], depositRows: [], date: '2026-10-15' })
	const state = {
		form, selectedCustomer: valueRef({ _id: 'customer-1' }), customerKeyword: valueRef('客户'), draftStep: valueRef(2),
		resolvingBottleKey: valueRef(''), depositLoading: valueRef(false), depositDirty: valueRef(false), submitting: valueRef(false),
		draftStatus: valueRef({ available: false }), receipt: valueRef(null), submissionLocked: valueRef(false),
		applySelectedCustomer(customer) { form.value.customerId = customer._id },
		applyBottleSelection(type, index, bottle) { const list = type === 'back' ? form.value.backItems : form.value.outItems; writes.push(bottle.bottle_no); return list[index] = { ...list[index], bottleNo: bottle.bottle_no, tare: bottle.tare_weight } },
		attachBottleScanLocation() {}, applyDeliverySelection() {}, applyVehicleSelection() {}, markDepositDirty() {},
		hydrateSelectedCustomer() {}, searchCustomers: async () => ({ code: 0, data: [] }), setCustomerKeyword() {}, clearSelectedCustomer() {},
		addOutItem() { form.value.outItems.push({ rowId: 'new-row', bottleNo: '' }) }, addBackItem() {},
		removeOutItem(index) { form.value.outItems.splice(index, 1) }, removeBackItem() {}, normalizeOutBottle() {}, normalizeBackBottle() {},
		resolveBottle: async () => ({ code: 0 }),
		applyScaleWeightToRow(...args) { events.push('apply-weight'); return overrides.applyWeight ? overrides.applyWeight(...args) : { code: 0 } }, clearScaleWeightFromRow() {},
		refreshDepositRows: async () => ({ code: 0 }), restoreDraft() {}, discardDraft() {}, startNewSale() {}, querySubmission() {}, applyRevalidationChanges() {},
		persistDraft() { events.push('persist') }, invalidateAsyncWork() { events.push('invalidate') },
		submit: overrides.submit || (async (options) => { requests.push(options); return { code: 0 } })
	}
	const suggestions = () => ({ items: valueRef([]), loading: valueRef(false), visible: valueRef(false), handleInput() {}, handleFocus() {}, handleBlur() {}, handleSelect: value => value, clear() {} })
	const context = vm.createContext({
		...camera, Date, Math, Promise, Number, String, Map, Boolean, Array, JSON,
		ref: valueRef, computed: overrides.reactive ? vue.computed : getter => ({ get value() { return getter() } }),
		watch: overrides.reactive ? vue.watch : () => {}, onBeforeUnmount() {}, onMounted() {},
		defineProps: () => ({}), defineExpose() {}, usePdaSaleForm: () => state, usePdaSuggestions: suggestions,
		getPdaBleScaleCapabilities: () => ({ transport: 'web', supported: overrides.bleSupported !== false }),
		getMobileCaptureCapabilities: () => ({ secure: true, camera: true, bluetooth: true }),
		createEmptyPdaBleScaleSnapshot: () => ({ is_connected: overrides.connected !== false, stable_seq: 0, session_id: 'initial' }),
		createPdaBleScaleSession: () => scale, ensurePdaBleRuntimePermission: async () => ({ code: 0 }),
		PDA_BLE_SCALE_DISPLAY_DECIMALS: 1, PDA_BLE_SCALE_DIVISION_STEP_KG: 0.5,
		resolveUsableBleScaleWeight: overrides.reactive ? resolveUsableBleScaleWeight : value => ({ hasCurrentStableWeight: value.is_stable, hasFreshCachedStableWeight: false }),
		PDA_CAPTURE_TARGETS: { SALE_CUSTOMER: 'customer', SALE_DELIVERY_1: 'd1', SALE_DELIVERY_2: 'd2', SALE_VEHICLE_NO: 'vehicle', saleOutBottleNo: i => `out-${i}`, saleBackBottleNo: i => `back-${i}` },
		resolvePdaBottleByQrCode: overrides.resolveBottle || (async text => ({ code: 0, data: { bottle_no: text, tare_weight: 40 } })),
		resolvePdaCustomerByQrCode: overrides.resolveCustomer || (async () => ({ code: 0, data: { _id: 'next-customer', name: '新客户' } })),
		resolvePdaCustomerPricing: () => ({ ok: true }),
		getPdaBottleScanLocation: async () => ({ status: 'failed' }),
		validatePdaBottleSaleForm: () => ({ ok: true }), createPdaOutItem: () => ({ rowId: 'new-row' }),
		normalizeText: value => String(value || '').trim(), normalizeBottleNo: value => String(value || '').trim().toUpperCase(), normalizeQrCode: value => String(value || '').trim().toUpperCase(),
		formatWeight: String, formatMoney: String, formatDateTime: String, canPageAction: () => true,
		uni: { getStorageSync: () => '', showToast: options => events.push(options.title), showModal: options => options.success({ confirm: true }) }
	})
	scope.run(() => vm.runInContext(`${saleScript}\nglobalThis.panel = { form, currentStep, cameraOpen, cameraTarget, scaleSnapshot, pendingScaleApplyTarget, scaleErrorText, scaleStatusText, barcodeHint, startCamera, closeCamera, onCameraResult, onFocusHeaderTarget, onScanCustomer, onScanBottle, onSelectBottleSuggestion, onRemoveOutItem, onAddOutItem, deactivateBarcodeSession, markPendingScaleApply, tryApplyPendingScaleWeight, cancelPendingMeasurement, onSubmit, enterBottleStep };`, context))
	return { panel: context.panel, state, events, writes, requests, emitSnapshot: snapshot => snapshotListener(snapshot), stop: () => scope.stop() }
}

test('focusing customer only changes target; explicit scan button opens camera', async () => {
	const { panel } = await saleHarness()
	panel.currentStep.value = 1
	await panel.onFocusHeaderTarget('customer')
	assert.equal(panel.cameraOpen.value, false)
	await panel.onScanCustomer()
	assert.equal(panel.cameraOpen.value, true)
})

test('cancel or delete row during QR lookup prevents applying its late response', async () => {
	for (const action of ['closeCamera', 'onRemoveOutItem']) {
		const pending = deferred()
		const { panel, writes } = await saleHarness({ resolveBottle: () => pending.promise })
		await panel.onScanBottle('out', 0)
		const result = panel.onCameraResult('QR001')
		panel[action](0)
		pending.resolve({ code: 0, data: { bottle_no: 'B001', tare_weight: 40 } })
		await result
		assert.deepEqual(writes, [])
	}
})

test('hidden page cancels QR lookup, persists form, and disconnects hardware', async () => {
	const pending = deferred()
	const { panel, writes, events } = await saleHarness({ resolveBottle: () => pending.promise })
	await panel.onScanBottle('out', 0)
	const result = panel.onCameraResult('QR001')
	await panel.deactivateBarcodeSession('test-hide')
	pending.resolve({ code: 0, data: { bottle_no: 'B001', tare_weight: 40 } })
	await result
	assert.deepEqual(writes, [])
	assert.equal(panel.cameraOpen.value, false)
	assert.ok(events.includes('persist') && events.includes('invalidate') && events.includes('stop-scale'))
})

test('only current measurement session may fill a row; next row is blocked until explicit cancel', async () => {
	const { panel, events } = await saleHarness()
	panel.form.value.outItems[0].bottleNo = 'B001'
	panel.scaleSnapshot.value = { is_connected: true, stable_seq: 0, session_id: 'connected' }
	panel.markPendingScaleApply('out', 0, 'B001')
	assert.equal(panel.pendingScaleApplyTarget.value.rowId, 'row-1')
	await panel.onAddOutItem()
	assert.equal(panel.form.value.outItems.length, 2)
	panel.scaleSnapshot.value = { is_connected: true, is_stable: true, stable_seq: 1, session_id: 'old-session' }
	assert.equal(panel.tryApplyPendingScaleWeight().code, 409)
	assert.equal(events.includes('apply-weight'), false)
})

test('success response leaves submitted details visible; missing BLE blocks entering details', async () => {
	const { panel } = await saleHarness()
	panel.currentStep.value = 3
	const original = panel.form.value
	await panel.onSubmit()
	assert.equal(panel.currentStep.value, 3)
	assert.equal(panel.form.value, original)
	const unsupported = await saleHarness({ bleSupported: false })
	unsupported.panel.currentStep.value = 1
	unsupported.panel.enterBottleStep()
	assert.equal(unsupported.panel.currentStep.value, 1)
})

test('only explicitly confirmable flow warnings allow a confirmed resubmit', async () => {
	for (const confirmable of [true, false]) {
		const calls = []
		const { panel } = await saleHarness({ submit: async options => { calls.push(options); return calls.length === 1 ? { code: 409, data: { confirmable, warning_items: [{ reason: '请核对瓶号' }] } } : { code: 0 } } })
		await panel.onSubmit()
		assert.equal(calls.length, confirmable ? 2 : 1)
		if (confirmable) assert.equal(calls[1].confirmedWarnings, true)
	}
})

test('route hidden before nextTick cannot reactivate camera/scale session later', async () => {
	const source = fs.readFileSync(path.join(__dirname, '../src/pages/pda/sale-create.vue'), 'utf8')
	const script = source.split('<script setup>')[1].split('</script>')[0].replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '')
	const ticks = [], timers = []
	let activations = 0
	const context = vm.createContext({ ref: valueRef, nextTick: fn => ticks.push(fn), onLoad() {}, onShow() {}, onHide() {}, onUnload() {},
		setTimeout: fn => { timers.push(fn); return timers.length }, clearTimeout() {}, restoreScannerProfile() {} })
	vm.runInContext(`${script}\nglobalThis.page = { viewRef, activateSession, deactivateSession };`, context)
	context.page.viewRef.value = { activateBarcodeSession: () => activations++, deactivateBarcodeSession() {} }
	context.page.activateSession()
	await context.page.deactivateSession('hidden')
	ticks.forEach(fn => fn())
	timers.forEach(fn => fn())
	assert.equal(activations, 0)
})

test('bottle capture requires connection; manual selection begins its own measurement window', async () => {
	const { panel, writes } = await saleHarness({ connected: false })
	await panel.onScanBottle('out', 0)
	assert.equal(panel.cameraOpen.value, false)
	panel.onSelectBottleSuggestion('out', 0, { bottle_no: 'B001', tare_weight: 40 })
	assert.deepEqual(writes, [])
	panel.scaleSnapshot.value = { is_connected: true, session_id: 'connected', stable_seq: 0 }
	panel.onSelectBottleSuggestion('out', 0, { bottle_no: 'B001', tare_weight: 40 })
	assert.deepEqual(writes, ['B001'])
	assert.equal(panel.pendingScaleApplyTarget.value.rowId, 'row-1')
	assert.equal(panel.pendingScaleApplyTarget.value.sessionId, 'session-1')
})

function readySnapshot(panel, patch = {}) {
	const target = panel.pendingScaleApplyTarget.value
	return { is_connected: true, is_online: true, is_stable: true, stable_seq: 1,
		session_id: target?.sessionId, measurement_started_at: target?.createdAt,
		weight_kg: 150, sampled_at: Date.now(), ...patch }
}

async function weighingHarness(t, overrides = {}) {
	const h = await saleHarness({ reactive: true, ...overrides })
	t.after(h.stop)
	h.panel.onSelectBottleSuggestion('out', 0, { bottle_no: '113', tare_weight: 124 })
	await vue.nextTick()
	return h
}

test('auto fill uses the final notification snapshot and retries when readiness returns without a new stable sequence', async t => {
	const h = await weighingHarness(t)
	const stable = readySnapshot(h.panel)
	h.emitSnapshot(stable)
	h.emitSnapshot({ ...stable, is_stable: false, weight_kg: 151 })
	await vue.nextTick()
	assert.equal(h.events.filter(value => value === 'apply-weight').length, 0, 'intermediate stable frame must not be adopted')
	assert.ok(h.panel.pendingScaleApplyTarget.value)
	h.emitSnapshot({ ...stable, sampled_at: Date.now() })
	await vue.nextTick()
	assert.equal(h.events.filter(value => value === 'apply-weight').length, 1)
	assert.equal(h.panel.pendingScaleApplyTarget.value, null)
	h.emitSnapshot({ ...stable, sampled_at: Date.now() })
	await vue.nextTick()
	assert.equal(h.events.filter(value => value === 'apply-weight').length, 1, 'completed target must not be rewritten')
})

test('a stale or future stable sample never fills; a fresh sample with the same sequence can fill', async t => {
	const h = await weighingHarness(t)
	const stable = readySnapshot(h.panel)
	for (const sampled_at of [Date.now() - 3001, Date.now() + 1000]) {
		h.emitSnapshot({ ...stable, sampled_at })
		await vue.nextTick()
		assert.equal(h.events.includes('apply-weight'), false)
	}
	h.emitSnapshot({ ...stable, sampled_at: Date.now() })
	await vue.nextTick()
	assert.equal(h.events.filter(value => value === 'apply-weight').length, 1)
})

test('auto fill failure exposes the specific reason once and a later usable sample can retry successfully', async t => {
	let accepted = false
	const reason = '毛重减空瓶重后净重需大于 0，请核对瓶档和称重'
	const h = await weighingHarness(t, { applyWeight: () => accepted ? { code: 0, data: { netWeight: 26 } } : { code: 400, msg: reason } })
	const stable = readySnapshot(h.panel, { weight_kg: 100 })
	for (let i = 0; i < 3; i++) {
		h.emitSnapshot({ ...stable, sampled_at: Date.now() })
		await vue.nextTick()
	}
	assert.match(h.panel.scaleErrorText.value, /113.*净重需大于 0/)
	assert.equal(h.panel.scaleStatusText.value, '回填未完成')
	assert.equal(h.events.filter(value => value.includes(reason)).length, 1, 'same error must not toast on every sample')
	assert.ok(h.panel.pendingScaleApplyTarget.value)
	accepted = true
	h.emitSnapshot({ ...stable, weight_kg: 150, sampled_at: Date.now() })
	await vue.nextTick()
	assert.equal(h.panel.pendingScaleApplyTarget.value, null)
	assert.equal(h.panel.scaleErrorText.value, '')
	assert.match(h.panel.barcodeHint.value, /已完成称重回填/)
})

test('a thrown auto fill error remains visible and cancel clears it without changing another bottle', async t => {
	const h = await weighingHarness(t, { applyWeight() { throw new Error('回填异常') } })
	h.emitSnapshot(readySnapshot(h.panel))
	await vue.nextTick()
	assert.match(h.panel.scaleErrorText.value, /回填异常/)
	h.panel.cancelPendingMeasurement()
	await vue.nextTick()
	assert.equal(h.panel.scaleErrorText.value, '')
	assert.equal(h.panel.pendingScaleApplyTarget.value, null)
	assert.equal(h.panel.form.value.outItems[1].bottleNo, '')
})

test('pending auto fill still rejects old sessions, disconnected snapshots, changed rows and hidden pages', async t => {
	for (const change of ['session', 'disconnect', 'row', 'hidden']) {
		const h = await weighingHarness(t)
		const stable = readySnapshot(h.panel)
		if (change === 'session') stable.session_id = 'old-session'
		if (change === 'disconnect') stable.is_connected = false
		if (change === 'row') h.panel.form.value.outItems.splice(0, 1)
		if (change === 'hidden') await h.panel.deactivateBarcodeSession('hidden')
		h.emitSnapshot(stable)
		await vue.nextTick()
		assert.equal(h.events.includes('apply-weight'), false, change)
		assert.equal(h.panel.pendingScaleApplyTarget.value, null, change)
	}
})

test('an already weighed result is preserved and never retried or forced by subsequent snapshots', async t => {
	const calls = []
	const h = await weighingHarness(t, { applyWeight(...args) { calls.push(args); return { code: 208, msg: '该瓶已完成称重，如需覆盖请点击重新称重' } } })
	const stable = readySnapshot(h.panel)
	h.emitSnapshot(stable)
	await vue.nextTick()
	assert.equal(h.panel.pendingScaleApplyTarget.value, null)
	assert.match(h.panel.barcodeHint.value, /该瓶已完成称重/)
	h.emitSnapshot({ ...stable, sampled_at: Date.now() })
	await vue.nextTick()
	assert.equal(calls.length, 1)
	assert.equal(calls[0][3].force, undefined)
})
