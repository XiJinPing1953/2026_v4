'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')

function load(file, names, globals = {}, transform = source => source) {
	const source = transform(fs.readFileSync(file, 'utf8'), file)
		.replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '')
		.replace(/export\s+(?=(?:async\s+)?function|const |let |class )/g, '')
		.replace(/export\s*\{[^}]*\}\s*;?/g, '')
	return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, { Date, Math, console, ...globals })
}

function compileH5UniApis(source, file) {
	const previousInput = process.env.UNI_INPUT_DIR
	process.env.UNI_INPUT_DIR = require('node:path').resolve('src')
	try {
		// Exercise the installed production compiler rather than giving the runtime uni
		// object methods that tree-shaken H5 builds do not actually expose.
		const { uniInjectPlugin } = require('@dcloudio/uni-h5-vite/dist/plugins/inject.js')
		const { parseAst } = require('rollup/parseAst')
		const plugin = uniInjectPlugin()
		plugin.configResolved({ command: 'build', build: { sourcemap: false } })
		return plugin.transform.call({ parse: parseAst }, source, file)?.code || source
	} finally {
		if (previousInput === undefined) delete process.env.UNI_INPUT_DIR
		else process.env.UNI_INPUT_DIR = previousInput
	}
}
const state = load('src/services/pda/mobileSaleDraft.js', ['createMobileSaleDraftStore', 'createMobileSaleId', 'cloneMobileSale', 'mobileSaleReceipt', 'canReleaseMobileSubmission'])
const shared = load('src/services/pda/shared.js', ['normalizeText', 'normalizeBottleNo', 'toNumber', 'todayDate', 'buildDepositPreviewRows'])
const scale = load('src/services/pda/bleScaleCore.js', ['PDA_BLE_SCALE_DISPLAY_DECIMALS', 'PDA_BLE_SCALE_DIVISION_STEP_KG', 'quantizeBleScaleWeightKg'], shared)
const customer = load('src/services/pda/customer.js', ['resolvePdaCustomerPricing'], shared)
const location = load('src/services/pda/location.js', ['normalizePdaScanLocation'], shared)
const settlement = load('src/services/models/settlement.js', ['normalizePaymentMethod', 'normalizePaymentStatus', 'normalizeSettlementMode'])
const model = load('src/services/models/sale.js', ['normalizeSaleDraft'], settlement)
const sale = load('src/services/pda/sale.js', ['createPdaBottleSaleForm', 'createPdaOutItem', 'createPdaBackItem', 'applyBottleToSaleRow', 'syncPdaBackRow', 'validatePdaBottleSaleForm', 'buildMobileSalePayload'], { ...shared, ...customer, ...location, ...model, ...state })
const copy = value => JSON.parse(JSON.stringify(value))
const customerDoc = { _id: 'c1', name: '测试客户', default_price_unit: 'kg', default_unit_price: 8, is_active: true, effective_settlement_customer_id: 'c1' }
const bottleDoc = { _id: 'b1', bottle_no: '101', tare_weight: 100, is_active: true }

