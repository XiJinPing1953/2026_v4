'use strict'

const RULE_VERSION = 'truck-quantity-closure-2026-10-11-v1'
const DAY_MS = 86400000
const text = value => value == null ? '' : String(value).trim()
const number = value => value === '' || value == null || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? null : Number(value)
const outKey = row => row.source_out_id ? `${text(row.source_out_id)}|${text(row.bottle_no).toUpperCase().replace(/\s+/g, '')}` : ''
const day = value => /^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : ''
const kg = value => { const n = number(value); return n == null || n < 0 ? null : Math.round(n * 1000) / 1000 }
const tonKg = value => { const n = number(value); return n == null || n < 0 ? null : Math.round(n * 1000000) / 1000 }
const difference = (a, b) => a == null || b == null ? null : (Math.round(a * 1000) - Math.round(b * 1000)) / 1000
const issue = (row, code) => { if (!row.issues.includes(code)) row.issues.push(code) }
const labels = row => { row.issue_labels = row.issues.map(code => ISSUE_LABELS[code] || code); return row }
const issueCodes = value => (Array.isArray(value) ? value : []).map(item => text(item?.code || item)).filter(Boolean)
const inRange = (d, start, end) => Boolean(d) && (!start || d >= start) && (!end || d <= end)
const ISSUE_LABELS = {
	transfer_in_progress: '观察截止时跨日进液尚未完成，最终磅差不提前计入', fact_conflict: '现场确认与当前源单不符，确认暂不套用', duplicate_gas_in: '入库源单编号重复',
	missing_business_day: '业务日期缺失或无效', invalid_transfer_window: '现场进液时间范围无效',
	unconfirmed_station_weighing: '登记毛重为出厂毛重，站内两次过磅依据待核',
	registered_gross_net_mismatch: '登记毛重减皮重与登记净重不一致', registered_split_mismatch: '站内卸入加随车直销与登记净重不一致',
	field_station_differs: '现场核准卸入与源单登记不同，保留两种数值', field_weigh_differs: '现场核准两磅与登记称重不同',
	field_weigh_station_mismatch: '现场两磅差与核准站内卸入不同', missing_inbound_weight: '卸入重量依据缺失或无效',
	mixed_tank: '卸前未清罐，按作业期关联，不能视为纯本车液', clear_status_unknown: '卸前清罐状态待核',
	unpumpable_not_zero: '清罐指再也灌不出，仍可能留有余液', day_boundary_uncertain: '入库仅日期依据，卸车当天先后待分配',
	overlapping_transfer_windows: '同日或重叠卸入，车次先后待核', open_period: '末车作业期仍开放，会随新记录更新',
	missing_filling_weight: '灌入重量缺失或无效', filling_weight_mismatch: '灌装称重差与账面灌入不一致',
	missing_filling_id: '灌装源单编号缺失', duplicate_filling_source: '灌装源单编号重复',
	unknown_record_type: '出罐类型未识别', filling_date_mismatch: '灌装日期与时刻日期不一致',
	before_first_batch: '首车之前或期前余液，不归首车', transfer_overlap: '可能发生于卸车期间，先后待核',
	multiple_candidate_batches: '可能归属多车，需补充灌装与卸车时刻', no_out_fact_conflict: '灌装时间完全落在无出气确认内，现场事实冲突',
	assumed_no_out: '按期间无出气的临时假设归属，仍待核实', unknown_chronology: '存在日期不明的入库，归属待核',
	missing_cycle_filling: '周期灌装源单未读到或超出观察截止', shared_batch_cycle: '跨车补灌或包含待分配灌装，出瓶不分摊',
	duplicate_cycle_filling: '同一灌装出现在多个周期，关联待核', duplicate_out_source: '同一出瓶出现在多个周期，仅保留一份待核',
	missing_out_weight: '出瓶净重缺失或无效', pending_cycle: '普通瓶周期本身待核', duplicate_cycle: '周期编号重复'
}

