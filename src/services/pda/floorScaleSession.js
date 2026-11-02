import { createFloorScaleDiagnostic } from './floorScaleDiagnostic'
import { floorScaleCandidateKg } from './floorScaleProtocol'

// Display-only commissioning session. No business capture callbacks.
export function createFloorScaleSession(runtime) {
	const diagnostic = createFloorScaleDiagnostic(runtime)
	let sessionId = '', sequence = 0, timer = null, publishedKey = '', listeners = new Set()
	function getSnapshot(state = diagnostic.getSnapshot()) {
		const connected = state.status === 'connected'
		const value = state.fresh ? floorScaleCandidateKg(state.frame) : null
		const communication = state.communication || {}
		let code = state.status, message = state.reason || '地秤未连接'
		if (connected) {
			if (state.fresh) { code = value === null ? 'unreadable_weight' : 'unverified'; message = value === null ? '已收到数据，重量超出可解析范围，请查看通信详情' : '地秤调试读数，设备待实测' }
			else if (communication.validFrames) { code = 'stale'; message = '地秤读数已过期，请等待新读数' }
			else if (communication.chunks) { code = 'invalid_frame'; message = communication.checksumErrors ? '已收到地秤数据，但校验未通过，请查看通信详情' : '已收到数据，尚未解析到完整重量帧，请查看通信详情' }
			else { code = 'no_data'; message = '蓝牙已连接，尚未收到地秤数据，请检查地秤并查看通信详情' }
		}
		return { is_connected: connected, is_online: connected && Boolean(state.fresh),
			is_stable: false, weight_kg: value, sampled_at: state.sampledAt,
			device_id: state.deviceId, session_id: sessionId, connection_key: state.sessionKey || '',
			diagnostic_frame: state.fresh ? state.frame : null, communication,
			can_calibrate: Boolean(state.canWriteCalibration), error_code: code, error_message: message }
	}
	function publish(state) {
		const snapshot = getSnapshot(state)
		const key = [snapshot.error_code, snapshot.device_id, snapshot.connection_key, snapshot.session_id,
			snapshot.sampled_at, snapshot.communication.chunks, snapshot.can_calibrate, snapshot.error_message].join('|')
		if (key === publishedKey) return
		publishedKey = key
		for (const listener of listeners) listener(snapshot)
	}
	function clearTimer() { if (timer !== null) clearInterval(timer); timer = null }
	let lastStatus = '', lastFresh = false
	const unsubscribe = diagnostic.subscribe(state => {
		// Connection changes, first data and invalidation remain immediate.
		if (state.status !== 'connected') clearTimer()
		if (state.status !== lastStatus || Boolean(state.fresh) !== lastFresh) publish(state)
		lastStatus = state.status; lastFresh = Boolean(state.fresh)
	})
	const connect = async ({ preferredDeviceId } = {}) => {
		const result = await diagnostic.connect(preferredDeviceId)
		if (result.code === 0 && timer === null) timer = setInterval(() => publish(), 250)
		return result
	}
	const disconnect = async () => { sessionId = ''; clearTimer(); await diagnostic.disconnect() }
	return {
		connect, discoverDevices: () => diagnostic.discover(),
		beginMeasurement() { sessionId = `floor-${Date.now()}-${++sequence}`; publish(); return sessionId },
		updateProfile() {}, disconnect, async stop() { await disconnect() },
		onSnapshot(listener) { listeners.add(listener); listener(getSnapshot()); return () => listeners.delete(listener) },
		// User actions read current data, independently of the display refresh rate.
		getSnapshot,
		writeCalibrationCommand: (command, expectedDeviceId) => diagnostic.writeCalibrationCommand(command, expectedDeviceId),
		destroy() { clearTimer(); unsubscribe(); listeners.clear(); return diagnostic.disconnect() }
	}
}
