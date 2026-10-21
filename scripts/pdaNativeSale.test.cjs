const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')

function load(file, names, globals = {}) {
	const source = fs.readFileSync(file, 'utf8').replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '').replace(/^export /gm, '')
	return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, { Date, Math, console, ...globals })
}
const shared = load('src/services/pda/shared.js', ['normalizeText', 'normalizeBottleNo', 'toNumber', 'todayDate', 'buildDepositPreviewRows'])
const draft = load('src/services/pda/mobileSaleDraft.js', ['createMobileSaleDraftStore', 'createMobileSaleId', 'cloneMobileSale', 'mobileSaleReceipt', 'canReleaseMobileSubmission'])
const pricing = load('src/services/pda/customer.js', ['resolvePdaCustomerPricing'], shared)
const location = load('src/services/pda/location.js', ['normalizePdaScanLocation'], shared)
const core = load('src/services/pda/bleScaleCore.js', ['createEmptyPdaBleScaleSnapshot', 'quantizeBleScaleWeightKg', 'PDA_BLE_SCALE_DISPLAY_DECIMALS', 'PDA_BLE_SCALE_DIVISION_STEP_KG'], shared)
const auto = load('src/services/pda/autoReturnWeight.js', ['createAutoReweighWeight'])
const settlement = load('src/services/models/settlement.js', ['normalizePaymentMethod', 'normalizePaymentStatus', 'normalizeSettlementMode'])
const model = load('src/services/models/sale.js', ['normalizeSaleDraft'], settlement)
const sales = load('src/services/pda/sale.js', ['createPdaBottleSaleForm', 'createPdaOutItem', 'createPdaBackItem', 'applyBottleToSaleRow', 'syncPdaBackRow', 'validatePdaBottleSaleForm', 'buildMobileSalePayload'], { ...shared, ...draft, ...pricing, ...location, ...model })
const customer = { _id: 'customer', name: '测试客户', default_price_unit: 'kg', default_unit_price: 8, is_active: true }
const bottle = no => ({ _id: `b${no}`, bottle_no: String(no), tare_weight: 100, is_active: true })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { resolve, promise } }

async function harness(t, options = {}) {
	let now = 10000, owner = 'worker', onSnapshot, frameListener, scanner, session = 0, connected = false
	const storage = options.storage || new Map(), requests = [], confirmations = []
	const runtime = {
		...shared, ...draft, ...pricing, ...location, ...core, ...auto, ...sales,
		ref: vue.ref, computed: vue.computed, watch: vue.watch, onBeforeUnmount() {},
		Date: class extends Date { static now() { return now } },
		getUser: () => ({ _id: owner }), canPageAction: () => true,
		uni: {
			getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
			showActionSheet: ({ success }) => success({ tapIndex: 0 }),
			showModal: ({ title, success }) => { confirmations.push(title); success({ confirm: options.confirm !== false }) }
		},
		getPdaCustomerById: async () => ({ code: 0, data: customer }),
		resolvePdaCustomerByQrCode: async () => ({ code: 0, data: customer }),
		listPdaCustomers: async () => ({ code: 0, data: [customer] }),
		findPdaBottleByNo: options.findBottle || (async no => ({ code: 0, data: bottle(no) })),
		resolvePdaBottleByQrCode: options.resolveQr || (async no => ({ code: 0, data: bottle(no) })),
		previewPdaDepositRows: async () => ({ code: 0, data: { depositRows: [], baseCount: 0, raw: '' } }),
		getPdaBottleScanLocation: async () => ({ status: 'failed' }),
		createMobileSale: async (id, payload) => { requests.push({ id, payload }); return options.send ? options.send(id, payload) : { code: 0, data: { operation_id: id, source_saved: true, processing_state: 'completed', sale_id: 's1' } } },
		getMobileSaleCreateResult: options.query || (async id => ({ code: 0, data: { operation_id: id, source_saved: true, processing_state: 'completed', sale_id: 's1' } })),
		ensurePdaBleRuntimePermission: async () => ({ code: 0 }),
		enterBarcodeSession: async ({ onResult }) => { scanner = onResult; return { code: 0 } }, leaveBarcodeSession: async () => {},
		createPdaBleScaleSession: ({ onWeightFrame }) => {
			frameListener = onWeightFrame
			return {
				onSnapshot: callback => { onSnapshot = callback; callback(core.createEmptyPdaBleScaleSnapshot()); return () => {} },
				beginMeasurement: () => { session++; emit(); return `session${session}` },
				discoverDevices: async () => ({ code: 0, data: [{ deviceId: 'scale1', name: 'NVK' }] }), updateProfile() {},
				connect: async () => { connected = true; emit(); return { code: 0 } },
				stop: async () => { if (options.stop) await options.stop(); connected = false; emit() }
			}
		}
	}
	function emit() { onSnapshot({ ...core.createEmptyPdaBleScaleSnapshot(), is_connected: connected, session_id: `session${session}` }) }
	runtime.createAutoReweighWeight = load('src/services/pda/autoReturnWeight.js', ['createAutoReweighWeight'], { Date: runtime.Date }).createAutoReweighWeight
	Object.assign(runtime, load('src/composables/pda/usePdaSaleForm.js', ['usePdaSaleForm'], runtime))
	const module = load('src/composables/pda/usePdaNativeSale.js', ['usePdaNativeSale', 'isNativeSaleRowWeighed'], runtime)
	const scope = vue.effectScope()
	const panel = scope.run(() => module.usePdaNativeSale())
	t.after(() => scope.stop())
	await panel.activate()
	async function start(step = 2) { panel.selectCustomer(customer); await panel.go(2); if (step === 3) await panel.go(3); await panel.connect() }
	function frames(weight, duration = 3200, oldSession) {
		for (let elapsed = 0; elapsed <= duration; elapsed += 100) {
			now += 100
			frameListener({ sampled_at: now, display_kg: weight, session_id: oldSession || `session${session}`, device_id: 'scale1' })
		}
	}
	return { panel, start, frames, storage, requests, confirmations, scan: value => scanner({ rawText: value }), setOwner: value => { owner = value }, session: () => `session${session}` }
}

