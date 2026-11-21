const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function load(file, names, globals = {}) {
	const source = fs.readFileSync(file, 'utf8')
		.replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '')
		.replace(/^export /gm, '')
	return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, {
		Date,
		Math,
		console,
		setTimeout,
		clearTimeout,
		...globals
	})
}

const shared = load('src/services/pda/shared.js', ['normalizeText', 'normalizeBottleNo', 'toNumber', 'todayDate'])
const settlement = load('src/services/models/settlement.js', ['normalizePaymentMethod', 'normalizePaymentStatus', 'normalizeSettlementMode'])
const saleModel = load('src/services/models/sale.js', ['normalizeSaleDraft'], settlement)

function loadLocation(uni) {
	return load('src/services/pda/location.js', [
		'PDA_SCAN_LOCATION_SOURCE',
		'PDA_FILLING_LABEL_LOCATION_SOURCE',
		'PDA_MANUAL_LOCATION_SOURCE',
		'PDA_LOCATION_ERROR_PENDING_AT_SUBMIT',
		'PDA_LOCATION_ERROR_INTERRUPTED_BACKGROUND',
		'PDA_LOCATION_ERROR_INTERRUPTED_CONTEXT_CHANGED',
		'normalizePdaScanLocation',
		'createPdaScanLocationPending',
		'createPdaScanLocationFailure',
		'getPdaBottleScanLocation',
		'formatSaleRowLocationText',
		'preserveEditedSaleRowLocations'
	], { ...shared, uni })
}

test('getPdaBottleScanLocation succeeds on high accuracy without triggering fallback', async () => {
	const calls = []
	const loc = loadLocation({
		getLocation(opts) {
			calls.push(opts)
			opts.success({ latitude: 31.230416, longitude: 121.473701, accuracy: 12.4 })
		}
	})
	const result = await loc.getPdaBottleScanLocation({
		source: loc.PDA_MANUAL_LOCATION_SOURCE,
		capturedAt: 1795000000000,
		highAccuracyTimeoutMs: 40,
		fallbackTimeoutMs: 40
	})
	assert.equal(calls.length, 1)
	assert.equal(calls[0].isHighAccuracy, true)
	assert.equal(result.status, 'ok')
	assert.equal(result.source, 'pda_bottle_manual')
	assert.equal(result.capturedAt, 1795000000000)
	assert.equal(result.latitude, 31.230416)
	assert.equal(result.longitude, 121.473701)
	assert.equal(result.accuracy, 12.4)
})

test('getPdaBottleScanLocation falls back to standard accuracy when high accuracy times out', async () => {
	const calls = []
	const loc = loadLocation({
		getLocation(opts) {
			calls.push(opts)
			if (!opts.isHighAccuracy) {
				setTimeout(() => opts.success({ latitude: 31.5, longitude: 121.6, accuracy: 35 }), 5)
			}
		}
	})
	const result = await loc.getPdaBottleScanLocation({
		source: loc.PDA_SCAN_LOCATION_SOURCE,
		highAccuracyTimeoutMs: 20,
		fallbackTimeoutMs: 80
	})
	assert.equal(calls.length, 2)
	assert.equal(calls[0].isHighAccuracy, true)
	assert.equal(calls[0].highAccuracyExpireTime, 20)
	assert.equal(calls[1].isHighAccuracy, false)
	assert.equal(calls[1].highAccuracyExpireTime, 80)
	assert.equal(result.status, 'ok')
	assert.equal(result.latitude, 31.5)
	assert.equal(result.longitude, 121.6)
	assert.equal(result.accuracy, 35)
})

test('getPdaBottleScanLocation does not start fallback when shouldContinue becomes false', async () => {
	const calls = []
	let active = true
	const loc = loadLocation({
		getLocation(opts) {
			calls.push(opts)
		}
	})
	const promise = loc.getPdaBottleScanLocation({
		source: loc.PDA_SCAN_LOCATION_SOURCE,
		highAccuracyTimeoutMs: 25,
		fallbackTimeoutMs: 50,
		shouldContinue: () => active
	})
	active = false
	const result = await promise
	assert.equal(calls.length, 1)
	assert.equal(calls[0].isHighAccuracy, true)
	assert.equal(result.status, 'failed')
	assert.equal(result.errorCode, 'cancelled')
})

