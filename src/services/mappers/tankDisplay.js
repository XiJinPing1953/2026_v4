// Select the explicit display snapshot without changing the API's raw inventory
// fields. This mapper is only used by the live dashboard, never by reconciliation.
export function mapTankDisplay(tank = {}) {
	if (!tank.display || typeof tank.display !== 'object') return tank
	const display = tank.display
	const unavailable = ['invalid', 'stale'].includes(display.status)
	return { ...tank,
		corrected_level_kpa: unavailable ? null : display.corrected_level_kpa,
		estimated_weight_t: unavailable ? null : display.estimated_weight_t,
		sampled_at: display.sampled_at,
		status: display.status === 'stale' ? 'stale' : display.status === 'invalid' ? 'error' : tank.status,
		message: display.message || tank.message,
		estimate_version: display.estimate_version,
		estimate_status: display.estimate_status }
}
