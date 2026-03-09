'use strict'

const db = uniCloud.database()

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const movements = db.collection('crm_bottle_movements')
const anomalies = db.collection('crm_bottle_anomalies')

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data && res.data[0]) || null
}

async function recordLog(user, action, detail = {}, requestId = '') {
	try {
		await logs.add({
			user_id: user?._id || null,
			username: user?.username || '',
			role: user?.role || '',
			action,
			detail,
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-bottle-movement] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toTimestamp(value, fallback = Date.now()) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
	if (typeof value === 'string' && value.trim()) {
		const asNum = Number(value)
		if (Number.isFinite(asNum) && asNum > 0) return asNum
		const asDate = Date.parse(value)
		if (Number.isFinite(asDate) && asDate > 0) return asDate
	}
	return fallback
}

function pad2(value) {
	return String(value).padStart(2, '0')
}

function formatDayByTs(ts) {
	const d = new Date(ts)
	const y = d.getFullYear()
	const m = pad2(d.getMonth() + 1)
	const day = pad2(d.getDate())
	return `${y}-${m}-${day}`
}

function normalizeEventDay(dateText, fallbackTs) {
	const text = normalizeString(dateText)
	const m = text.match(/^(\d{4}-\d{2}-\d{2})/)
	if (m) return m[1]
	return formatDayByTs(toTimestamp(fallbackTs, Date.now()))
}

function parseEventAt(dateText, fallbackTs) {
	const text = normalizeString(dateText)
	const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
	if (m) {
		const y = m[1]
		const mon = m[2]
		const d = m[3]
		const hh = pad2(m[4] || '00')
		const mm = pad2(m[5] || '00')
		const ss = pad2(m[6] || '00')
		const ts = Date.parse(`${y}-${mon}-${d}T${hh}:${mm}:${ss}+08:00`)
		if (Number.isFinite(ts) && ts > 0) return ts
	}
	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return parsed
	return toTimestamp(fallbackTs, Date.now())
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeType(value) {
	const t = normalizeString(value)
	if (t === 'back' || t === 'fill' || t === 'out' || t === 'adjust') return t
	return ''
}

function movementTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	if (type === 'adjust') return 40
	return 99
}

function normalizeSourceType(value) {
	const s = normalizeString(value)
	if (s === 'sale' || s === 'filling' || s === 'manual_fix' || s === 'manual') return s
	return ''
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function buildMovementWhere(data, options = {}) {
	const bottleNo = normalizeString(data && data.bottle_no)
	const type = normalizeType(data && data.type)
	const sourceType = normalizeSourceType(data && data.source_type)
	const dateStart = normalizeString(data && data.dateStart)
	const dateEnd = normalizeString(data && data.dateEnd)
	const where = {}
	if (bottleNo) where.bottle_no = normalizeBottleNo(bottleNo)
	if (!options.ignoreType && type) where.type = type
	if (sourceType) where.source_type = sourceType
	if (dateStart && dateEnd) {
		where.event_day = db.command.and(db.command.gte(dateStart), db.command.lte(dateEnd))
	} else if (dateStart) {
		where.event_day = db.command.gte(dateStart)
	} else if (dateEnd) {
		where.event_day = db.command.lte(dateEnd)
	}
	return where
}

function normalizeDay(value) {
	const text = normalizeString(value)
	const m = text.match(/^(\d{4}-\d{2}-\d{2})/)
	return m ? m[1] : ''
}

function normalizeAnomalyStatus(value) {
	const status = normalizeString(value).toLowerCase()
	return status === 'resolved' ? 'resolved' : 'open'
}

function anomalyStatusPriority(status) {
	return normalizeAnomalyStatus(status) === 'open' ? 2 : 1
}

function anomalyIdentity(row) {
	const fingerprint = normalizeString(row && row.fingerprint)
	if (fingerprint) return `fp:${fingerprint}`
	const id = normalizeString(row && row._id)
	if (id) return `id:${id}`
	const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
	const type = normalizeString(row && row.anomaly_type)
	const day = normalizeDay(
		ctx.legacy_date || ctx.next_out?.date || ctx.last_back?.date || ctx.last_out?.date || ctx.next_fill?.date || row?.date
	)
	const note = normalizeString(row && row.note)
	return `fallback:${type}|${day}|${note}`
}

function selectPreferredAnomaly(a, b) {
	const aPriority = anomalyStatusPriority(a && a.status)
	const bPriority = anomalyStatusPriority(b && b.status)
	if (aPriority !== bPriority) return bPriority > aPriority ? b : a

	const aUpdated = toTimestamp(a && a.updated_at, toTimestamp(a && a.created_at, 0))
	const bUpdated = toTimestamp(b && b.updated_at, toTimestamp(b && b.created_at, 0))
	if (aUpdated !== bUpdated) return bUpdated > aUpdated ? b : a

	const aCreated = toTimestamp(a && a.created_at, 0)
	const bCreated = toTimestamp(b && b.created_at, 0)
	return bCreated >= aCreated ? b : a
}

function dedupeTimelineAnomalies(rows) {
	const uniq = new Map()
	for (const row of rows || []) {
		const key = anomalyIdentity(row)
		if (!uniq.has(key)) {
			uniq.set(key, row)
			continue
		}
		uniq.set(key, selectPreferredAnomaly(uniq.get(key), row))
	}
	return Array.from(uniq.values()).sort((a, b) => {
		const aPriority = anomalyStatusPriority(a && a.status)
		const bPriority = anomalyStatusPriority(b && b.status)
		if (aPriority !== bPriority) return bPriority - aPriority
		const aUpdated = toTimestamp(a && a.updated_at, toTimestamp(a && a.created_at, 0))
		const bUpdated = toTimestamp(b && b.updated_at, toTimestamp(b && b.created_at, 0))
		if (aUpdated !== bUpdated) return bUpdated - aUpdated
		return toTimestamp(b && b.created_at, 0) - toTimestamp(a && a.created_at, 0)
	})
}

function round2(value) {
	const num = Number(value || 0)
	return Math.round(num * 100) / 100
}

function isMissingFillLossRow(row) {
	if (normalizeType(row && row.type) !== 'adjust') return false
	if (normalizeSourceType(row && row.source_type) !== 'manual_fix') return false
	const loss = toNumber(row && row.loss_weight, null)
	if (loss == null || loss <= 0) return false
	const adjustReason = normalizeString(row && row.adjust_reason).toLowerCase()
	if (adjustReason === 'missing_fill_loss' || adjustReason === 'missing_fill_loss_accept') return true
	const note = normalizeString(row && row.note)
	return /缺灌装.*损耗|损耗.*缺灌装/.test(note)
}

function buildLossWhere(data) {
	const where = {
		type: 'adjust',
		source_type: 'manual_fix',
		loss_weight: db.command.gt(0)
	}
	const bottleNo = normalizeBottleNo(data && (data.bottle_no || data.bottleNo))
	const dateStart = normalizeString(data && data.dateStart)
	const dateEnd = normalizeString(data && data.dateEnd)
	if (bottleNo) where.bottle_no = bottleNo
	if (dateStart && dateEnd) {
		where.event_day = db.command.and(db.command.gte(dateStart), db.command.lte(dateEnd))
	} else if (dateStart) {
		where.event_day = db.command.gte(dateStart)
	} else if (dateEnd) {
		where.event_day = db.command.lte(dateEnd)
	}
	return where
}

async function fetchAllLossRows(where) {
	const pageSize = 200
	let page = 0
	let rows = []
	while (true) {
		const res = await movements
			.where(where)
			.orderBy('event_day', 'desc')
			.orderBy('event_at', 'desc')
			.orderBy('created_at', 'desc')
			.skip(page * pageSize)
			.limit(pageSize)
			.get()
		const current = res.data || []
		rows = rows.concat(current)
		if (current.length < pageSize) break
		page += 1
		if (page > 200) break
	}
	return rows
}

async function fetchAllBottleMovementRows(bottleNo) {
	const pageSize = 300
	let page = 0
	let rows = []
	while (true) {
		const res = await movements
			.where({ bottle_no: bottleNo })
			.orderBy('event_at', 'asc')
			.orderBy('type_order', 'asc')
			.orderBy('created_at', 'asc')
			.skip(page * pageSize)
			.limit(pageSize)
			.get()
		const current = res.data || []
		rows = rows.concat(current)
		if (current.length < pageSize) break
		page += 1
		if (page > 400) break
	}
	return rows
}

function isDayInRange(day, dateStart, dateEnd) {
	const normalizedDay = normalizeDay(day)
	if (!normalizedDay) return !dateStart && !dateEnd
	if (dateStart && normalizedDay < dateStart) return false
	if (dateEnd && normalizedDay > dateEnd) return false
	return true
}

function buildIncompletePreviewRow(reason, row, detail) {
	return {
		reason: normalizeString(reason),
		event_day: normalizeDay(row && row.event_day) || normalizeDay(row && row.date) || '',
		event_date: normalizeString(row && row.date),
		source_id: normalizeString(row && row.source_id) || null,
		detail: normalizeString(detail)
	}
}

function buildTimelineMarkers(anomalyRows) {
	const markers = []
	const push = (eventDay, type, anomaly) => {
		const day = normalizeDay(eventDay)
		if (!day) return
		markers.push({
			anomaly_id: normalizeString(anomaly && anomaly._id),
			event_day: day,
			type: normalizeType(type),
			anomaly_type: normalizeString(anomaly && anomaly.anomaly_type),
			status: normalizeAnomalyStatus(anomaly && anomaly.status),
			note: normalizeString(anomaly && anomaly.note)
		})
	}
	for (const row of anomalyRows) {
		const ctx = row && typeof row.context === 'object' && !Array.isArray(row.context) ? row.context : {}
		let markerCount = 0
		if (ctx.last_out && typeof ctx.last_out === 'object') {
			push(ctx.last_out.date, 'out', row)
			markerCount += 1
		}
		if (ctx.next_fill && typeof ctx.next_fill === 'object') {
			push(ctx.next_fill.date, 'fill', row)
			markerCount += 1
		}
		if (ctx.last_back && typeof ctx.last_back === 'object') {
			push(ctx.last_back.date, 'back', row)
			markerCount += 1
		}
		if (ctx.next_out && typeof ctx.next_out === 'object') {
			push(ctx.next_out.date, 'out', row)
			markerCount += 1
		}
		const legacyDate = normalizeDay(ctx.legacy_date)
		if (!markerCount && legacyDate) {
			push(legacyDate, '', row)
			markerCount += 1
		}
		if (!markerCount) {
			const hits = normalizeString(row && row.note).match(/\d{4}-\d{2}-\d{2}/g) || []
			if (hits.length > 0) {
				push(hits[0], '', row)
				if (hits[1]) push(hits[1], '', row)
			}
		}
	}
	const uniq = new Map()
	for (const marker of markers) {
		const key = `${marker.anomaly_id}|${marker.event_day}|${marker.type}`
		if (!uniq.has(key)) uniq.set(key, marker)
	}
	return Array.from(uniq.values())
}

function buildTimelineState(events, anomalyRows) {
	const openAnomalies = anomalyRows.filter((row) => normalizeAnomalyStatus(row && row.status) === 'open').length
	if (openAnomalies > 0) {
		return { code: 'anomaly_open', label: '异常待处理', kind: 'danger' }
	}
	if (!events.length) {
		return { code: 'empty', label: '暂无流转', kind: 'soft' }
	}
	const last = events[events.length - 1] || {}
	if (last.type === 'out') return { code: 'waiting_back', label: '待回瓶', kind: 'warning' }
	if (last.type === 'back') return { code: 'waiting_fill', label: '待灌装', kind: 'warning' }
	if (last.type === 'fill') return { code: 'ready_out', label: '可出瓶', kind: 'success' }
	if (last.type === 'adjust') return { code: 'adjusted', label: '调整后待确认', kind: 'info' }
	return { code: 'unknown', label: '状态待确认', kind: 'info' }
}

function buildTimelineStats(events, anomalyRows) {
	const stats = {
		total: events.length,
		out: 0,
		back: 0,
		fill: 0,
		adjust: 0,
		open_anomalies: 0,
		resolved_anomalies: 0,
		cycle_estimated: 0
	}
	for (const row of events) {
		const type = normalizeType(row && row.type)
		if (type === 'out') stats.out += 1
		if (type === 'back') stats.back += 1
		if (type === 'fill') stats.fill += 1
		if (type === 'adjust') stats.adjust += 1
	}
	for (const row of anomalyRows) {
		if (normalizeAnomalyStatus(row && row.status) === 'resolved') stats.resolved_anomalies += 1
		else stats.open_anomalies += 1
	}
	stats.cycle_estimated = Math.min(stats.out, stats.back, stats.fill)
	return stats
}

async function listV1(user, data, requestId) {
	void user
	const bottleNo = normalizeString(data.bottle_no)
	const type = normalizeType(data.type)
	const sourceType = normalizeSourceType(data.source_type)
	const dateStart = normalizeString(data.dateStart)
	const dateEnd = normalizeString(data.dateEnd)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || data.limit || 50) || 50, 1), 200)

	const where = buildMovementWhere(data)
	const summaryWhere = buildMovementWhere(data, { ignoreType: true })

	const res = await movements
		.where(where)
		.orderBy('event_at', 'asc')
		.orderBy('type_order', 'asc')
		.orderBy('created_at', 'asc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()
	const [totalRes, outRes, backRes, fillRes, adjustRes] = await Promise.all([
		movements.where(where).count(),
		movements.where({ ...summaryWhere, type: 'out' }).count(),
		movements.where({ ...summaryWhere, type: 'back' }).count(),
		movements.where({ ...summaryWhere, type: 'fill' }).count(),
		movements.where({ ...summaryWhere, type: 'adjust' }).count()
	])

	await recordLog(
		user,
		'bottle_movement_list_v1',
		{ bottle_no: bottleNo, type: type || '', source_type: sourceType || '', date_start: dateStart, date_end: dateEnd },
		requestId
	)
	return {
		code: 0,
		data: res.data || [],
		total: totalRes.total || 0,
		page,
		pageSize,
		summary: {
			total: (outRes.total || 0) + (backRes.total || 0) + (fillRes.total || 0) + (adjustRes.total || 0),
			out: outRes.total || 0,
			back: backRes.total || 0,
			fill: fillRes.total || 0,
			adjust: adjustRes.total || 0
		}
	}
}

async function getV1(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const res = await movements.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '记录不存在' }
	return { code: 0, data: doc }
}