test('normalizePdaScanLocation and normalizeSaleDraft sanitize out-of-range coords, non-numbers and negative accuracy', () => {
	const loc = loadLocation({})
	const outOfRange = loc.normalizePdaScanLocation({ status: 'ok', latitude: 91, longitude: 121, accuracy: 10, capturedAt: 1000 })
	assert.equal(outOfRange.status, 'failed')
	assert.equal(outOfRange.errorCode, 'invalid_location')

	const badLng = loc.normalizePdaScanLocation({ status: 'ok', latitude: 31, longitude: -181, accuracy: 10, capturedAt: 1000 })
	assert.equal(badLng.status, 'failed')

	const boolCoord = loc.normalizePdaScanLocation({ status: 'ok', latitude: true, longitude: 121, accuracy: 10, capturedAt: 1000 })
	assert.equal(boolCoord.status, 'failed')

	const blankCoord = loc.normalizePdaScanLocation({ status: 'ok', latitude: '   ', longitude: 121, accuracy: '   ', capturedAt: 1000 })
	assert.equal(blankCoord.status, 'failed')
	assert.equal(blankCoord.errorCode, 'invalid_location')

	const arrayCoord = loc.normalizePdaScanLocation({ status: 'ok', latitude: [], longitude: [121], accuracy: [], capturedAt: 1000 })
	assert.equal(arrayCoord.status, 'failed')
	assert.equal(arrayCoord.errorCode, 'invalid_location')

	const negAcc = loc.normalizePdaScanLocation({ status: 'ok', latitude: 31.23, longitude: 121.47, accuracy: -1, capturedAt: 1000 })
	assert.equal(negAcc.status, 'ok')
	assert.equal(negAcc.accuracy, null)

	const blankAndArrayAcc = loc.normalizePdaScanLocation({ status: 'ok', latitude: ' 31.23 ', longitude: ' 121.47 ', accuracy: [], capturedAt: '   ' })
	assert.equal(blankAndArrayAcc.status, 'ok')
	assert.equal(blankAndArrayAcc.latitude, 31.23)
	assert.equal(blankAndArrayAcc.longitude, 121.47)
	assert.equal(blankAndArrayAcc.accuracy, null)
	assert.ok(blankAndArrayAcc.capturedAt > 0)

	const draftPayload = saleModel.normalizeSaleDraft({
		date: '2026-11-21',
		customerId: 'c1',
		customerName: '客户A',
		unitPrice: 8,
		outItems: [
			{ bottleNo: 'A01', bottleId: 'b1', gross: 120, tare: 100, net: 20, scanLocation: { status: 'ok', latitude: 95, longitude: 121, accuracy: 5, capturedAt: 1795000000000 } },
			{ bottleNo: 'A02', bottleId: 'b2', gross: 120, tare: 100, net: 20, scanLocation: { status: 'ok', latitude: 31.23, longitude: 121.47, accuracy: -5, capturedAt: 1795000000000 } },
			{ bottleNo: 'A03', bottleId: 'b3', gross: 120, tare: 100, net: 20, scanLocation: { status: 'ok', latitude: '   ', longitude: [], accuracy: [], capturedAt: 1795000000000 } }
		]
	})
	assert.equal(draftPayload.outRows[0].scan_location.status, 'failed')
	assert.equal(draftPayload.outRows[0].scan_location.error_code, 'invalid_location')
	assert.equal(draftPayload.outRows[1].scan_location.status, 'ok')
	assert.equal(draftPayload.outRows[1].scan_location.accuracy, null)
	assert.equal(draftPayload.outRows[2].scan_location.status, 'failed')
	assert.equal(draftPayload.outRows[2].scan_location.error_code, 'invalid_location')
})

