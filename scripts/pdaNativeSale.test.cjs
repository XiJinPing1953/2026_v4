const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')

function load(file, names, globals = {}) {
	const source = fs.readFileSync(file, 'utf8').replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '').replace(/^export /gm, '')
	return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, { Date, Math, console, setTimeout, clearTimeout, ...globals })
}
const feedback = load('src/services/pda/driverSaleFeedback.js', ['driverSaleWarning', 'driverReceiptSummary', 'driverSaleFeedback'])
const display = load('src/services/pda/weighStatus.js', ['sameWeighDisplay'])
const shared = load('src/services/pda/shared.js', ['normalizeText', 'normalizeBottleNo', 'toNumber', 'todayDate', 'buildDepositPreviewRows'])
const draft = load('src/services/pda/mobileSaleDraft.js', ['createMobileSaleDraftStore', 'createMobileSaleId', 'cloneMobileSale', 'mobileSaleReceipt', 'canReleaseMobileSubmission'])
const pricing = load('src/services/pda/customer.js', ['resolvePdaCustomerPricing'], shared)
const location = load('src/services/pda/location.js', ['normalizePdaScanLocation'], shared)
const core = load('src/services/pda/bleScaleCore.js', ['createEmptyPdaBleScaleSnapshot', 'quantizeBleScaleWeightKg', 'PDA_BLE_SCALE_DISPLAY_DECIMALS', 'PDA_BLE_SCALE_DIVISION_STEP_KG'], shared)
const auto = load('src/services/pda/autoReturnWeight.js', ['createAutoReweighWeight'])
const settlement = load('src/services/models/settlement.js', ['normalizePaymentMethod', 'normalizePaymentStatus', 'normalizeSettlementMode'])
const model = load('src/services/models/sale.js', ['normalizeSaleDraft'], settlement)
const sales = load('src/services/pda/sale.js', ['createPdaBottleSaleForm', 'createPdaOutItem', 'createPdaBackItem', 'applyBottleToSaleRow', 'syncPdaBackRow', 'validatePdaBottleSaleForm', 'buildMobileSalePayload'], { ...display, ...shared, ...draft, ...pricing, ...location, ...model })
const labelParsing = load('src/services/pda/fillingLabel.js', ['parseFillingLabel'])
const customer = { _id: 'customer', name: '测试客户', default_price_unit: 'kg', default_unit_price: 8, is_active: true }
const bottle = no => ({ _id: `b${no}`, bottle_no: String(no), tare_weight: 100, is_active: true })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { resolve, promise } }

