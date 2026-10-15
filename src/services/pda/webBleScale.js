import { createBleScaleCoreSession, normalizeBleScaleProfile } from './bleScaleCore'

export function getWebBleScaleCapabilities(environment = globalThis) {
	if (!environment.isSecureContext) return { supported: false, reason: '请用 HTTPS 地址打开后连接吊秤' }
	if (typeof environment.navigator?.bluetooth?.requestDevice !== 'function') {
		return { supported: false, reason: '当前浏览器不支持连接吊秤，请用支持网页蓝牙的浏览器打开' }
	}
	const policy = environment.document?.permissionsPolicy || environment.document?.featurePolicy
	// Native browser shims may expose Bluetooth while the engine does not know this directive.
	if (typeof policy?.features === 'function' && policy.features().includes('bluetooth') && typeof policy.allowsFeature === 'function' && !policy.allowsFeature('bluetooth')) {
		return { supported: false, reason: '当前网页未获蓝牙访问权限，请在独立浏览器页面打开' }
	}
	return { supported: true, reason: '' }
}

function createWebBluetoothRuntime() {
	let device = null
	let server = null
	let characteristic = null
	let valueListener = null
	let disconnectListener = null
	let epoch = 0
	const values = new Set()
	const connections = new Set()
	const invoke = (options, action) => {
		Promise.resolve().then(action).then((data) => options.success?.(data || {}), (error) => options.fail?.(error))
	}
	function clearCharacteristic() {
		if (characteristic && valueListener) characteristic.removeEventListener('characteristicvaluechanged', valueListener)
		characteristic = null
		valueListener = null
		server = null
	}
	function detachDevice() {
		if (device && disconnectListener) device.removeEventListener('gattserverdisconnected', disconnectListener)
		disconnectListener = null
		clearCharacteristic()
	}
	function close() {
		epoch += 1
		detachDevice()
		if (device?.gatt?.connected) device.gatt.disconnect()
	}
	return {
		transport: 'web',
		setDevice(nextDevice) { close(); device = nextDevice },
		getDevice: () => device,
		openBluetoothAdapter(options) { options.success?.({}) },
		closeBluetoothAdapter(options) { close(); options.success?.({}) },
		createBLEConnection(options) {
			invoke(options, async () => {
				if (!device?.gatt || device.id !== options.deviceId) throw new Error('请点击连接吊秤并选择设备')
				const selected = device
				const attempt = ++epoch
				detachDevice()
				disconnectListener = () => {
					if (device !== selected) return
					epoch += 1
					clearCharacteristic()
					for (const listener of connections) listener({ deviceId: selected.id, connected: false })
				}
				device.addEventListener('gattserverdisconnected', disconnectListener)
				const connectedServer = await device.gatt.connect()
				if (attempt !== epoch || device !== selected) {
					if (selected.gatt.connected) selected.gatt.disconnect()
					throw new Error('connection_cancelled')
				}
				server = connectedServer
			})
		},
		notifyBLECharacteristicValueChange(options) {
			invoke(options, async () => {
				const attempt = epoch
				const selected = device
				if (!server || !selected?.gatt?.connected) throw new Error('吊秤连接已中断')
				// GATT objects become invalid on disconnect; retrieve both again after every reconnect.
				const service = await server.getPrimaryService(options.serviceId.toLowerCase())
				const next = await service.getCharacteristic(options.characteristicId.toLowerCase())
				if (attempt !== epoch || device !== selected) throw new Error('connection_cancelled')
				valueListener = (event) => {
					if (attempt !== epoch || characteristic !== next || !selected.gatt.connected) return
					for (const listener of values) listener({ deviceId: selected.id, characteristicId: options.characteristicId, value: event.target.value })
				}
				characteristic = next
				next.addEventListener('characteristicvaluechanged', valueListener)
				await next.startNotifications()
				if (attempt !== epoch || device !== selected) throw new Error('connection_cancelled')
			})
		},
		closeBLEConnection(options) { close(); options.success?.({}) },
		onBLECharacteristicValueChange(listener) { values.add(listener) },
		offBLECharacteristicValueChange(listener) { values.delete(listener) },
		onBLEConnectionStateChange(listener) { connections.add(listener) },
		offBLEConnectionStateChange(listener) { connections.delete(listener) }
	}
}