function harness(t, options = {}) {
	const storage = options.storage || new Map()
	let owner = options.owner || 'u1'
	const requests = []
	let reads = 0
	const storageApis = {
		getStorageSync: key => storage.get(key),
		setStorageSync: (key, value) => { if (options.storageFails) throw new Error('quota'); storage.set(key, value) },
		removeStorageSync: key => storage.delete(key)
	}
	const module = load('src/composables/pda/usePdaSaleForm.js', ['usePdaSaleForm', 'resolveUsableBleScaleWeight'], {
		...state, ...shared, ...customer, ...location, ...sale,
		ref: vue.ref, computed: vue.computed, watch: vue.watch, onBeforeUnmount: () => {},
		getUser: () => ({ _id: owner, mobile_sale_defaults: options.defaults }),
		uni: options.h5TreeShaking ? {} : storageApis, navigator: { onLine: true },
		$inject_uni_getStorageSync: storageApis.getStorageSync,
		$inject_uni_setStorageSync: storageApis.setStorageSync,
		$inject_uni_removeStorageSync: storageApis.removeStorageSync,
		...scale,
		getPdaCustomerById: async () => { reads++; return { code: 0, data: options.customer || customerDoc } },
		findPdaBottleByNo: options.findBottle || (async (_, opts) => { assert.equal(opts?.fresh, true); return { code: 0, data: options.bottle || bottleDoc } }),
		previewPdaDepositRows: async () => ({ code: 0, data: { depositRows: [{ bottle_no: '101' }], raw: '', baseCount: 0 } }),
		createMobileSale: async (id, payload) => {
			requests.push({ id, payload: copy(payload) })
			return options.send ? options.send(id, payload, requests.length) : { code: 0, data: { operation_id: id, sale_id: 's1', source_saved: true, processing_state: 'completed', warnings: [] } }
		},
		getMobileSaleCreateResult: options.query || (async () => ({ code: 404, error_code: 'MOBILE_SALE_OPERATION_NOT_FOUND' }))
	}, options.h5TreeShaking ? compileH5UniApis : undefined)
	const scope = vue.effectScope()
	const form = scope.run(() => module.usePdaSaleForm(options.initialValues))
	t.after(() => scope.stop())
	function fill() {
		form.applySelectedCustomer(customerDoc)
		form.form.value.outItems = [{ ...sale.createPdaOutItem(), bottleNo: '101', bottleId: 'b1', gross: '120.0', tare: '100.0', net: '20.0', weightSource: 'web_ble', weightSampledAt: Date.now(), scaleSessionId: 'session-1', scaleStableSeq: 1 }]
		form.form.value.depositRows = [{ bottle_no: '101' }]
		form.draftStep.value = 3
	}
	return { form, storage, requests, fill, module, setOwner: value => { owner = value }, reads: () => reads }
}

test('production H5 API transform supports saving, restoring and clearing with an empty runtime uni object', t => {
	const first = harness(t, { h5TreeShaking: true })
	assert.equal(first.form.submissionLocked.value, false)
	assert.equal(first.form.draftStatus.value.state, 'ready')
	first.fill()
	assert.equal(first.form.persistDraft(), true)
	assert.equal(first.form.draftStatus.value.state, 'saved')
	const restored = harness(t, { h5TreeShaking: true, storage: first.storage })
	assert.equal(restored.form.draftStatus.value.available, true)
	assert.equal(restored.form.restoreDraft(), true)
	assert.equal(restored.form.form.value.customerId, 'c1')
	assert.equal(restored.form.form.value.outItems[0].gross, '120.0')
	assert.equal(restored.form.startNewSale(), true)
	assert.equal(restored.storage.size, 0)
	assert.equal(restored.form.submissionLocked.value, false)
})

test('production H5 storage adapter still blocks submission when the browser cannot save', async t => {
	const h = harness(t, { h5TreeShaking: true, storageFails: true })
	h.fill()
	assert.equal((await h.form.submit()).code, 507)
	assert.equal(h.requests.length, 0)
	assert.equal(h.form.draftStatus.value.state, 'error')
})

test('account defaults seed a fresh sale, remain editable, and explicit initial values take precedence', t => {
	const defaults = { delivery1: ' 配送甲 ', delivery2: '配送乙', vehicle_no: ' 测A12345 ' }
	const h = harness(t, { defaults })
	assert.equal(h.form.form.value.delivery1, '配送甲')
	assert.equal(h.form.form.value.delivery2, '配送乙')
	assert.equal(h.form.form.value.vehicleNo, '测A12345')
	h.form.form.value.delivery1 = '临时配送员'
	h.form.form.value.vehicleNo = '测B67890'
	h.form.applySelectedCustomer(customerDoc)
	assert.equal(h.form.form.value.delivery1, '临时配送员')
	assert.equal(h.form.form.value.vehicleNo, '测B67890')
	const explicit = harness(t, { defaults, initialValues: { delivery1: '', vehicleNo: '测C11111' } })
	assert.equal(explicit.form.form.value.delivery1, '')
	assert.equal(explicit.form.form.value.delivery2, '配送乙')
	assert.equal(explicit.form.form.value.vehicleNo, '测C11111')
})

