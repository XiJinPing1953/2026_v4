'use strict'

const MINUTE = 60000
const MAX_GAP = 90000
const POLICY = Object.freeze({ stable_minutes: 5, stable_span_kpa: 0.05, drop_kpa: 0.1, descending_minutes: 3 })

function number(value) {
	if (value === null || value === undefined || value === '') return null
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : null
}

function timestamp(value) {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	// Bare dates and local-time strings do not establish an operation time.
	return typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) && Number.isFinite(Date.parse(value))
		? Date.parse(value) : null
}

function median(values) {
	const sorted = values.filter(value => value !== null).sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : null
}

function span(values) { return Math.max(...values) - Math.min(...values) }
function iso(value) { return value == null ? null : new Date(value).toISOString() }

/**
 * Read-only evidence, never an actual valve-open time or calibrated physical inventory.
 * coverage.complete means all pages in [from,to] were read, not uninterrupted acquisition.
 * started_at on a filling fact is only an operator/ready event; created_at is not used.
 */
function analyzeTankBeforeFilling({ day, logs = [], fillingFacts = [], coverage = {} } = {}) {
	const result = {
		day, status: 'pending', quantity_t: null, level_kpa: null, pressure_mpa: null,
		observed_at: null, start_window: null, candidates: [], issues: [],
		method: 'minute_median_stable_platform_v1', parameters: { ...POLICY }
	}
	const issue = (code, message) => {
		if (!result.issues.some(item => item.code === code)) result.issues.push({ code, message })
	}
	issue('uncalibrated_indication', '余量为日志中的仪表重量，未经绝对量校准；不作拟合或账期零点替换。')
	issue('operation_unconfirmed', '连续下降仅为疑似出罐；平压、放散、车辆加气及灌装不能仅凭液位区分。')
	issue('server_receive_time', '时段依据服务器接收时间，不能作为实际开阀时间。')
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) {
		issue('invalid_day', '缺少有效业务日期。')
		return result
	}
	const dayStart = Date.parse(`${day}T00:00:00+08:00`)
	const dayEnd = dayStart + 24 * 60 * MINUTE
	if (!Number.isFinite(dayStart) || new Date(dayStart + 8 * 60 * MINUTE).toISOString().slice(0, 10) !== day) {
		issue('invalid_day', '缺少有效业务日期。')
		return result
	}
	const seen = new Set()
	const points = []
	for (const log of Array.isArray(logs) ? logs : []) {
		const time = timestamp(log?.created_at)
		const detail = log?.detail || {}
		const level = number(detail.level_kpa)
		if (log?.action !== 'tank_gateway_ingest' || time === null || time < dayStart || time >= dayEnd || level === null) continue
		const key = log._id || `${time}:${detail.gateway_id || ''}:${detail.tank_id || ''}`
		if (seen.has(key)) continue
		seen.add(key)
		const weight = number(detail.lng_weight_t)
		points.push({ time, level, pressure: number(detail.pressure_mpa), weight: weight !== null && weight >= 0 ? weight : null,
			source: `${detail.gateway_id || ''}/${detail.tank_id || ''}` })
	}
	points.sort((a, b) => a.time - b.time)
	if (!points.length) {
		issue('no_usable_logs', '没有可用的当日储罐日志。')
		return result
	}
	if (new Set(points.map(point => point.source)).size > 1) {
		issue('multiple_sources', '日志包含多个储罐或网关，须先按来源分开。')
		return result
	}
	const gaps = []
	for (let index = 1; index < points.length; index++) {
		if (points[index].time - points[index - 1].time > MAX_GAP) gaps.push({ from: points[index - 1].time, to: points[index].time })
	}
	if (gaps.length) issue('acquisition_gaps', '当日采集存在超过90秒的缺口，缺口内可能仍在作业。')
	const queryFrom = timestamp(coverage.from)
	const queryTo = timestamp(coverage.to)
	const fullQuery = coverage.complete === true && queryFrom !== null && queryFrom <= dayStart && queryTo !== null && queryTo >= dayEnd
	if (!fullQuery) issue('query_incomplete', '尚未确认整日范围和全部分页，不能认定当天首次灌装。')
	const missingBeginning = points[0].time - dayStart > MAX_GAP
	if (missingBeginning) issue('day_start_missing', '当天首段日志缺失，只能识别所见局部时段。')
	const buckets = new Map()
	for (const point of points) {
		const key = Math.floor(point.time / MINUTE) * MINUTE
		if (!buckets.has(key)) buckets.set(key, [])
		buckets.get(key).push(point)
	}
	const minutes = [...buckets].map(([time, rows]) => {
		const levels = rows.map(row => row.level).sort((a, b) => a - b)
		// Trim one extreme on either side: an isolated spike must not end a platform.
		const core = levels.length >= 5 ? levels.slice(1, -1) : levels
		return { time, rows, level: median(levels), stable: span(core) <= POLICY.stable_span_kpa + 1e-9,
			weight: median(rows.map(row => row.weight)), pressure: median(rows.map(row => row.pressure)), usable: rows.length >= 3 }
	})
	const contiguous = rows => rows.every((row, index) => row.usable && (!index || row.time - rows[index - 1].time === MINUTE))
	const supportTimes = (Array.isArray(fillingFacts) ? fillingFacts : []).map(fact => timestamp(fact?.started_at))
		.filter(time => time !== null && time >= dayStart && time < dayEnd)
	if (supportTimes.length) issue('started_at_auxiliary_only', '灌装started_at仅作点击开始或工位ready辅助证据，不是实际开阀反馈。')
	if (!Array.isArray(fillingFacts) || !fillingFacts.length) issue('no_filling_facts', '没有当日灌装源单支持，下降段不能确认属于灌装。')
	const candidates = new Map()
	for (let index = POLICY.stable_minutes - 1; index < minutes.length - POLICY.descending_minutes; index++) {
		const plateau = minutes.slice(index + 1 - POLICY.stable_minutes, index + 1)
		if (!contiguous(plateau) || !plateau.every(row => row.stable) || span(plateau.map(row => row.level)) > POLICY.stable_span_kpa + 1e-9) continue
		const baseline = median(plateau.map(row => row.level))
		for (let offset = 1; offset <= 4; offset++) {
			const decline = minutes.slice(index + offset, index + offset + POLICY.descending_minutes)
			const bridge = minutes.slice(index, index + offset + POLICY.descending_minutes)
			if (decline.length !== POLICY.descending_minutes || !contiguous(bridge)) continue
			if (!decline.every((row, position) => row.level <= baseline - POLICY.drop_kpa && (!position || row.level <= decline[position - 1].level + 0.03))) continue
			const endPoint = plateau.at(-1).rows.at(-1)
			const from = endPoint.time
			const to = decline[0].time + MINUTE
			if (gaps.some(gap => gap.from < decline.at(-1).time + MINUTE && gap.to > plateau[0].time)) continue
			const platformRows = plateau.flatMap(row => row.rows)
			const values = platformRows.map(row => row.pressure).filter(value => value !== null)
			const pressures = bridge.map(row => row.pressure).filter(value => value !== null)
			const candidateIssues = []
			if (values.length && span(values) > 0.03) candidateIssues.push('platform_pressure_unstable')
			if (pressures.length && span(pressures) > 0.05) candidateIssues.push('pressure_changed')
			if (bridge.some(row => row.level > baseline + POLICY.drop_kpa)) candidateIssues.push('rise_before_decline')
			const quantity = median(plateau.map(row => row.weight))
			if (quantity === null) candidateIssues.push('quantity_missing')
			const candidate = {
				quantity_t: quantity, level_kpa: baseline, pressure_mpa: median(plateau.map(row => row.pressure)),
				observed_at: iso(endPoint.time), platform_window: { from: iso(plateau[0].time), to: iso(endPoint.time) },
				start_window: { from: iso(from), to: iso(to) },
				started_at_support: supportTimes.filter(time => time >= from - 5 * MINUTE && time <= to + 5 * MINUTE).map(iso),
				issues: candidateIssues, first_decline_at: iso(decline[0].time)
			}
			// Keep the latest stable platform for the same sustained decline, never multiple sliding windows.
			candidates.set(decline[0].time, candidate)
			break
		}
	}
	result.candidates = [...candidates.values()]
	if (!result.candidates.length) {
		issue('no_stable_start_candidate', '未找到连续稳定平台接连续下降的可用候选；不推算余量。')
		return result
	}
	if (result.candidates.length > 1) {
		issue('multiple_start_candidates', '出现多个疑似作业时段，未据此指定唯一的当天灌装起点。')
		return result
	}
	const selected = result.candidates[0]
	const precedingGap = gaps.some(gap => gap.from < Date.parse(selected.start_window.to))
	if (precedingGap) issue('gap_before_candidate', '候选之前存在采集缺口，不能排除更早作业。')
	if (!fullQuery || missingBeginning || precedingGap || !Array.isArray(fillingFacts) || !fillingFacts.length) return result
	Object.assign(result, { status: 'candidate', quantity_t: selected.quantity_t, level_kpa: selected.level_kpa,
		pressure_mpa: selected.pressure_mpa, observed_at: selected.observed_at, start_window: selected.start_window })
	if (selected.issues.length) issue('candidate_conditions_unverified', '候选平台含缺失量或压力/液位变化，须结合现场作业核实。')
	return result
}

module.exports = { analyzeTankBeforeFilling }
