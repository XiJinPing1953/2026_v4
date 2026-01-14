export function formatDateTime(ts) {
	if (!ts) return '-'
	const d = new Date(ts)
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	const hh = String(d.getHours()).padStart(2, '0')
	const mm = String(d.getMinutes()).padStart(2, '0')
	const ss = String(d.getSeconds()).padStart(2, '0')
	return `${y}-${m}-${day} ${hh}:${mm}:${ss}`
}