test('draft restore keeps edited delivery and vehicle; discard and next sale use current account defaults', t => {
	const defaults = { delivery1: '配送甲', delivery2: '配送乙', vehicle_no: '测A12345' }
	const first = harness(t, { defaults })
	first.form.form.value.delivery1 = '临时配送员'
	first.form.form.value.delivery2 = ''
	first.form.form.value.vehicleNo = '测B67890'
	const restored = harness(t, { storage: first.storage, defaults })
	assert.equal(restored.form.restoreDraft(), true)
	assert.equal(restored.form.form.value.delivery1, '临时配送员')
	assert.equal(restored.form.form.value.delivery2, '')
	assert.equal(restored.form.form.value.vehicleNo, '测B67890')
	assert.equal(restored.form.startNewSale(), true)
	assert.equal(restored.form.form.value.delivery1, '配送甲')
	assert.equal(restored.form.form.value.delivery2, '配送乙')
	assert.equal(restored.form.form.value.vehicleNo, '测A12345')
	const discard = harness(t, { storage: restored.storage, defaults: { delivery1: '新默认' } })
	assert.equal(discard.form.discardDraft(), true)
	assert.equal(discard.form.form.value.delivery1, '新默认')
	assert.equal(discard.form.form.value.vehicleNo, '')
})

test('defaults and existing drafts never cross accounts; accounts without defaults retain empty fields', t => {
	const first = harness(t, { defaults: { delivery1: '配送甲', vehicle_no: '测A12345' } })
	first.form.form.value.remark = '属于 u1'
	const second = harness(t, { storage: first.storage, owner: 'u2', defaults: { delivery1: '配送乙', vehicle_no: '测B67890' } })
	assert.equal(second.form.draftStatus.value.available, false)
	assert.equal(second.form.form.value.delivery1, '配送乙')
	assert.equal(second.form.form.value.vehicleNo, '测B67890')
	assert.equal(second.form.form.value.remark, '')
	const plain = harness(t, { storage: first.storage, owner: 'u3' })
	assert.equal(plain.form.form.value.delivery1, '')
	assert.equal(plain.form.form.value.delivery2, '')
	assert.equal(plain.form.form.value.vehicleNo, '')
	first.setOwner('u2')
	assert.equal(first.form.startNewSale(), false)
})

test('customer selection fills ID and price; a changed keyword or explicit clear removes both', t => {
	const h = harness(t)
	h.form.applySelectedCustomer(customerDoc)
	assert.equal(h.form.form.value.customerId, 'c1')
	assert.equal(h.form.form.value.customerName, '测试客户')
	assert.equal(h.form.form.value.unitPrice, '8')
	h.form.setCustomerKeyword('另一个客户')
	assert.equal(h.form.form.value.customerId, '')
	assert.equal(h.form.form.value.customerName, '')
	assert.equal(h.form.form.value.unitPrice, '')
	assert.equal(h.form.selectedCustomer.value, null)
	h.form.applySelectedCustomer(customerDoc)
	h.form.clearSelectedCustomer()
	assert.equal(h.form.form.value.customerId, '')
	assert.equal(h.form.form.value.unitPrice, '')
	assert.equal(h.form.customerKeyword.value, '')
})

test('quota failure prevents network create and exposes unsaved draft', async t => {
	const h = harness(t, { storageFails: true }); h.fill()
	assert.equal((await h.form.submit()).code, 507)
	assert.equal(h.requests.length, 0)
	assert.equal(h.form.draftStatus.value.state, 'error')
	assert.equal(h.form.submissionLocked.value, false)
})

test('timeout, query-not-found and retry keep exactly the original operation and payload', async t => {
	const h = harness(t, { send: async () => { throw new Error('timeout') } }); h.fill()
	assert.equal((await h.form.submit()).code, 503)
	const original = copy(h.requests[0])
	assert.equal(h.form.submissionLocked.value, true)
	assert.equal((await h.form.querySubmission()).code, 404)
	assert.equal(h.form.startNewSale(), false)
	assert.equal(h.form.discardDraft(), false)
	// Even a stale UI callback cannot change the frozen request.
	h.form.form.value.remark = 'late callback'
	await h.form.submit({ confirmedWarnings: true })
	assert.deepEqual(h.requests[1], original)
})

test('reload restores unfinished operation without re-reading changing master data', async t => {
	const h = harness(t, { send: async () => { throw new Error('lost response') } }); h.fill(); await h.form.submit()
	const restored = harness(t, { storage: h.storage, customer: { ...customerDoc, default_unit_price: 99 } })
	assert.equal(restored.form.draftStatus.value.available, true)
	assert.equal(restored.form.discardDraft(), false)
	assert.equal(restored.form.restoreDraft(), true)
	await restored.form.submit()
	assert.deepEqual(restored.requests[0], h.requests[0])
	assert.equal(restored.reads(), 0)
	assert.equal(restored.form.receipt.value.status, 'saved')
})

