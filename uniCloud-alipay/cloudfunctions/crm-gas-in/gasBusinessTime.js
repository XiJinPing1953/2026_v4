'use strict'

const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function pad2(value) {
	return String(value).padStart(2, '0')
}

function normalizeParts(yearValue, monthValue, dayValue, hourValue = 0, minuteValue = 0) {
	const year = Number(yearValue)
	const month = Number(monthValue)
	const day = Number(dayValue)
	const hour = Number(hourValue)
	const minute = Number(minuteValue)
	if (![year, month, day, hour, minute].every(Number.isInteger)) return ''
	if (year < 1970 || year > 2200) return ''
	if (month < 1 || month > 12) return ''
	const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
	if (day < 1 || day > maxDay) return ''
	if (hour < 0 || hour > 23) return ''
	if (minute < 0 || minute > 59) return ''
	return `${year}-${pad2(month)}-${pad2(day)}-${pad2(hour)}-${pad2(minute)}`
}

function formatBusinessTimeByTs(ts) {
	const source = Number(ts)
	const shifted = new Date((Number.isFinite(source) && source > 0 ? source : Date.now()) + UTC8_OFFSET_MS)
	return normalizeParts(
		shifted.getUTCFullYear(),
		shifted.getUTCMonth() + 1,
		shifted.getUTCDate(),
		shifted.getUTCHours(),
		shifted.getUTCMinutes()
	)
}

function normalizeGasBusinessTime(value, fallbackTs = null) {
	const text = normalizeString(value)
	if (!text) return fallbackTs == null ? '' : formatBusinessTimeByTs(fallbackTs)

	const localMatch = text.match(
		/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T-](\d{1,2})(?::|-)(\d{1,2})(?::\d{1,2}(?:\.\d+)?)?)?$/
	)
	if (localMatch) {
		return normalizeParts(
			localMatch[1],
			localMatch[2],
			localMatch[3],
			localMatch[4] == null ? 0 : localMatch[4],
			localMatch[5] == null ? 0 : localMatch[5]
		)
	}

	if (/^\d{10,13}$/.test(text)) {
		const asNumber = Number(text)
		if (Number.isFinite(asNumber) && asNumber > 0) {
			return formatBusinessTimeByTs(text.length === 10 ? asNumber * 1000 : asNumber)
		}
	}

	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return formatBusinessTimeByTs(parsed)
	return ''
}

function isValidGasBusinessTimeString(value) {
	const text = normalizeString(value)
	if (!/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(text)) return false
	return normalizeGasBusinessTime(text) === text
}

function parseShanghaiBusinessTime(value, fallbackTs = null) {
	const normalized = normalizeGasBusinessTime(value)
	if (normalized) {
		const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/)
		if (match) {
			const parsed = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+08:00`)
			if (Number.isFinite(parsed) && parsed > 0) return parsed
		}
	}
	const fallback = Number(fallbackTs)
	return Number.isFinite(fallback) && fallback > 0 ? fallback : Date.now()
}

module.exports = {
	formatBusinessTimeByTs,
	isValidGasBusinessTimeString,
	normalizeGasBusinessTime,
	parseShanghaiBusinessTime
}
