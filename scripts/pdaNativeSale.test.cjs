const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')

function load(file, names, globals = {}) {
	const source = fs.readFileSync(file, 'utf8').replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '').replace(/^export /gm, '')
	return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, { Date, Math, console, setTimeout, clearTimeout, ...globals })
}
const feedback = load('src/services/pda/driverSaleFeedback.js', ['driverBottleCheck', 'driverReceiptWarnings', 'driverSaleWarning', 'driverReceiptSummary', 'driverSaleFeedback'])
const display = load('src/services/pda/weighStatus.js', ['sameWeighDisplay'])
const shared = load('src/services/pda/shared.js', ['normalizeText', 'normalizeBottleNo', 'toNumber', 'todayDate', 'buildDepositPreviewRows'])
const draft = load('src/services/pda/mobileSaleDraft.js', ['createMobileSaleDraftStore', 'createMobileSaleId', 'cloneMobileSale', 'mobileSaleReceipt', 'canReleaseMobileSubmission'])
const pricing = load('src/services/pda/customer.js', ['resolvePdaCustomerPricing'], shared)
const location = load('src/services/pda/location.js', [
	'PDA_SCAN_LOCATION_COORDINATE_TYPE',
	'PDA_SCAN_LOCATION_SOURCE',
	'PDA_FILLING_LABEL_LOCATION_SOURCE',
	'PDA_MANUAL_LOCATION_SOURCE',
	'PDA_LOCATION_ERROR_PENDING_AT_SUBMIT',
	'PDA_LOCATION_ERROR_INTERRUPTED_BACKGROUND',
	'PDA_LOCATION_ERROR_INTERRUPTED_CONTEXT_CHANGED',
	'normalizePdaScanLocation',
	'createPdaScanLocationPending',
	'createPdaScanLocationFailure',
	'formatSaleRowLocationText'
], shared)
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
		watchMobileSaleContext: options.watchContext || (async (id, version) => version ? new Promise(() => {}) : ({ code: 0, data: {
			customerId: id, customer: id ? customer : null, bound: (options.role || 'superadmin') !== 'superadmin',
			vehicleId: options.defaults?.vehicle_id || '', vehicleNo: options.defaults?.vehicle_no || '', version: '1' } })),
		setMobileSaleVehicleTicket: options.vehicleTicket || (async () => ({ code: 0 })),
		getPdaCustomerById: async () => ({ code: 0, data: customer }),
		resolvePdaCustomerByQrCode: async () => ({ code: 0, data: customer }),
		listPdaCustomers: async () => ({ code: 0, data: [customer] }),
		findPdaBottleByNo: options.findBottle || (async no => ({ code: 0, data: bottle(no) })),
		resolvePdaBottleByQrCode: options.resolveQr || (async no => ({ code: 0, data: bottle(no) })),
		previewPdaDepositRows: async () => ({ code: 0, data: { depositRows: [], baseCount: 0, raw: '' } }),
		getPdaBottleScanLocation: options.getLocation || (async opts => ({ status: 'failed', source: opts?.source, capturedAt: opts?.capturedAt })),
		createMobileSale: async (id, payload) => { requests.push({ id, payload }); return options.send ? options.send(id, payload) : { code: 0, data: { operation_id: id, source_saved: true, processing_state: 'completed', sale_id: 's1' } } },
		closeMissingMobileSale: options.closeMissing || (async id => ({ code:409, error_code:'MOBILE_SALE_CLOSED_UNSAVED',data:{source_saved:false,operation_id:id} })),
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
	const panel = scope.run(() => module.usePdaNativeSale({ locate: runtime.getPdaBottleScanLocation }))
	t.after(() => { panel.sale.setForeground(false); scope.stop() })
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

test('a selected customer is mandatory and a bottle can only occupy one direction in a sale', async t => {
	for (const start of [2, 3]) {
		const h = await harness(t)
		h.panel.sale.form.value.customerName = '仅输入了名称'
		assert.equal(await h.panel.go(2), false)
		await h.start(start)
		await h.scan('55')
		h.frames(120)
		assert.equal(await h.panel.go(start === 2 ? 3 : 2), true)
		assert.equal(await h.panel.chooseBottle('55'), false)
		assert.match(h.panel.error.value, /不能重复登记/)
		assert.equal(h.panel.outRows.value.length + h.panel.backRows.value.length, 1)
	}
})

