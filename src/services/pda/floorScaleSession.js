import { createFloorScaleDiagnostic } from './floorScaleDiagnostic'
import { floorScaleCandidateKg, floorScaleBootStatus } from './floorScaleProtocol'

import { floorScaleDivisionKg } from './floorScaleDisplay'

// Ordinary floor scale: stream the board's current signed reading. No load
// ownership, empty-platform cycle, handheld zero or falling-weight anchor.
export function createFloorScaleSession(runtime, { onWeightFrame, onInterrupted } = {}) {
	let lastQualified = false, started = 0, previous = 0, stamp = ''
	function interrupt() { lastQualified = false; onInterrupted?.() }
	const diagnostic = createFloorScaleDiagnostic(runtime, { onInterrupted: interrupt, onFrame(frame, time, deviceId) {
		const kg = floorScaleCandidateKg(frame)
		if (frame.format !== 'milligrams' || frame.moduleId !== 0 || frame.status !== 0 ||
			kg == null || Math.abs(kg) > 1000) { interrupt(); return }
		// Repeated board timestamps are duplicate samples, not a movement or a
		// communication break. Ignore them so one duplicated BLE notification
		// cannot make a steady 185 kg reading flash unstable.
		if (stamp === frame.timestampHex) return
		stamp = frame.timestampHex
		if (previous && (time < previous || time - previous > 300)) interrupt()
		previous = time; lastQualified = true
		if (!sessionId || time < started) return
		onWeightFrame?.({ session_id: sessionId, sampled_at: time, device_id: deviceId,
			display_kg: floorScaleDivisionKg(kg), raw: frame.rawHex, raw_kg: kg })
	} })
	let sessionId = '', sequence = 0, timer = null, publishedKey = '', listeners = new Set()
	function getSnapshot(state = diagnostic.getSnapshot()) {
		const connected = state.status === 'connected'
		const value = state.fresh ? floorScaleCandidateKg(state.frame) : null
		const boot = state.fresh ? floorScaleBootStatus(state.frame) : null
		const communication = state.communication || {}
		let code = state.status, message = state.reason || '地秤未连接'
		if (connected) {
			if (boot) { code = boot.code; message = boot.message }
			else if (state.fresh && value !== null && (state.frame?.format !== 'milligrams' || state.frame.moduleId !== 0 || state.frame.status !== 0 || Math.abs(value) > 1000)) {
				code = 'unsupported_capture'; message = '当前帧的通道、状态、格式或量程不符，不能取重'
			} else if (state.fresh) { code = value === null ? 'unreadable_weight' : 'reading'; message = value === null ? '已收到数据，重量超出可解析范围，请查看通信详情' : '地秤正在接收实时重量' }
			else if (communication.validFrames) { code = 'stale'; message = '地秤读数已过期，请等待新读数' }
			else if (communication.chunks) { code = 'invalid_frame'; message = communication.checksumErrors ? '已收到地秤数据，但校验未通过，请查看通信详情' : '已收到数据，尚未解析到完整重量帧，请查看通信详情' }
			else { code = 'no_data'; message = '蓝牙已连接，尚未收到地秤数据，请检查地秤并查看通信详情' }
		}
		const warming = boot?.code === 'boot_zero_pending'
		const qualifiedFrame = lastQualified && state.sampledAt === previous && stamp === state.frame?.timestampHex

		return { warming, qualified_frame: qualifiedFrame, is_connected: connected, is_online: connected && Boolean(state.fresh),
			is_stable: false, weight_kg: value, sampled_at: state.sampledAt,
			device_id: state.deviceId, session_id: sessionId, connection_key: state.sessionKey || '',
			diagnostic_frame: state.fresh ? state.frame : null, communication,
			can_calibrate: Boolean(state.canWriteCalibration), boot_zero_state: boot?.code || '', error_code: code, error_message: message }
	}
	function publish(state) {
		const snapshot = getSnapshot(state)
		const key = [snapshot.error_code, snapshot.device_id, snapshot.connection_key, snapshot.session_id,
			snapshot.qualified_frame, snapshot.sampled_at, snapshot.communication.chunks, snapshot.can_calibrate, snapshot.error_message].join('|')
		if (key === publishedKey) return
		publishedKey = key
		for (const listener of listeners) listener(snapshot)
	}
	function clearTimer() { if (timer !== null) clearInterval(timer); timer = null }
	let lastStatus = '', lastFresh = false
	const unsubscribe = diagnostic.subscribe(state => {
		// Connection changes, first data and invalidation remain immediate.
		if (state.status !== 'connected') { clearTimer(); lastQualified = false; previous = 0; stamp = ''; interrupt() }
		if (state.status !== lastStatus || Boolean(state.fresh) !== lastFresh) publish(state)
		lastStatus = state.status; lastFresh = Boolean(state.fresh)
	})
	const connect = async ({ preferredDeviceId } = {}) => {
		const result = await diagnostic.connect(preferredDeviceId)
		if (result.code === 0 && timer === null) timer = setInterval(() => publish(), 250)
		return result
	}
	const disconnect = async () => { clearTimer(); await diagnostic.disconnect() }
	return {
		connect, discoverDevices: () => diagnostic.discover(),
		beginMeasurement() {
			started = Date.now()
			sessionId = `floor-${started}-${++sequence}`
			publish(); return sessionId
		},
		endMeasurement() { sessionId = ''; publish() }, updateProfile() {}, disconnect,
		async stop() { sessionId = ''; await disconnect() },
		onSnapshot(listener) { listeners.add(listener); listener(getSnapshot()); return () => listeners.delete(listener) },
		// User actions read current data, independently of the display refresh rate.
		getSnapshot,
		writeCalibrationCommand: (command, expectedDeviceId) => diagnostic.writeCalibrationCommand(command, expectedDeviceId),
		destroy() { clearTimer(); unsubscribe(); listeners.clear(); return diagnostic.disconnect() }
	}
}
