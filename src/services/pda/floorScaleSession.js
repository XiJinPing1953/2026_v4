import { createFloorScaleDiagnostic } from './floorScaleDiagnostic'
import { floorScaleCandidateKg } from './floorScaleProtocol'

// Separate, commissioning-only implementation of the weighing session API.
// Candidate readings are visible for comparison; no capture callbacks are
// emitted until signedness, fault flags and the delivered hardware are verified.
export function createFloorScaleSession(runtime) {
	const diagnostic = createFloorScaleDiagnostic(runtime)
	let sessionId = '', sequence = 0, timer = null, snapshot = {}, listeners = new Set()
	const publish = state => {
		const connected = state.status === 'connected'
		const value = state.fresh ? floorScaleCandidateKg(state.frame) : null
		snapshot = { is_connected: connected, is_online: connected && value !== null,
			is_stable: false, weight_kg: value, sampled_at: state.sampledAt,
			device_id: state.deviceId, session_id: sessionId,
			connection_key: state.sessionKey || '',
			diagnostic_frame: state.fresh ? state.frame : null,
			can_calibrate: Boolean(state.canWriteCalibration),
			error_code: connected ? 'unverified' : state.status,
			error_message: connected ? '地秤调试读数，设备待实测' : (state.reason || '地秤未连接') }
		for (const listener of listeners) listener({ ...snapshot })
	}
	const unsubscribe = diagnostic.subscribe(publish)
	const connect = async ({ preferredDeviceId } = {}) => {
		const result = await diagnostic.connect(preferredDeviceId)
		if (result.code === 0 && !timer) timer = setInterval(() => publish(diagnostic.getSnapshot()), 500)
		return result
	}
	const disconnect = async () => { sessionId = ''; if (timer) clearInterval(timer); timer = null; await diagnostic.disconnect() }
	return {
		connect,
		discoverDevices: () => diagnostic.discover(),
		beginMeasurement() { sessionId = `floor-${Date.now()}-${++sequence}`; publish(diagnostic.getSnapshot()); return sessionId },
		updateProfile() {},
		disconnect,
		async stop() { await disconnect() },
		onSnapshot(listener) { listeners.add(listener); listener({ ...snapshot }); return () => listeners.delete(listener) },
		getSnapshot: () => ({ ...snapshot }),
		writeCalibrationCommand: (command, expectedDeviceId) => diagnostic.writeCalibrationCommand(command, expectedDeviceId),
		destroy() { if (timer) clearInterval(timer); timer = null; unsubscribe(); listeners.clear() }
	}
}