test('getPdaBottleScanLocation falls back on transient failure but stops immediately on permission denial', async () => {
	const calls = []
	const loc1 = loadLocation({
		getLocation(opts) {
			calls.push(opts.isHighAccuracy)
			if (opts.isHighAccuracy) opts.fail({ errCode: 'provider_unavailable', errMsg: 'GPS signal weak' })
			else opts.success({ latitude: 30.1, longitude: 120.2, accuracy: 25 })
		}
	})
	const recovered = await loc1.getPdaBottleScanLocation({ highAccuracyTimeoutMs: 30, fallbackTimeoutMs: 30 })
	assert.deepEqual(calls, [true, false])
	assert.equal(recovered.status, 'ok')
	assert.equal(recovered.latitude, 30.1)

	const deniedCalls = []
	const loc2 = loadLocation({
		getLocation(opts) {
			deniedCalls.push(opts.isHighAccuracy)
			opts.fail({ errCode: 'permission_denied', errMsg: '用户拒绝授权定位' })
		}
	})
	const denied = await loc2.getPdaBottleScanLocation({
		source: loc2.PDA_FILLING_LABEL_LOCATION_SOURCE,
		highAccuracyTimeoutMs: 30,
		fallbackTimeoutMs: 30
	})
	assert.deepEqual(deniedCalls, [true])
	assert.equal(denied.status, 'failed')
	assert.equal(denied.errorCode, 'permission_denied')
	assert.equal(denied.source, 'pda_bottle_filling_label')
})

test('getPdaBottleScanLocation returns bounded timeout when both stages time out and never fabricates coordinates', async () => {
	const calls = []
	const loc = loadLocation({
		getLocation(opts) {
			calls.push(opts.isHighAccuracy)
		}
	})
	const result = await loc.getPdaBottleScanLocation({
		source: loc.PDA_SCAN_LOCATION_SOURCE,
		highAccuracyTimeoutMs: 20,
		fallbackTimeoutMs: 20
	})
	assert.deepEqual(calls, [true, false])
	assert.equal(result.status, 'failed')
	assert.equal(result.errorCode, 'timeout')
	assert.equal(result.errorMessage, '定位超时')
	assert.equal('latitude' in result, false)
	assert.equal('longitude' in result, false)
})

test('getPdaBottleScanLocation accepts late high-accuracy fix if it arrives before fallback finishes', async () => {
	let highSuccess = null
	const loc = loadLocation({
		getLocation(opts) {
			if (opts.isHighAccuracy) highSuccess = opts.success
			else setTimeout(() => highSuccess({ latitude: 31.88, longitude: 121.99, accuracy: 6 }), 5)
		}
	})
	const result = await loc.getPdaBottleScanLocation({
		highAccuracyTimeoutMs: 20,
		fallbackTimeoutMs: 80
	})
	assert.equal(result.status, 'ok')
	assert.equal(result.latitude, 31.88)
	assert.equal(result.accuracy, 6)
})

test('normalizeSaleDraft converts pending scanLocation into pending_at_submit failed payload', () => {
	const payload = saleModel.normalizeSaleDraft({
		date: '2026-11-21',
		customerId: 'c1',
		customerName: '客户A',
		unitPrice: 8,
		outItems: [{
			bottleNo: 'A01',
			bottleId: 'b1',
			gross: 120,
			tare: 100,
			net: 20,
			scanLocation: { status: 'pending', capturedAt: 1795000001234, source: 'pda_bottle_manual' }
		}],
		backItems: [{
			bottleNo: 'B02',
			bottleId: 'b2',
			gross: 100,
			tare: 100,
			net: 0,
			scanLocation: { status: 'pending', capturedAt: 1795000005678, source: 'pda_bottle_scan' }
		}]
	})
	assert.equal(payload.outRows[0].scan_location.status, 'failed')
	assert.equal(payload.outRows[0].scan_location.error_code, 'pending_at_submit')
	assert.equal(payload.outRows[0].scan_location.error_message, '提交时定位尚未返回')
	assert.equal(payload.outRows[0].scan_location.source, 'pda_bottle_manual')
	assert.equal(payload.outRows[0].scan_location.captured_at, 1795000001234)
	assert.equal(payload.backRows[0].scan_location.error_code, 'pending_at_submit')
	assert.equal(payload.backRows[0].scan_location.source, 'pda_bottle_scan')
})