test('storage failure during an uncertain retry never unlocks or loses the original operation', async t => {
	const options = { send: async () => { throw new Error('lost response') } }
	const h = harness(t, options); h.fill(); await h.form.submit()
	const original = copy(h.requests[0])
	options.storageFails = true
	assert.equal((await h.form.submit()).code, 507)
	assert.equal(h.form.submissionLocked.value, true)
	assert.equal(h.form.startNewSale(), false)
	assert.equal(h.requests.length, 1)
	options.storageFails = false
	await h.form.submit()
	assert.deepEqual(h.requests[1], original)
})

test('reload while request is in flight exposes recovery actions even before a receipt exists', async t => {
	const h = harness(t); h.fill()
	const [key, raw] = [...h.storage.entries()][0]
	const saved = JSON.parse(raw)
	saved.submission = { operationId: 'sale-in-flight', payload: sale.buildMobileSalePayload(h.form.form.value), attempted: true }
	saved.receipt = null
	h.storage.set(key, JSON.stringify(saved))
	const restored = harness(t, { storage: h.storage })
	assert.equal(restored.form.restoreDraft(), true)
	assert.equal(restored.form.receipt.value.status, 'unknown')
	assert.equal(restored.form.receipt.value.operationId, 'sale-in-flight')
	await restored.form.submit()
	assert.equal(restored.requests[0].id, 'sale-in-flight')
})

test('pre-write warning rejection unlocks, explicit confirmation creates a new frozen version', async t => {
	const h = harness(t, { send: async (id, payload, count) => count === 1
		? { code: 409, confirmable: true, warning_items: [{ bottle_no: '101' }], data: { source_saved: false } }
		: { code: 0, data: { operation_id: id, sale_id: 's1', source_saved: true, processing_state: 'pending_review', warnings: ['库存待核'] } } })
	h.fill(); await h.form.submit()
	assert.equal(h.form.submissionLocked.value, false)
	await h.form.submit({ confirmedWarnings: true })
	assert.notEqual(h.requests[1].id, h.requests[0].id)
	assert.equal(h.requests[1].payload.ignore_bottle_flow_warning, true)
	assert.equal(h.form.receipt.value.status, 'pending')
	assert.equal(h.form.form.value.outItems[0].net, '20.0')
	assert.equal(h.form.startNewSale(), true)
})

test('price and tare changes require explicit acceptance and invalidate old measured row', async t => {
	const h = harness(t, { customer: { ...customerDoc, default_unit_price: 9 }, bottle: { ...bottleDoc, tare_weight: 101 } }); h.fill()
	const response = await h.form.submit()
	assert.equal(response.error_code, 'MOBILE_SALE_REVALIDATION_CHANGED')
	assert.equal(h.requests.length, 0)
	assert.equal(h.form.form.value.unitPrice, '8')
	assert.equal(h.form.form.value.outItems[0].tare, '100.0')
	assert.equal(h.form.applyRevalidationChanges(), true)
	assert.equal(h.form.form.value.unitPrice, '9')
	assert.equal(h.form.form.value.outItems[0].tare, '101')
	assert.equal(h.form.form.value.outItems[0].gross, '')
})

test('account switch cannot submit or overwrite the original account draft', async t => {
	const h = harness(t); h.fill()
	const saved = [...h.storage.values()][0]
	h.setOwner('u2')
	assert.equal((await h.form.submit()).code, 401)
	h.form.form.value.remark = 'wrong account'
	assert.equal(h.form.persistDraft(), false)
	assert.equal([...h.storage.values()][0], saved)
	assert.equal(h.requests.length, 0)
})

test('a failed progress query preserves the known saved sale and its number', async t => {
	const h = harness(t); h.fill(); await h.form.submit()
	await h.form.querySubmission()
	assert.equal(h.form.receipt.value.sourceSaved, true)
	assert.equal(h.form.receipt.value.saleId, 's1')
	assert.equal(h.form.startNewSale(), true)
})

test('another tab restoring the same draft cannot create a second operation or overwrite newer state', async t => {
	const one = harness(t); one.fill()
	const draftId = JSON.parse([...one.storage.values()][0]).draftId
	const two = harness(t, { storage: one.storage }); two.form.restoreDraft()
	await two.form.submit()
	const saved = [...one.storage.values()][0]
	assert.equal(two.requests[0].id, draftId)
	assert.equal((await one.form.submit()).code, 507)
	assert.equal(one.requests.length, 0)
	assert.equal([...one.storage.values()][0], saved)
})

