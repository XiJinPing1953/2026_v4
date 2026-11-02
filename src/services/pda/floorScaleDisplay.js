// App display increment only. Never adjust the sensor's zero or raw weight.
export const FLOOR_SCALE_DISPLAY_STEP_KG = 0.5

export function floorScaleDivisionKg(value) {
	return Math.sign(value) * Math.round(Math.abs(value) / FLOOR_SCALE_DISPLAY_STEP_KG) * FLOOR_SCALE_DISPLAY_STEP_KG
}

export function floorScaleDisplayWeight(snapshot, { raw = false } = {}) {
	if (!snapshot?.is_connected || !snapshot.is_online || snapshot.weight_kg == null) return '—'
	const value = Number(snapshot.weight_kg)
	if (!Number.isFinite(value)) return '—'
	if (raw) return value.toFixed(3)
	// Symmetric half-step rounding; keep negative readings and normalize only -0.
	const rounded = floorScaleDivisionKg(value - (snapshot.offset_kg || 0))
	return (rounded === 0 ? 0 : rounded).toFixed(1)
}

// Read-only, one summary per observation; no frame history, storage writes or BLE commands.
export function floorZeroObservation(initial, now = Date.now) {
	const start = now(), key = initial.connection_key, device = initial.device_id
	if (!key || !device || !initial.is_online || !initial.is_connected) throw new Error('请先连接地秤并等待实时读数')
	const s = { status: '观察中', elapsed: 0, count: 0, missing: 0, first: null, last: null, min: null, max: null, maxGapMs: 0 }
	let previous = null
	function stop(status) { if (s.status === '观察中') s.status = status; return { ...s } }
	function sample(frame) {
		if (s.status !== '观察中') return { ...s }
		const at = now(); s.elapsed = Math.max(0, Math.floor((at - start) / 1000))
		if (!frame?.is_connected || frame.connection_key !== key || frame.device_id !== device) return stop('连接已结束')
		const stamp = frame.sampled_at, weight = frame.weight_kg
		if (!frame.is_online || !Number.isFinite(weight) || !Number.isFinite(stamp) || stamp > at || at - stamp > 3000 || (previous !== null && stamp <= previous)) s.missing++
		else {
			if (previous !== null) s.maxGapMs = Math.max(s.maxGapMs, stamp - previous)
			previous = stamp; s.count++; s.last = weight
			if (s.first === null) s.first = s.min = s.max = weight
			s.min = Math.min(s.min, weight); s.max = Math.max(s.max, weight)
		}
		if (s.elapsed >= 2700) return stop('45分钟观察结束')
		return { ...s }
	}
	return { sample, stop }
}
