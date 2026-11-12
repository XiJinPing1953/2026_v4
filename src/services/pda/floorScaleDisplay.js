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
	if (snapshot.warming || snapshot.qualified_frame === false || snapshot.error_code === 'unsupported_capture') return '—'
	// The live session owns rounding/hysteresis so display and saved gross agree.
	// Diagnostic-only callers still use symmetric half-step rounding.
	const rounded = Number.isFinite(snapshot.display_kg) ? snapshot.display_kg : floorScaleDivisionKg(value)
	return (rounded === 0 ? 0 : rounded).toFixed(1)
}