test('PDA continuous weighing waits through swing, corrects current weight and freezes previous bottle', async t => {
	const h = await harness(t); await h.start(); await h.scan('101')
	h.frames(4); assert.equal(h.panel.current.value.gross, '')
	h.frames(120, 1000); h.frames(121, 1000); assert.equal(h.panel.current.value.gross, '')
	h.frames(120.5); assert.equal(h.panel.current.value.gross, '120.5')
	h.frames(120); assert.equal(h.panel.current.value.gross, '120.0')
	h.frames(4); assert.equal(h.panel.current.value.gross, '120.0')
	const previousSession = h.session()
	await h.scan('102'); h.frames(180, 3200, previousSession)
	assert.equal(h.panel.outRows.value[0].gross, '120.0'); assert.equal(h.panel.current.value.gross, '')
	h.frames(130); assert.equal(h.panel.current.value.gross, '130.0')
	assert.equal(h.panel.outRows.value.length, 2); assert.equal(h.confirmations.length, 0)
	await h.scan('101'); h.frames(140)
	assert.equal(h.panel.outRows.value.length, 2); assert.equal(h.panel.current.value.gross, '120.0')
})

test('unfinished bottle blocks next scan and forward step without dropping content; explicit deletion confirms', async t => {
	const h = await harness(t); await h.start(); await h.scan('101'); await h.scan('102')
	assert.equal(h.panel.outRows.value.length, 1); assert.equal(await h.panel.go(3), false)
	await h.panel.remove(h.panel.current.value)
	assert.equal(h.confirmations.length, 1); assert.equal(h.panel.outRows.value.length, 0)
	assert.equal(await h.panel.go(3), true); assert.equal(await h.panel.go(4), false)
})

test('rescanning the current weighed bottle keeps automatic small corrections active', async t => {
	const h = await harness(t); await h.start(); await h.scan('101'); h.frames(120)
	await h.scan('101'); h.frames(120.5)
	assert.equal(h.panel.current.value.gross, '120.5'); assert.equal(h.panel.outRows.value.length, 1)
})

test('manual disconnect blocks connect until stopping finishes', async t => {
	const stopped = deferred(); const h = await harness(t, { stop: () => stopped.promise }); await h.start()
	const stopping = h.panel.disconnect()
	assert.equal(h.panel.busy.value, true); assert.equal(await h.panel.connect(), false)
	stopped.resolve(); await stopping
	assert.equal(h.panel.busy.value, false); assert.equal(await h.panel.connect(), true)
})

