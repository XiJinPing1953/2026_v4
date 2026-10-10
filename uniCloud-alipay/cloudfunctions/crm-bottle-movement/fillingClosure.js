'use strict'

const flowRules = require('./bottleFlowRulesLocal')
const RULE_VERSION = 'filling-closure-2026-10-10-v1'
const text = value => value == null ? '' : String(value).trim()
const bottle = value => text(value).toUpperCase().replace(/\s+/g, '')
const day = value => /^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : ''
const number = value => value === '' || value == null || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? null : Number(value)
const rounded = value => value == null ? null : Math.round((value + Number.EPSILON) * 1000) / 1000
const sum = values => values.some(value => value == null) ? null : rounded(values.reduce((total, value) => total + value, 0))
const issueList = value => (Array.isArray(value) ? value : []).map(item => text(item?.code || item)).filter(Boolean)
const inRange = (value, start, end) => Boolean(value) && (!start || value >= start) && (!end || value <= end)
const eventDay = row => day(row.event_day || row.date)
const issue = (target, code) => { if (!target.issues.includes(code)) target.issues.push(code) }
const ISSUE_LABELS = {
	duplicate_filling_source: '灌装源单重复', duplicate_source_event: '同一来源存在重复事件',
	missing_filling_movement: '灌装源单缺少对应事件', missing_filling_source: '找不到灌装源单',
	filling_source_mismatch: '灌装源单与事件依据不一致', missing_business_day: '业务日期缺失',
	missing_source_id: '来源编号缺失', same_day_order_uncertain: '同日先后顺序待核',
	missing_back: '缺少本周期回瓶依据', back_before_out: '出瓶前又出现回瓶，周期待核',
	missing_tare: '缺少皮重依据', tare_mismatch: '本周期皮重不一致或无效',
	missing_filling_weight: '灌装称重依据缺失', filling_weight_mismatch: '灌装称重与净增量不一致',
	invalid_net_weight: '瓶内净重缺失或无效', missing_back_weight: '回瓶净重缺失或无效',
	sale_weight_mismatch: '销售称重与净重不一致', source_boundary: '遇到不可直接关联的流转环节',
	same_day_boundary: '同日含不可直接关联的流转，先后关系待核'
}

function eventKey(row) {
	return row.source_id ? [row.type, row.source_type, row.source_id, row.bottle_no].join('|') : row._id
}

function normalizeEvents(events, fillings) {
	const sourceById = new Map()
	for (const filling of fillings) {
		const id = text(filling._id)
		if (!id) continue
		const existing = sourceById.get(id)
		sourceById.set(id, { ...filling, source_issues: [...issueList(filling.source_issues), ...(existing ? ['duplicate_filling_source'] : [])] })
	}
	const byKey = new Map()
	const seenFills = new Set()
	const sourceEvents = [...events]
	for (const row of events) if (row.type === 'fill') seenFills.add(text(row.source_id))
	for (const [id, filling] of sourceById) {
		if (seenFills.has(id) || (filling.record_type && filling.record_type !== 'normal_fill')) continue
		sourceEvents.push({ type: 'fill', source_type: 'filling', source_id: id, bottle_no: filling.bottle_no,
			date: filling.filling_time || filling.date, event_day: day(filling.date), net_weight: filling.fill_weight,
			context: { source_issues: ['missing_filling_movement'] } })
	}
	for (const source of sourceEvents) {
		if (!['back', 'fill', 'out', 'boundary'].includes(source.type)) continue
		const row = { ...source, _id: text(source._id), source_id: text(source.source_id), source_type: text(source.source_type),
			bottle_no: bottle(source.bottle_no), context: { ...(source.context || {}) },
			issues: [...issueList(source.source_issues), ...issueList(source.context?.source_issues)] }
		if (row.type === 'fill') {
			const filling = sourceById.get(row.source_id)
			if (!filling) issue(row, 'missing_filling_source')
			else {
				if (filling.record_type && filling.record_type !== 'normal_fill') continue
				if (row.bottle_no !== bottle(filling.bottle_no) || eventDay(row) !== day(filling.date) ||
					(number(row.net_weight) != null && number(filling.fill_weight) != null && Math.abs(number(row.net_weight) - number(filling.fill_weight)) > 0.001)) issue(row, 'filling_source_mismatch')
				row.bottle_no = bottle(filling.bottle_no)
				row.date = filling.filling_time || filling.date
				row.event_day = day(filling.date)
				row.net_weight = number(filling.fill_weight)
				for (const key of ['weight_start', 'weight_end', 'tare']) if (filling[key] != null) row.context[key] = filling[key]
				for (const code of issueList(filling.source_issues)) issue(row, code)
			}
		}
		if (!row.bottle_no || /^TRUCK[-_]/.test(row.bottle_no)) continue
		row.event_day = eventDay(row)
		row.net_weight = number(row.net_weight)
		if (!row.event_day) issue(row, 'missing_business_day')
		if (!row.source_id && row.type !== 'boundary') issue(row, 'missing_source_id')
		const key = eventKey(row) || `unidentified:${byKey.size}`
		if (byKey.has(key)) {
			const previous = byKey.get(key)
			issue(previous, 'duplicate_source_event')
			for (const code of row.issues) issue(previous, code)
		} else byKey.set(key, row)
	}
	return [...byKey.values()]
}