async function harness(t, options = {}) {
	let now = 10000, owner = 'worker', onSnapshot, frameListener, scanner, session = 0, connected = false
	const storage = options.storage || new Map(), requests = [], confirmations = []
	const runtime = {
		...feedback, ...display, ...shared, ...draft, ...pricing, ...location, ...core, ...auto, ...sales, ...labelParsing,
  resolveFillingLabel: options.resolveLabel || (async () => ({ code:409, msg:'标签已失效' })),
		ref: vue.ref, computed: vue.computed, watch: vue.watch, onBeforeUnmount() {},
		Date: class extends Date { static now() { return now } },
		syncCurrentUser: options.syncCurrentUser || (async () => ({ code: 0 })),
		getUser: () => ({ _id: owner, role: options.role || 'superadmin', mobile_sale_defaults: options.defaults }), canPageAction: () => true,
		uni: {
			getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
			showActionSheet: options.pick || (({ success }) => success({ tapIndex: 0 })),
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
		ensurePdaBleRuntimePermission: options.permission || (async () => ({ code: 0 })),
		enterBarcodeSession: async ({ onResult }) => { scanner = onResult; return { code: 0 } }, leaveBarcodeSession: async () => {},
		createPdaBleScaleSession: ({ onWeightFrame, preserveMeasurementOnReadTimeout }) => {
			assert.equal(preserveMeasurementOnReadTimeout, true)
			frameListener = onWeightFrame
			return {
				onSnapshot: callback => { onSnapshot = callback; callback(core.createEmptyPdaBleScaleSnapshot()); return () => {} },
				beginMeasurement: () => { session++; emit(); return `session${session}` },
				discoverDevices: async () => ({ code: 0, data: options.devices || [{ deviceId: 'scale1', name: 'NVK' }] }), updateProfile() {},
				connect: async ({ preferredDeviceId }) => { if (options.rejectDevice?.(preferredDeviceId)) return { code: 500 }; connected = true; emit(); return { code: 0 } },
				stop: async () => { if (options.stop) await options.stop(); connected = false; emit() }
			}
		}
	}
	function emit() { onSnapshot({ ...core.createEmptyPdaBleScaleSnapshot(), is_connected: connected, session_id: `session${session}` }) }
	runtime.usePdaSalePrinter = () => ({ busy: vue.ref(false), arm() {}, confirmed() {}, close() {}, resume() {} })
	const printNative = require('./lib/receiptPrinterHarness.cjs').receiptPrinterHarness(), printReads = []
	if (options.printing) {
		const receiptApi = load('src/services/pda/receiptPrinter.js', ['writeReceiptText', 'RECEIPT_TAIL_DOTS'])
		Object.assign(runtime, load('src/services/pda/salePrint.js', ['salePrintPages', 'writeSalePage'], { ...shared, ...receiptApi, ...load('src/services/pda/printBusinessTime.js', ['formatFillingPrintTime']) }))
		Object.assign(runtime, {
			onAuthIdentityChange: () => () => {}, plus: { android: printNative.android }, setInterval: () => 0, clearInterval() {},
			selectPairedPrinter: async () => ({ name: 'HL30-AA20', address: printNative.address }), rememberPrinter() {},
			createLabelPrinterSession: (_, callback) => ({ connected: true, close() {}, connect() { callback({ connected: true }) }, async sendDocument(writer) { writer({}); await options.afterPrint?.() } }),
			getPdaSale: async id => {
				printReads.push(id); assert.equal(requests.length, 1)
				const p = requests[0].payload, out = p.outRows, back = p.backRows
				const net = out.reduce((n, r) => n + Number(r.net), 0) - back.reduce((n, r) => n + Number(r.net), 0)
				return { code: 0, data: { _id: id, biz_mode: 'bottle', price_unit: 'kg', customer_name: customer.name, unit_price: 8, total_net_weight: net, should_receive: net * 8, out_items: out, back_items: back, deposit_rows: p.depositRows } }
			}
		})
		runtime.uni.requireNativePlugin = () => ({})
		Object.assign(runtime, load('src/composables/pda/usePdaSalePrinter.js', ['usePdaSalePrinter'], runtime))
	}
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
	return { printNative, printReads, pause: ms => { now += ms; onSnapshot({ ...core.createEmptyPdaBleScaleSnapshot(), is_connected: connected, session_id: `session${session}`, error_code: 'read_timeout' }) }, panel, start, frames, storage, requests, confirmations, scan: value => scanner({ rawText: value }), setOwner: value => { owner = value }, session: () => `session${session}` }
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
	const frozen = await harness(t, { storage: h.storage }); assert.equal(frozen.panel.sale.draftStatus.value.available, false)
	assert.equal(frozen.panel.step.value, 4); assert.equal(frozen.panel.locked.value, true)
	await frozen.panel.query(); assert.equal(frozen.panel.sale.receipt.value.status, 'saved')
})

test('unknown submission stays frozen and retries the original operation and payload', async t => {
	const h = await harness(t, { send: async () => { throw new Error('timeout') } }); await h.start()
	await h.scan('101'); h.frames(120); await h.panel.go(3); await h.panel.go(4); await h.panel.save()
	assert.equal(h.panel.sale.receipt.value.status, 'unknown'); assert.equal(await h.panel.nextSale(), false)
	await h.panel.save(true)
	assert.equal(h.requests.length, 2); assert.equal(h.requests[0].id, h.requests[1].id)
	assert.deepEqual(h.requests[0].payload, h.requests[1].payload)
})

test('low out weight and a fifteen-minute data silence recover without another scan; unloading does not replace weight', async t => {
 const h = await harness(t); await h.start(); await h.scan('101'); h.frames(90)
 assert.equal(h.panel.current.value.gross, '')
 assert.match(h.panel.error.value, /重量偏小/)
 h.pause(15 * 60 * 1000); h.frames(120, 1000)
 assert.equal(h.panel.current.value.gross, '')
 h.frames(120, 2200)
 assert.equal(h.panel.current.value.gross, '120.0'); assert.equal(h.panel.error.value, '')
 h.pause(4000); h.frames(4)
 assert.equal(h.panel.current.value.gross, '120.0')
 h.frames(119.5)
 assert.equal(h.panel.current.value.gross, '119.5')
 assert.equal(h.confirmations.length, 0)
})