test('late live customer responses cannot overwrite another customer or a hidden screen', async t => {
	const delayed = deferred(), answered = deferred()
	const h = await harness(t, {watchContext: async (id,version) => {
		if (version) return new Promise(() => {})
		if (id === 'old') { answered.resolve(); return delayed.promise }
		return {code:0,data:{version:'current', customerId:id, bound:false, customer:id ? {...customer,_id:id,default_unit_price:17} : null}}
	}})
	h.panel.selectCustomer({...customer,_id:'old'})
	await answered.promise
	h.panel.selectCustomer({...customer,_id:'new'})
	await new Promise(resolve=>setImmediate(resolve))
	assert.equal(h.panel.sale.form.value.unitPrice,'17')
	delayed.resolve({code:0,data:{customerId:'old',version:'old',bound:false,customer:{...customer,_id:'old',default_unit_price:3}}})
	await new Promise(resolve=>setImmediate(resolve))
	assert.equal(h.panel.sale.selectedCustomer.value._id,'new')
	assert.equal(h.panel.sale.form.value.unitPrice,'17')
	await h.panel.deactivate()
})

test('submit uses latest settlement and price and keeps the captured truck and weight', async t => {
	let price = 8
	const h = await harness(t, {
		role: 'pda_operator', defaults: { vehicle_id:'v1', vehicle_no:'TEST' },
		watchContext: async (id, version) => version ? new Promise(() => {}) : ({ code: 0, data: {
			version: String(price), customerId:id, bound:true, vehicleId:'v1', vehicleNo:'TEST',
			customer: id ? {...customer, default_unit_price:price, effective_settlement_customer_id:'parent-' + price} : null } })
	})
	await h.start()
	await h.scan('66'); h.frames(120)
	await h.panel.go(3); await h.panel.go(4)
	price = 11
	assert.equal(await h.panel.save(), true)
	const payload = h.requests[0].payload
	assert.equal(payload.base.unitPrice, 11)
	assert.equal(payload.base.settlementCustomerId, 'parent-11')
	assert.equal(payload.base.vehicleId, 'v1')
	assert.ok(payload.base.vehicleTicket)
	assert.equal(payload.outRows[0].net, 20)
})

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

test('missing original only reopens after durable proof and automatically submits the preserved weighing', async t => {
	let attempts=0
	const h=await harness(t,{query:async id=>({code:404,error_code:'MOBILE_SALE_OPERATION_NOT_FOUND',data:{operation_id:id,source_saved:null}}),
		send:async id=>++attempts===1 ? {code:503,data:{source_saved:null}} : {code:0,data:{operation_id:id,source_saved:true,sale_id:'saved'}}})
	await h.start();await h.scan('101');h.frames(120);await h.panel.go(3);await h.panel.go(4);await h.panel.save()
	await h.panel.sale.recoverSubmission()
	assert.equal(h.requests.length,1)
	h.pause(31000)
	await h.panel.sale.recoverSubmission()
	assert.equal(h.requests.length,2)
	assert.notEqual(h.requests[0].id,h.requests[1].id)
	assert.deepEqual(h.requests[0].payload.outRows,h.requests[1].payload.outRows)
	assert.equal(h.panel.sale.receipt.value.sourceSaved,true)
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
	assert.match(feedback.driverReceiptSummary({ status: 'unknown', sourceSaved: null, message: raw }), /自动确认原单/)
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
		const receipt = { status, sourceSaved, saleId: sourceSaved ? 's1' : '', message: raw, warnings: [raw, '关联异常刷新任务待管理员核查'] }
		const page = vue.createSSRApp({
			render,
			setup: () => ({
				...feedback, receipt,
				printer: { busy: { value: false } }, submissionLocked: sourceSaved !== false, submitting: false,
				openNext() {}, query() {}, save() {}
			})
		})
		page.component('AppButton', { setup: (_, { slots }) => () => vue.h('button', slots.default?.()) })
		return renderToString(page)
	}
	const saved = await screen(true, 'pending')
	assert.match(saved, /销售单已保存/); assert.match(saved, /开下一单/); assert.match(saved, /补打两联/)
	assert.doesNotMatch(saved, /enqueueEvent|timeout|流转|刷新处理状态|待核对|管理员核查|重试这单|放弃草稿/)
	const unknown = await screen(null, 'unknown')
	assert.match(unknown, /自动确认原单/); assert.doesNotMatch(unknown, /重试这单|查询保存结果/)
	assert.doesNotMatch(unknown, /开下一单|补打两联|销售单已保存|enqueueEvent|timeout/)
	const rejected = await screen(false, 'failed')
	assert.match(rejected, /本单未保存/); assert.doesNotMatch(rejected, /开下一单|销售单已保存|enqueueEvent|timeout/)
})