function evidence(row) {
	return { type: row.type, date: text(row.date), event_day: eventDay(row), source_type: row.source_type,
		source_id: row.source_id || null, movement_id: row._id || null, net_weight: number(row.net_weight),
		weight_start: number(row.context?.weight_start), weight_end: number(row.context?.weight_end),
		gross: number(row.context?.gross), tare: number(row.context?.tare), issues: [...row.issues],
		issue_labels: row.issues.map(code => ISSUE_LABELS[code] || code) }
}

function businessTimestamp(row) {
	const date = text(row.date)
	const hour = date.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})$/)
	if (hour) return Date.parse(`${hour[1]}T${hour[2]}:00:00+08:00`)
	if (['hour', 'minute', 'exact'].includes(row.context?.time_precision)) return number(row.event_at)
	if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(date)) return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(date) ? date : `${date.replace(' ', 'T')}+08:00`)
	return null
}

function markAmbiguousDay(rows) {
	const counts = rows.reduce((result, row) => ({ ...result, [row.type]: (result[row.type] || 0) + 1 }), {})
	const timestamps = rows.map(businessTimestamp)
	const multipleTurns = (counts.back > 1 || counts.out > 1 || counts.fill > 1) && Boolean(counts.back || counts.out)
	const knownTimes = timestamps.filter(value => value != null && Number.isFinite(value))
	const timeConflict = knownTimes.some((value, index) => index && value < knownTimes[index - 1])
	if ((multipleTurns && timestamps.some(value => value == null)) || timeConflict) {
		for (const row of rows) issue(row, 'same_day_order_uncertain')
	}
}