test('large sale keeps every row and raw scale updates do not rewrite the draft', async t => {
 const storage = new Map(); let writes = 0
 const originalSet = storage.set.bind(storage); storage.set = (key, value) => { writes++; return originalSet(key, value) }
 const h = await harness(t, { storage }); await h.start()
 for (let i=1; i<=100; i++) { await h.scan(String(i)); h.frames(120) }
 assert.equal(h.panel.outRows.value.length, 100)
 const before = writes; h.frames(120, 10000)
 assert.equal(writes, before)
 assert.equal(h.panel.outRows.value.every(row => row.gross === '120.0'), true)
})

const labelUrl = `https://env-00jxuffegf2n-static.normal.cloudstatic.cn/#/pages/public/filling-label?t=${'a'.repeat(48)}&c=${encodeURIComponent('新拓能源')}&b=90&p=100.0&g=185.5&n=85.5`
test('verified filling QR fills out row without scale and duplicate does not overwrite; back still weighs', async t => {
 const h = await harness(t, { resolveQr:async()=>({code:0,data:bottle('90')}), resolveLabel:async()=>({code:0,data:{bottle_no:'90',tare_weight:100,gross_weight:185.5,net_weight:85.5,label_token:'a'.repeat(48)}}) })
 h.panel.selectCustomer(customer); await h.panel.go(2)
 assert.equal(await h.scan(labelUrl),true)
 assert.equal(h.panel.outRows.value.length,1);assert.equal(h.panel.outRows.value[0].weightSource,'filling_reweigh');assert.equal(h.panel.outRows.value[0].gross,'185.5')
 await h.scan(labelUrl);assert.equal(h.panel.outRows.value.length,1)
 const payload=sales.buildMobileSalePayload(h.panel.sale.form.value);assert.equal(payload.outRows[0].filling_label_token,'a'.repeat(48));assert.equal('scale_session_id' in payload.outRows[0],false);assert.equal('scale_stable_seq' in payload.outRows[0],false)
 await h.panel.go(3);assert.equal(await h.scan(labelUrl),false);assert.match(h.panel.error.value,/连接吊秤/)
})
test('invalid or late filling QR verification cannot add a bottle',async t=>{
 const pending=deferred();const h=await harness(t,{resolveLabel:()=>pending.promise})
 h.panel.selectCustomer(customer);await h.panel.go(2);const scan=h.scan(labelUrl)
 await h.panel.deactivate();pending.resolve({code:0,data:{bottle_no:'90',tare_weight:100,gross_weight:185.5,net_weight:85.5}});await scan
 assert.equal(h.panel.outRows.value.length,0)
})

test('preview save submits once then sends two signed copies; next sale waits for both sends', async t => {
	const hold = deferred(), h = await harness(t, { printing: true, afterPrint: () => hold.promise })
	await h.start(); await h.scan('101'); h.frames(120); await h.panel.go(3); await h.panel.go(4)
	await h.panel.printer.connect()
	await Promise.all([h.panel.save(), h.panel.save()])
	assert.equal(h.requests.length, 1); assert.equal(h.panel.sale.receipt.value.status, 'saved')
	assert.deepEqual(h.printReads, ['s1']); assert.equal(h.printNative.sends.length, 1)
	assert.equal(await h.panel.nextSale(), false); assert.equal(await h.panel.save(), false)
	hold.resolve(); await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.printNative.sends.length, 2)
	const texts = h.printNative.operations.filter(row => row[0] === 'addText').map(row => row[1])
	assert.equal(texts.filter(s => s === '留底联').length, 1); assert.equal(texts.filter(s => s === '客户联').length, 1)
	assert.equal(texts.filter(s => s.startsWith('客户签名:')).length, 2)
	assert.equal(h.panel.printer.busy.value, false); assert.equal(await h.panel.nextSale(), true)
})

test('preview with unknown save result sends no copy until the original operation is confirmed', async t => {
	const h = await harness(t, { printing: true, send: async () => { throw Error('timeout') } })
	await h.start(); await h.scan('101'); h.frames(120); await h.panel.go(3); await h.panel.go(4); await h.panel.printer.connect()
	await h.panel.save(); assert.equal(h.panel.sale.receipt.value.status, 'unknown'); assert.equal(h.printNative.sends.length, 0)
	await h.panel.query(); await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.requests.length, 1); assert.equal(h.printNative.sends.length, 2)
	await h.panel.query(); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.printNative.sends.length, 2)
})

