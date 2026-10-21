'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

class Events {
	constructor() { this.listeners = new Map() }
	addEventListener(type, listener) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set())
		this.listeners.get(type).add(listener)
	}
	removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
	emit(type, extra = {}) { for (const listener of [...(this.listeners.get(type) || [])]) listener({ target: this, ...extra }) }
	count(type) { return this.listeners.get(type)?.size || 0 }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
function clock() {
	let now = 10000, nextId = 0
	const timers = new Map()
	return {
		Date: class extends Date { static now() { return now } },
		setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { fn, at: now + ms, every: 0 }); return id },
		clearTimeout(id) { timers.delete(id) },
		setInterval(fn, ms) { const id = ++nextId; timers.set(id, { fn, at: now + ms, every: ms }); return id },
		clearInterval(id) { timers.delete(id) },
		async advance(ms) {
			const end = now + ms
			for (;;) {
				const item = [...timers.entries()].filter(([, entry]) => entry.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
				if (!item) break
				const [id, entry] = item
				now = entry.at
				if (entry.every) entry.at += entry.every
				else timers.delete(id)
				entry.fn()
				await flush()
			}
			now = end
			await flush()
		},
		jump(ms) { now += ms },
		count: () => timers.size
	}
}
function load() {
	const time = clock()
	const context = vm.createContext({ ...time, ArrayBuffer, Uint8Array, DataView, TextDecoder, console, normalizeText: (value) => String(value ?? '').trim() })
	for (const file of ['bleScaleCore.js', 'webBleScale.js']) {
		const source = fs.readFileSync(path.join(process.cwd(), 'src/services/pda', file), 'utf8').replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '')
		vm.runInContext(source, context, { filename: file })
	}
	return { context, time }
}
function fixture(options = {}) {
	const { context, time } = load()
	const env = new Events()
	env.document = new Events()
	env.document.hidden = false
	env.isSecureContext = true
	const device = new Events()
	device.id = 'opaque-scale-id+1'
	device.name = 'NVK test scale'
	const stats = { requests: 0, connects: 0, services: [], characteristics: [], notifications: 0 }
	let characteristic = null, activeClick = false
	device.gatt = {
		connected: false,
		async connect() {
			stats.connects += 1
			if (options.connectDelay) await options.connectDelay
			this.connected = true
			return {
				async getPrimaryService(id) {
					stats.services.push(id)
					return {
						async getCharacteristic(id) {
							stats.characteristics.push(id)
							characteristic = new Events()
							characteristic.startNotifications = async () => { stats.notifications += 1 }
							return characteristic
						}
					}
				}
			}
		},
		disconnect() { this.connected = false; device.emit('gattserverdisconnected') }
	}
	env.navigator = { bluetooth: { requestDevice(request) {
		assert.equal(activeClick, true, 'requestDevice must execute synchronously inside the user click')
		stats.requests += 1
		stats.request = request
		if (options.requestDevice) return options.requestDevice(device)
		return Promise.resolve(device)
	} } }
	const session = context.createWebBleScaleSession({}, env)
	function clickConnect(options = {}) { activeClick = true; const result = session.connect(options); activeClick = false; return result }
	function send(text, offset = 0) {
		const payload = Buffer.from(text)
		const array = new Uint8Array(payload.length + offset + 3)
		array.fill(88)
		array.set(payload, offset)
		characteristic.value = new DataView(array.buffer, offset, payload.length)
		characteristic.emit('characteristicvaluechanged')
	}
	async function stable(weight = 25) {
		for (let i = 0; i < 5; i++) { if (i) await time.advance(300); send(`UT,NT,+${weight.toFixed(1)}kg\r\n`) }
	}
	return { context, time, env, device, session, stats, clickConnect, send, stable, characteristic: () => characteristic }
}