test('formatSaleRowLocationText distinguishes web manual, legacy missing, PDA sources, pending-at-submit and failures', () => {
	const loc = loadLocation({})
	const ts = Date.UTC(2026, 10, 21, 4, 0, 0)

	// Missing location by sale origin: only _id === web_save_operation_key proves web creation
	assert.equal(loc.formatSaleRowLocationText(null, { _id: 'web-op-1', web_save_operation_key: 'web-op-1', source: 'manual-v4' }), '网页手工建单（未采集定位）')
	// Edited legacy sale or bare manual-v4 without creation receipt stays neutral
	assert.equal(loc.formatSaleRowLocationText(null, { _id: 'legacy-1', web_save_operation_key: 'web-edit-2', source: 'manual-v4' }), '未记录定位')
	assert.equal(loc.formatSaleRowLocationText(null, { _id: 'legacy-2', source: 'manual-v4', web_save_review: { status: 'completed' } }), '未记录定位')
	assert.equal(loc.formatSaleRowLocationText(null, { _id: 'mob-1', source: 'mobile-sale-v1', mobile_create_operation_key: 'mob-1', web_save_operation_key: 'web-edit-3' }), '未记录定位（历史记录或未回填）')
	assert.equal(loc.formatSaleRowLocationText(null, {}), '未记录定位')

	// Existing data takes precedence even if later edited on web
	const scanOk = loc.formatSaleRowLocationText(
		{ status: 'ok', latitude: 31.230416, longitude: 121.473701, accuracy: 15, captured_at: ts, source: 'pda_bottle_scan' },
		{ _id: 'mob-1', source: 'mobile-sale-v1', mobile_create_operation_key: 'mob-1', web_save_operation_key: 'web-edit-1' }
	)
	assert.match(scanOk, /^PDA扫码 · 31\.230416, 121\.473701 \/ 精度15m \/ /)

	// Negative accuracy or out-of-range legacy data renders safely
	const negAccText = loc.formatSaleRowLocationText(
		{ status: 'ok', latitude: 31.230416, longitude: 121.473701, accuracy: -1, captured_at: ts, source: 'pda_bottle_scan' }
	)
	assert.doesNotMatch(negAccText, /精度/)
	assert.equal(
		loc.formatSaleRowLocationText({ status: 'ok', latitude: 95, longitude: 121, source: 'pda_bottle_scan' }),
		'PDA扫码 · 未记录定位'
	)

	const labelOk = loc.formatSaleRowLocationText(
		{ status: 'ok', latitude: 31.230416, longitude: 121.473701, accuracy: 8, captured_at: ts, source: 'pda_bottle_filling_label' }
	)
	assert.match(labelOk, /^PDA充装标签扫码 · 31\.230416, 121\.473701 \/ 精度8m \/ /)

	const manualOk = loc.formatSaleRowLocationText(
		{ status: 'ok', latitude: 31.230416, longitude: 121.473701, accuracy: 20, captured_at: ts, source: 'pda_bottle_manual' }
	)
	assert.match(manualOk, /^PDA手输 · 31\.230416, 121\.473701 \/ 精度20m \/ /)

	// Pending at submit vs interrupted vs failed
	assert.match(
		loc.formatSaleRowLocationText({ status: 'failed', error_code: 'pending_at_submit', error_message: '提交时定位尚未返回', source: 'pda_bottle_scan', captured_at: ts }),
		/^PDA扫码 · 交单时尚无定位结果 \/ /
	)
	assert.match(
		loc.formatSaleRowLocationText({ status: 'failed', error_code: 'pending_at_submit', source: 'pda_bottle_manual', captured_at: ts }),
		/^PDA手输 · 交单时尚无定位结果 \/ /
	)
	assert.match(
		loc.formatSaleRowLocationText({ status: 'failed', error_code: 'interrupted_background', error_message: '定位未完成（页面已切后台）', source: 'pda_bottle_scan', captured_at: ts }),
		/^PDA扫码 · 定位未完成（页面已切后台） \/ /
	)
	assert.equal(
		loc.formatSaleRowLocationText({ status: 'failed', error_code: 'timeout', error_message: '定位超时', source: 'pda_bottle_manual' }),
		'PDA手输 · 定位失败：定位超时'
	)

	// Legacy records compatibility
	assert.equal(
		loc.formatSaleRowLocationText({ status: 'failed', error_code: 'timeout', error_message: '定位超时', source: 'mobile_bottle_scan' }),
		'PDA扫码 · 定位失败：定位超时'
	)
	assert.equal(
		loc.formatSaleRowLocationText({ status: 'failed', error_code: 'timeout', error_message: '定位超时' }),
		'定位失败：定位超时'
	)

	// SaleDetailView wires detail origin into formatSaleRowLocationText for both out and back rows
	const detailView = fs.readFileSync('src/components/domain/sale/SaleDetailView.vue', 'utf8')
	assert.match(detailView, /import\s*\{\s*formatSaleRowLocationText\s*\}\s*from\s*'@\/services\/pda\/location'/)
	assert.match(detailView, /normalizeBottleRows\(detail\.value\?\.out_items,\s*detail\.value\)/)
	assert.match(detailView, /normalizeBottleRows\(detail\.value\?\.back_items,\s*detail\.value\)/)
	assert.match(detailView, /formatSaleRowLocationText\(row\?\.scan_location\s*\|\|\s*row\?\.scanLocation,\s*saleDoc\)/)
})