async function timelineV1(user, data, requestId) {
	void user
	const bottleNo = normalizeBottleNo(data.bottle_no || data.bottleNo)
	if (!bottleNo) return { code: 400, msg: '瓶号必填' }
	const limit = Math.min(Math.max(Number(data.limit || 1000) || 1000, 1), 3000)

	const [eventRes, anomalyRes] = await Promise.all([
		movements
			.where({ bottle_no: bottleNo })
			.orderBy('event_at', 'asc')
			.orderBy('type_order', 'asc')
			.orderBy('created_at', 'asc')
			.limit(limit)
			.get(),
		anomalies
			.where({ bottle_no: bottleNo })
			.orderBy('created_at', 'desc')
			.limit(200)
			.get()
	])

	const events = eventRes.data || []
	const anomalyRows = dedupeTimelineAnomalies(anomalyRes.data || [])
	const markers = buildTimelineMarkers(anomalyRows)
	const state = buildTimelineState(events, anomalyRows)
	const stats = buildTimelineStats(events, anomalyRows)

	await recordLog(user, 'bottle_movement_timeline_v1', { bottle_no: bottleNo, event_count: events.length }, requestId)
	return {
		code: 0,
		data: {
			bottle_no: bottleNo,
			events,
			anomalies: anomalyRows,
			markers,
			state,
			stats
		}
	}
}

