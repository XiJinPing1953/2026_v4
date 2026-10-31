const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const driverSource = fs.readFileSync('src/services/pda/capture/scannerDriver.js', 'utf8').replace(/export /g, '')
const source = fs.readFileSync('src/services/pda/capture/index.js', 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')
function setup({ powered = true, invalidMode = false, setterFails = false, openChecksBeforeReady = 0, neverReady = false, profileMissingReads = 0 } = {}) {
	const calls = [], scans = [], delays = [], properties = { 200000: 'original.action', 200002: 'original.data' }
	let opening = false, openChecks = 0
	let receiver, mode = 1, pluginLoads = 0, imports = 0, registered = false
	const manager = {}, activity = {}
	const android = {
		newObject: name => name === 'android.device.ScanManager' ? manager : {},
		importClass() { imports++; throw new Error('must not import intent') },
		runtimeMainActivity: () => activity,
		implements: (_, implementation) => { receiver = implementation; return receiver },
		invoke(target, method, ...args) {
			calls.push(method)
			if (target !== manager) {
				if (method === 'registerReceiver') registered = true
				if (method === 'unregisterReceiver') registered = false
				return
			}
			if (method === 'getOutputMode') return invalidMode ? undefined : mode
			if (method === 'getScannerState') return opening && (neverReady || openChecks++ < openChecksBeforeReady) ? false : powered
			if (method === 'getTriggerLockState') return false
			if (method === 'getPropertyString') return opening && profileMissingReads-- > 0 ? '' : properties[args[0]]
			if (method === 'setPropertyString') { if (setterFails) return undefined; properties[args[0]] = args[1]; return true }
			if (method === 'switchOutputMode') { mode = args[0]; return true }
			if (method === 'openScanner') { powered = true; opening = true; return true }
			if (method === 'closeScanner') { powered = false; opening = false; return true }
		}
	}
	const context = { plus: { os: { name: 'Android' }, android }, uni: { requireNativePlugin() { pluginLoads++; return null } },
		startPerformanceSpan: () => () => {}, normalizeText: value => value == null ? '' : String(value).trim(), setTimeout: (fn, ms) => { delays.push(ms); return setTimeout(fn, Math.min(ms, 5)) }, clearTimeout }
	const api = vm.runInNewContext(driverSource + '\n' + source + '\n;({ enterBarcodeSession, leaveBarcodeSession, restoreScannerProfile, setActiveBarcodeTarget, getScannerState, teardownPdaCapture })', context)
	const enter = (page = 'return', onResult = result => scans.push(result)) => api.enterBarcodeSession({ page, onResult, activeTarget: { page, target: 'bottle' } })
	const broadcast = text => receiver.onReceive(null, { getAction: () => 'android.intent.ACTION_DECODE_DATA', getStringExtra: key => key === 'barcode_string' ? text : '', getByteArrayExtra: () => null })
	return { api, enter, broadcast, calls, scans, delays, properties, state: () => ({ mode, powered, pluginLoads, imports, registered }) }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 15))