function finalizeCycle(active, out, terminalIssue, dateEnd) {
	const fills = active.fills
	const first = fills[0]
	const last = fills[fills.length - 1]
	const rows = [...(active.back ? [active.back] : []), ...fills, ...(out ? [out] : [])]
	const cycle = { id: `fill:${first.source_id || first._id}`, bottle_no: first.bottle_no,
		first_fill_id: first.source_id || null, first_fill_day: eventDay(first), out_day: out ? eventDay(out) : null,
		status: 'pending', issues: [...new Set(rows.flatMap(row => row.issues))], fill_count: fills.length,
		source_fill_ids: fills.map(row => row.source_id), source_out_id: out?.source_id || null,
		evidence: rows.map(evidence) }
	if (!active.back) issue(cycle, 'missing_back')
	if (terminalIssue) issue(cycle, terminalIssue)
	if (active.boundary) {
		cycle.evidence.push(evidence(active.boundary))
		for (const code of active.boundary.issues) issue(cycle, code)
	}
	const tareValues = rows.map(row => number(row.context?.tare)).filter(value => value != null)
	const tare = number(first.context?.tare) ?? number(active.back?.context?.tare) ?? number(out?.context?.tare)
	if (tare == null) issue(cycle, 'missing_tare')
	if (tareValues.some(value => value < 0 || (tare != null && Math.abs(value - tare) > 0.001))) issue(cycle, 'tare_mismatch')
	const fillWeights = fills.map(row => number(row.net_weight))
	for (const row of fills) {
		const start = number(row.context?.weight_start)
		const end = number(row.context?.weight_end)
		if (start == null || end == null || row.net_weight == null) issue(cycle, 'missing_filling_weight')
		else if (start < 0 || end < start || row.net_weight < 0 || Math.abs(end - start - row.net_weight) > 0.001) issue(cycle, 'filling_weight_mismatch')
	}
	cycle.selected_fill_kg = sum(fills.filter(row => !dateEnd || eventDay(row) <= dateEnd).map(row => row.net_weight))
	cycle.later_fill_kg = sum(fills.filter(row => dateEnd && eventDay(row) > dateEnd).map(row => row.net_weight))
	cycle.total_fill_kg = sum(fillWeights)
	const firstStart = number(first.context?.weight_start)
	const lastEnd = number(last.context?.weight_end)
	cycle.pre_fill_net_kg = tare == null || firstStart == null ? null : rounded(firstStart - tare)
	cycle.last_net_kg = tare == null || lastEnd == null ? null : rounded(lastEnd - tare)
	cycle.out_net_kg = out ? number(out.net_weight) : null
	if (cycle.pre_fill_net_kg < 0 || cycle.last_net_kg < 0 || (out && (cycle.out_net_kg == null || cycle.out_net_kg < 0))) issue(cycle, 'invalid_net_weight')
	const backNet = number(active.back?.net_weight)
	if (active.back && (backNet == null || backNet < 0)) issue(cycle, 'missing_back_weight')
	for (const row of [active.back, out].filter(Boolean)) {
		const gross = number(row.context?.gross)
		const rowTare = number(row.context?.tare)
		if (gross != null && rowTare != null && row.net_weight != null && Math.abs(gross - rowTare - row.net_weight) > 0.001) issue(cycle, 'sale_weight_mismatch')
	}
	const storageDifferences = fills.slice(1).map((row, index) => {
		const previousEnd = number(fills[index].context?.weight_end)
		const nextStart = number(row.context?.weight_start)
		return previousEnd == null || nextStart == null ? null : rounded(previousEnd - nextStart)
	})
	cycle.start_loss_kg = sum([backNet == null || cycle.pre_fill_net_kg == null ? null : rounded(backNet - cycle.pre_fill_net_kg), ...storageDifferences])
	cycle.post_fill_difference_kg = cycle.last_net_kg == null || cycle.out_net_kg == null ? null : rounded(cycle.last_net_kg - cycle.out_net_kg)
	cycle.status = cycle.issues.length ? 'pending' : out ? 'closed' : 'unsold'
	cycle.issue_labels = cycle.issues.map(code => ISSUE_LABELS[code] || code)
	return cycle
}

function summarize(cycles) {
	const summary = { cycle_count: cycles.length, bottle_count: new Set(cycles.map(row => row.bottle_no)).size,
		closed_count: 0, unsold_count: 0, pending_count: 0, known_totals: {}, unknown_weight_counts: {} }
	for (const status of ['closed', 'unsold', 'pending']) summary[`${status}_count`] = cycles.filter(row => row.status === status).length
	const metrics = {
		selected_fill_kg: cycles, later_fill_kg: cycles, total_fill_kg: cycles,
		out_net_kg: cycles.filter(row => row.status === 'closed'),
		unsold_net_kg: cycles.filter(row => row.status === 'unsold'),
		pending_fill_kg: cycles.filter(row => row.status === 'pending'),
		post_fill_difference_kg: cycles.filter(row => row.status === 'closed')
	}
	for (const [key, rows] of Object.entries(metrics)) {
		const field = key === 'unsold_net_kg' ? 'last_net_kg' : key === 'pending_fill_kg' ? 'total_fill_kg' : key
		const values = rows.map(row => row[field])
		summary[key] = sum(values)
		summary.known_totals[key] = sum(values.filter(value => value != null))
		summary.unknown_weight_counts[key] = values.filter(value => value == null).length
	}
	return summary
}