test('multiple changed tares can be reweighed one by one after submission revalidation', async t => {
	let tare = 100
	const h = await harness(t, { findBottle: async no => ({ code: 0, data: { ...bottle(no), tare_weight: tare } }) }); await h.start()
	await h.scan('101'); h.frames(120); await h.scan('102'); h.frames(130)
	await h.panel.go(3); await h.panel.go(4)
	tare = 101; await h.panel.save(); assert.ok(h.panel.changes.value.length)
	h.panel.applyChanges()
	const [first, second] = h.panel.outRows.value
	assert.equal(first.gross, ''); assert.equal(second.gross, '')
	assert.equal(await h.panel.reweigh(first), true)
	assert.equal(await h.panel.reweigh(second), false)
	h.frames(120); assert.equal(await h.panel.reweigh(second), true); h.frames(130)
	assert.equal(h.panel.outRows.value[0].net, '19.0'); assert.equal(h.panel.outRows.value[1].net, '29.0')
	await h.panel.go(3); await h.panel.go(4); await h.panel.save()
	assert.equal(h.requests.length, 1); assert.equal(h.panel.sale.receipt.value.status, 'saved')
})

for (const mode of ['out', 'back', 'both']) test(`${mode}: preserves existing sale payload and preview, one-side skip and single submission`, async t => {
	const h = await harness(t); await h.start()
	if (mode !== 'back') { await h.scan('101'); h.frames(120) }
	await h.panel.go(3)
	if (mode !== 'out') { await h.scan('102'); h.frames(99.5) }
	assert.equal(await h.panel.go(4), true)
	await Promise.all([h.panel.save(), h.panel.save()])
	assert.equal(h.requests.length, 1)
	assert.equal(h.panel.sale.receipt.value.status, 'saved')
	assert.equal(h.requests[0].payload.outRows.length, mode === 'back' ? 0 : 1)
	assert.equal(h.requests[0].payload.backRows.length, mode === 'out' ? 0 : 1)
})

test('disconnect, hide and account switch reject further frames while preserving recorded weights', async t => {
	const h = await harness(t); await h.start(); await h.scan('101'); h.frames(120)
	await h.panel.disconnect(); h.frames(121); assert.equal(h.panel.current.value.gross, '120.0')
	await h.panel.connect(); await h.panel.reweigh(h.panel.current.value); h.frames(122)
	h.setOwner('another'); h.frames(123); assert.equal(h.panel.current.value.gross, '122.0')
	h.setOwner('worker'); await h.panel.deactivate(); h.frames(124); assert.equal(h.panel.current.value.gross, '122.0')
})

test('late lookup after hide cannot append a bottle or start weighing', async t => {
	const lookup = deferred(); const h = await harness(t, { resolveQr: () => lookup.promise }); await h.start()
	const pending = h.scan('101'); await h.panel.deactivate(); lookup.resolve({ code: 0, data: bottle('101') }); await pending
	assert.equal(h.panel.outRows.value.length, 0)
})

test('PDA drafts restore return step and weights; legacy preview stays preview and frozen receipt survives', async t => {
	const h = await harness(t); await h.start(); await h.scan('101'); h.frames(120); await h.panel.go(3)
	await h.panel.deactivate()
	const restored = await harness(t, { storage: h.storage }); restored.panel.restore()
	assert.equal(restored.panel.step.value, 3); assert.equal(restored.panel.outRows.value[0].gross, '120.0')
	const key = [...h.storage.keys()].find(key => key.startsWith('crm_mobile_sale_draft'))
	const legacy = JSON.parse(h.storage.get(key)); delete legacy.pdaStep; legacy.step = 3
	legacy.submission = { operationId: 'original', payload: { outItems: ['original'] }, attempted: true }; legacy.receipt = null
	h.storage.set(key, JSON.stringify(legacy))
	const frozen = await harness(t, { storage: h.storage }); frozen.panel.restore()
	assert.equal(frozen.panel.step.value, 4); assert.equal(frozen.panel.locked.value, true)
	await frozen.panel.query(); assert.equal(frozen.panel.sale.receipt.value.status, 'saved')
})

test('unknown submission stays frozen and retries the original operation and payload', async t => {
	const h = await harness(t, { send: async () => { throw new Error('timeout') } }); await h.start()
	await h.scan('101'); h.frames(120); await h.panel.go(3); await h.panel.go(4); await h.panel.save()
	assert.equal(h.panel.sale.receipt.value.status, 'unknown'); assert.equal(h.panel.nextSale(), false)
	await h.panel.save(true)
	assert.equal(h.requests.length, 2); assert.equal(h.requests[0].id, h.requests[1].id)
	assert.deepEqual(h.requests[0].payload, h.requests[1].payload)
})
