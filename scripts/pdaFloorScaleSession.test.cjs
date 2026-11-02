const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const load = fs.readFileSync('src/services/pda/floorScaleLoad.js','utf8').replace(/export /g,'')
const protocol = fs.readFileSync('src/services/pda/floorScaleProtocol.js', 'utf8').replace(/export /g, '')
const session = fs.readFileSync('src/services/pda/floorScaleSession.js', 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')
test('candidate readings remain display-only and are invalidated on disconnection', async () => {
	let push, state = { status: 'idle' }, interval
	const diagnostic = {
		subscribe(cb) { push = cb; cb(state); return () => {} },
		getSnapshot() { return state }, discover: async () => ({ code: 0, data: [] }),
		connect: async () => { state = { status: 'connected', deviceId: 'floor' }; push(state); return { code: 0 } },
		disconnect: async () => { state = { status: 'disconnected' }; push(state) }
	}
	const { createFloorScaleSession } = vm.runInNewContext(`${load}\n${protocol}\n${session}\n;({createFloorScaleSession})`, {
		Date, Number, ArrayBuffer, Uint8Array, parseInt, Set,
		createFloorScaleDiagnostic: () => diagnostic,
		setInterval: fn => { interval = fn; return 1 }, clearInterval: () => {}
	})
	const s = createFloorScaleSession({}); await s.connect({ preferredDeviceId: 'floor' }); s.beginMeasurement()
	state = { status: 'connected', deviceId: 'floor', fresh: true, sampledAt: 1000,
		frame: { weightHex: '00000000000F4240', rawHex: 'AA', verifiedForCapture: false } }; push(state)
	assert.equal(s.getSnapshot().weight_kg, 1); assert.equal(s.getSnapshot().is_stable, false)
	assert.equal(s.getSnapshot().diagnostic_frame.verifiedForCapture, false)
	state = { status: 'connected', deviceId: 'floor', fresh: false }; interval()
	assert.equal(s.getSnapshot().weight_kg, null)
	await s.disconnect(); assert.equal(s.getSnapshot().is_connected, false)
})
