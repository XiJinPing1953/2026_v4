export function normalizeText(value) {
	if (value == null) return ''
	return String(value).trim()
}

export function normalizeBottleNo(value) {
	return normalizeText(value).toUpperCase().replace(/\s+/g, '')
}

export function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

export function todayDate() {
	const date = new Date()
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

export function formatDateTime(value) {
	const text = normalizeText(value)
	let date = null
	if (typeof value === 'number' && Number.isFinite(value)) {
		date = new Date(value)
	} else if (/^\d+$/.test(text)) {
		date = new Date(Number(text))
	} else if (text) {
		const parsed = Date.parse(text)
		if (Number.isFinite(parsed)) date = new Date(parsed)
	}
	if (!date || Number.isNaN(date.getTime())) return text || '-'
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const hh = String(date.getHours()).padStart(2, '0')
	const mm = String(date.getMinutes()).padStart(2, '0')
	return `${y}-${m}-${d} ${hh}:${mm}`
}

export function formatMoney(value) {
	return Number(toNumber(value, 0)).toFixed(2)
}

export function formatWeight(value, digits = 2) {
	const num = toNumber(value, null)
	if (num == null) return '-'
	return Number(num).toFixed(digits)
}

export function buildDepositPreviewRows({ baseBottleNos = [], outItems = [], backItems = [] } = {}) {
	const depositSet = new Set()

	baseBottleNos.forEach((item) => {
		const bottleNo = normalizeBottleNo(typeof item === 'string' ? item : item?.bottle_no || item?.bottleNo)
		if (bottleNo) depositSet.add(bottleNo)
	})

	outItems.forEach((item) => {
		const bottleNo = normalizeBottleNo(item?.bottle_no || item?.bottleNo)
		if (bottleNo) depositSet.add(bottleNo)
	})

	backItems.forEach((item) => {
		const bottleNo = normalizeBottleNo(item?.bottle_no || item?.bottleNo)
		if (bottleNo) depositSet.delete(bottleNo)
	})

	return Array.from(depositSet)
		.sort()
		.map((bottleNo) => ({ bottle_no: bottleNo }))
}
