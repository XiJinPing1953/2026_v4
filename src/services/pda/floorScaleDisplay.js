// App display increment only. Never adjust the sensor's zero or raw weight.
export const FLOOR_SCALE_DISPLAY_STEP_KG = 0.5

export function floorScaleDivisionKg(value) {
	return Math.sign(value) * Math.round(Math.abs(value) / FLOOR_SCALE_DISPLAY_STEP_KG) * FLOOR_SCALE_DISPLAY_STEP_KG
}

export function floorScaleDisplayWeight(snapshot, { raw = false, tare = null } = {}) {
	if (!snapshot?.is_connected || !snapshot.is_online || snapshot.weight_kg == null) return '—'
	const value = Number(snapshot.weight_kg)
	if (!Number.isFinite(value)) return '—'
	if (raw) return value.toFixed(3)
	if (snapshot.warming || snapshot.qualified_frame === false || snapshot.error_code === 'unsupported_capture') return '—'
	// Symmetric half-step rounding; keep negative readings and normalize only -0.
	const offset = tare?.deviceId === snapshot.device_id && (tare.connectionKey || '') === (snapshot.connection_key || '') && Number.isFinite(tare?.kg) ? tare.kg : 0
	const rounded = floorScaleDivisionKg(value - offset)
	return (rounded === 0 ? 0 : rounded).toFixed(1)
}

// Display-only tare: never mutate a frame, calibration or business capture.
export function floorDisplayTarePoint(snapshot, now = Date.now()) {
	const age = now - Number(snapshot?.sampled_at)
	if (!snapshot?.device_id || !Number.isFinite(age) || age < 0 || age > 3000 || floorScaleDisplayWeight(snapshot) === '—') return null
	return { deviceId: snapshot.device_id, connectionKey: snapshot.connection_key || '', kg: Number(snapshot.weight_kg) }
}
