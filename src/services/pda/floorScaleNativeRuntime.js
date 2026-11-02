import { FLOOR_SCALE_SERVICE_ID, FLOOR_SCALE_NOTIFY_ID, FLOOR_SCALE_WRITE_ID } from './floorScaleProtocol'

// Each page owns its native driver. Discovery still uses the existing shared
// adapter; connections, notifications and writes never enter uni's GATT map.
export function createFloorScaleNativeRuntime(runtime, android = typeof plus !== 'undefined' ? plus.android : null) {
	const values = new Set(), connections = new Set(), requests = new Map()
	let driver = null, listener = null, sequence = 0, generation = 0, deviceId = '', properties = null
	const fail = (options, message) => options.fail?.({ errMsg: message })
	function cancelPending() {
		for (const [id, request] of requests) {
			if (request.method === 'close') continue
			requests.delete(id); clearTimeout(request.timer)
			fail(request.options, '地秤连接已结束，操作结果待核对')
		}
	}
	function receive(raw) {
		let event
		try { event = JSON.parse(String(raw)) } catch (_) { return }
		if (event.type === 'result') {
			const request = requests.get(event.id)
			if (!request) return
			requests.delete(event.id); clearTimeout(request.timer)
			if (event.ok) request.options.success?.(event.data || {})
			else fail(request.options, `地秤蓝牙操作失败：${event.message || 'unknown'}`)
		} else if (event.type === 'disconnected') {
			properties = null
			cancelPending()
			for (const fn of connections) fn({ deviceId: event.deviceId, connected: false, status: event.status, reason: event.reason })
		} else if (event.type === 'value' && event.deviceId === deviceId && typeof event.hex === 'string' && event.hex.length <= 1024 && /^(?:[0-9A-F]{2})*$/.test(event.hex)) {
			const bytes = new Uint8Array(event.hex.length / 2)
			for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(event.hex.slice(i * 2, i * 2 + 2), 16)
			for (const fn of values) fn({ deviceId, serviceId: FLOOR_SCALE_SERVICE_ID, characteristicId: FLOOR_SCALE_NOTIFY_ID, value: bytes.buffer, receivedAt: event.receivedAt })
		}
	}
	function ensureDriver() {
		if (driver) return
		if (!android) throw new Error('请安装包含地秤连接修复的新 APK')
		try {
			const Driver = android.importClass('com.xintuo.scale.FloorScaleGatt')
			if (Number(Driver.apiVersion()) !== 1) throw new Error('native API mismatch')
			listener = android.implements('com.xintuo.scale.FloorScaleGatt$Listener', { onEvent: receive })
			driver = android.newObject('com.xintuo.scale.FloorScaleGatt', android.runtimeMainActivity(), listener)
		} catch (_) { throw new Error('当前 APK 缺少地秤连接修复模块，请安装新版 APK；热更新无法补齐') }
	}
	function request(method, args, options) {
		try { ensureDriver() } catch (error) { fail(options, error.message); return }
		const id = ++sequence, requestGeneration = generation
		const timer = setTimeout(() => {
			if (!requests.delete(id)) return
			// The Java owner has its own 6s watchdog. This is a bounded bridge
			// failure fallback and also closes only this page's native resource.
			if (requestGeneration === generation) { try { android.invoke(driver, 'close', 0) } catch (_) {} }
			fail(options, '地秤原生接口响应超时，请退出地秤页面后重试')
		}, 8000)
		requests.set(id, { options, timer, method })
		try { android.invoke(driver, method, ...args, id) }
		catch (error) { requests.delete(id); clearTimeout(timer); fail(options, error.message || '地秤原生接口调用失败') }
	}
	const selected = options => properties && String(options.deviceId).toUpperCase() === deviceId.toUpperCase()
	return {
		openBluetoothAdapter: options => runtime.openBluetoothAdapter(options),
		startBluetoothDevicesDiscovery: options => runtime.startBluetoothDevicesDiscovery(options),
		stopBluetoothDevicesDiscovery: options => runtime.stopBluetoothDevicesDiscovery(options),
		getBluetoothDevices: options => runtime.getBluetoothDevices(options),
		createBLEConnection(options) {
			generation++
			deviceId = String(options.deviceId || '').toUpperCase(); properties = null
			request('connect', [deviceId], { ...options, success(data) { properties = data; options.success?.({}) } })
		},
		closeBLEConnection(options) {
			if (!driver) { options.success?.({}); return }
			cancelPending(); properties = null
			request('close', [], options)
		},
		getBLEDeviceServices(options) {
			if (!selected(options)) return fail(options, '地秤连接已变化')
			options.success?.({ services: [{ uuid: FLOOR_SCALE_SERVICE_ID }] })
		},
		getBLEDeviceCharacteristics(options) {
			if (!selected(options)) return fail(options, '地秤连接已变化')
			options.success?.({ characteristics: [
				{ uuid: FLOOR_SCALE_NOTIFY_ID, properties: { notify: Boolean(properties.notifyProperties & 16), indicate: Boolean(properties.notifyProperties & 32) } },
				{ uuid: FLOOR_SCALE_WRITE_ID, properties: { write: Boolean(properties.writeProperties & 8), writeNoResponse: Boolean(properties.writeProperties & 4) } }
			] })
		},
		notifyBLECharacteristicValueChange(options) {
			if (!selected(options) || options.state !== true || String(options.characteristicId).toUpperCase() !== FLOOR_SCALE_NOTIFY_ID.toUpperCase()) return fail(options, '地秤订阅目标已变化')
			request('subscribe', [], options)
		},
		writeBLECharacteristicValue(options) {
			if (!selected(options) || String(options.characteristicId).toUpperCase() !== FLOOR_SCALE_WRITE_ID.toUpperCase()) return fail(options, '地秤写入目标已变化')
			const hex = Array.from(new Uint8Array(options.value), byte => byte.toString(16).padStart(2, '0')).join('')
			request('write', [hex], options)
		},
		onBLECharacteristicValueChange: fn => values.add(fn),
		offBLECharacteristicValueChange: fn => values.delete(fn),
		onBLEConnectionStateChange: fn => connections.add(fn),
		offBLEConnectionStateChange: fn => connections.delete(fn)
	}
}