test('head and fixed UART frames retain raw kg conversion; sales quantize to 0.5 kg', () => {
	const { context } = load()
	assert.equal(context.parsePdaBleScaleLine('ST,NT,+ 25.4kg').weightKg, 25.4)
	assert.equal(context.parsePdaBleScaleLine('UT,NT,+25400.0g').weightKg, 25.4)
	assert.equal(context.parsePdaBleScaleLine('+   25.4 kg\r\n').weightKg, 25.4)
	assert.equal(context.parsePdaBleScaleLine('bad frame'), null)
	assert.equal(context.quantizeBleScaleWeightKg(25.46), 25.5)
	assert.equal(context.quantizeBleScaleWeightKg(25.24), 25)
	assert.equal(context.quantizeBleScaleWeightKg(25.26), 25.5)
})

test('capability detection uses HTTPS, available API and permissions policy, not user agent', () => {
	const { context } = load()
	assert.equal(context.getWebBleScaleCapabilities({ isSecureContext: false }).supported, false)
	assert.equal(context.getWebBleScaleCapabilities({ isSecureContext: true, navigator: {} }).supported, false)
	assert.equal(context.getWebBleScaleCapabilities({ isSecureContext: true, navigator: { bluetooth: { requestDevice() {} } } }).supported, true)
	assert.equal(context.getWebBleScaleCapabilities({ isSecureContext: true, navigator: { bluetooth: { requestDevice() {} } }, document: { featurePolicy: { features: () => ['bluetooth'], allowsFeature: () => false } } }).supported, false)
	assert.equal(context.getWebBleScaleCapabilities({ isSecureContext: true, navigator: { bluetooth: { requestDevice() {} } }, document: { featurePolicy: { features: () => ['camera'], allowsFeature: () => false } } }).supported, true)
})

test('user click invokes chooser before returning; GATT service and notify characteristic are explicit', async () => {
	const f = fixture()
	const pending = f.clickConnect()
	assert.equal(f.stats.requests, 1)
	assert.equal((await pending).code, 0)
	assert.equal(f.stats.request.filters[0].namePrefix, 'NVK')
	assert.equal(f.stats.request.optionalServices[0], '0000ffe0-0000-1000-8000-00805f9b34fb')
	assert.equal(f.stats.characteristics[0], '0000ffe1-0000-1000-8000-00805f9b34fb')
	assert.equal(f.session.getSnapshot().transport, 'web')
	await f.session.stop()
})

test('notifications parse split packets and DataView offsets without adjacent buffer bytes', async () => {
	const f = fixture()
	await f.clickConnect()
	f.session.beginMeasurement()
	f.send('ST,NT,+2', 3)
	f.send('5.4kg\r\n', 5)
	assert.equal(f.session.getSnapshot().weight_kg, 25.5)
	assert.equal(f.session.getSnapshot().frame_parse_ok_count, 1)
	f.send('+   24.0 kg\r\n+   25.0 kg\r\n', 2)
	assert.equal(f.session.getSnapshot().weight_kg, 25)
	assert.equal(f.session.getSnapshot().frame_parse_ok_count, 3)
	await f.session.stop()
})

test('fragmented weights and separate CR/LF do not flicker after stabilization; a new weight does invalidate', async () => {
	const f = fixture()
	await f.clickConnect()
	f.session.beginMeasurement()
	const states = []
	f.session.onSnapshot(value => states.push(value))
	for (let i = 0; i < 6; i++) {
		if (i) await f.time.advance(300)
		f.send('+  170.')
		f.send('0 kg\r')
		f.send('\n')
	}
	const stable = f.session.getSnapshot()
	assert.equal(stable.is_stable, true)
	assert.equal(stable.weight_kg, 170)
	assert.equal(stable.frame_parse_ok_count, 6)
	const firstStable = states.findIndex(value => value.is_stable)
	assert.ok(firstStable >= 0)
	assert.ok(states.slice(firstStable).every(value => value.is_stable), 'packet fragments must not report a weight change')
	f.send('+  170.')
	assert.equal(f.session.getSnapshot().is_stable, true)
	assert.equal(f.session.getSnapshot().sampled_at, stable.sampled_at)
	f.send('5 kg\r\n')
	assert.equal(f.session.getSnapshot().weight_kg, 170.5)
	assert.equal(f.session.getSnapshot().is_stable, false)
	await f.session.stop()
})