// Read-only grouping by the first fill, with all later fills kept inside one sale cycle.
function buildFillingClosure({ events = [], fillings = [], dateStart = '', dateEnd = '', cutoffDay = '', bottleNo = '', selectedFillingIds = null } = {}) {
	dateStart = day(dateStart); dateEnd = day(dateEnd); cutoffDay = day(cutoffDay)
	const byBottle = new Map()
	const normalized = normalizeEvents(events, fillings)
	for (const row of normalized) {
		if (bottleNo && row.bottle_no !== bottle(bottleNo)) continue
		if (cutoffDay && eventDay(row) > cutoffDay) continue
		if (!byBottle.has(row.bottle_no)) byBottle.set(row.bottle_no, [])
		byBottle.get(row.bottle_no).push(row)
	}
	const allCycles = []
	let unmatchedOutCount = 0
	for (const rows of byBottle.values()) {
		const byDay = new Map()
		for (const row of rows.sort(flowRules.compareEvents)) {
			if (!byDay.has(eventDay(row))) byDay.set(eventDay(row), [])
			byDay.get(eventDay(row)).push(row)
		}
		let active = { back: null, fills: [] }
		let pending = []
		let lastType = ''
		const finish = (out = null, reason = '') => {
			if (active.fills.length) allCycles.push(finalizeCycle(active, out, reason, dateEnd))
			active = { back: null, fills: [] }
		}
		for (const dayRows of byDay.values()) {
			const ordered = flowRules.businessDayOrder(dayRows, { pending: pending.length > 0, hasBack: Boolean(active.back), lastWasOut: lastType === 'out' })
			markAmbiguousDay(ordered)
			const boundary = ordered.find(row => row.type === 'boundary')
			if (boundary) {
				active.boundary = boundary
				finish(null, 'source_boundary')
				pending = []
				// Without a shared, proven clock, a same-day boundary cannot sit safely between source rows.
				const fills = ordered.filter(row => row.type === 'fill')
				if (fills.length) {
					active = { back: null, fills, boundary }
					finish(null, 'same_day_boundary')
				}
				unmatchedOutCount += ordered.filter(row => row.type === 'out').length
				lastType = ''
				continue
			}
			if (flowRules.hasSameDayBackOutWithoutFill(ordered) && (pending.length || (!active.back && lastType !== 'out'))) {
				if (active.fills.length) finish(null, 'same_day_order_uncertain')
				pending.push(ordered)
				continue
			}
			if (pending.length) {
				const latest = pending[pending.length - 1]
				if (ordered[0]?.type === 'fill') active.back = latest.filter(row => row.type === 'back').slice(-1)[0]
				else active = { back: null, fills: [] }
				pending = []
			}
			for (const row of ordered) {
				if (row.type === 'back') {
					if (active.fills.length) finish(null, 'back_before_out')
					active.back = row
				} else if (row.type === 'fill') active.fills.push(row)
				else if (active.fills.length) finish(row)
				else { unmatchedOutCount += 1; active = { back: null, fills: [] } }
				lastType = row.type
			}
		}
		finish()
	}
	const selectedIds = Array.isArray(selectedFillingIds) ? new Set(selectedFillingIds.map(text)) : null
	const selectedFillEvidence = row => row.evidence.filter(event => event.type === 'fill' &&
		inRange(event.event_day, dateStart, dateEnd) && (!selectedIds || selectedIds.has(event.source_id)))
	const priorCycles = allCycles.filter(row => dateStart && row.first_fill_day < dateStart && selectedFillEvidence(row).length)
	const priorFillWeights = priorCycles.flatMap(selectedFillEvidence).map(row => row.net_weight)
	const cycles = allCycles.filter(row => inRange(row.first_fill_day, dateStart, dateEnd) && (!selectedIds || row.source_fill_ids.some(id => selectedIds.has(id))))
		.sort((a, b) => a.first_fill_day.localeCompare(b.first_fill_day) || a.bottle_no.localeCompare(b.bottle_no) || a.id.localeCompare(b.id))
	return { cycles, summary: summarize(cycles), scope: { rule_version: RULE_VERSION, date_start: dateStart, date_end: dateEnd,
		cutoff_day: cutoffDay, selection_basis: 'first_filling_day', total_event_count: normalized.length,
		observed_event_count: [...byBottle.values()].reduce((total, rows) => total + rows.length, 0),
		excluded_prior_cycle_count: priorCycles.length,
		selected_prior_fill_count: priorFillWeights.length, selected_prior_fill_kg: sum(priorFillWeights),
		selected_prior_known_fill_kg: sum(priorFillWeights.filter(value => value != null)),
		selected_prior_unknown_weight_count: priorFillWeights.filter(value => value == null).length,
		unmatched_out_count: unmatchedOutCount, read_only: true } }
}

module.exports = { buildFillingClosure, RULE_VERSION }
