const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const source = readFileSync('src/services/pda/amapSaleLocation.js', 'utf8').replace(/^import .*\n/, '').replace(/^export /gm, '')

function setup() {
	const now = Date.now()
	const fix = { getErrorCode: 0, getLocationType: 5, getTime: now - 1000, getCoordType: 'GCJ-02', getLatitude: 36, getLongitude: 115, getAccuracy: 30 }
	let permission, listener, fireTimeout, starts = 0, stops = 0, system = 0, consent = false
	const android = {
		requestPermissions(_, reply) { permission = reply },
		runtimeMainActivity: () => ({}),
		importClass: name => name.endsWith('Mode') ? { Battery_Saving: 'network' } : { updatePrivacyShow() {}, updatePrivacyAgree() {} },
		newObject: () => ({}),
		implements(_, value) { listener = value; return value },
		invoke(object, method) {
			if (method === 'startLocation') starts++
			if (method === 'onDestroy') stops++
			return object[method]
		}
	}
	const helpers = vm.runInNewContext(source + '\n;({createSaleLocationSession,readAmapFix})', {
		plus: { android }, Date, setTimeout(fn) { fireTimeout = fn; return 1 }, clearTimeout() {}, normalizePdaScanLocation: x => x,
		createPdaScanLocationFailure: error => ({ status: 'failed', errorCode: error.code }),
		getPdaBottleScanLocation: async () => { system++; return { coordinateType: 'wgs84' } }
	})
	return {
		session: helpers.createSaleLocationSession(() => consent), enable() { consent = true },
		permit() { permission({ granted: ['android.permission.ACCESS_FINE_LOCATION'] }) },
		timeout() { fireTimeout() },
		deny() { permission({ granted: [] }) },
		respond(changes = {}) { listener.onLocationChanged({ ...fix, ...changes }) }, check: changes => helpers.readAmapFix(android, { ...fix, ...changes }, now),
		counts: () => [starts, stops, system]
	}
}

test('a sale without consent makes zero location requests', async () => {
	const h = setup()
	assert.equal((await h.session.locate({})).errorCode, 'amap_consent_required')
	assert.deepEqual(h.counts(), [0, 0, 0])
})

test('concurrent bottle requests retain independent sources and use a fresh session after completion', async () => {
	const h = setup(); h.enable()
	const a = h.session.locate({ source: 'out' }), b = h.session.locate({ source: 'back' })
	h.permit(); h.respond()
	assert.equal((await a).source, 'out')
	const row = await b
	assert.equal(row.coordinateType, 'gcj02')
	assert.equal(row.source, 'back')
	assert.equal(row.accuracy, 30)
	assert.deepEqual(h.counts(), [1, 1, 0])
	const next = h.session.locate({}); h.permit(); h.respond(); await next
	assert.deepEqual(h.counts(), [2, 2, 0])
})

test('leaving before permission or cancelling an active request prevents any late result or fallback', async () => {
	const h = setup(); h.enable()
	let valid = true
	const before = h.session.locate({ shouldContinue: () => valid }); valid = false; h.permit()
	assert.equal(await before, null)
	assert.deepEqual(h.counts(), [0, 0, 0])
	const running = h.session.locate({}); h.permit(); h.session.cancel(); h.respond()
	assert.equal(await running, null)
	assert.deepEqual(h.counts(), [1, 1, 0])
})

test('rejects SDK errors, mock, stale, cached, invalid or unlabelled fixes', () => {
	const h = setup()
	for (const changes of [{ getErrorCode: 7 }, { isMock: true }, { getLocationType: 4 }, { getTime: Date.now() - 31000 },
		{ getCoordType: '' }, { getTime: null }, { getAccuracy: 0 }, { getLatitude: null }, { getLongitude: 181 }]) {
		assert.equal(h.check(changes), null)
	}
	assert.equal(h.check({ getLocationType: 6 }).coordinateType, 'gcj02')
})


test('AMap failure, timeout and denied permission never trigger system positioning', async () => {
	const h = setup(); h.enable()
	const faulty = h.session.locate({}); h.permit(); h.respond({ getErrorCode: 7 })
	assert.equal((await faulty).errorCode, 'amap_no_fix')
	const slow = h.session.locate({}); h.permit(); h.timeout(); h.respond()
	assert.equal((await slow).errorCode, 'amap_timeout')
	const denied = h.session.locate({}); h.deny()
	assert.equal((await denied).errorCode, 'permission_denied')
	assert.deepEqual(h.counts(), [2, 2, 0])
})


test('previous AMap consent survives upgrades and the retired system option never grants consent', () => {
	const store = new Map()
	const uni = { getStorageSync: key => store.get(key), setStorageSync: (key, v) => store.set(key, v) }
	const { readSaleLocationConsent: read, saveSaleLocationConsent: save } = vm.runInNewContext(
		source + '\n;({readSaleLocationConsent,saveSaleLocationConsent})', { uni })
	store.set('pda.sale.amap.choice.v1.old', 'system')
	assert.equal(read('old'), '')
	save('old', 'declined')
	save('other', 'amap')
	assert.equal(read('old'), 'declined')
	assert.equal(read('other'), 'amap')
	assert.equal(read('new'), '')
})

test('the Android sale entry binds only the AMap session and offers no provider switch', () => {
	const page = readFileSync('src/components/domain/pda/PdaNativeSaleView.vue', 'utf8')
	const template = page.split('</template>\n\n<script')[0]
	assert.match(page, /locate: iosSale \? getPdaBottleScanLocation : locationSession\.locate/)
	assert.doesNotMatch(template, /系统定位|定位方式/)
	assert.doesNotMatch(source, /getPdaBottleScanLocation|uni\.getLocation/)
})