test('fragments cannot refresh a stable weight or extend its three-second validity', async () => {
	const f = fixture()
	await f.clickConnect()
	const id = f.session.beginMeasurement()
	await f.stable(170)
	const sampledAt = f.session.getSnapshot().sampled_at
	for (let i = 0; i < 5; i++) { await f.time.advance(500); f.send('\n') }
	assert.equal(f.session.getSnapshot().sampled_at, sampledAt)
	await f.time.advance(1000)
	assert.equal(f.session.getSnapshot().is_stable, false)
	assert.equal(f.session.getSnapshot().weight_kg, null)
	assert.notEqual(f.session.getSnapshot().session_id, id)
	await f.session.stop()
})

test('0.5 kg buckets stabilize small raw fluctuations but a half-kilogram step restarts the window', async () => {
	const f = fixture()
	await f.clickConnect()
	f.session.beginMeasurement()
	for (const weight of [170, 170.1, 169.9, 170.2, 170]) {
		f.send(`UT,NT,+${weight.toFixed(1)}kg\r\n`)
		await f.time.advance(300)
	}
	assert.equal(f.session.getSnapshot().weight_kg, 170)
	assert.equal(f.session.getSnapshot().is_stable, true)
	f.send('UT,NT,+170.5kg\r\n')
	assert.equal(f.session.getSnapshot().is_stable, false)
	await f.stable(170.5)
	assert.equal(f.session.getSnapshot().is_stable, true)
	await f.session.stop()
})

test('early ST and rising weights cannot fill before a fresh stable window', async () => {
	const f = fixture()
	await f.clickConnect()
	f.session.beginMeasurement()
	for (const weight of [20, 21, 22, 23]) { f.send(`ST,NT,+${weight}.0kg\r\n`); await f.time.advance(300) }
	assert.equal(f.session.getSnapshot().is_stable, false)
	assert.equal(f.session.getSnapshot().stable_seq, 0)
	await f.stable(25)
	assert.equal(f.session.getSnapshot().is_stable, true)
	assert.equal(f.session.getSnapshot().last_stable_weight_kg, 25)
	await f.session.stop()
})

test('local stability requires both five frames and 1200 ms; ST candidate can confirm at 1500 ms', async () => {
	const f = fixture()
	await f.clickConnect()
	f.session.beginMeasurement()
	for (let i = 0; i < 5; i++) f.send('UT,NT,+25.0kg\r\n')
	assert.equal(f.session.getSnapshot().is_stable, false)
	await f.time.advance(1200)
	f.send('UT,NT,+25.0kg\r\n')
	assert.equal(f.session.getSnapshot().is_stable, true)
	f.session.beginMeasurement()
	f.send('ST,NT,+26.0kg\r\n')
	await f.time.advance(1499)
	f.send('ST,NT,+26.0kg\r\n')
	assert.equal(f.session.getSnapshot().is_stable, false)
	await f.time.advance(1)
	f.send('ST,NT,+26.0kg\r\n')
	assert.equal(f.session.getSnapshot().is_stable, true)
	await f.session.stop()
})

test('beginMeasurement returns a new identity and clears previous stable frames for equal-weight bottles', async () => {
	const f = fixture()
	await f.clickConnect()
	const first = f.session.beginMeasurement()
	await f.stable(25)
	assert.equal(f.session.getSnapshot().stable_seq, 1)
	const second = f.session.beginMeasurement()
	assert.notEqual(second, first)
	assert.equal(f.session.getSnapshot().session_id, second)
	assert.equal(f.session.getSnapshot().last_stable_weight_kg, null)
	assert.equal(f.session.getSnapshot().weight_kg, null)
	f.send('UT,NT,+25.0kg\r\n')
	assert.equal(f.session.getSnapshot().is_stable, false)
	await f.time.advance(300)
	await f.stable(25)
	assert.equal(f.session.getSnapshot().is_stable, true)
	assert.equal(f.session.getSnapshot().session_id, second)
	await f.session.stop()
})

