import { createFloorScaleDiagnostic } from './floorScaleDiagnostic'
import { floorScaleCandidateKg } from './floorScaleProtocol'

import { createFloorLoadTracker } from './floorScaleLoad'
import { floorScaleDivisionKg } from './floorScaleDisplay'
export function createFloorScaleSession(runtime, { onWeightFrame, onInterrupted, onEmpty } = {}) {
	const load = createFloorLoadTracker()
	let expectedCycle = null, started = 0, previous = 0, stamp = '', operation = '', claimedCycle = null
	function interrupt() { load.interrupt(); onInterrupted?.() }
	const diagnostic = createFloorScaleDiagnostic(runtime, { onInterrupted: interrupt, onFrame(frame, time, deviceId) {
		const kg = floorScaleCandidateKg(frame)
		// Only the on-site single-channel 0x22 profile is qualified for filling.
		if (frame.format !== 'milligrams' || frame.moduleId !== 0 || frame.status !== 0 ||
			kg == null || Math.abs(kg) > 1000 || stamp === frame.timestampHex) { interrupt(); return }
		stamp = frame.timestampHex
		if (previous && (time < previous || time - previous > 300)) interrupt()
		if (previous && time - previous > 3000 && claimedCycle !== null) sessionId = ''
		previous = time
		const before = load.phase
		load.observe(kg, time)
		if (!sessionId || time < started) return
		if (before !== 'empty' && load.phase === 'empty') onEmpty?.(sessionId)
		if (expectedCycle !== null && expectedCycle !== load.cycle) {
			if (expectedCycle < load.cycle) { sessionId = ''; publish() }
			return
		}
		if (claimedCycle !== null && claimedCycle !== load.cycle) return
		const cycle = load.claim(operation)
		if (cycle === null) { onInterrupted?.(); return }
		claimedCycle = cycle
		const corrected = kg - load.offset
		if (corrected > 1000) { onInterrupted?.(); return }
		onWeightFrame?.({ session_id: sessionId, sampled_at: time, device_id: deviceId,
			display_kg: floorScaleDivisionKg(corrected), raw: frame.rawHex, offset_kg: load.offset, raw_kg: kg })
	} })
	let sessionId = '', sequence = 0, timer = null, publishedKey = '', listeners = new Set()
	function getSnapshot(state = diagnostic.getSnapshot()) {
		const connected = state.status === 'connected'
		const value = state.fresh ? floorScaleCandidateKg(state.frame) : null
		const communication = state.communication || {}
		let code = state.status, message = state.reason || '地秤未连接'
		if (connected) {
			if (state.fresh && value !== null && (state.frame?.format !== 'milligrams' || state.frame.moduleId !== 0 || state.frame.status !== 0 || Math.abs(value) > 1000)) {
				code = 'unsupported_capture'; message = '当前帧的通道、状态、格式或量程不符，不能取重'
			} else if (state.fresh) { code = value === null ? 'unreadable_weight' : 'reading'; message = value === null ? '已收到数据，重量超出可解析范围，请查看通信详情' : '地秤正在接收实时重量' }
			else if (communication.validFrames) { code = 'stale'; message = '地秤读数已过期，请等待新读数' }
			else if (communication.chunks) { code = 'invalid_frame'; message = communication.checksumErrors ? '已收到地秤数据，但校验未通过，请查看通信详情' : '已收到数据，尚未解析到完整重量帧，请查看通信详情' }
			else { code = 'no_data'; message = '蓝牙已连接，尚未收到地秤数据，请检查地秤并查看通信详情' }
		}
		return { is_connected: connected, is_online: connected && Boolean(state.fresh),
			is_stable: false, weight_kg: value, sampled_at: state.sampledAt,
			device_id: state.deviceId, session_id: sessionId, connection_key: state.sessionKey || '',
			diagnostic_frame: state.fresh ? state.frame : null, communication,
			load_phase: load.phase, needs_clear: load.phase === 'unknown' || (load.phase === 'loaded' && !!load.owner && load.owner !== operation), offset_kg: load.offset, zero_offer: connected && state.fresh ? load.offer : null,
			can_calibrate: Boolean(state.canWriteCalibration), error_code: code, error_message: message }
	}
	function publish(state) {
		const snapshot = getSnapshot(state)
		const key = [snapshot.error_code, snapshot.device_id, snapshot.connection_key, snapshot.session_id,
			snapshot.load_phase, snapshot.offset_kg, snapshot.zero_offer?.generation, snapshot.sampled_at, snapshot.communication.chunks, snapshot.can_calibrate, snapshot.error_message].join('|')
		if (key === publishedKey) return
		publishedKey = key
		for (const listener of listeners) listener(snapshot)
	}
	function clearTimer() { if (timer !== null) clearInterval(timer); timer = null }
	let lastStatus = '', lastFresh = false
	const unsubscribe = diagnostic.subscribe(state => {
		// Connection changes, first data and invalidation remain immediate.
		if (state.status !== 'connected') { clearTimer(); sessionId = ''; load.reset(); previous = 0; stamp = '' }
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
		orderTicket(operationId) {
			return { connection: diagnostic.getSnapshot().sessionKey, cycle: load.phase === 'loaded' && (!load.owner || load.owner === operationId) ? load.cycle : load.cycle + 1 }
		},
		beginMeasurement(operationId, ticket) {
			expectedCycle = ticket?.cycle ?? null
			if (ticket && ticket.connection !== diagnostic.getSnapshot().sessionKey) expectedCycle = -1
			started = Date.now(); claimedCycle = null
			sessionId = `floor-${started}-${++sequence}`; operation = operationId || sessionId
			publish(); return sessionId
		},
		applyTemporaryZero(expected) {
			if (!diagnostic.getSnapshot().fresh || !load.acceptOffer(expected, Date.now())) return false
			publish(); return true
		},
		resetLoad() { load.reset(); interrupt(); sessionId = ''; publish() },
		endMeasurement(clearOffset = true) { sessionId = ''; if (clearOffset) load.end(); publish() }, updateProfile() {}, disconnect, async stop() { await disconnect() },
		onSnapshot(listener) { listeners.add(listener); listener(getSnapshot()); return () => listeners.delete(listener) },
		// User actions read current data, independently of the display refresh rate.
		getSnapshot,
		writeCalibrationCommand: (command, expectedDeviceId) => diagnostic.writeCalibrationCommand(command, expectedDeviceId),
		destroy() { clearTimer(); unsubscribe(); listeners.clear(); return diagnostic.disconnect() }
	}
}
