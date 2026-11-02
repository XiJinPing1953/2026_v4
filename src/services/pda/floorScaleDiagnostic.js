import { createFloorScaleFrameDecoder, FLOOR_SCALE_SERVICE_ID, FLOOR_SCALE_NOTIFY_ID, FLOOR_SCALE_WRITE_ID, FLOOR_SCALE_NAME_PREFIX } from './floorScaleProtocol'

// Independent commissioning session; it never closes the shared BLE adapter.
const normal = value => String(value || '').trim().toUpperCase()
// App-Plus exposes onBLE* but not offBLE*. Keep one dispatcher per runtime
// and event there; retired pages release their callbacks from its subscriber set.
// Never remove all BLE listeners: hanging scales may share the same runtime.
const floorEventHubs = new WeakMap()
function subscribeRuntimeEvent(runtime, onName, offName, listener) {
	let hubs = floorEventHubs.get(runtime)
	if (!hubs) { hubs = new Map(); floorEventHubs.set(runtime, hubs) }
	let hub = hubs.get(onName)
	if (!hub) {
		const subscribers = new Set()
		const dispatch = event => { for (const fn of subscribers) fn(event) }
		runtime[onName](dispatch)
		hub = { subscribers, dispatch }; hubs.set(onName, hub)
	}
	hub.subscribers.add(listener)
	return () => {
		if (!hub.subscribers.delete(listener) || hub.subscribers.size) return
		if (typeof runtime[offName] === 'function') {
			try { runtime[offName](hub.dispatch); hubs.delete(onName) } catch (_) { /* Reuse the empty dispatcher if native removal is unavailable. */ }
		}
	}
}
function call(runtime, method, options = {}, timeoutMs = 6000, onLateSuccess) {
	return new Promise((resolve, reject) => {
		if (typeof runtime?.[method] !== 'function') return reject(new Error(`蓝牙接口不可用：${method}`))
		let settled = false, timedOut = false
		const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); callback(value) }
		const timer = setTimeout(() => { timedOut = true; finish(reject, new Error(`蓝牙操作超时：${method}，请重新连接`)) }, timeoutMs)
		try { runtime[method]({ ...options, success: value => { if (settled) { if (timedOut) { timedOut = false; onLateSuccess?.() }; return }; finish(resolve, value) }, fail: error => finish(reject, error) }) }
		catch (error) { finish(reject, error) }
	})
}

