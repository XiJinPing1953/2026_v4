function pad(value) {
	return String(value).padStart(2, '0')
}

export function formatDateInput(value) {
	const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
	if (Number.isNaN(date.getTime())) return ''
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function getToday(baseDate = new Date()) {
	const date = new Date(baseDate)
	date.setHours(0, 0, 0, 0)
	return date
}

function getWeekStart(baseDate = new Date()) {
	const date = getToday(baseDate)
	const day = date.getDay() || 7
	date.setDate(date.getDate() - day + 1)
	return date
}

function getMonthStart(baseDate = new Date()) {
	const date = getToday(baseDate)
	date.setDate(1)
	return date
}

function getLastMonthStart(baseDate = new Date()) {
	const date = getMonthStart(baseDate)
	date.setMonth(date.getMonth() - 1)
	return date
}

function getYearStart(baseDate = new Date()) {
	const date = getToday(baseDate)
	date.setMonth(0, 1)
	return date
}

export function buildDatePresetRange(preset, baseDate = new Date()) {
	const today = getToday(baseDate)
	if (preset === 'today') {
		const text = formatDateInput(today)
		return { dateStart: text, dateEnd: text }
	}
	if (preset === 'yesterday') {
		const date = new Date(today)
		date.setDate(date.getDate() - 1)
		const text = formatDateInput(date)
		return { dateStart: text, dateEnd: text }
	}
	if (preset === 'week') {
		return {
			dateStart: formatDateInput(getWeekStart(today)),
			dateEnd: formatDateInput(today)
		}
	}
	if (preset === 'lastWeek') {
		const currentWeekStart = getWeekStart(today)
		const lastWeekStart = new Date(currentWeekStart)
		lastWeekStart.setDate(lastWeekStart.getDate() - 7)
		const lastWeekEnd = new Date(currentWeekStart)
		lastWeekEnd.setDate(lastWeekEnd.getDate() - 1)
		return {
			dateStart: formatDateInput(lastWeekStart),
			dateEnd: formatDateInput(lastWeekEnd)
		}
	}
	if (preset === 'month') {
		return {
			dateStart: formatDateInput(getMonthStart(today)),
			dateEnd: formatDateInput(today)
		}
	}
	if (preset === 'lastMonth') {
		const currentMonthStart = getMonthStart(today)
		const lastMonthEnd = new Date(currentMonthStart)
		lastMonthEnd.setDate(0)
		return {
			dateStart: formatDateInput(getLastMonthStart(today)),
			dateEnd: formatDateInput(lastMonthEnd)
		}
	}
	if (preset === 'year') {
		return {
			dateStart: formatDateInput(getYearStart(today)),
			dateEnd: formatDateInput(today)
		}
	}
	return {
		dateStart: '',
		dateEnd: ''
	}
}

export function detectDatePreset(dateStart, dateEnd, baseDate = new Date(), options = {}) {
	const start = String(dateStart || '').trim()
	const end = String(dateEnd || '').trim()
	if (!start && !end) return 'custom'
	if (options && options.includeYear) {
		const yearRange = buildDatePresetRange('year', baseDate)
		if (start === yearRange.dateStart && end === yearRange.dateEnd) return 'year'
	}
	const todayRange = buildDatePresetRange('today', baseDate)
	if (start === todayRange.dateStart && end === todayRange.dateEnd) return 'today'
	if (options && options.includePrevious) {
		const yesterdayRange = buildDatePresetRange('yesterday', baseDate)
		if (start === yesterdayRange.dateStart && end === yesterdayRange.dateEnd) return 'yesterday'
	}
	const weekRange = buildDatePresetRange('week', baseDate)
	if (start === weekRange.dateStart && end === weekRange.dateEnd) return 'week'
	if (options && options.includePrevious) {
		const lastWeekRange = buildDatePresetRange('lastWeek', baseDate)
		if (start === lastWeekRange.dateStart && end === lastWeekRange.dateEnd) return 'lastWeek'
	}
	const monthRange = buildDatePresetRange('month', baseDate)
	if (start === monthRange.dateStart && end === monthRange.dateEnd) return 'month'
	if (options && options.includePrevious) {
		const lastMonthRange = buildDatePresetRange('lastMonth', baseDate)
		if (start === lastMonthRange.dateStart && end === lastMonthRange.dateEnd) return 'lastMonth'
	}
	return 'custom'
}