test('unreadable draft is preserved and cannot silently become a new sale', async t => {
	const storage = new Map([['crm_mobile_sale_draft_v1:u1', '{broken']])
	const h = harness(t, { storage }); h.fill()
	assert.equal(h.form.submissionLocked.value, true)
	assert.equal((await h.form.submit()).code, 409)
	assert.equal(h.form.discardDraft(), false)
	assert.equal(h.form.persistDraft(), false)
	assert.equal(storage.get('crm_mobile_sale_draft_v1:u1'), '{broken')
})

test('late bottle lookup after deleting row or hiding page cannot write into replacement', async t => {
	let finish
	const h = harness(t, { findBottle: () => new Promise(resolve => { finish = resolve }) }); h.fill()
	const pending = h.form.resolveBottle('out', 0)
	h.form.invalidateAsyncWork()
	h.form.removeOutItem(0)
	finish({ code: 0, data: bottleDoc }); await pending
	assert.equal(h.form.form.value.outItems[0].bottleNo, '')
})

test('a fresh stable sample fills half-kilogram gross, preserves archive tare and persists the completed row', t => {
	const h = harness(t)
	h.form.applySelectedCustomer(customerDoc)
	h.form.form.value.outItems = [{ ...sale.createPdaOutItem(), bottleNo: '113', bottleId: 'b113', tare: '124.1', tareSource: 'bottle_profile' }]
	const now = Date.now()
	const sample = { weight_kg: 170.4, is_connected: true, is_online: true, is_stable: true, sampled_at: now, measurement_started_at: now - 1500, session_id: 'b113', stable_seq: 1, transport: 'web' }
	assert.equal(h.form.applyScaleWeightToRow('out', 0, sample, { sessionId: 'b113' }).code, 0)
	const row = h.form.form.value.outItems[0]
	assert.equal(row.gross, '170.5')
	assert.equal(row.tare, '124.1', 'archive tare is not rounded to the scale division')
	assert.equal(row.net, '46.4')
	assert.equal(h.form.applyScaleWeightToRow('out', 0, { ...sample, weight_kg: 180 }).code, 208)
	const reopened = harness(t, { storage: h.storage })
	assert.equal(reopened.form.restoreDraft(), true)
	assert.equal(reopened.form.form.value.outItems[0].gross, '170.5')
	assert.equal(reopened.form.form.value.outItems[0].net, '46.4')
})

test('disconnected cached weight, stale or future samples and mismatched sessions are refused', t => {
	const h = harness(t); h.fill()
	const now = Date.now()
	const valid = { weight_kg: 120, is_connected: true, is_online: true, is_stable: true, sampled_at: now, session_id: 'new', measurement_started_at: now - 1500 }
	for (const snapshot of [{ ...valid, is_connected: false, last_stable_weight_kg: 120, last_stable_at: now }, { ...valid, sampled_at: now - 3001 }, { ...valid, sampled_at: now + 1000 }]) assert.equal(h.module.resolveUsableBleScaleWeight(snapshot, now).weightKg, null)
	assert.equal(h.module.resolveUsableBleScaleWeight(valid, now).weightKg, 120)
	assert.equal(h.form.applyScaleWeightToRow('out', 0, valid, { sessionId: 'old' }).code, 409)
})

test('mobile payload keeps scan and BLE evidence and rejects duplicate bottle before normalization', t => {
	const h = harness(t); h.fill()
	const row = h.form.form.value.outItems[0]
	row.scanLocation = { status: 'failed', capturedAt: 100, source: 'mobile_bottle_scan', errorCode: 'denied' }
	const payload = sale.buildMobileSalePayload(h.form.form.value)
	assert.equal(payload.outRows[0].weight_source, 'web_ble')
	assert.equal(payload.outRows[0].scale_session_id, 'session-1')
	assert.equal(payload.outRows[0].scan_location.status, 'failed')
	assert.equal(payload.base.amountReceived, 0)
	assert.equal(payload.base.paymentMethod, 'on_account')
	h.form.form.value.outItems.push({ ...row, rowId: 'other' })
	assert.equal(sale.validatePdaBottleSaleForm(h.form.form.value, customerDoc).ok, false)
})