test('permission timeout releases the sale page and a late grant cannot complete the retry', async t => {
	const pending = [], timers = new Map()
	const permissionSource = fs.readFileSync('src/services/pda/bleScale.js', 'utf8')
		.split('function runOnAppPlusAndroid')[1].replace(/^export /gm, '')
	const permission = vm.runInNewContext('function runOnAppPlusAndroid' + permissionSource + '\n;ensurePdaBleRuntimePermission', {
		plus: { os: { name: 'Android' }, android: {
			importClass: () => ({ VERSION: { SDK_INT: 31 } }),
			requestPermissions: (_, success) => pending.push(success)
		} },
		setTimeout: (fn, ms) => { assert.equal(ms, 15000); timers.set(fn, fn); return fn },
		clearTimeout: id => timers.delete(id)
	})
	const h = await harness(t, { permission })
	const first = h.panel.connect()
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.panel.busy.value, true)
	const expire = [...timers.values()][0]
	timers.delete(expire)
	expire()
	assert.equal(await first, false)
	assert.match(h.panel.error.value, /权限请求超时/)
	assert.equal(h.panel.busy.value, false)
	const retry = h.panel.connect()
	await new Promise(resolve => setImmediate(resolve))
	pending[0]({})
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.panel.busy.value, true)
	pending[1]({})
	assert.equal(await retry, true)
	assert.equal(timers.size, 0)
})

test('same-name scales distinguish addresses and mark only the last successful selection', async t => {
	const devices = ['01:02:03:04:75:28','01:02:03:04:74:67'].map(deviceId => ({ deviceId, name:'NVK-K02' }))
	const storage = new Map([['pda_ble_scale_bound_device_v1', devices[0]]])
	const lists = []
	let reject = true
	const h = await harness(t, { storage, devices, rejectDevice: id => reject && id === devices[1].deviceId,
		pick: ({itemList, success}) => { lists.push(Array.from(itemList)); success({tapIndex:1}) } })
	assert.equal(await h.panel.connect(true), false)
	reject = false
	assert.equal(await h.panel.connect(true), true)
	assert.equal(await h.panel.connect(true), true)
	assert.deepEqual(lists[0], ['上次 · NVK-K02 (047528)', 'NVK-K02 (047467)'])
	assert.deepEqual(lists[1], lists[0])
	assert.deepEqual(lists[2], ['NVK-K02 (047528)', '上次 · NVK-K02 (047467)'])
	assert.equal(storage.get('pda_ble_scale_bound_device_v1').deviceId, devices[1].deviceId)
})

test('returning before permission resolves can reconnect immediately without an old callback unlocking the new request', async t => {
 const old = deferred(), fresh = deferred()
 let requests = 0
 const h = await harness(t, { permission: () => (++requests === 1 ? old : fresh).promise })
 const first = h.panel.connect(true)
 await new Promise(resolve => setImmediate(resolve))
 await h.panel.deactivate()
 await h.panel.activate()
 assert.equal(h.panel.busy.value, false)
 const next = h.panel.connect(true)
 await new Promise(resolve => setImmediate(resolve))
 assert.equal(requests, 2)
 old.resolve({code:0})
 assert.equal(await first, false)
 assert.equal(h.panel.busy.value, true)
 assert.equal(h.storage.has('pda_ble_scale_bound_device_v1'), false)
 fresh.resolve({code:0})
 assert.equal(await next, true)
 assert.equal(h.panel.busy.value, false)
})