test('three-second read timeout invalidates measurement and removes old stable cache', async () => {
	const f = fixture()
	await f.clickConnect()
	const id = f.session.beginMeasurement()
	await f.stable()
	await f.time.advance(3400)
	const value = f.session.getSnapshot()
	assert.equal(value.is_online, false)
	assert.equal(value.is_stable, false)
	assert.equal(value.last_stable_weight_kg, null)
	assert.equal(value.weight_kg, null)
	assert.notEqual(value.session_id, id)
	await f.session.stop()
})

test('a suspended timer cannot join stable samples across a long notification gap', async () => {
	const f = fixture()
	await f.clickConnect()
	const id = f.session.beginMeasurement()
	await f.stable()
	f.time.jump(6000)
	f.send('UT,NT,+25.0kg\r\n')
	assert.notEqual(f.session.getSnapshot().session_id, id)
	assert.equal(f.session.getSnapshot().is_stable, false)
	assert.equal(f.session.getSnapshot().last_stable_weight_kg, null)
	await f.session.stop()
})

test('physical disconnect invalidates pending identity; reconnect retrieves new GATT objects without another chooser', async () => {
	const f = fixture()
	await f.clickConnect()
	const id = f.session.beginMeasurement()
	await f.stable()
	const oldCharacteristic = f.characteristic()
	f.device.gatt.disconnect()
	assert.notEqual(f.session.getSnapshot().session_id, id)
	assert.equal(f.session.getSnapshot().last_stable_weight_kg, null)
	await f.time.advance(1000)
	assert.equal(f.stats.requests, 1)
	assert.equal(f.stats.services.length, 2)
	assert.equal(f.stats.characteristics.length, 2)
	assert.notEqual(f.characteristic(), oldCharacteristic)
	assert.equal(oldCharacteristic.count('characteristicvaluechanged'), 0)
	assert.equal(f.session.getSnapshot().is_connected, true)
	await f.session.stop()
})

test('hiding page clears measurement synchronously, disconnects and prevents automatic reconnect', async () => {
	const f = fixture()
	await f.clickConnect()
	const id = f.session.beginMeasurement()
	await f.stable()
	f.env.document.hidden = true
	f.env.document.emit('visibilitychange')
	assert.equal(f.session.getSnapshot().is_connected, false)
	assert.notEqual(f.session.getSnapshot().session_id, id)
	await f.time.advance(10000)
	assert.equal(f.stats.connects, 1)
	assert.equal(f.device.gatt.connected, false)
	await f.session.stop()
	assert.equal(f.env.document.count('visibilitychange'), 0)
	assert.equal(f.env.count('pagehide'), 0)
	assert.equal(f.time.count(), 0)
})

test('chooser cancellation returns 499 once and never reopens automatically', async () => {
	const f = fixture({ requestDevice: () => Promise.reject(Object.assign(new Error('cancel'), { name: 'NotFoundError' })) })
	assert.equal((await f.clickConnect()).code, 499)
	await f.time.advance(10000)
	assert.equal(f.stats.requests, 1)
	assert.equal(f.stats.connects, 0)
	await f.session.stop()
})

test('a late chooser result after hiding page cannot establish a connection', async () => {
	let resolve
	const pending = new Promise((yes) => { resolve = yes })
	const f = fixture({ requestDevice: () => pending })
	const connection = f.clickConnect()
	f.env.document.hidden = true
	f.env.document.emit('visibilitychange')
	resolve(f.device)
	assert.equal((await connection).code, 499)
	assert.equal(f.stats.connects, 0)
	await f.session.stop()
})