export function createFloorScaleDiagnostic(runtime, { onFrame, onInterrupted, now = Date.now, staleMs = 3000, callTimeoutMs = 6000, closeTimeoutMs = 1500, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
	const decoder = createFloorScaleFrameDecoder()
	let epoch = 0, connecting = false, scanning = false, attached = false, deviceId = '', lastFrame = null, lastAt = 0, lastChunkAt = 0
	let receiving = false, chunks = 0, receivedBytes = 0, validFrames = 0, lastRaw = new Uint8Array(0)
	const invoke = (method, options = {}, timeout = callTimeoutMs) => call(runtime, method, options, timeout)
	let emittedAt = null, emittedFresh = false
	let status = 'idle', reason = '', writeType = '', sessionKey = ''
	const listeners = new Set()
	let unbindEvents = []
	function snapshot() {
		const current = now()
		const fresh = status === 'connected' && lastAt > 0 && current >= lastAt && current - lastAt <= staleMs
		const communication = { chunks, receivedBytes, validFrames, ...decoder.getStats(), lastChunkAt: lastChunkAt || null,
			lastRawHex: Array.from(lastRaw, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase() }
		return { communication, status, reason, deviceId, sessionKey, frame: fresh ? lastFrame : null, sampledAt: fresh ? lastAt : null, fresh, canWriteCalibration: status === 'connected' && Boolean(writeType), verifiedForCapture: false }
	}
	function emit(force = true) {
		const time = now(), fresh = status === 'connected' && lastAt > 0 && time >= lastAt && time - lastAt <= staleMs
		if (!force && fresh === emittedFresh && emittedAt !== null && time >= emittedAt && time - emittedAt < 250) return
		emittedAt = time; emittedFresh = fresh
		const state = snapshot(); for (const listener of listeners) listener(state)
	}
	function clearData() { decoder.reset(); lastFrame = null; lastAt = 0; lastChunkAt = 0; chunks = 0; receivedBytes = 0; validFrames = 0; lastRaw = new Uint8Array(0) }
	function onValue(event) {
		if (!receiving || normal(event?.deviceId) !== normal(deviceId) ||
			normal(event?.characteristicId) !== normal(FLOOR_SCALE_NOTIFY_ID) ||
			(event?.serviceId && normal(event.serviceId) !== normal(FLOOR_SCALE_SERVICE_ID))) return
		const current = now(), time = event.receivedAt == null ? current : Number(event.receivedAt)
		// Native timestamps are captured before any UI/bridge queue. A delayed
		// notification must never make an old weight fresh enough to calibrate.
		if (!Number.isFinite(time) || time > current || current - time > staleMs || (lastChunkAt && time < lastChunkAt)) {
			decoder.reset(); lastFrame = null; lastAt = 0; onInterrupted?.()
			if (status === 'connected') emit(false)
			return
		}
		if (lastChunkAt && (time < lastChunkAt || time - lastChunkAt > staleMs)) decoder.reset()
		lastChunkAt = time
		let frames
		try {
			const bytes = event.value instanceof ArrayBuffer ? new Uint8Array(event.value) : ArrayBuffer.isView(event.value) ? new Uint8Array(event.value.buffer, event.value.byteOffset, event.value.byteLength) : Uint8Array.from(event.value || [])
			chunks++; receivedBytes += bytes.byteLength; lastRaw = bytes.slice(0, 46)
			const before = decoder.getStats()
			frames = decoder.push(bytes)
			const after = decoder.getStats()
			if (after.checksumErrors !== before.checksumErrors || after.formatErrors !== before.formatErrors) { onInterrupted?.(); frames = [] }
		} catch (_) { decoder.reset(); onInterrupted?.(); return }
		if (frames.length) { validFrames += frames.length; lastFrame = frames[frames.length - 1]; lastAt = time }
		if (status === 'connected') {
			for (const frame of frames) onFrame?.(frame, time, deviceId)
			emit(false)
		}
	}
	function onConnection(event) {
		if (normal(event?.deviceId) !== normal(deviceId) || event.connected !== false) return
		epoch++; receiving = false; clearData(); writeType = ''; sessionKey = ''; status = 'disconnected'; reason = '蓝牙连接中断'; detach(); emit()
	}
	function attach() {
		if (attached) return
		for (const name of ['onBLECharacteristicValueChange', 'onBLEConnectionStateChange']) {
			if (typeof runtime?.[name] !== 'function') throw new Error(`蓝牙监听接口不可用：${name}`)
		}
		try {
			unbindEvents.push(subscribeRuntimeEvent(runtime, 'onBLECharacteristicValueChange', 'offBLECharacteristicValueChange', onValue))
			unbindEvents.push(subscribeRuntimeEvent(runtime, 'onBLEConnectionStateChange', 'offBLEConnectionStateChange', onConnection))
			attached = true
		} catch (error) { detach(); throw error }
	}
	function detach() {
		for (const unbind of unbindEvents) unbind()
		unbindEvents = []; attached = false
	}
	async function close(id) { if (id) { try { await invoke('closeBLEConnection', { deviceId: id }, closeTimeoutMs) } catch (_) {} } }
	async function discover() {
		if (connecting || scanning || status === 'connected') return { code: 409, msg: '请先断开地秤连接', data: [] }
		scanning = true; const ticket = ++epoch
		let started = false
		try {
			await invoke('openBluetoothAdapter')
			if (ticket !== epoch) return { code: 499, msg: '扫描已取消', data: [] }
			started = true
			await invoke('startBluetoothDevicesDiscovery', { allowDuplicatesKey: false })
			if (ticket !== epoch) return { code: 499, msg: '扫描已取消', data: [] }
			await wait(5000)
			if (ticket !== epoch) return { code: 499, msg: '扫描已取消', data: [] }
			const result = await invoke('getBluetoothDevices')
			if (ticket !== epoch) return { code: 499, msg: '扫描已取消', data: [] }
			const seen = new Set(), devices = []
			for (const item of result?.devices || []) {
				const id = String(item.deviceId || '').trim(), name = String(item.name || item.localName || '').trim()
				if (!id || !normal(name).startsWith(FLOOR_SCALE_NAME_PREFIX) || seen.has(normal(id))) continue
				seen.add(normal(id)); devices.push({ deviceId: id, name })
			}
			return { code: devices.length ? 0 : 404, msg: devices.length ? '' : '未发现地秤设备', data: devices }
		} catch (error) {
			return { code: ticket !== epoch ? 499 : 500, msg: ticket !== epoch ? '扫描已取消' : String(error?.errMsg || error?.message || '扫描失败'), data: [] }
		} finally {
			if (started) { try { await invoke('stopBluetoothDevicesDiscovery') } catch (_) {} }
			scanning = false
		}
	}
	async function connect(id) {
		const target = String(id || '').trim()
		if (!target) return { code: 400, msg: '请选择地秤设备' }
		if (connecting || scanning || status === 'connected') return { code: 409, msg: '已有地秤连接或扫描任务，请先结束' }
		connecting = true; const ticket = ++epoch
		deviceId = target; clearData(); status = 'connecting'; reason = ''; emit()
		let opened = false
		const check = () => { if (ticket !== epoch) throw new Error('connection_cancelled') }
		try {
			await invoke('openBluetoothAdapter'); check(); attach()
			opened = true
			await call(runtime, 'createBLEConnection', { deviceId: target, timeout: callTimeoutMs }, callTimeoutMs, () => {
				// A timed-out native connection can still complete. Clean it only if
				// no newer attempt owns the same peripheral.
				if (ticket === epoch || normal(deviceId) !== normal(target) || (!connecting && status !== 'connected')) void close(target)
			}); check()
			const services = await invoke('getBLEDeviceServices', { deviceId: target }); check()
			const service = (services?.services || []).find(item => normal(item.uuid) === normal(FLOOR_SCALE_SERVICE_ID))
			if (!service) throw new Error('未找到地秤蓝牙服务')
			const chars = await invoke('getBLEDeviceCharacteristics', { deviceId: target, serviceId: service.uuid }); check()
			const characteristic = (chars?.characteristics || []).find(item => normal(item.uuid) === normal(FLOOR_SCALE_NOTIFY_ID))
			if (!characteristic || !(characteristic.properties?.notify || characteristic.properties?.indicate)) throw new Error('未找到地秤通知特征')
			const writable = (chars?.characteristics || []).find(item => normal(item.uuid) === normal(FLOOR_SCALE_WRITE_ID))
			writeType = writable?.properties?.writeNoResponse ? 'writeNoResponse' : writable?.properties?.write ? 'write' : ''
			receiving = true
			await invoke('notifyBLECharacteristicValueChange', { deviceId: target, serviceId: service.uuid, characteristicId: characteristic.uuid, state: true }); check()
			sessionKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
			status = 'connected'; reason = ''; emit(); return { code: 0, msg: '已连接，等待数据' }
		} catch (error) {
			receiving = false
			if (opened) await close(target)
			if (ticket !== epoch) return { code: 499, msg: '地秤连接已取消' }
			detach(); clearData(); writeType = ''; status = 'disconnected'; reason = String(error?.errMsg || error?.message || '连接失败'); emit()
			return { code: 500, msg: reason }
		} finally { connecting = false }
	}
	async function disconnect() {
		const target = deviceId; epoch++; receiving = false; clearData(); writeType = ''; sessionKey = ''; status = 'disconnected'; reason = ''; detach(); emit()
		await close(target)
	}
	async function writeCalibrationCommand(command, expectedDeviceId) {
		if (status !== 'connected' || !writeType || !expectedDeviceId || normal(expectedDeviceId) !== normal(deviceId)) throw new Error('地秤连接或写入接口已变化')
		const bytes = command instanceof Uint8Array ? command : Uint8Array.from(command || [])
		const valid = bytes[0] === 0xaa && bytes[1] === 1 && bytes[2] === 3 && bytes[3] === bytes.length && bytes[7] === 0 &&
			((bytes[6] === 7 && bytes.length === 8 && bytes[5] === 1) || (bytes[6] === 9 && bytes.length === 12 && bytes[5] === 5)) &&
			bytes.reduce((check, byte) => check ^ byte, 0) === 0
		if (!valid) throw new Error('校准指令格式不正确')
		const ticket = epoch, target = deviceId, mode = writeType
		clearData(); emit()
		await invoke('writeBLECharacteristicValue', { deviceId: target, serviceId: FLOOR_SCALE_SERVICE_ID,
			characteristicId: FLOOR_SCALE_WRITE_ID, value: Uint8Array.from(bytes).buffer, writeType: mode })
		if (ticket !== epoch || status !== 'connected' || normal(target) !== normal(deviceId)) throw new Error('指令发送结果待核对')
	}
	function subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener) }
	return { discover, connect, disconnect, subscribe, getSnapshot: snapshot, writeCalibrationCommand }
}