function startOfDay(value) {
	const d = day(value)
	if (!d) return null
	const ms = Date.parse(`${d}T00:00:00+08:00`)
	return Number.isFinite(ms) && new Date(ms + 28800000).toISOString().slice(0, 10) === d ? ms : null
}
function timestamp(value) {
	const raw = text(value)
	const legacy = raw.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(?:-(\d{2}))?$/)
	const normalized = legacy ? `${legacy[1]}T${legacy[2]}:${legacy[3] || '00'}:00+08:00` : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw.replace(' ', 'T')}+08:00`
	const ms = Date.parse(normalized)
	return startOfDay(raw) != null && Number.isFinite(ms) ? ms : null
}
function fillingWindow(row) {
	const raw = text(row.filling_time || row.date)
	const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[- T](\d{2})(?:[:-](\d{2})(?::(\d{2}))?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/)
	if (!match || startOfDay(match[1]) == null || Number(match[2] || 0) > 23 || Number(match[3] || 0) > 59 || Number(match[4] || 0) > 59) return null
	const precision = match[4] ? 'second' : match[3] ? 'minute' : match[2] ? 'hour' : 'day'
	const start = startOfDay(match[1]) + Number(match[2] || 0) * 3600000 + Number(match[3] || 0) * 60000 + Number(match[4] || 0) * 1000
	return { start, end: start + ({ day: DAY_MS, hour: 3600000, minute: 60000, second: 1000 })[precision], precision }
}
function aggregate(values) {
	const valid = values.map(kg)
	const knownGrams = valid.reduce((total, value) => total + (value == null ? 0 : Math.round(value * 1000)), 0)
	const unknown = valid.filter(value => value == null).length
	return { kg: unknown ? null : knownGrams / 1000, known_kg: knownGrams / 1000, count: values.length, unknown_count: unknown }
}
function matchedFact(row, entries) {
	if (!entries.length) return { fact: null, conflict: false }
	if (entries.length !== 1) return { fact: null, conflict: true }
	const fact = entries[0]
	const expected = fact.expected
	if (!expected || !Object.keys(expected).length) return { fact: null, conflict: true }
	const matches = Object.entries(expected).every(([key, value]) => {
		if (value == null || value === '') return row[key] == null || row[key] === ''
		if (key === 'date') return text(row[key]) === text(value)
		return number(value) != null ? number(row[key]) != null && Math.abs(number(row[key]) - number(value)) < 1e-9 : text(row[key]) === text(value)
	})
	return { fact: matches ? fact : null, conflict: !matches }
}
function fillingKind(row) {
	const type = text(row.record_type) || 'normal_fill'
	if (type === 'truck_out_agent_sale') return 'agent_out'
	if (type === 'truck_out_no_sale') return 'self_use'
	if (type !== 'normal_fill') return 'other'
	return /^TRUCK(?:[-_]|$)/i.test(text(row.bottle_no)) ? 'truck_refill' : 'normal_fill'
}
function subtractWindow(segments, start, end) {
	return segments.flatMap(segment => {
		if (end <= segment.start || start >= segment.end) return [segment]
		return [...(segment.start < start ? [{ start: segment.start, end: start }] : []), ...(segment.end > end ? [{ start: end, end: segment.end }] : [])]
	})
}
function buildBatch(row, fact, conflict, duplicate) {
	const d = day(fact?.effective_day || row.date)
	const s = startOfDay(d)
	const batch = { id: text(row._id), day: d, recorded_day: day(row.date), source_date: text(row.date),
		truck_no: text(row.truck_no || row.plate_no || row.car_no || row.vehicle_no), source_id: text(row._id),
		issues: [...issueCodes(row.source_issues)], filling_rows: [], cycles: [], clear_before: fact?.clear_before || 'unknown',
		mixed_tank: fact?.clear_before === 'not_cleared', fact_note: text(fact?.note), open_period: false,
		boundary: { start_at: null, end_at: null, precision: 'day', source: 'registered_day' }, _start: s, _end: s == null ? null : s + DAY_MS }
	if (conflict) issue(batch, 'fact_conflict')
	if (duplicate) issue(batch, 'duplicate_gas_in')
	if (s == null) issue(batch, 'missing_business_day')
	if (fact?.transfer_start || fact?.transfer_end) {
		const from = timestamp(fact.transfer_start), to = timestamp(fact.transfer_end)
		if (from != null && to != null && to > from) {
			batch._start = from; batch._end = to
			batch.boundary = { start_at: text(fact.transfer_start), end_at: text(fact.transfer_end), precision: 'field_window', source: 'confirmed_field_record' }
		} else issue(batch, 'invalid_transfer_window')
	}
	if (batch.boundary.precision === 'day') issue(batch, 'day_boundary_uncertain')
	if (batch.mixed_tank) issue(batch, 'mixed_tank')
	else if (batch.clear_before === 'unpumpable') issue(batch, 'unpumpable_not_zero')
	else issue(batch, 'clear_status_unknown')
	const sourceGross = tonKg(row.gross_weight_t), sourceTare = tonKg(row.tare_weight_t), sourceNet = tonKg(row.net_weight_t)
	const sourceStation = tonKg(row.station_weight_t), direct = tonKg(row.direct_sale_weight_t)
	const sourceDiff = sourceGross != null && sourceTare != null && sourceGross >= sourceTare ? difference(sourceGross, sourceTare) : null
	const fieldGross = tonKg(fact?.gross_weight_t), fieldTare = tonKg(fact?.tare_weight_t)
	const fieldDiff = fieldGross != null && fieldTare != null && fieldGross >= fieldTare ? difference(fieldGross, fieldTare) : null
	const fieldStation = tonKg(fact?.station_weight_t)
	batch.weight = { confirmed_weigh_in_kg: fieldDiff, recorded_station_in_kg: sourceStation,
		direct_sale_kg: direct, registered_net_kg: sourceNet, registered_gross_diff_kg: sourceDiff,
		raw_gross_kg: sourceGross, raw_tare_kg: sourceTare, field_gross_kg: fieldGross, field_tare_kg: fieldTare,
		adopted_station_in_kg: fieldStation != null ? fieldStation : sourceStation,
		adopted_basis: fieldStation != null ? 'confirmed_field_record' : 'registered_pending',
		evidence_basis: fieldDiff != null ? 'confirmed_two_weighings' : 'factory_gross_unverified' }
	if (fieldDiff == null) issue(batch, 'unconfirmed_station_weighing')
	if (batch.weight.adopted_station_in_kg == null) issue(batch, 'missing_inbound_weight')
	if (sourceDiff != null && sourceNet != null && Math.abs(difference(sourceDiff, sourceNet)) > 0.001) issue(batch, 'registered_gross_net_mismatch')
	if (sourceStation != null && direct != null && sourceNet != null && Math.abs(sourceStation + direct - sourceNet) > 0.001) issue(batch, 'registered_split_mismatch')
	if (fieldStation != null && sourceStation != null && Math.abs(difference(fieldStation, sourceStation)) > 0.001) issue(batch, 'field_station_differs')
	if ((fieldGross != null && sourceGross != null && fieldGross !== sourceGross) || (fieldTare != null && sourceTare != null && fieldTare !== sourceTare)) issue(batch, 'field_weigh_differs')
	if (fieldDiff != null && fieldStation != null && Math.abs(difference(fieldDiff, fieldStation)) > 0.001) issue(batch, 'field_weigh_station_mismatch')
	return batch
}

// Working-period attribution only. Neither tank molecules nor loss/cost are allocated here.
function buildTruckQuantityClosure({ gasIns = [], fillings = [], cycles = [], facts = [], dateStart = '', dateEnd = '', cutoffDay = '' } = {}) {
	dateStart = day(dateStart); dateEnd = day(dateEnd); cutoffDay = day(cutoffDay)
	const byGasId = new Map(), factMap = new Map(), noOutWindows = []
	for (const fact of facts) {
		const id = text(fact.source_id)
		if (!factMap.has(id)) factMap.set(id, [])
		factMap.get(id).push(fact)
	}
	for (const row of gasIns) {
		const id = text(row._id)
		if (!byGasId.has(id)) byGasId.set(id, { row, duplicate: false })
		else byGasId.get(id).duplicate = true
	}
	const allBatches = []
	for (const { row, duplicate } of byGasId.values()) {
		const { fact, conflict } = matchedFact(row, factMap.get(text(row._id)) || [])
		const batch = buildBatch(row, fact, conflict, duplicate)
		if (cutoffDay && batch.day > cutoffDay) continue
		if (cutoffDay && batch.boundary.precision === 'field_window' && batch._end > startOfDay(cutoffDay) + DAY_MS) {
			batch.transfer_in_progress = true
			issue(batch, 'transfer_in_progress')
			batch.weight.confirmed_weigh_in_kg = null
			batch.weight.adopted_station_in_kg = null
			batch.weight.adopted_basis = 'transfer_in_progress'
		}
		allBatches.push(batch)
		const ns = timestamp(fact?.no_out_start), ne = timestamp(fact?.no_out_end)
		if (ns != null && ne != null && ne > ns && ['confirmed', 'assumed'].includes(fact?.no_out_basis)) noOutWindows.push({ start: ns, end: ne, basis: fact.no_out_basis, batch_id: batch.id })
	}
	allBatches.sort((a, b) => (a._start ?? Infinity) - (b._start ?? Infinity) || a.id.localeCompare(b.id))
	const unknownChronology = allBatches.some(batch => batch._start == null)
	const groups = []
	for (const batch of allBatches.filter(row => row._start != null)) {
		const last = groups[groups.length - 1]
		if (last && batch._start < last.end) { last.end = Math.max(last.end, batch._end); last.batches.push(batch) }
		else groups.push({ start: batch._start, end: batch._end, batches: [batch] })
	}
	for (let index = 0; index < groups.length; index++) {
		const group = groups[index], next = groups[index + 1]
		for (const batch of group.batches) {
			if (group.batches.length > 1) issue(batch, 'overlapping_transfer_windows')
			const end = next?.start ?? (cutoffDay ? startOfDay(cutoffDay) + DAY_MS : null)
			batch.work_period = { start_ms: group.batches.length === 1 && (end == null || group.end < end) ? group.end : null, end_ms: end, end_basis: next ? 'next_transfer_earliest' : 'observation_cutoff', note: '完整落入此范围才确定归属；边界时段另列待分配' }
		}
	}
	const finalGroup = groups[groups.length - 1]
	if (finalGroup) for (const batch of finalGroup.batches) { batch.open_period = true; issue(batch, 'open_period') }
	const batchById = new Map(allBatches.map(batch => [batch.id, batch]))
	const fillById = new Map(), assignmentById = new Map(), unassigned = []
	for (const source of fillings) {
		const effectiveDay = day(source.filling_time || source.date)
		if (cutoffDay && effectiveDay > cutoffDay) continue
		const sourceId = text(source._id)
		if (sourceId && fillById.has(sourceId)) { issue(fillById.get(sourceId), 'duplicate_filling_source'); continue }
		const row = { id: sourceId || `missing:${fillById.size}`, source_id: sourceId || null, day: effectiveDay,
			date: text(source.filling_time || source.date), bottle_no: text(source.bottle_no), kind: fillingKind(source),
			fill_kg: kg(source.fill_weight), weight_start: number(source.weight_start), weight_end: number(source.weight_end),
			issues: [...issueCodes(source.source_issues)], candidate_batch_ids: [], assigned_batch_id: null, assignment_basis: 'pending', period_before_first: false }
		if (!sourceId) issue(row, 'missing_filling_id')
		if (row.fill_kg == null) issue(row, 'missing_filling_weight')
		if (row.kind === 'other') issue(row, 'unknown_record_type')
		if (day(source.date) && effectiveDay && day(source.date) !== effectiveDay) issue(row, 'filling_date_mismatch')
		if (row.weight_start != null && row.weight_end != null && (row.weight_start < 0 || row.weight_end < row.weight_start || (row.fill_kg != null && Math.abs(row.weight_end - row.weight_start - row.fill_kg) > 0.001))) issue(row, 'filling_weight_mismatch')
		const window = fillingWindow(source)
		row.time_precision = window?.precision || 'unknown'
		let segments = window ? [{ start: window.start, end: window.end }] : []
		if (!window) issue(row, 'missing_business_day')
		let assumptionApplied = false
		for (const excluded of noOutWindows) {
			const overlaps = segments.some(segment => excluded.start < segment.end && excluded.end > segment.start)
			if (!overlaps) continue
			if (excluded.basis === 'assumed') assumptionApplied = true
			segments = subtractWindow(segments, excluded.start, excluded.end)
		}
		if (window && !segments.length) issue(row, 'no_out_fact_conflict')
		if (assumptionApplied) issue(row, 'assumed_no_out')
		row.possible_time_windows = segments.map(segment => ({ start_ms: segment.start, end_ms: segment.end }))
		const candidates = new Set()
		let determined = null, entirelyDefinite = Boolean(segments.length)
		for (const segment of segments) {
			let segmentDefinite = null
			for (let index = 0; index < groups.length; index++) {
				const group = groups[index], next = groups[index + 1]
				if (segment.end > group.start && segment.start < (next?.end ?? Infinity)) for (const batch of group.batches) candidates.add(batch.id)
				if (group.batches.length === 1 && segment.start >= group.end && segment.end <= (next?.start ?? Infinity)) segmentDefinite = group.batches[0].id
			}
			if (!groups.length || segment.start < groups[0].end) row.period_before_first = true
			if (!segmentDefinite || (determined && determined !== segmentDefinite)) entirelyDefinite = false
			if (segmentDefinite) determined = segmentDefinite
		}
		if (unknownChronology) { entirelyDefinite = false; issue(row, 'unknown_chronology'); for (const batch of allBatches.filter(item => item._start == null)) candidates.add(batch.id) }
		row.candidate_batch_ids = [...candidates]
		if (row.issues.includes('filling_date_mismatch')) entirelyDefinite = false
		if (entirelyDefinite && determined) {
			row.assigned_batch_id = determined; row.assignment_basis = assumptionApplied ? 'assumed_no_out' : 'bounded_time_window'
			row.candidate_batch_ids = [determined]
		} else {
			if (row.period_before_first) issue(row, 'before_first_batch')
			if (candidates.size > 1) issue(row, 'multiple_candidate_batches')
			if (segments.some(segment => groups.some(group => segment.start < group.end && segment.end > group.start))) issue(row, 'transfer_overlap')
		}
		fillById.set(row.id, row)
	}
	// Resolve duplicate source IDs before populating totals, so a duplicated source never counts twice.
	for (const row of fillById.values()) {
		if (row.issues.includes('duplicate_filling_source')) { row.assigned_batch_id = null; row.assignment_basis = 'pending' }
		labels(row)
		assignmentById.set(row.id, row)
		if (row.assigned_batch_id) batchById.get(row.assigned_batch_id).filling_rows.push(row)
		else unassigned.push(row)
	}
	const uniqueCycles = new Map(), fillMembership = new Map(), outMembership = new Map()
	for (const cycle of cycles) {
		if (cutoffDay && cycle.first_fill_day > cutoffDay) continue
		const id = text(cycle.id) || `cycle:${uniqueCycles.size}`
		if (uniqueCycles.has(id)) { issue(uniqueCycles.get(id), 'duplicate_cycle'); continue }
		const item = { ...cycle, id, issues: [...issueCodes(cycle.issues)], source_fill_ids: [...new Set((cycle.source_fill_ids || []).map(text).filter(Boolean))] }
		uniqueCycles.set(id, item)
		for (const fillId of item.source_fill_ids) { if (!fillMembership.has(fillId)) fillMembership.set(fillId, []); fillMembership.get(fillId).push(id) }
		if (item.source_out_id) { const outId = outKey(item); if (!outMembership.has(outId)) outMembership.set(outId, []); outMembership.get(outId).push(id) }
	}
	const sharedCycles = [], sharedOuts = new Map()
	for (const cycle of uniqueCycles.values()) {
		const fillRows = cycle.source_fill_ids.map(id => assignmentById.get(id))
		const assigned = [...new Set(fillRows.map(row => row?.assigned_batch_id).filter(Boolean))]
		const candidates = [...new Set(fillRows.flatMap(row => row?.candidate_batch_ids || []))]
		if (!fillRows.length || fillRows.some(row => !row || row.kind !== 'normal_fill')) issue(cycle, 'missing_cycle_filling')
		if (cycle.source_fill_ids.some(id => (fillMembership.get(id) || []).length > 1)) issue(cycle, 'duplicate_cycle_filling')
		if ((outMembership.get(outKey(cycle)) || []).length > 1) issue(cycle, 'duplicate_out_source')
		const uniquelyAssigned = fillRows.length && assigned.length === 1 && fillRows.every(row => row && row.kind === 'normal_fill' && row.assigned_batch_id === assigned[0]) && !['duplicate_cycle_filling', 'duplicate_out_source', 'duplicate_cycle'].some(code => cycle.issues.includes(code))
		const outInScope = !cutoffDay || !cycle.out_day || cycle.out_day <= cutoffDay
		const hasOut = Boolean(cycle.source_out_id || cycle.out_day || cycle.out_net_kg != null) && outInScope
		const inheritedLabels = Object.fromEntries(issueCodes(cycle.issues).map((code, index) => [code, cycle.issue_labels?.[index] || code]))
		const normalized = { id: cycle.id, bottle_no: text(cycle.bottle_no), source_fill_ids: cycle.source_fill_ids,
			source_out_id: hasOut ? text(cycle.source_out_id) || null : null, first_fill_day: cycle.first_fill_day, out_day: hasOut ? cycle.out_day || null : null,
			original_status: cycle.status, status: cycle.status, out_net_kg: hasOut ? kg(cycle.out_net_kg) : null,
			last_net_kg: kg(cycle.last_net_kg), total_fill_kg: aggregate(fillRows.map(row => row?.fill_kg)).kg,
			candidate_batch_ids: candidates, assigned_batch_id: uniquelyAssigned ? assigned[0] : null,
			issues: [...cycle.issues] }
		if (!outInScope) normalized.status = cycle.status === 'closed' ? 'unsold' : 'pending'
		if (fillRows.some(row => row && row.issues.length)) normalized.status = 'pending'
		if (fillRows.some(row => row?.assignment_basis === 'assumed_no_out')) { issue(normalized, 'assumed_no_out'); normalized.status = 'pending' }
		if (hasOut && normalized.out_net_kg == null) { issue(normalized, 'missing_out_weight'); normalized.status = 'pending' }
		if (normalized.status === 'pending') issue(normalized, 'pending_cycle')
		const cycleLabels = row => { labels(row); row.issue_labels = row.issues.map((code, index) => ISSUE_LABELS[code] || inheritedLabels[code] || row.issue_labels[index]); return row }
		if (uniquelyAssigned) batchById.get(assigned[0]).cycles.push(cycleLabels(normalized))
		else {
			normalized.status = 'shared'; issue(normalized, 'shared_batch_cycle')
			const outId = outKey(normalized)
			if (outId && sharedOuts.has(outId)) {
				const existing = sharedOuts.get(outId)
				existing.related_cycle_ids.push(normalized.id)
				existing.candidate_batch_ids = [...new Set([...existing.candidate_batch_ids, ...normalized.candidate_batch_ids])]
				existing.source_fill_ids = [...new Set([...existing.source_fill_ids, ...normalized.source_fill_ids])]
				existing.total_fill_kg = aggregate(existing.source_fill_ids.map(id => assignmentById.get(id)?.fill_kg)).kg
				if (existing.out_net_kg !== normalized.out_net_kg) existing.out_net_kg = null
				continue
			}
			normalized.related_cycle_ids = [normalized.id]
			sharedCycles.push(cycleLabels(normalized)); if (outId) sharedOuts.set(outId, normalized)
		}
	}
	for (const batch of allBatches) {
		batch.filling = {}
		for (const kind of ['normal_fill', 'truck_refill', 'agent_out', 'self_use', 'other']) batch.filling[kind] = aggregate(batch.filling_rows.filter(row => row.kind === kind).map(row => row.fill_kg))
		batch.filling.total = aggregate(batch.filling_rows.map(row => row.fill_kg))
		batch.filling.assumed_count = batch.filling_rows.filter(row => row.assignment_basis === 'assumed_no_out').length
		if (batch.filling.assumed_count) issue(batch, 'assumed_no_out')
		batch.sales = {}
		for (const status of ['closed', 'unsold', 'pending']) {
			const items = batch.cycles.filter(row => row.status === status)
			batch.sales[status] = { ...aggregate(items.map(row => status === 'unsold' ? row.last_net_kg : row.out_net_kg)), cycle_count: items.length,
				fill_kg: aggregate(items.map(row => row.total_fill_kg)).kg }
		}
		batch.unassigned_candidate_count = unassigned.filter(row => row.candidate_batch_ids.includes(batch.id)).length
		batch.shared_cycle_count = sharedCycles.filter(row => row.candidate_batch_ids.includes(batch.id)).length
		batch.arithmetic_balance_kg = difference(batch.weight.adopted_station_in_kg, batch.filling.total.kg)
		batch.arithmetic_balance_note = '仅减已分配账面出罐；未扣待分配及余液变化，非损耗'
		labels(batch); delete batch._start; delete batch._end
	}
	const batches = allBatches.filter(batch => inRange(batch.day, dateStart, dateEnd))
	const selectedIds = new Set(batches.map(batch => batch.id))
	const selectedUnassigned = unassigned.filter(row => row.candidate_batch_ids.some(id => selectedIds.has(id)) || (!row.candidate_batch_ids.length && inRange(row.day, dateStart, cutoffDay || dateEnd)))
	const selectedShared = sharedCycles.filter(row => row.candidate_batch_ids.some(id => selectedIds.has(id)) || (!row.candidate_batch_ids.length && inRange(row.first_fill_day, dateStart, cutoffDay || dateEnd)))
	const summary = { batch_count: batches.length, adopted_station_in: aggregate(batches.map(batch => batch.weight.adopted_station_in_kg)),
		confirmed_weigh_in: aggregate(batches.map(batch => batch.weight.confirmed_weigh_in_kg)), direct_sale: aggregate(batches.map(batch => batch.weight.direct_sale_kg)),
		filling: {}, sales: {}, unassigned_fillings: aggregate(selectedUnassigned.map(row => row.fill_kg)), shared_out: aggregate(selectedShared.filter(row => row.source_out_id || row.out_day).map(row => row.out_net_kg)) }
	for (const kind of ['normal_fill', 'truck_refill', 'agent_out', 'self_use', 'other', 'total']) summary.filling[kind] = aggregate(batches.flatMap(batch => batch.filling_rows.filter(row => kind === 'total' || row.kind === kind).map(row => row.fill_kg)))
	for (const status of ['closed', 'unsold', 'pending']) summary.sales[status] = aggregate(batches.flatMap(batch => batch.cycles.filter(row => row.status === status).map(row => status === 'unsold' ? row.last_net_kg : row.out_net_kg)))
	// Detail rows contain source links and quantities only; do not duplicate full source evidence in the response.
	for (const batch of batches) batch.filling_rows = batch.filling_rows.map(row => ({ source_id: row.source_id, date: row.date, bottle_no: row.bottle_no, kind: row.kind, fill_kg: row.fill_kg, issue_labels: row.issue_labels, assignment_basis: row.assignment_basis }))
	for (const row of selectedUnassigned) { delete row.possible_time_windows; delete row.weight_start; delete row.weight_end }
	return { batches, unassigned_fillings: selectedUnassigned, shared_cycles: selectedShared, summary,
		scope: { rule_version: RULE_VERSION, date_start: dateStart, date_end: dateEnd, cutoff_day: cutoffDay,
			attribution: 'truck_working_period', cost_allocation: false, read_batch_count: allBatches.length,
			unassigned_global_count: unassigned.length, shared_cycle_global_count: sharedCycles.length,
			unknown_date_batch_count: allBatches.filter(batch => !batch.day).length,
			selected_period_only: true, quantity_note: '出瓶净气包含原瓶余气，不与新增灌入直接相减认定损耗；随车直销单列，不计为站内灌入。' } }
}

module.exports = { buildTruckQuantityClosure, RULE_VERSION }
