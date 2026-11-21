const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const source = readFileSync('src/services/pda/amapSaleLocation.js', 'utf8').replace(/^import .*\n/, '').replace(/^export /gm, '')

function setup() {
	const now = Date.now()
	const fix = { getErrorCode: 0, getLocationType: 5, getTime: now - 1000, getCoordType: 'GCJ-02', getLatitude: 36, getLongitude: 115, getAccuracy: 30 }
	let permission, listener, starts = 0, stops = 0, system = 0, consent = false
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
		plus: { android }, Date, setTimeout, clearTimeout, normalizePdaScanLocation: x => x,
		createPdaScanLocationFailure: error => ({ status: 'failed', errorCode: error.code }),
		getPdaBottleScanLocation: async () => { system++; return { coordinateType: 'wgs84' } }
	})
	return {
		session: helpers.createSaleLocationSession(() => consent), enable() { consent = true },
		permit() { permission({ granted: ['android.permission.ACCESS_FINE_LOCATION'] }) },
		deny() { permission({ granted: [] }) },
		respond(changes = {}) { listener.onLocationChanged({ ...fix, ...changes }) }, check: changes => helpers.readAmapFix(android, { ...fix, ...changes }, now),
		counts: () => [starts, stops, system]
	}
}

test('no consent uses system positioning and never starts a vendor request', async () => {
	const h = setup()
	assert.equal((await h.session.locate({})).coordinateType, 'wgs84')
	assert.deepEqual(h.counts(), [0, 0, 1])
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


test('vendor failure falls back to system GPS, denied OS access does not prompt again', async () => {
	const h = setup(); h.enable()
	const faulty = h.session.locate({}); h.permit(); h.respond({ getErrorCode: 7 })
	assert.equal((await faulty).coordinateType, 'wgs84')
	const denied = h.session.locate({}); h.deny()
	assert.equal((await denied).errorCode, 'permission_denied')
	assert.deepEqual(h.counts(), [1, 1, 1])
})