test('i6310 uses system scanner without constructing the incompatible plugin and restores original configuration', async () => {
	const h = setup()
	assert.equal((await h.enter()).code, 0)
	assert.equal(h.state().pluginLoads, 0)
	assert.equal(h.api.getScannerState().driver, 'system-scan-manager')
	assert.equal(h.state().mode, 0)
	h.broadcast('123'); assert.equal(h.scans.length, 0)
	await tick(); assert.equal(h.scans.length, 1)
	assert.equal(h.state().imports, 0)
	await h.api.leaveBarcodeSession({ page: 'return' })
	assert.equal(h.state().mode, 1)
	assert.equal(h.properties[200000], 'original.action')
	assert.equal(h.properties[200002], 'original.data')
	assert.equal(h.state().powered, true)
	assert.equal(h.state().registered, false)
	assert.equal(h.calls.filter(x => x === 'getPropertyString').length, 2)
})
test('pending entry cannot reattach after page leave; session-opened scanner is closed', async () => {
	const h = setup({ powered: false })
	const first = h.enter(); await Promise.resolve(); await Promise.resolve()
	const leaving = h.api.leaveBarcodeSession({ page: 'return' })
	assert.equal((await first).code, 499); await leaving
	assert.equal(h.api.getScannerState().sessionPage, '')
	assert.equal(h.state().registered, false)
	assert.equal(h.state().powered, false)
})
test('overlapping hide/unload and next page entry do not close or overwrite the new scanner', async () => {
	const h = setup({ powered: false })
	await h.enter('return')
	const hide = h.api.leaveBarcodeSession({ page: 'return' })
	const show = h.enter('filling')
	const unload = h.api.leaveBarcodeSession({ page: 'return' })
	await Promise.all([hide, show, unload])
	assert.equal(h.api.getScannerState().sessionPage, 'filling')
	assert.equal(h.state().registered, true)
	assert.equal(h.state().powered, true)
	assert.equal(h.calls.filter(x => x === 'closeScanner').length, 0)
	await h.api.teardownPdaCapture()
	assert.equal(h.state().powered, false)
})
test('queued broadcasts are cancelled on page or target switch; duplicate scans remain deduplicated', async () => {
	const h = setup(); await h.enter()
	h.broadcast('old'); await h.api.setActiveBarcodeTarget({ target: 'different' }); await tick()
	assert.equal(h.scans.length, 0)
	h.broadcast('old-page'); await h.enter('sale'); await tick()
	assert.equal(h.scans.length, 0)
	h.broadcast('new'); h.broadcast('new'); await tick()
	assert.equal(h.scans.length, 1)
	assert.equal(h.api.getScannerState().captureDiagnostic.broadcastDedupedCount, 1)
})
test('undefined native return is a failure, not output mode zero or successful parameter write', async () => {
	const invalid = setup({ invalidMode: true })
	assert.notEqual((await invalid.enter()).code, 0)
	assert.equal(invalid.state().registered, false)
	const failed = setup({ setterFails: true })
	assert.notEqual((await failed.enter()).code, 0)
	assert.equal(failed.state().registered, false)
	assert.equal(failed.state().mode, 1)
})
test('async scan rejection is caught without breaking subsequent broadcasts', async () => {
	const h = setup(); let count = 0
	await h.enter('return', async () => { count++; throw new Error('query failed') })
	h.broadcast('one'); await tick(); h.broadcast('two'); await tick()
	assert.equal(count, 2); assert.equal(h.api.getScannerState().lastError, 'query failed')
})
test('a confirmed synchronous open skips settling; delayed opening retains both existing waits and failure recovery', async () => {
	const immediate = setup({ powered: false })
	assert.equal((await immediate.enter()).code, 0)
	assert.deepEqual(immediate.delays, [])
	await immediate.api.leaveBarcodeSession({ page: 'return' })
	assert.equal(immediate.state().powered, false)
	const delayed = setup({ powered: false, openChecksBeforeReady: 2 })
	assert.equal((await delayed.enter()).code, 0)
	assert.deepEqual(delayed.delays, [250, 150])
	const failed = setup({ powered: false, neverReady: true })
	assert.equal((await failed.enter()).code, 500)
	assert.deepEqual(failed.delays, [250, 150])
	assert.equal(failed.state().registered, false); assert.equal(failed.state().powered, false)
})
test('ready power with unreadable configuration still settles and preserves the original broadcast profile', async () => {
	const h = setup({ powered: false, profileMissingReads: 4 })
	assert.equal((await h.enter()).code, 0); assert.deepEqual(h.delays, [250])
	await h.api.leaveBarcodeSession({ page: 'return' })
	assert.equal(h.properties[200000], 'original.action'); assert.equal(h.properties[200002], 'original.data')
})