async function lossStatsV1(user, data, requestId) {
	void user
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || data.limit || 50) || 50, 1), 200)
	const where = buildLossWhere(data)
	const allRows = await fetchAllLossRows(where)
	const filtered = allRows.filter((row) => isMissingFillLossRow(row))

	filtered.sort((a, b) => {
		const aAt = toTimestamp(a && a.event_at, toTimestamp(a && a.created_at, 0))
		const bAt = toTimestamp(b && b.event_at, toTimestamp(b && b.created_at, 0))
		if (aAt !== bAt) return bAt - aAt
		return toTimestamp(b && b.created_at, 0) - toTimestamp(a && a.created_at, 0)
	})

	const dailyMap = new Map()
	const bottleSet = new Set()
	let totalLoss = 0
	for (const row of filtered) {
		const day = normalizeDay(row && row.event_day) || normalizeDay(row && row.date) || '-'
		const bottleNo = normalizeBottleNo(row && row.bottle_no)
		if (bottleNo) bottleSet.add(bottleNo)
		const loss = toNumber(row && row.loss_weight, 0) || 0
		totalLoss += loss
		if (!dailyMap.has(day)) {
			dailyMap.set(day, { event_day: day, loss_kg: 0, count: 0 })
		}
		const target = dailyMap.get(day)
		target.loss_kg += loss
		target.count += 1
	}

	const daily = Array.from(dailyMap.values())
		.map((item) => ({
			event_day: item.event_day,
			loss_kg: round2(item.loss_kg),
			count: item.count
		}))
		.sort((a, b) => b.event_day.localeCompare(a.event_day))

	const total = filtered.length
	const start = (page - 1) * pageSize
	const list = filtered.slice(start, start + pageSize).map((row) => ({
		_id: normalizeString(row && row._id),
		bottle_no: normalizeBottleNo(row && row.bottle_no),
		event_day: normalizeDay(row && row.event_day) || normalizeDay(row && row.date) || '',
		loss_weight: toNumber(row && row.loss_weight, null),
		note: normalizeString(row && row.note),
		adjust_reason: normalizeString(row && row.adjust_reason),
		created_at: toTimestamp(row && row.created_at, 0),
		event_at: toTimestamp(row && row.event_at, 0)
	}))

	await recordLog(
		user,
		'bottle_movement_loss_stats_v1',
		{
			bottle_no: normalizeBottleNo(data && (data.bottle_no || data.bottleNo)),
			date_start: normalizeString(data && data.dateStart),
			date_end: normalizeString(data && data.dateEnd),
			total
		},
		requestId
	)

	return {
		code: 0,
		data: {
			summary: {
				total_loss_kg: round2(totalLoss),
				record_count: total,
				bottle_count: bottleSet.size,
				daily
			},
			list,
			page,
			pageSize,
			total
		}
	}
}

