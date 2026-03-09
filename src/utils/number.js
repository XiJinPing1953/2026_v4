export function toNumber(value, fallback = 0) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isNaN(num) ? fallback : num
}

export function fix2(value) {
	return Math.round(Number(value) * 100) / 100
}

export function fmt2(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '0.00'
	return num.toFixed(2)
}

export function nearlyEqual(a, b, eps = 0.01) {
	return Math.abs(a - b) < eps
}