test('scan, filling label and manual entry all start location in parallel and tag distinct sources', async t => {
	const calls = []
	const lookupGate = deferred()
	let gateUsed = false
	const h = await harness(t, {
		resolveQr: async no => {
			if (!gateUsed) {
				gateUsed = true
				assert.equal(calls.length, 1, 'location should start in parallel before lookup settles')
				await lookupGate.promise
			}
			return { code: 0, data: bottle(no) }
		},
		resolveLabel: async () => ({ code: 0, data: { bottle_no: '90', tare_weight: 100, gross_weight: 185.5, net_weight: 85.5, label_token: 'a'.repeat(48) } }),
		getLocation: async opts => {
			calls.push(opts)
			return { status: 'ok', latitude: 31.2304, longitude: 121.4737, accuracy: 12, source: opts.source, capturedAt: opts.capturedAt }
		}
	})
	await h.start()
	const firstScan = h.scan('101')
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(calls.length, 1)
	assert.equal(calls[0].source, 'pda_bottle_scan')
	lookupGate.resolve()
	await firstScan
	h.frames(120)
	await h.scan(labelUrl)
	await h.panel.chooseBottle('103', false)
	h.frames(130)
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(calls.length, 3)
	assert.deepEqual(calls.map(c => c.source), ['pda_bottle_scan', 'pda_bottle_filling_label', 'pda_bottle_manual'])
	assert.deepEqual(Array.from(h.panel.outRows.value.map(r => r.scanLocation.source)), ['pda_bottle_scan', 'pda_bottle_filling_label', 'pda_bottle_manual'])
	assert.equal(h.panel.outRows.value.every(r => r.scanLocation.status === 'ok'), true)
})