test('preserveEditedSaleRowLocations preserves exact original row locations on normal web edit and rejects delete+re-add, replace+revert, changed context or duplicates', () => {
	const loc = loadLocation({})
	const plain = (value) => JSON.parse(JSON.stringify(value))
	const outLoc = { status: 'ok', coordinate_type: 'wgs84', latitude: 31.23, longitude: 121.47, accuracy: 12, captured_at: 1795000000000, source: 'pda_bottle_scan' }
	const backLoc = { status: 'failed', coordinate_type: 'wgs84', error_code: 'timeout', error_message: '定位超时', captured_at: 1795000001000, source: 'pda_bottle_manual' }
	const originContext = {
		recordId: 'sale-1',
		deliveryCustomerId: 'cust-1',
		carNo: '沪A12345',
		out: [
			{ originLocationKey: 'sale-1:out:0', bottle_no: 'A01', bottle_id: 'b1', scan_location: outLoc },
			{ originLocationKey: 'sale-1:out:1', bottle_no: 'DUP', bottle_id: 'bd1', scan_location: outLoc },
			{ originLocationKey: 'sale-1:out:2', bottle_no: 'DUP', bottle_id: 'bd2', scan_location: outLoc }
		],
		back: [
			{ originLocationKey: 'sale-1:back:0', bottle_no: 'B01', bottle_id: 'b2', scan_location: backLoc }
		]
	}

	// Ordinary edit (weight/remark changed, original row keeps originLocationKey): preserves location and strips temp key
	const editedOut = loc.preserveEditedSaleRowLocations([
		{ originLocationKey: 'sale-1:out:0', bottle_no: 'a01', bottle_id: 'b1', gross: '122', tare: '100', net: '22' },
		{ bottle_no: 'NEW1', bottle_id: 'b9', gross: '120', tare: '100', net: '20' },
		{ originLocationKey: 'sale-1:back:0', bottle_no: 'B01', bottle_id: 'b2', gross: '120', tare: '100', net: '20' },
		{ originLocationKey: 'sale-1:out:1', bottle_no: 'DUP', bottle_id: 'bd1', gross: '120', tare: '100', net: '20' }
	], {
		direction: 'out',
		originContext,
		currentRecordId: 'sale-1',
		currentDeliveryCustomerId: 'cust-1',
		currentCarNo: ' 沪a12345 '
	})
	assert.deepEqual(plain(editedOut[0].scan_location), outLoc)
	assert.equal('originLocationKey' in editedOut[0], false)
	assert.equal(editedOut[1].scan_location, undefined)
	assert.equal(editedOut[2].scan_location, undefined)
	assert.equal(editedOut[3].scan_location, undefined)

	// Delete + re-add same bottleNo and bottle_id in same direction (no originLocationKey): must NOT inherit old GPS
	const readdedSameBottle = loc.preserveEditedSaleRowLocations([
		{ bottle_no: 'A01', bottle_id: 'b1', gross: '120', tare: '100', net: '20' }
	], {
		direction: 'out',
		originContext,
		currentRecordId: 'sale-1',
		currentDeliveryCustomerId: 'cust-1',
		currentCarNo: '沪A12345'
	})
	assert.equal(readdedSameBottle[0].scan_location, undefined)

	// Replace bottle then revert to original bottleNo (originLocationKey cleared to ''): must NOT inherit old GPS
	const replacedThenReverted = loc.preserveEditedSaleRowLocations([
		{ originLocationKey: '', bottle_no: 'A01', bottle_id: 'b1', gross: '120', tare: '100', net: '20' }
	], {
		direction: 'out',
		originContext,
		currentRecordId: 'sale-1',
		currentDeliveryCustomerId: 'cust-1',
		currentCarNo: '沪A12345'
	})
	assert.equal(replacedThenReverted[0].scan_location, undefined)

	// Back direction preserves original failed location faithfully
	const editedBack = loc.preserveEditedSaleRowLocations([
		{ originLocationKey: 'sale-1:back:0', bottle_no: 'B01', bottle_id: 'b2', gross: '100', tare: '100', net: '0' }
	], {
		direction: 'back',
		originContext,
		currentRecordId: 'sale-1',
		currentDeliveryCustomerId: 'cust-1',
		currentCarNo: '沪A12345'
	})
	assert.deepEqual(plain(editedBack[0].scan_location), backLoc)

	// Changed delivery customer, car, bottle_id or new record: never inherit
	const changedCustomer = loc.preserveEditedSaleRowLocations(
		[{ originLocationKey: 'sale-1:out:0', bottle_no: 'A01', bottle_id: 'b1' }],
		{ direction: 'out', originContext, currentRecordId: 'sale-1', currentDeliveryCustomerId: 'cust-2', currentCarNo: '沪A12345' }
	)
	assert.equal(changedCustomer[0].scan_location, undefined)

	const changedCar = loc.preserveEditedSaleRowLocations(
		[{ originLocationKey: 'sale-1:out:0', bottle_no: 'A01', bottle_id: 'b1' }],
		{ direction: 'out', originContext, currentRecordId: 'sale-1', currentDeliveryCustomerId: 'cust-1', currentCarNo: '沪B99999' }
	)
	assert.equal(changedCar[0].scan_location, undefined)

	const changedBottleId = loc.preserveEditedSaleRowLocations(
		[{ originLocationKey: 'sale-1:out:0', bottle_no: 'A01', bottle_id: 'b-other' }],
		{ direction: 'out', originContext, currentRecordId: 'sale-1', currentDeliveryCustomerId: 'cust-1', currentCarNo: '沪A12345' }
	)
	assert.equal(changedBottleId[0].scan_location, undefined)

	const newSale = loc.preserveEditedSaleRowLocations(
		[{ originLocationKey: 'sale-1:out:0', bottle_no: 'A01', bottle_id: 'b1', scan_location: outLoc }],
		{ direction: 'out', originContext: null, currentRecordId: '', currentDeliveryCustomerId: 'cust-1', currentCarNo: '沪A12345' }
	)
	assert.equal(newSale[0].scan_location, undefined)

	// SaleEditView & SaleBottleLinesCard wire originLocationKey and clear it on bottle change
	const editView = fs.readFileSync('src/components/domain/sale/SaleEditView.vue', 'utf8')
	assert.match(editView, /import\s*\{\s*preserveEditedSaleRowLocations\s*\}\s*from\s*'@\/services\/pda\/location'/)
	assert.match(editView, /preserveEditedSaleRowLocations\(outItems\.value/)
	assert.match(editView, /preserveEditedSaleRowLocations\(backItems\.value/)
	assert.match(editView, /scanLocationManaged:\s*true/)
	const linesCard = fs.readFileSync('src/components/domain/sale/SaleBottleLinesCard.vue', 'utf8')
	assert.match(linesCard, /patch\.originLocationKey\s*=\s*''/)
	assert.match(linesCard, /next\.originLocationKey\s*=\s*''/)
})

test('crm-sale updateV2 helper preserves original locations for legacy clients, respects managed omissions, and drops on context change or duplicates', () => {
	const plain = (value) => JSON.parse(JSON.stringify(value))
	const indexSource = fs.readFileSync('uniCloud-alipay/cloudfunctions/crm-sale/index.js', 'utf8')
	const start = indexSource.indexOf('function toFiniteLocationNumber(')
	const end = indexSource.indexOf('function normalizeBottleRows(')
	assert.ok(start > 0 && end > start)
	const snippet = indexSource.slice(start, end)
	const helpers = vm.runInNewContext(
		`function normalizeString(v){ return v == null ? '' : String(v).trim() }\n`
		+ `function normalizeBottleNoForCreate(v){ return normalizeString(v).toUpperCase() }\n`
		+ `${snippet}\n;({ normalizeScanLocation, preserveExistingBottleLocationsForUpdate })`,
		{ Date, Number, Math, Map }
	)

	// Legacy client omits scan_location on updateV2: server preserves authoritative original location
	const origLoc = { status: 'ok', coordinate_type: 'wgs84', latitude: 31.23, longitude: 121.47, accuracy: 15, captured_at: 1795000000000, source: 'pda_bottle_scan' }
	const kept = helpers.preserveExistingBottleLocationsForUpdate(
		[{ bottle_no: 'A01', bottle_id: 'b1', gross: 121, tare: 100, net: 21 }, { bottle_no: 'A02', bottle_id: 'b2', gross: 120, tare: 100, net: 20 }],
		[{ bottle_no: 'A01', bottle_id: 'b1', scan_location: origLoc }],
		{ existingDeliveryCustomerId: 'c1', nextDeliveryCustomerId: 'c1', existingCarNo: '沪A12345', nextCarNo: '沪a12345' }
	)
	assert.deepEqual(plain(kept[0].scan_location), origLoc)
	assert.equal(kept[1].scan_location, undefined)

	// Managed client (new SaleEditView): omitting scan_location (delete+re-add same bottleNo) must NOT resurrect old GPS
	const managedReadd = helpers.preserveExistingBottleLocationsForUpdate(
		[{ bottle_no: 'A01', bottle_id: 'b1', gross: 120, tare: 100, net: 20 }],
		[{ bottle_no: 'A01', bottle_id: 'b1', scan_location: origLoc }],
		{ existingDeliveryCustomerId: 'c1', nextDeliveryCustomerId: 'c1', existingCarNo: '沪A12345', nextCarNo: '沪A12345', clientManaged: true }
	)
	assert.equal(managedReadd[0].scan_location, undefined)

	// Managed client carrying original row location keeps authoritative server copy
	const managedKept = helpers.preserveExistingBottleLocationsForUpdate(
		[{ bottle_no: 'A01', bottle_id: 'b1', gross: 121, tare: 100, net: 21, scan_location: origLoc }],
		[{ bottle_no: 'A01', bottle_id: 'b1', scan_location: origLoc }],
		{ existingDeliveryCustomerId: 'c1', nextDeliveryCustomerId: 'c1', existingCarNo: '沪A12345', nextCarNo: '沪A12345', clientManaged: true }
	)
	assert.deepEqual(plain(managedKept[0].scan_location), origLoc)

	// Changed customer/car strips even client-supplied stale scan_location
	const dropped = helpers.preserveExistingBottleLocationsForUpdate(
		[{ bottle_no: 'A01', bottle_id: 'b1', scan_location: origLoc }],
		[{ bottle_no: 'A01', bottle_id: 'b1', scan_location: origLoc }],
		{ existingDeliveryCustomerId: 'c1', nextDeliveryCustomerId: 'c2', existingCarNo: '沪A12345', nextCarNo: '沪A12345' }
	)
	assert.equal(dropped[0].scan_location, undefined)

	// Server normalizeScanLocation rejects whitespace/array coords and negative accuracy
	assert.equal(helpers.normalizeScanLocation({ status: 'ok', latitude: '   ', longitude: 121 }).status, 'failed')
	assert.equal(helpers.normalizeScanLocation({ status: 'ok', latitude: [], longitude: 121 }).status, 'failed')
	assert.equal(helpers.normalizeScanLocation({ status: 'ok', latitude: 31.23, longitude: 121.47, accuracy: -2 }).accuracy, null)
})