test('stop during GATT connection closes a late connection instead of reviving the page session', async () => {
	let resolve
	const delay = new Promise((yes) => { resolve = yes })
	const f = fixture({ connectDelay: delay })
	const connection = f.clickConnect()
	await flush()
	assert.equal(f.stats.connects, 1)
	await f.session.stop()
	resolve()
	assert.equal((await connection).code, 499)
	assert.equal(f.session.getSnapshot().is_connected, false)
	assert.equal(f.device.gatt.connected, false)
})

test('native uni callback transport still feeds the same measurement engine', async () => {
	const { context, time } = load()
	let onValue, onConnection
	const native = {
		openBluetoothAdapter: (args) => args.success({}), createBLEConnection: (args) => args.success({}),
		notifyBLECharacteristicValueChange: (args) => args.success({}), closeBLEConnection: (args) => args.success({}), closeBluetoothAdapter: (args) => args.success({}),
		onBLECharacteristicValueChange: (fn) => { onValue = fn }, offBLECharacteristicValueChange() {},
		onBLEConnectionStateChange: (fn) => { onConnection = fn }, offBLEConnectionStateChange() {}
	}
	const session = context.createBleScaleCoreSession({ deviceId: 'AA:BB:CC:DD:EE:FF' }, native)
	assert.equal((await session.connect()).code, 0)
	const id = session.beginMeasurement()
	for (let i = 0; i < 5; i++) {
		if (i) await time.advance(300)
		const bytes = Uint8Array.from(Buffer.from('UT,NT,+25.0kg\r\n'))
		onValue({ deviceId: 'aa-bb-cc-dd-ee-ff', characteristicId: 'FFE1', value: bytes.buffer })
	}
	assert.equal(session.getSnapshot().transport, 'native')
	assert.equal(session.getSnapshot().is_stable, true)
	onConnection({ deviceId: 'AA:BB:CC:DD:EE:FF', connected: false })
	assert.notEqual(session.getSnapshot().session_id, id)
	assert.equal(session.getSnapshot().last_stable_weight_kg, null)
	await session.stop()
})


test('a new measurement receives its own three-second timeout even after a long connection', async () => {
	const f = fixture()
	await f.clickConnect()
	for (let i = 0; i < 8; i++) { await f.time.advance(500); f.send('UT,NT,+25.0kg\r\n') }
	const id = f.session.beginMeasurement()
	await f.time.advance(500)
	assert.equal(f.session.getSnapshot().session_id, id)
	assert.equal(f.session.getSnapshot().is_connected, true)
	await f.stable()
	assert.equal(f.session.getSnapshot().session_id, id)
	assert.equal(f.session.getSnapshot().is_stable, true)
	await f.session.stop()
})

function nativeFixture({ failAttempts = [], holdAttempt = 0 } = {}) {
	const { context, time } = load()
	let onValue, onConnection, heldConnection
	const stats = { connects: [], closes: 0 }
	const deviceId = 'AA:BB:CC:DD:EE:FF'
	const lost = () => onConnection?.({ deviceId, connected: false })
	const native = {
		openBluetoothAdapter: args => args.success({}),
		createBLEConnection(args) {
			stats.connects.push(time.Date.now())
			if (stats.connects.length === holdAttempt) { heldConnection = args; return }
			if (failAttempts.includes(stats.connects.length)) args.fail({ errCode: 10003, errMsg: 'temporary connection failure' })
			else args.success({})
		},
		notifyBLECharacteristicValueChange: args => args.success({}),
		// Native cleanup may also report a disconnected event.
		closeBLEConnection(args) { stats.closes++; lost(); args.success({}) },
		closeBluetoothAdapter: args => args.success({}),
		onBLECharacteristicValueChange: fn => { onValue = fn }, offBLECharacteristicValueChange() {},
		onBLEConnectionStateChange: fn => { onConnection = fn }, offBLEConnectionStateChange() { onConnection = null }
	}
	const session = context.createBleScaleCoreSession({ deviceId }, native)
	const send = (text = 'UT,NT,+120.0kg\r\n') => onValue({ deviceId, characteristicId: 'FFE1', value: Uint8Array.from(Buffer.from(text)).buffer })
	return { time, session, stats, send, lost, finishConnect: () => heldConnection.success({}) }
}