async function cycleLossV1(user, data, requestId) {
	void user
	const bottleNo = normalizeBottleNo(data.bottle_no || data.bottleNo)
	if (!bottleNo) return { code: 400, msg: '瓶号必填' }

	const dateStart = normalizeDay(data.dateStart)
	const dateEnd = normalizeDay(data.dateEnd)
	const page = Math.max(Number(data.page || 1) || 1, 1)
	const pageSize = Math.min(Math.max(Number(data.pageSize || data.limit || 50) || 50, 1), 200)

	const allRows = await fetchAllBottleMovementRows(bottleNo)
	const events = allRows.filter((row) => {
		const type = normalizeType(row && row.type)
		return type === 'back' || type === 'fill' || type === 'out'
	})

	let activeCycle = null
	const cycleRows = []
	const incompleteRows = []

	for (const row of events) {
		const type = normalizeType(row && row.type)
		if (type === 'back') {
			if (activeCycle && activeCycle.back) {
				incompleteRows.push(
					buildIncompletePreviewRow('back_without_out', activeCycle.back, '回瓶后未找到对应出瓶（遇到新的回瓶）')
				)
			}
			activeCycle = {
				back: row,
				fillSum: 0,
				fillCount: 0,
				fillSourceIds: []
			}
			continue
		}

		if (type === 'fill') {
			if (!activeCycle) continue
			const fillWeight = toNumber(row && row.net_weight, 0) || 0
			activeCycle.fillSum += fillWeight
			activeCycle.fillCount += 1
			const fillSourceId = normalizeString(row && row.source_id)
			if (fillSourceId) activeCycle.fillSourceIds.push(fillSourceId)
			continue
		}

		if (type === 'out') {
			if (!activeCycle || !activeCycle.back) {
				incompleteRows.push(buildIncompletePreviewRow('out_without_back', row, '出瓶前未找到可配对回瓶'))
				continue
			}

			const backRow = activeCycle.back
			const backNet = toNumber(backRow && backRow.net_weight, 0) || 0
			const fillSum = round2(activeCycle.fillSum)
			const outNet = toNumber(row && row.net_weight, 0) || 0
			const theoreticalOut = round2(backNet + fillSum)
			const delta = round2(theoreticalOut - outNet)
			const resultType = delta > 0 ? 'loss' : delta < 0 ? 'swell' : 'exact'

			cycleRows.push({
				bottle_no: bottleNo,
				back_date: normalizeString(backRow && backRow.date),
				back_day: normalizeDay(backRow && backRow.event_day) || normalizeDay(backRow && backRow.date),
				back_net_kg: round2(backNet),
				fill_count: activeCycle.fillCount,
				fill_sum_kg: fillSum,
				out_date: normalizeString(row && row.date),
				out_day: normalizeDay(row && row.event_day) || normalizeDay(row && row.date),
				out_net_kg: round2(outNet),
				theoretical_out_kg: theoreticalOut,
				delta_kg: delta,
				result_type: resultType,
				source_back_id: normalizeString(backRow && backRow.source_id) || null,
				source_fill_ids: Array.from(new Set(activeCycle.fillSourceIds)),
				source_out_id: normalizeString(row && row.source_id) || null,
				out_event_at: toTimestamp(row && row.event_at, toTimestamp(row && row.created_at, 0)),
				out_created_at: toTimestamp(row && row.created_at, 0)
			})
			activeCycle = null
		}
	}

	if (activeCycle && activeCycle.back) {
		incompleteRows.push(buildIncompletePreviewRow('back_without_out', activeCycle.back, '回瓶后直到查询结束仍未找到对应出瓶'))
	}

	const filteredCycles = cycleRows
		.filter((row) => isDayInRange(row.out_day, dateStart, dateEnd))
		.sort((a, b) => {
			if (a.out_event_at !== b.out_event_at) return b.out_event_at - a.out_event_at
			return b.out_created_at - a.out_created_at
		})

	const filteredIncomplete = incompleteRows.filter((row) => isDayInRange(row.event_day, dateStart, dateEnd))

	let lossCount = 0
	let swellCount = 0
	let exactCount = 0
	let lossTotal = 0
	let swellTotal = 0

	for (const row of filteredCycles) {
		const delta = toNumber(row.delta_kg, 0) || 0
		if (delta > 0) {
			lossCount += 1
			lossTotal += delta
		} else if (delta < 0) {
			swellCount += 1
			swellTotal += Math.abs(delta)
		} else {
			exactCount += 1
		}
	}

	const total = filteredCycles.length
	const start = (page - 1) * pageSize
	const list = filteredCycles.slice(start, start + pageSize).map((row) => ({
		bottle_no: row.bottle_no,
		back_date: row.back_date,
		back_net_kg: row.back_net_kg,
		fill_count: row.fill_count,
		fill_sum_kg: row.fill_sum_kg,
		out_date: row.out_date,
		out_net_kg: row.out_net_kg,
		theoretical_out_kg: row.theoretical_out_kg,
		delta_kg: row.delta_kg,
		result_type: row.result_type,
		source_back_id: row.source_back_id,
		source_fill_ids: row.source_fill_ids,
		source_out_id: row.source_out_id
	}))

	await recordLog(
		user,
		'bottle_movement_cycle_loss_v1',
		{
			bottle_no: bottleNo,
			date_start: dateStart || '',
			date_end: dateEnd || '',
			total,
			incomplete_count: filteredIncomplete.length
		},
		requestId
	)

	return {
		code: 0,
		data: {
			summary: {
				cycle_count: total,
				loss_count: lossCount,
				loss_total_kg: round2(lossTotal),
				swell_count: swellCount,
				swell_total_kg: round2(swellTotal),
				exact_count: exactCount,
				incomplete_count: filteredIncomplete.length
			},
			list,
			paging: {
				page,
				pageSize,
				total,
				hasMore: page * pageSize < total
			},
			incomplete_preview: filteredIncomplete.slice(0, 20)
		}
	}
}

