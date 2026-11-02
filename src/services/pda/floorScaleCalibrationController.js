import { floorScaleMassCommand, floorScaleZeroCommand, floorScaleKilogramsToGrams } from './floorScaleCalibration'

// One persistent, account-scoped in-flight operation. A transport success only
// means that bytes were submitted, not that the board calibrated successfully.
export function createFloorScaleCalibrationController({ ownerId, storage, ownerMatches, connection, canStart, send, timeoutMs = 8000 }) {
	// A pending command blocks other accounts on this PDA from silently replacing it.
	const key = 'crm_pda_floor_calibration_v1'
	const token = value => value ? (typeof value === 'string' ? value : JSON.stringify(value)) : null
	let expected = null, running = false, broken = '', listeners = new Set()
	let state = { version: 1, ownerId, zeroFor: '', pending: null, lastVerified: null, requiresReview: false }
	try {
		const raw = storage.getStorageSync(key); expected = token(raw)
		if (raw) {
			const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
			if (parsed?.version !== 1 || !parsed.ownerId || typeof parsed.zeroFor !== 'string' ||
				(parsed.pending && (!['zero', 'mass'].includes(parsed.pending.kind) || !parsed.pending.deviceId || !parsed.pending.connectionKey || typeof parsed.pending.needsReconnect !== 'boolean'))) throw new Error('校准状态无法识别，请保留原数据')
			if (parsed.ownerId !== ownerId && (parsed.pending || parsed.requiresReview)) throw new Error('其他账号有待核对的校准，请使用原账号处理')
			if (parsed.ownerId === ownerId) state = { ...state, ...parsed }
		}
	} catch (error) { broken = error.message || '校准状态读取失败' }
	const getState = () => ({ ...state, pending: state.pending ? { ...state.pending } : null, running, error: broken })
	function notify() { const value = getState(); for (const fn of listeners) fn(value) }
	function save(next) {
		if (broken) throw new Error(broken)
		if (!ownerId || !ownerMatches()) throw new Error('账号已变化，请使用原账号处理校准')
		if (token(storage.getStorageSync(key)) !== expected) throw new Error('校准状态已在其他页面变化，请重新进入')
		const raw = JSON.stringify(next)
		storage.setStorageSync(key, raw)
		if (token(storage.getStorageSync(key)) !== raw) { broken = '校准状态写入无法确认，请保留原数据'; throw new Error(broken) }
		expected = raw; state = next; notify()
	}
	function requireConnection(requireFresh = true) {
		if (!ownerId || !ownerMatches()) throw new Error('账号已变化，请使用原账号处理校准')
		const current = connection()
		if (!current?.is_connected || !current.device_id || !current.connection_key) throw new Error('请先连接地秤')
		const age = Date.now() - Number(current.sampled_at)
		if (requireFresh && (!current.is_online || !Number.isFinite(age) || age < 0 || age > 3000)) throw new Error(current.error_message || '地秤数据已中断或过期，请等待新读数')
		if (requireFresh && current.error_code === 'unreadable_weight') throw new Error(current.error_message)
		if (requireFresh && current.diagnostic_frame && current.diagnostic_frame.moduleId !== 0) throw new Error('当前数据不是单地秤通道，请核对设备')
		return current
	}
	async function issue(kind, inputKg = '') {
		if (broken) throw new Error(broken)
		if (running || state.pending) throw new Error('上次校准结果待核对，请先处理')
		if (!canStart()) throw new Error('请先完成或放弃当前钢瓶，再进行校准')
		const current = requireConnection()
		if (!current.can_calibrate) throw new Error('未发现地秤校准写入接口')
		if (kind === 'mass' && state.zeroFor !== current.device_id) throw new Error('请先在当前地秤完成空秤归零复核')
		const command = kind === 'zero' ? floorScaleZeroCommand() : floorScaleMassCommand(inputKg)
		const grams = kind === 'mass' ? floorScaleKilogramsToGrams(inputKg) : null
		const pending = { kind, deviceId: current.device_id, connectionKey: current.connection_key, needsReconnect: true, grams, startedAt: Date.now() }
		// Persist before any side effect; app termination must never trigger a retry.
		save({ ...state, zeroFor: kind === 'zero' ? '' : state.zeroFor, pending, requiresReview: true })
		running = true; notify()
		let timeout
		try {
			const again = requireConnection()
			if (!canStart() || again.device_id !== current.device_id || again.connection_key !== current.connection_key) throw new Error('连接或作业状态变化')
			await Promise.race([
				Promise.resolve().then(() => send(command, current.device_id)),
				new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('发送结果未确认')), timeoutMs) })
			])
			if (!ownerMatches()) throw new Error('账号已变化')
			const after = requireConnection(false)
			if (after.device_id !== current.device_id || after.connection_key !== current.connection_key) throw new Error('连接已变化')
			save({ ...state, pending: { ...pending, needsReconnect: false } })
			return { sent: true, msg: '指令已提交，校准结果仍需现场核对' }
		} catch (_) {
			// Saved pending remains locked even for timeout, account switch, late
			// transport callback or failed persistence. Never repeat automatically.
			return { sent: false, msg: '结果未确认，请重新连接原地秤并核对' }
		} finally { if (timeout) clearTimeout(timeout); running = false; notify() }
	}
	function resolvePending(verified) {
		if (running) throw new Error('指令仍在处理，请稍候')
		if (!state.pending) throw new Error('没有待核对的校准')
		if (!canStart()) throw new Error('请先完成或放弃当前钢瓶，再核对校准')
		const current = requireConnection(), pending = state.pending
		if (current.device_id !== pending.deviceId) throw new Error('请连接原来的地秤后核对')
		if (pending.needsReconnect && current.connection_key === pending.connectionKey) throw new Error('发送结果不明确，请先断开并重新连接原地秤')
		const zeroFor = verified && pending.kind === 'zero' ? current.device_id : ''
		save({ ...state, pending: null, zeroFor, requiresReview: !(verified && pending.kind === 'mass'), lastVerified: verified ? { kind: pending.kind, deviceId: pending.deviceId, grams: pending.grams, verifiedAt: Date.now() } : state.lastVerified })
	}
	function subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener) }
	return { getState, subscribe, issueZero: () => issue('zero'), issueMass: input => issue('mass', input), resolvePending }
}
