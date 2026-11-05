import { floorScaleMassCommand, floorScaleZeroCommand, floorScaleKilogramsToGrams } from './floorScaleCalibration'

// One persistent, account-scoped in-flight operation. A transport success only
// means that bytes were submitted, not that the board calibrated successfully.
export function createFloorScaleCalibrationController({ ownerId, storage, ownerMatches, connection, canStart, send, stableReading, now = Date.now, timeoutMs = 8000 }) {
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
				(parsed.pending && (!['zero', 'mass', 'check'].includes(parsed.pending.kind) || !parsed.pending.deviceId || !parsed.pending.connectionKey || typeof parsed.pending.needsReconnect !== 'boolean'))) throw new Error('校准状态无法识别，请保留原数据')
			if (parsed.ownerId !== ownerId && (parsed.pending || parsed.requiresReview)) throw new Error('其他账号有待核对的校准，请使用原账号处理')
			if (parsed.ownerId === ownerId) state = { ...state, ...parsed }
			// A completed physical calibration belongs to this device. An operator
			// may weigh with it but cannot resolve someone else's pending action.
			else if (!parsed.pending && !parsed.requiresReview && ['mass', 'check'].includes(parsed.lastVerified?.kind))
				state.lastVerified = parsed.lastVerified
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
	function requireConnection(requireFresh = true, allowUnzeroed = false) {
		if (!ownerId || !ownerMatches()) throw new Error('账号已变化，请使用原账号处理校准')
		const current = connection()
		if (!current?.is_connected || !current.device_id || !current.connection_key) throw new Error('请先连接地秤')
		const age = now() - Number(current.sampled_at)
		if (requireFresh && (!current.is_online || !Number.isFinite(age) || age < 0 || age > 3000)) throw new Error(current.error_message || '地秤数据已中断或过期，请等待新读数')
		if (requireFresh && current.diagnostic_frame && current.diagnostic_frame.moduleId !== 0) throw new Error('当前数据不是单地秤通道，请核对设备')
		if (requireFresh && current.error_code !== 'reading' && !(allowUnzeroed && current.error_code === 'boot_zero_timeout')) throw new Error(current.error_message || '重量帧无效')
		return current
	}
	function sample(current, after = null) {
		const point = stableReading?.(current.connection_key)
		if (!point?.stable || point.connectionKey !== current.connection_key || !Number.isFinite(point.kg) ||
			!Number.isFinite(point.ad) || !Number.isFinite(point.from) || !Number.isFinite(point.at) ||
			now() - point.at > 500 || point.at > now() || (after !== null && point.from <= after)) {
			throw new Error('请保持载荷，等待读数稳定后再操作')
		}
		return { kg: point.kg, ad: point.ad, at: point.at }
	}
	async function issue(kind, inputKg = '') {
		if (broken) throw new Error(broken)
		if (running || state.pending) throw new Error('上次校准结果待核对，请先处理')
		if (!canStart()) throw new Error('请先完成或放弃当前钢瓶，再进行校准')
		const current = requireConnection(true, kind === 'zero')
		if (!current.can_calibrate) throw new Error('未发现地秤校准写入接口')
		if (kind === 'mass' && state.zeroFor !== current.device_id) throw new Error('请先在当前地秤完成空秤归零复核')
		const command = kind === 'zero' ? floorScaleZeroCommand() : floorScaleMassCommand(inputKg)
		const grams = kind === 'mass' ? floorScaleKilogramsToGrams(inputKg) : null
		if (grams > 1000000) throw new Error('这台秤最大 1000 kg，放 200 kg 请输入 200')
		const before = sample(current)
		const pending = { kind, before, deviceId: current.device_id, connectionKey: current.connection_key, needsReconnect: true, grams, priorRequiresReview: state.requiresReview, startedAt: now() }
		// Persist before any side effect; app termination must never trigger a retry.
		save({ ...state, zeroFor: kind === 'zero' ? '' : state.zeroFor, pending, requiresReview: true })
		running = true; notify()
		let timeout
		try {
			const again = requireConnection(true, kind === 'zero')
			if (!canStart() || again.device_id !== current.device_id || again.connection_key !== current.connection_key) throw new Error('连接或作业状态变化')
			const latest = sample(again)
			if (Math.abs(latest.kg - before.kg) > 0.1) throw new Error('载荷已变化，请核对')
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
	function beginCheck(inputKg) {
		if (broken) throw new Error(broken)
		if (running || state.pending) throw new Error('请先完成当前操作')
		if (!canStart()) throw new Error('请先完成或放弃当前钢瓶')
		const current = requireConnection(), before = sample(current)
		if (Math.abs(before.kg) >= 0.25) throw new Error('请先清空秤台，归零后再做砝码复核')
		const grams = floorScaleKilogramsToGrams(inputKg)
		if (grams > 1000000) throw new Error('最大称量 1000 kg')
		save({ ...state, pending: { kind: 'check', deviceId: current.device_id, connectionKey: current.connection_key,
			needsReconnect: false, grams, before, priorRequiresReview: state.requiresReview, startedAt: now() }, requiresReview: true })
	}

	function pendingForReview(requireFresh = true) {
		if (running || !state.pending) throw new Error(running ? '指令仍在处理，请稍候' : '没有待核对的校准')
		if (!canStart()) throw new Error('请先结束当前作业，再核对校准')
		const current = requireConnection(requireFresh), pending = state.pending
		if (current.device_id !== pending.deviceId) throw new Error('请连接原来的地秤后核对')
		if (pending.needsReconnect && current.connection_key === pending.connectionKey) throw new Error('发送结果不明确，请先断开并重新连接原地秤')
		return { current, pending }
	}
	function confirmLoad() {
		const { current, pending } = pendingForReview()
		if (!['mass', 'check'].includes(pending.kind) || pending.loaded) throw new Error('当前不需要核对加载点')
		const point = sample(current, pending.startedAt), reference = pending.grams / 1000
		if (Math.abs(point.kg - reference) > Math.min(0.25, reference * 0.01)) {
			if (pending.kind === 'check') save({ ...state, pending: { ...pending, mismatch: point } })
			throw new Error(`实读 ${point.kg.toFixed(3)} kg，砝码 ${reference} kg，相差 ${(point.kg-reference).toFixed(3)} kg。${pending.kind === 'check' ? '这次只检查，尚未执行标定；可退出复核后重新标定。' : '标定后的示值未通过，请保留读数。'}`)
		}
		save({ ...state, pending: { ...pending, loaded: point } })
	}
	function resolvePending(verified) {
		const { current, pending } = pendingForReview(verified)
		let empty = null
		if (verified) {
			if (['mass', 'check'].includes(pending.kind) && !pending.loaded) throw new Error('先核对台上的砝码，再卸空')
			empty = sample(current, pending.loaded?.at ?? pending.startedAt)
			if (Math.abs(empty.kg) >= 0.25) throw new Error('空台尚未回到零分度，请保留读数并检查')
		}
		if (pending.kind === 'zero') {
			// A daily zero does not overwrite the scale's verified span record.
			save({ ...state, pending: null, zeroFor: verified ? current.device_id : '',
				requiresReview: verified ? Boolean(pending.priorRequiresReview) : true,
				lastZero: verified ? { deviceId: current.device_id, empty, verifiedAt: now() } : state.lastZero })
			return
		}
		save({ ...state, pending: null, zeroFor: '', requiresReview: !verified,
			lastVerified: verified ? { kind: pending.kind, deviceId: pending.deviceId, grams: pending.grams,
				before: pending.before, loaded: pending.loaded, empty,
				zero: pending.kind === 'check' ? pending.before : state.lastZero?.empty,
				verifiedAt: now() } : state.lastVerified })
	}
	function cancelCheck() {
		if (broken) throw new Error(broken)
		if (running || state.pending?.kind !== 'check') throw new Error('只能退出只读复核，标定指令仍须核对结果')
		const pending = state.pending
		// No board command occurred. Keep failed/legacy checks unverified; a new
		// check abandoned without a mismatch may restore its previous review state.
		save({ ...state, pending: null, requiresReview: pending.mismatch || typeof pending.priorRequiresReview !== 'boolean' ? true : pending.priorRequiresReview,
			lastCheck: { deviceId: pending.deviceId, grams: pending.grams, result: pending.mismatch ? 'mismatch' : 'cancelled', reading: pending.mismatch || pending.loaded || null, endedAt: now() } })
	}
	function reviewWhenReady() {
		if (broken || running || !['zero', 'mass'].includes(state.pending?.kind)) return null
		let current, pending, point
		try {
			({ current, pending } = pendingForReview())
			point = sample(current, pending.loaded?.at ?? pending.startedAt)
		} catch (_) { return null }
		if (pending.kind === 'zero') {
			if (Math.abs(point.kg) >= 0.25) return null
			resolvePending(true); return 'zero'
		}
		const reference = pending.grams / 1000
		if (!pending.loaded) {
			if (Math.abs(point.kg-reference) > Math.min(0.25, reference*0.01)) return null
			confirmLoad(); return 'loaded'
		}
		// A tiny reference may itself round to zero; require explicit unloading
		// review in that case instead of treating it as an automatically empty pan.
		if (reference < 0.5 || Math.abs(point.kg) >= 0.25) return null
		resolvePending(true); return 'complete'
	}
	function subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener) }
	return { getState, subscribe, issueZero: () => issue('zero'), issueMass: input => issue('mass', input), beginCheck, cancelCheck, reviewWhenReady, confirmLoad, resolvePending }
}