async function createV1(user, data, requestId) {
	const bottleNo = normalizeBottleNo(data.bottle_no)
	if (!bottleNo) return { code: 400, msg: '瓶号必填' }
	const type = normalizeType(data.type)
	if (!type) return { code: 400, msg: '事件类型无效' }
	const date = normalizeString(data.date)
	if (!date) return { code: 400, msg: '日期必填' }
	const sourceType = normalizeSourceType(data.source_type)
	if (!sourceType) return { code: 400, msg: '来源类型无效' }
	const now = Date.now()
	const eventDay = normalizeEventDay(date, now)
	const eventAt = parseEventAt(date, now)

	const doc = {
		bottle_no: bottleNo,
		type,
		date,
		event_day: eventDay,
		event_at: eventAt,
		type_order: movementTypeOrder(type),
		source_type: sourceType,
		source_id: normalizeString(data.source_id) || null,
		customer_id: normalizeString(data.customer_id) || null,
		customer_name: normalizeString(data.customer_name),
		net_weight: toNumber(data.net_weight, null),
		loss_weight: toNumber(data.loss_weight, null),
		note: normalizeString(data.note),
		created_at: now,
		created_by: user?._id || null,
		created_by_name: user?.username || ''
	}

	const res = await movements.add(doc)
	await recordLog(user, 'bottle_movement_create_v1', { id: res.id, type, bottle_no: bottleNo }, requestId)
	return { code: 0, msg: '创建成功', data: { _id: res.id } }
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event
	const requestId =
		normalizeString(event.request_id || event.requestId || context?.requestId || context?.request_id || '') ||
		generateRequestId()

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }

	if (action === 'listV1') return listV1(user, data, requestId)
	if (action === 'getV1') return getV1(user, data)
	if (action === 'timelineV1') return timelineV1(user, data, requestId)
	if (action === 'createV1') return createV1(user, data, requestId)
	if (action === 'lossStatsV1') return lossStatsV1(user, data, requestId)
	if (action === 'cycleLossV1') return cycleLossV1(user, data, requestId)

	return { code: 400, msg: '未知 action' }
}
