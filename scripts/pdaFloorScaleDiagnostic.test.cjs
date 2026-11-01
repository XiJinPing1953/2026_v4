const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const protocol = fs.readFileSync('src/services/pda/floorScaleProtocol.js', 'utf8').replace(/export /g, '')
const session = fs.readFileSync('src/services/pda/floorScaleDiagnostic.js', 'utf8').replace(/^import .*\n/, '').replace(/export /g, '')
const { createFloorScaleDiagnostic, FLOOR_SCALE_SERVICE_ID, FLOOR_SCALE_NOTIFY_ID, FLOOR_SCALE_WRITE_ID } = vm.runInThisContext(`${protocol}\n${session}\n;({createFloorScaleDiagnostic,FLOOR_SCALE_SERVICE_ID,FLOOR_SCALE_NOTIFY_ID,FLOOR_SCALE_WRITE_ID})`)
function frame() {
	const b = [0xaa, 3, 1, 23, 0, 16, 0x22, 0, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 42]
	b[4] = b.reduce((x, y) => x ^ y, 0); return Uint8Array.from(b)
}
function mock() {
	const events = {}, calls = []
	const runtime = { calls, events }
	for (const key of ['openBluetoothAdapter', 'createBLEConnection', 'closeBLEConnection', 'notifyBLECharacteristicValueChange']) {
		runtime[key] = options => { calls.push(key); options.success({}) }
	}
	runtime.getBLEDeviceServices = o => o.success({ services: [{ uuid: FLOOR_SCALE_SERVICE_ID }] })
	runtime.getBLEDeviceCharacteristics = o => o.success({ characteristics: [{ uuid: FLOOR_SCALE_NOTIFY_ID, properties: { notify: true } }] })
	runtime.onBLECharacteristicValueChange = cb => events.value = cb
	runtime.onBLEConnectionStateChange = cb => events.connection = cb
	runtime.offBLECharacteristicValueChange = cb => { if (events.value === cb) delete events.value }
	runtime.offBLEConnectionStateChange = cb => { if (events.connection === cb) delete events.connection }
	return runtime
}
test('connection filters devices and reassembles notifications without writing', async () => {
	let t = 10000; const r = mock(), d = createFloorScaleDiagnostic(r, { now: () => t })
	assert.equal((await d.connect('device-a')).code, 0)
	const bytes = frame(), event = { deviceId: 'device-a', serviceId: FLOOR_SCALE_SERVICE_ID, characteristicId: FLOOR_SCALE_NOTIFY_ID }
	r.events.value({ ...event, deviceId: 'other', value: bytes }); assert.equal(d.getSnapshot().frame, null)
	r.events.value({ ...event, value: bytes.subarray(0, 16) }); assert.equal(d.getSnapshot().frame, null)
	r.events.value({ ...event, value: bytes.subarray(16) }); assert.equal(d.getSnapshot().frame.weightHex, '0000000000000001')
	assert.equal(d.getSnapshot().verifiedForCapture, false)
	t += 3001; assert.equal(d.getSnapshot().frame, null)
	await d.disconnect(); assert.equal(r.events.value, undefined)
	assert.equal(r.calls.includes('writeBLECharacteristicValue'), false)
})
test('stale fragments and disconnection cannot form a new frame', async () => {
	let t = 10000; const r = mock(), d = createFloorScaleDiagnostic(r, { now: () => t }); await d.connect('a')
	const bytes = frame(), event = { deviceId: 'a', characteristicId: FLOOR_SCALE_NOTIFY_ID }
	r.events.value({ ...event, value: bytes.subarray(0, 10) }); t += 3001
	r.events.value({ ...event, value: bytes.subarray(10) }); assert.equal(d.getSnapshot().frame, null)
	r.events.value({ ...event, value: bytes }); assert.ok(d.getSnapshot().frame)
	r.events.connection({ deviceId: 'a', connected: false }); assert.equal(d.getSnapshot().frame, null)
	await d.disconnect()
})
test('missing service closes the connection and unregisters listeners', async () => {
	const r = mock(); r.getBLEDeviceServices = o => o.success({ services: [] })
	const d = createFloorScaleDiagnostic(r); assert.equal((await d.connect('a')).code, 500)
	assert.equal(d.getSnapshot().status, 'disconnected'); assert.ok(r.calls.includes('closeBLEConnection')); assert.equal(r.events.value, undefined)
})
test('discovers only named floor scales and stops scanning', async () => {
	const r = mock()
	r.startBluetoothDevicesDiscovery = o => { r.calls.push('startScan'); o.success({}) }
	r.stopBluetoothDevicesDiscovery = o => { r.calls.push('stopScan'); o.success({}) }
	r.getBluetoothDevices = o => o.success({ devices: [{ deviceId: 'a', name: 'WEIGHT_01' }, { deviceId: 'a', name: 'WEIGHT_01' }, { deviceId: 'b', name: 'NVK01' }] })
	const d = createFloorScaleDiagnostic(r, { wait: async () => {} }), result = await d.discover()
	assert.equal(result.code, 0); assert.deepEqual(result.data, [{ deviceId: 'a', name: 'WEIGHT_01' }]); assert.ok(r.calls.includes('stopScan'))
})
test('cancelled connection closes a late success and cannot subscribe', async () => {
	const r = mock(); let finish
	r.createBLEConnection = o => { finish = () => o.success({}) }
	const d = createFloorScaleDiagnostic(r), pending = d.connect('a')
	await Promise.resolve(); await d.disconnect(); finish()
	assert.equal((await pending).code, 499); assert.notEqual(d.getSnapshot().status, 'connected')
	assert.equal(r.calls.includes('notifyBLECharacteristicValueChange'), false)
})
test('only valid calibration commands can write to the selected device, without retries', async () => {
	const r = mock(), sent = []
	r.getBLEDeviceCharacteristics = o => o.success({ characteristics: [{ uuid: FLOOR_SCALE_NOTIFY_ID, properties: { notify: true } }, { uuid: FLOOR_SCALE_WRITE_ID, properties: { writeNoResponse: true } }] })
	r.writeBLECharacteristicValue = o => { sent.push(o); o.success({}) }
	const d = createFloorScaleDiagnostic(r); await d.connect('a')
	assert.equal(d.getSnapshot().canWriteCalibration, true)
	const zero = Uint8Array.from([0xaa, 1, 3, 8, 0xa6, 1, 7, 0])
	await assert.rejects(d.writeCalibrationCommand(zero, 'other'), /已变化/)
	const corrupt = Uint8Array.from(zero); corrupt[4] ^= 1
	await assert.rejects(d.writeCalibrationCommand(corrupt, 'a'), /不正确/)
	await d.writeCalibrationCommand(zero, 'a')
	assert.equal(sent.length, 1); assert.equal(sent[0].writeType, 'writeNoResponse'); assert.equal(sent[0].characteristicId, FLOOR_SCALE_WRITE_ID)
	assert.deepEqual([...new Uint8Array(sent[0].value)], [...zero])
	await d.disconnect(); await assert.rejects(d.writeCalibrationCommand(zero, 'a'), /已变化/)
})
test('disconnect while writing reports the result as uncertain', async () => {
	const r = mock(); let finish
	r.getBLEDeviceCharacteristics = o => o.success({ characteristics: [{ uuid: FLOOR_SCALE_NOTIFY_ID, properties: { notify: true } }, { uuid: FLOOR_SCALE_WRITE_ID, properties: { write: true } }] })
	r.writeBLECharacteristicValue = o => { finish = o.success }
	const d = createFloorScaleDiagnostic(r); await d.connect('a')
	const write = d.writeCalibrationCommand(Uint8Array.from([0xaa, 1, 3, 8, 0xa6, 1, 7, 0]), 'a')
	r.events.connection({ deviceId: 'a', connected: false }); finish({})
	await assert.rejects(write, /待核对/)
	await d.disconnect()
})