test('legacy blank vehicle form opens directly, changed crew survives, and saved receipts open without another submission', async t => {
	const defaults = { vehicle_no: 'TEST-01', delivery1: '原司机', delivery2: '搭档' }
	const h = await harness(t, { defaults })
	const sale = h.panel.sale
	await h.panel.deactivate()
	const key = 'crm_mobile_sale_draft_v1:worker'
	assert.equal(h.storage.has(key), false)
	const legacy = { version: 1, ownerId: 'worker', draftId: 'legacy', form: sale.form.value }
	h.storage.set(key, JSON.stringify(legacy))
	const blank = await harness(t, { storage: h.storage, defaults })
	assert.equal(blank.panel.sale.draftStatus.value.available, false)
	assert.equal(h.storage.has(key), false)
	blank.panel.sale.form.value.delivery1 = '替班司机'
	await blank.panel.deactivate()
	const changed = await harness(t, { storage: h.storage, defaults })
	assert.equal(changed.panel.sale.draftStatus.value.available, true)
	changed.panel.restore()
	assert.equal(changed.panel.sale.form.value.delivery1, '替班司机')
	await changed.panel.deactivate()
	const receipt = { status: 'pending', sourceSaved: true, operationId: 'original', saleId: 's1', warnings: ['crm-reg-bridge enqueueEventV1 timeout'] }
	h.storage.set(key, JSON.stringify({ ...legacy, submission: { operationId: 'original' }, receipt }))
	const saved = await harness(t, { storage: h.storage, defaults })
	assert.equal(saved.panel.sale.draftStatus.value.available, false)
	assert.equal(saved.panel.sale.receipt.value.saleId, 's1')
	assert.equal(saved.requests.length, 0)
	assert.equal(await saved.panel.nextSale(), true)
	assert.equal(h.storage.has(key), false)
})

test('driver receipt guidance distinguishes a saved sale from an unknown result and keeps bottle-specific instructions', () => {
	const raw = '监管处理：crm-reg-bridge enqueueEventV1 timeout'
	assert.equal(feedback.driverSaleWarning(raw, ''), '')
	assert.equal(feedback.driverSaleWarning({ message: raw }, ''), '')
	assert.equal(feedback.driverSaleWarning({ bottle_no: 'A12', message: '请核对钢瓶归属' }, ''), 'A12 号瓶 · 请核对钢瓶归属')
	assert.match(feedback.driverReceiptSummary({ status: 'pending', sourceSaved: true, message: raw }), /开下一单/)
	assert.match(feedback.driverReceiptSummary({ status: 'unknown', sourceSaved: null, message: raw }), /先查询原单/)
	assert.match(feedback.driverReceiptSummary({ status: 'failed', sourceSaved: false, message: raw }), /未保存/)
})

test('the native receipt renders the next action for saved, unknown and rejected orders', async () => {
	const { parse } = require('@vue/compiler-sfc')
	const { compile, baseParse } = require('@vue/compiler-dom')
	const { renderToString } = require('vue/server-renderer')
	const source = fs.readFileSync('src/components/domain/pda/PdaNativeSaleView.vue', 'utf8')
	const template = parse(source).descriptor.template.content
	const receiptNode = baseParse(template).children[0].children.find(node =>
		node.props?.some(prop => prop.name === 'if' && prop.exp?.content === 'receipt'))
	const { code } = compile(receiptNode.loc.source, { prefixIdentifiers: true, isCustomElement: tag => ['view', 'text'].includes(tag) })
	const render = new Function('Vue', code)(vue)
	const raw = '关联处理：crm-reg-bridge enqueueEventV1 timeout'
	async function screen(sourceSaved, status) {
		const receipt = { status, sourceSaved, saleId: sourceSaved ? 's1' : '', message: raw, warnings: [raw] }
		const page = vue.createSSRApp({
			render,
			setup: () => ({
				...feedback, receipt, receiptWarnings: receipt.warnings.map(w => feedback.driverSaleWarning(w, '')).filter(Boolean),
				printer: { busy: { value: false } }, submissionLocked: sourceSaved !== false, submitting: false,
				openNext() {}, query() {}, save() {}
			})
		})
		page.component('AppButton', { setup: (_, { slots }) => () => vue.h('button', slots.default?.()) })
		return renderToString(page)
	}
	const saved = await screen(true, 'pending')
	assert.match(saved, /销售单已保存/); assert.match(saved, /开下一单/); assert.match(saved, /补打两联/)
	assert.doesNotMatch(saved, /enqueueEvent|timeout|重试这单|放弃草稿/)
	const unknown = await screen(null, 'unknown')
	assert.match(unknown, /查询保存结果/); assert.match(unknown, /重试这单/)
	assert.doesNotMatch(unknown, /开下一单|补打两联|销售单已保存|enqueueEvent|timeout/)
	const rejected = await screen(false, 'failed')
	assert.match(rejected, /本单未保存/); assert.doesNotMatch(rejected, /开下一单|销售单已保存|enqueueEvent|timeout/)
})