test('late location callbacks survive step switches across out, back and confirm in the same draft', async t => {
	const outLoc = deferred(), backLoc = deferred()
	let seq = 0
	const h = await harness(t, {
		getLocation: opts => (++seq === 1 ? outLoc.promise : backLoc.promise).then(res => ({ ...res, source: opts.source, capturedAt: opts.capturedAt }))
	})
	await h.start()
	await h.scan('201'); h.frames(120)
	assert.equal(h.panel.outRows.value[0].scanLocation.status, 'pending')
	assert.equal(await h.panel.go(3), true)
	await h.panel.chooseBottle('202', false); h.frames(99.5)
	assert.equal(h.panel.backRows.value[0].scanLocation.status, 'pending')
	assert.equal(await h.panel.go(4), true)
	outLoc.resolve({ status: 'ok', latitude: 31.111111, longitude: 121.111111, accuracy: 10 })
	backLoc.resolve({ status: 'ok', latitude: 31.222222, longitude: 121.222222, accuracy: 15 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.panel.outRows.value[0].scanLocation.status, 'ok')
	assert.equal(h.panel.outRows.value[0].scanLocation.latitude, 31.111111)
	assert.equal(h.panel.outRows.value[0].scanLocation.source, 'pda_bottle_scan')
	assert.equal(h.panel.backRows.value[0].scanLocation.status, 'ok')
	assert.equal(h.panel.backRows.value[0].scanLocation.latitude, 31.222222)
	assert.equal(h.panel.backRows.value[0].scanLocation.source, 'pda_bottle_manual')
	assert.equal(await h.panel.save(), true)
	assert.equal(h.requests[0].payload.outRows[0].scan_location.latitude, 31.111111)
	assert.equal(h.requests[0].payload.backRows[0].scan_location.latitude, 31.222222)
})

test('location callbacks isolate remove/re-add, customer/vehicle/account/order switch, background and frozen retry, and never overwrite ok', async t => {
	const gates = []
	const h = await harness(t, {
		send: async () => { throw new Error('network timeout') },
		getLocation: opts => {
			const g = deferred()
			gates.push({ g, opts })
			return g.promise.then(res => ({ ...res, source: opts.source, capturedAt: opts.capturedAt }))
		}
	})
	await h.start()

	// 1. Delete and re-add same bottleNo: old rowId callback must not overwrite new row
	await h.scan('301'); h.frames(120)
	await h.panel.remove(h.panel.outRows.value[0])
	await h.panel.chooseBottle('301', false); h.frames(120)
	gates[0].g.resolve({ status: 'ok', latitude: 10, longitude: 20, accuracy: 5 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.panel.outRows.value[0].scanLocation.status, 'pending')
	gates[1].g.resolve({ status: 'ok', latitude: 30, longitude: 120, accuracy: 8 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.panel.outRows.value[0].scanLocation.status, 'ok')
	assert.equal(h.panel.outRows.value[0].scanLocation.latitude, 30)

	// 2. Existing ok location cannot be overwritten by a failure
	h.panel.sale.attachBottleScanLocation('out', 0, { status: 'failed', errorCode: 'timeout', errorMessage: '定位超时' })
	assert.equal(h.panel.outRows.value[0].scanLocation.status, 'ok')
	assert.equal(h.panel.outRows.value[0].scanLocation.latitude, 30)

	// 3. Submit does not wait for pending GPS; records pending_at_submit and frozen retry ignores late GPS
	await h.scan('302'); h.frames(125)
	assert.equal(h.panel.outRows.value[1].scanLocation.status, 'pending')
	await h.panel.go(3); await h.panel.go(4)
	await h.panel.save()
	assert.equal(h.requests.length, 1)
	assert.equal(h.requests[0].payload.outRows[1].scan_location.status, 'failed')
	assert.equal(h.requests[0].payload.outRows[1].scan_location.error_code, 'pending_at_submit')
	assert.equal(h.requests[0].payload.outRows[1].scan_location.source, 'pda_bottle_scan')
	// Late GPS resolves while frozen: must not mutate frozen payload or form
	gates[2].g.resolve({ status: 'ok', latitude: 31.9, longitude: 121.9, accuracy: 5 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.panel.outRows.value[1].scanLocation.status, 'pending')
	await h.panel.save(true)
	assert.equal(h.requests.length, 2)
	assert.deepEqual(h.requests[0].payload, h.requests[1].payload)

	// 4. Background deactivate marks pending as interrupted_background and rejects post-background callback
	const h2 = await harness(t, {
		getLocation: opts => {
			const g = deferred()
			gates.push({ g, opts })
			return g.promise.then(res => ({ ...res, source: opts.source, capturedAt: opts.capturedAt }))
		}
	})
	await h2.start()
	await h2.scan('401'); h2.frames(120)
	await h2.panel.deactivate()
	assert.equal(h2.panel.outRows.value[0].scanLocation.status, 'failed')
	assert.equal(h2.panel.outRows.value[0].scanLocation.errorCode, 'interrupted_background')
	await h2.panel.activate()
	gates[3].g.resolve({ status: 'ok', latitude: 39.9, longitude: 116.4, accuracy: 5 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h2.panel.outRows.value[0].scanLocation.status, 'failed')
	assert.equal(h2.panel.outRows.value[0].scanLocation.errorCode, 'interrupted_background')

	// 5. Customer / vehicle / account / draft switch drops stale callbacks
	const h3 = await harness(t, {
		getLocation: opts => {
			const g = deferred()
			gates.push({ g, opts })
			return g.promise.then(res => ({ ...res, source: opts.source, capturedAt: opts.capturedAt }))
		}
	})
	await h3.start()
	await h3.scan('501'); h3.frames(120)
	h3.panel.sale.form.value.vehicleNo = 'NEW-TRUCK'
	assert.equal(h3.panel.outRows.value[0].scanLocation.errorCode, 'interrupted_context_changed')
	gates[4].g.resolve({ status: 'ok', latitude: 35, longitude: 115, accuracy: 5 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h3.panel.outRows.value[0].scanLocation.status, 'failed')

	await h3.scan('502'); h3.frames(120)
	h3.panel.sale.form.value.customerId = 'another-customer'
	assert.equal(h3.panel.outRows.value[1].scanLocation.errorCode, 'interrupted_context_changed')
	gates[5].g.resolve({ status: 'ok', latitude: 36, longitude: 116, accuracy: 5 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h3.panel.outRows.value[1].scanLocation.status, 'failed')

	await h3.panel.discard()
	await h3.start()
	await h3.scan('504'); h3.frames(120)
	h3.setOwner('other-worker')
	gates[6].g.resolve({ status: 'ok', latitude: 36.5, longitude: 116.5, accuracy: 5 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h3.panel.outRows.value[0].scanLocation.status, 'pending')
	h3.setOwner('worker')

	await h3.panel.discard()
	await h3.start()
	await h3.scan('503'); h3.frames(120)
	const oldGate = gates[7]
	await h3.panel.discard()
	await h3.start()
	await h3.scan('503'); h3.frames(120)
	oldGate.g.resolve({ status: 'ok', latitude: 37, longitude: 117, accuracy: 5 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h3.panel.outRows.value[0].scanLocation.status, 'pending')

	// 6. Restoring a draft that crashed while location was pending converts it to interrupted_background
	const draftKey = 'crm_mobile_sale_draft_v1:worker'
	const rawDraft = JSON.parse(h3.storage.get(draftKey) || JSON.stringify({
		version: 1, ownerId: 'worker', draftId: 'crash-draft', form: h3.panel.sale.form.value, customer, step: 2, pdaStep: 2
	}))
	rawDraft.form.outItems[0].scanLocation = { status: 'pending', coordinateType: 'wgs84', capturedAt: 12345, source: 'pda_bottle_scan' }
	h3.storage.set(draftKey, JSON.stringify(rawDraft))
	const restored = await harness(t, { storage: h3.storage })
	assert.equal(restored.panel.restore(), true)
	assert.equal(restored.panel.outRows.value[0].scanLocation.status, 'failed')
	assert.equal(restored.panel.outRows.value[0].scanLocation.errorCode, 'interrupted_background')
	assert.equal(restored.panel.outRows.value[0].scanLocation.source, 'pda_bottle_scan')

	// 7. shouldContinue turns false on background and after submit so fallback low-accuracy is never started
	const guards = []
	const h4 = await harness(t, {
		getLocation: opts => {
			guards.push(opts.shouldContinue)
			return new Promise(() => {})
		}
	})
	await h4.start()
	await h4.scan('601'); h4.frames(120)
	assert.equal(guards[0](), true)
	await h4.panel.go(3); await h4.panel.go(4)
	assert.equal(guards[0](), true)
	await h4.panel.save()
	assert.equal(guards[0](), false)

	const h5 = await harness(t, {
		getLocation: opts => {
			guards.push(opts.shouldContinue)
			return new Promise(() => {})
		}
	})
	await h5.start()
	await h5.scan('602'); h5.frames(120)
	assert.equal(guards[1](), true)
	await h5.panel.deactivate()
	assert.equal(guards[1](), false)
})

test('location arriving during submit preflight enters first frozen payload without unlocking form, while frozen payload stays immutable', async t => {
	const loc1 = deferred(), loc2 = deferred(), preflightGate = deferred(), preflightEntered = deferred()
	let locSeq = 0
	const h = await harness(t, {
		send: async () => { throw new Error('network timeout') },
		findBottle: async (no, opts) => {
			if (opts?.fresh) {
				preflightEntered.resolve()
				await preflightGate.promise
			}
			return { code: 0, data: bottle(no) }
		},
		getLocation: opts => (++locSeq === 1 ? loc1 : loc2).promise.then(res => ({ ...res, source: opts.source, capturedAt: opts.capturedAt }))
	})
	await h.start()
	await h.scan('701'); h.frames(120)
	await h.scan('702'); h.frames(125)
	await h.panel.go(3); await h.panel.go(4)

	const saving = h.panel.save()
	await preflightEntered.promise
	assert.equal(h.panel.sale.submitting.value, true)
	assert.equal(h.panel.locked.value, true)
	// Form remains locked for edits during preflight
	assert.equal(h.panel.sale.applyBottleSelection('out', 0, bottle('701')), null)
	// loc1 arrives before freeze: accepted safely into row and included in first frozen payload
	loc1.resolve({ status: 'ok', latitude: 31.456789, longitude: 121.456789, accuracy: 9 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.panel.outRows.value[0].scanLocation.status, 'ok')
	assert.equal(h.panel.outRows.value[0].scanLocation.latitude, 31.456789)

	preflightGate.resolve()
	await saving
	assert.equal(h.requests.length, 1)
	assert.equal(h.requests[0].payload.outRows[0].scan_location.status, 'ok')
	assert.equal(h.requests[0].payload.outRows[0].scan_location.latitude, 31.456789)
	assert.equal(h.requests[0].payload.outRows[1].scan_location.status, 'failed')
	assert.equal(h.requests[0].payload.outRows[1].scan_location.error_code, 'pending_at_submit')

	// loc2 arrives after freeze: must not mutate form or frozen payload on retry
	loc2.resolve({ status: 'ok', latitude: 31.999999, longitude: 121.999999, accuracy: 5 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.panel.outRows.value[1].scanLocation.status, 'pending')
	await h.panel.save(true)
	assert.equal(h.requests.length, 2)
	assert.deepEqual(h.requests[0].payload, h.requests[1].payload)
})

test('customer A->B->A and vehicle V1->V2->V1 round-trips block stale location callbacks from overwriting interrupted_context_changed', async t => {
	const custLoc = deferred(), vehLoc = deferred()
	let seq = 0
	const h = await harness(t, {
		defaults: { vehicle_id: 'v1', vehicle_no: 'V1' },
		getLocation: opts => (++seq === 1 ? custLoc : vehLoc).promise.then(res => ({ ...res, source: opts.source, capturedAt: opts.capturedAt }))
	})
	await h.start()
	await h.scan('801'); h.frames(120)
	const origCustomerId = h.panel.sale.form.value.customerId
	h.panel.sale.form.value.customerId = 'customer-B'
	assert.equal(h.panel.outRows.value[0].scanLocation.errorCode, 'interrupted_context_changed')
	h.panel.sale.form.value.customerId = origCustomerId
	custLoc.resolve({ status: 'ok', latitude: 31.1, longitude: 121.1, accuracy: 8 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.panel.outRows.value[0].scanLocation.status, 'failed')
	assert.equal(h.panel.outRows.value[0].scanLocation.errorCode, 'interrupted_context_changed')

	await h.scan('802'); h.frames(125)
	const origVehicleNo = h.panel.sale.form.value.vehicleNo
	h.panel.sale.form.value.vehicleNo = 'V2'
	assert.equal(h.panel.outRows.value[1].scanLocation.errorCode, 'interrupted_context_changed')
	h.panel.sale.form.value.vehicleNo = origVehicleNo
	vehLoc.resolve({ status: 'ok', latitude: 31.2, longitude: 121.2, accuracy: 8 })
	await new Promise(resolve => setImmediate(resolve))
	assert.equal(h.panel.outRows.value[1].scanLocation.status, 'failed')
	assert.equal(h.panel.outRows.value[1].scanLocation.errorCode, 'interrupted_context_changed')
})

test('hiding during a failed presubmit check leaves an interrupted location on the retained draft', async t => {
	const location = deferred(), checkStarted = deferred(), bottleCheck = deferred()
	const h = await harness(t, {
		getLocation: () => location.promise,
		findBottle: async (no, options) => {
			if (!options?.fresh) return { code: 0, data: bottle(no) }
			checkStarted.resolve()
			return bottleCheck.promise
		}
	})
	await h.start()
	await h.scan('803')
	h.frames(120)
	await h.panel.go(3)
	await h.panel.go(4)
	const saving = h.panel.save()
	await checkStarted.promise
	await h.panel.deactivate()
	location.resolve({ status: 'ok', latitude: 30, longitude: 110 })
	bottleCheck.resolve({ code: 503, msg: '临时断网' })
	await saving
	assert.equal(h.requests.length, 0)
	assert.equal(h.panel.outRows.value[0].scanLocation.errorCode, 'interrupted_background')
})