export function createWebBleScaleSession(inputProfile = {}, environment = globalThis) {
	let profile = normalizeBleScaleProfile(inputProfile)
	const runtime = createWebBluetoothRuntime()
	// An opaque Web Bluetooth ID cannot restore a device from the PDA's local MAC binding.
	const core = createBleScaleCoreSession({ ...profile, deviceId: '' }, runtime)
	let selecting = false
	let selectionEpoch = 0
	let stopped = false
	const document = environment.document
	const deviceDetails = (device) => ({ deviceId: device.id, name: device.name || '', localName: device.name || '' })
	const cancelled = () => ({ code: 499, msg: '已取消连接吊秤', data: null })

	function connect(options = {}) {
		const capabilities = getWebBleScaleCapabilities(environment)
		if (!capabilities.supported) return Promise.resolve({ code: 501, msg: capabilities.reason, data: null })
		if (document?.hidden) return Promise.resolve({ code: 409, msg: '请回到销售页面后连接吊秤', data: null })
		if (selecting) return Promise.resolve({ code: 409, msg: '正在选择吊秤', data: null })
		stopped = false
		const knownDevice = runtime.getDevice()
		if (knownDevice && !options.forcePick) {
			return core.connect({ preferredDeviceId: knownDevice.id }).then((result) => ({
				...result,
				data: result.code === 0 ? { ...result.data, selected_device: deviceDetails(knownDevice) } : result.data
			}))
		}
		selecting = true
		const epoch = ++selectionEpoch
		let requestedDevice
		try {
			// Keep this call in the original button handler stack: no permission/scanning await first.
			requestedDevice = environment.navigator.bluetooth.requestDevice({
				filters: [{ namePrefix: profile.deviceNamePrefix }],
				optionalServices: [profile.serviceId.toLowerCase()]
			})
		} catch (error) {
			selecting = false
			return Promise.resolve({ code: error?.name === 'NotFoundError' ? 499 : 403, msg: error?.name === 'NotFoundError' ? '已取消选择吊秤' : '请点击连接吊秤并允许蓝牙访问', data: null })
		}
		const disconnected = core.disconnect()
		return Promise.resolve(requestedDevice).then(async (device) => {
			await disconnected
			if (epoch !== selectionEpoch || stopped || document?.hidden) return cancelled()
			runtime.setDevice(device)
			const result = await core.connect({ preferredDeviceId: device.id })
			return { ...result, data: result.code === 0 ? { ...result.data, selected_device: deviceDetails(device) } : result.data }
		}).catch((error) => ({
			code: error?.name === 'NotFoundError' ? 499 : 403,
			msg: error?.name === 'NotFoundError' ? '已取消选择吊秤' : '吊秤授权失败，请重新点击连接并允许蓝牙访问',
			data: null
		})).finally(() => { selecting = false })
	}
	function disconnect(options = {}) {
		selectionEpoch += 1
		return core.disconnect(options)
	}
	function onVisibilityChange() {
		if (document?.hidden) void disconnect({ error_code: 'page_hidden', error_message: '页面已离开前台，请重新连接并称重' })
	}
	function onPageHide() {
		void disconnect({ error_code: 'page_hidden', error_message: '页面已离开前台，请重新连接并称重' })
	}
	document?.addEventListener?.('visibilitychange', onVisibilityChange)
	environment.addEventListener?.('pagehide', onPageHide)
	async function stop() {
		stopped = true
		selectionEpoch += 1
		document?.removeEventListener?.('visibilitychange', onVisibilityChange)
		environment.removeEventListener?.('pagehide', onPageHide)
		return core.stop()
	}
	return {
		...core,
		connect,
		start: connect,
		disconnect,
		stop,
		discoverDevices: async () => ({ code: 501, msg: '请点击连接吊秤，使用浏览器设备选择器', data: [] }),
		updateProfile(next = {}) {
			profile = normalizeBleScaleProfile({ ...profile, ...next })
			core.updateProfile({ ...profile, deviceId: runtime.getDevice()?.id || '' })
		}
	}
}
