export function normalizeText(value) {
	if (value == null) return ''
	return String(value).trim()
}

const SCALE_WEIGHT_CHAR_MAP = {
	O: '0',
	D: '0',
	Q: '0',
	C: '0',
	U: '0',
	I: '1',
	L: '1',
	'!': '1',
	J: '1',
	T: '7',
	Y: '7',
	Z: '2',
	S: '5',
	B: '8',
	G: '6',
	A: '4'
}

export function normalizeBottleNo(value) {
	return normalizeText(value).toUpperCase().replace(/\s+/g, '')
}

export function normalizeQrCode(value) {
	return normalizeText(value).toUpperCase().replace(/\s+/g, '')
}

export function normalizePlateNo(value) {
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

export function extractCapturedWeight(value, fallback = '') {
	const text = normalizeText(value).replace(/,/g, '')
	if (!text) return fallback
	const match = text.match(/-?\d+(?:\.\d+)?/)
	return match ? match[0] : fallback
}

export function normalizeNumericWeightInput(value) {
	const source = normalizeText(value)
		.replace(/[，,。]/g, '.')
		.replace(/[：:]/g, '.')
		.replace(/[oO]/g, '0')
		.replace(/[lI!]/g, '1')
	if (!source) return ''
	let out = ''
	let dotUsed = false
	for (const char of source) {
		if (char >= '0' && char <= '9') {
			out += char
			continue
		}
		if (char === '.' && !dotUsed) {
			out += out ? '.' : '0.'
			dotUsed = true
		}
	}
	if (out.endsWith('.')) out = out.slice(0, -1)
	if (!out) return ''
	if (out.startsWith('0') && !out.startsWith('0.') && out.length > 1) {
		out = out.replace(/^0+/, '')
		if (!out) out = '0'
	}
	return out
}

function normalizeScaleWeightChars(value) {
	const source = normalizeText(value).toUpperCase().replace(/,/g, '')
	if (!source) return ''
	const withoutUnits = source
		.replace(/KGS?/g, ' ')
		.replace(/KG/g, ' ')
		.replace(/千克/g, ' ')
		.replace(/公斤/g, ' ')
		.replace(/克/g, ' ')
	return Array.from(withoutUnits)
		.map((char) => SCALE_WEIGHT_CHAR_MAP[char] || char)
		.join('')
}

function scoreScaleWeightCandidate(value) {
	const normalized = normalizeNumericWeightInput(value)
	if (!normalized) return -1
	const numeric = Number(normalized)
	const digits = normalized.replace(/\./g, '').length
	const hasDecimal = normalized.includes('.')
	const integerPreferred = !hasDecimal && digits >= 3 && digits <= 5
	const decimalPreferred = hasDecimal && digits >= 3 && digits <= 6
	const continuousNumeric = /^[0-9]+(?:\.[0-9]+)?$/.test(normalized)
	let score = 0
	if (Number.isFinite(numeric) && numeric > 0) score += 10
	if (continuousNumeric) score += 6
	if (integerPreferred) score += 32
	else if (decimalPreferred) score += 24
	else if (!hasDecimal) score += 18
	else score += 8
	if (digits >= 3 && digits <= 6) score += 8
	else if (digits >= 2) score += 2
	if (hasDecimal && decimalPreferred) score += 4
	score += Math.min(digits, 6)
	return score
}

export function analyzeScaleWeight(rawValue) {
	const rawText = normalizeText(rawValue)
	if (!rawText) {
		return {
			rawText: '',
			normalizedText: '',
			candidates: [],
			value: ''
		}
	}
	const normalizedText = normalizeScaleWeightChars(rawText)
	const condensed = normalizeNumericWeightInput(normalizedText)
	const segmented = normalizedText
		.replace(/[^0-9.]/g, ' ')
		.split(/\s+/)
		.map((item) => normalizeNumericWeightInput(item))
		.filter(Boolean)
	const candidates = Array.from(new Set([condensed, ...segmented].filter(Boolean)))
		.sort((left, right) => {
			const scoreDiff = scoreScaleWeightCandidate(right) - scoreScaleWeightCandidate(left)
			if (scoreDiff !== 0) return scoreDiff
			return right.length - left.length
		})
	const value = candidates[0] || ''
	return {
		rawText,
		normalizedText,
		candidates,
		value
	}
}

export function extractScaleWeight(rawValue, fallback = '') {
	const analyzed = analyzeScaleWeight(rawValue)
	return analyzed.value || fallback
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