test('native data timeout invalidates weight without reconnecting a live link; fresh frames recover automatically', async () => {
	const f = nativeFixture()
	await f.session.connect()
	for (let i = 0; i < 5; i++) { f.send(); await f.time.advance(300) }
	assert.equal(f.session.getSnapshot().is_stable, true)
	const previousSession = f.session.getSnapshot().session_id
	await f.time.advance(3500)
	assert.equal(f.session.getSnapshot().error_code, 'read_timeout')
	assert.equal(f.session.getSnapshot().is_connected, true)
	assert.equal(f.session.getSnapshot().is_online, false)
	assert.equal(f.session.getSnapshot().weight_kg, null)
	assert.equal(f.session.getSnapshot().last_stable_weight_kg, null)
	assert.notEqual(f.session.getSnapshot().session_id, previousSession)
	// Cover both prolonged silence and a recovery near the old 4.5-second reconnect.
	await f.time.advance(10000)
	assert.equal(f.stats.connects.length, 1)
	f.send()
	assert.equal(f.session.getSnapshot().is_online, true)
	assert.equal(f.session.getSnapshot().is_stable, false)
	await f.time.advance(4000)
	f.send()
	await f.time.advance(500)
	assert.equal(f.stats.connects.length, 1)
	assert.equal(f.stats.closes, 0)
	assert.equal(f.session.getSnapshot().weight_kg, 120)
	await f.session.stop()
})

test('native physical loss retries bound device at 1/2/5 seconds despite failed cleanup and duplicate loss events', async () => {
	const f = nativeFixture({ failAttempts: [2, 3] })
	await f.session.connect()
	f.send()
	f.lost()
	assert.equal(f.session.getSnapshot().weight_kg, null)
	await f.time.advance(500)
	f.lost()
	await f.time.advance(500)
	assert.equal(f.stats.connects.length, 2)
	assert.equal(f.session.getSnapshot().is_connected, false)
	await f.time.advance(2000)
	assert.equal(f.stats.connects.length, 3)
	await f.time.advance(5000)
	assert.deepEqual(f.stats.connects, [10000, 11000, 13000, 18000])
	assert.equal(f.session.getSnapshot().is_connected, true)
	assert.equal(f.session.getSnapshot().is_online, false)
	assert.equal(f.session.getSnapshot().last_stable_weight_kg, null)
	f.send()
	assert.equal(f.session.getSnapshot().is_online, true)
	await f.session.stop()
})

test('native stop cancels both scheduled and in-flight automatic reconnects', async () => {
	for (const inFlight of [false, true]) {
		const f = nativeFixture({ holdAttempt: inFlight ? 2 : 0 })
		await f.session.connect()
		f.lost()
		if (inFlight) await f.time.advance(1000)
		await f.session.stop()
		if (inFlight) { f.finishConnect(); await flush() }
		await f.time.advance(15000)
		assert.equal(f.stats.connects.length, inFlight ? 2 : 1)
		assert.equal(f.session.getSnapshot().is_connected, false)
		assert.equal(f.time.count(), 0)
	}
})

test('native initial bound-device failure retains manual error without background retries', async () => {
	const f = nativeFixture({ failAttempts: [1] })
	assert.equal((await f.session.connect()).code, 409)
	assert.equal(f.session.getSnapshot().error_code, 'bound_device_unavailable')
	await f.time.advance(15000)
	assert.equal(f.stats.connects.length, 1)
	await f.session.stop()
})
