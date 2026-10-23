'use strict'

const { readComplete, FinancialReadError } = require('./financialReadLocal')
const { resolveRange, VERSION } = require('./operatingBrief')
const { deriveTankEstimate, TANK_ESTIMATE_VERSION } = require('./tankTelemetry')
const { summarizeGasOutflow } = require('./gasOutflow')

const DAY = 86400000
const OFFSET = 8 * 3600000
const MAX_SAMPLE_AGE = 90000
const LOG_PAGE_SIZE = 200
const MAX_BOUNDARY_LOGS = 2000
const dayText = at => new Date(at + OFFSET).toISOString().slice(0, 10)
const dayStart = day => Date.parse(`${day}T00:00:00+08:00`)
const roundKg = value => Math.round(value * 1000) / 1000

function numberOrNull(value) {
	return ['number', 'string'].includes(typeof value) && String(value).trim() !== '' &&
		Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null
}

function countValue(result, source) {
	const count = numberOrNull(result && result.total)
	if (!Number.isSafeInteger(count)) throw new FinancialReadError('count_unavailable', { source })
	return count
}

async function guardedRead(source, fn) {
	try { return await fn() } catch (error) {
		if (error instanceof FinancialReadError || error.code === 'FINANCIAL_READ_INCOMPLETE') throw error
		throw new FinancialReadError('source_read_failed', { source })
	}
}

// Only these two 90-second windows are read. The existing action/created_at index
// supports this ordering; no new action/_id compound index or month-long log scan.
async function readBoundaryLogs(db, boundary, queries) {
	const command = db.command, source = 'crm_operation_logs'
	const where = command.and([{ action: 'tank_gateway_ingest' },
		{ created_at: command.gte(boundary - MAX_SAMPLE_AGE) }, { created_at: command.lte(boundary) }])
	return guardedRead(source, async () => {
		const collection = db.collection(source)
		const before = countValue(await collection.where(where).count(), source)
		if (before > MAX_BOUNDARY_LOGS) throw new FinancialReadError('row_limit', { source, expected_rows: before, max_rows: MAX_BOUNDARY_LOGS })
		const rows = [], ids = new Set()
		for (let offset = 0; offset < before; offset += LOG_PAGE_SIZE) {
			const result = await collection.where(where).orderBy('created_at', 'desc').skip(offset).limit(LOG_PAGE_SIZE).get()
			if (!Array.isArray(result.data)) throw new FinancialReadError('invalid_page', { source })
			for (const row of result.data) {
				const id = typeof row._id === 'string' ? row._id : ''
				if (!id || ids.has(id)) throw new FinancialReadError('duplicate_or_missing_id', { source })
				if (numberOrNull(row.created_at) == null || row.created_at < boundary - MAX_SAMPLE_AGE || row.created_at > boundary) {
					throw new FinancialReadError('invalid_log_timestamp', { source })
				}
				ids.add(id); rows.push(row)
			}
			if (result.data.length < Math.min(LOG_PAGE_SIZE, before - offset)) throw new FinancialReadError('truncated_page', { source })
		}
		if (rows.length !== before || countValue(await collection.where(where).count(), source) !== before) {
			throw new FinancialReadError('membership_changed', { source })
		}
		queries.push({ name: source, where, count: rows.length })
		return rows
	})
}

function boundaryEstimate(rows, label, issues) {
	const add = (code, message) => { issues.push({ code: `${label}_${code}`, message }); return null }
	// A missing tank identity cannot be silently assigned to the main tank. Other
	// explicitly identified tanks have no bearing on this main-tank calculation.
	if (rows.some(row => !row.detail || typeof row.detail.tank_id !== 'string' || !row.detail.tank_id.trim())) {
		return add('unknown_source', `${label === 'opening' ? '期初' : '期末'}采样缺少储罐归属`)
	}
	const main = rows.filter(row => row.detail.tank_id.trim() === 'main')
	if (!main.length) return add('missing_sample', `${label === 'opening' ? '期初' : '期末'}边界前90秒内没有主罐采样`)
	const gateways = new Set(main.map(row => typeof row.detail.gateway_id === 'string' ? row.detail.gateway_id.trim() : ''))
	if (gateways.has('') || gateways.size !== 1) return add('ambiguous_gateway', `${label === 'opening' ? '期初' : '期末'}主罐采样网关不唯一或缺失`)
	main.sort((a, b) => Number(b.created_at) - Number(a.created_at))
	const latest = main[0]
	const latestRows = main.filter(row => Number(row.created_at) === Number(latest.created_at))
	if (latestRows.some(row => numberOrNull(row.detail.level_kpa) !== numberOrNull(latest.detail.level_kpa))) {
		return add('conflicting_sample', `${label === 'opening' ? '期初' : '期末'}最新同刻液位相互冲突`)
	}
	const level = numberOrNull(latest.detail.level_kpa)
	const estimate = level == null ? null : deriveTankEstimate({ tank_id: 'main', level_kpa: level })
	// An invalid latest sample is evidence of a gap, never a reason to use an older valid one.
	if (!estimate || estimate.estimate_status !== 'valid') return add('invalid_sample', `${label === 'opening' ? '期初' : '期末'}最新液位无效或超出换算范围`)
	return { weight_kg: roundKg(estimate.estimated_weight_t * 1000), observed_at: Number(latest.created_at),
		level_kpa: level, gateway_id: [...gateways][0] }
}

// Date-only historical rows cover a completed natural day. A partial current day
// needs a recorded business time. created_at and operator-ready started_at are not substitutes.
function businessTime(row, kind, range, endAt) {
	const date = typeof row.date === 'string' ? row.date.trim() : ''
	const match = /^(\d{4}-\d{2}-\d{2})(?:-(\d{2})(?:-(\d{2})(?:-(\d{2}))?)?)?$/.exec(date)
	if (!match || !Number.isFinite(dayStart(match[1])) || dayText(dayStart(match[1])) !== match[1]) return { issue: '业务日期无效' }
	const day = match[1]
	let text = kind === 'filling' && row.filling_time != null && String(row.filling_time).trim() !== '' ? row.filling_time : date
	const precise = typeof text === 'string' && /^(\d{4}-\d{2}-\d{2})-(\d{2})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text.trim())
	let at = null
	if (precise) {
		if (precise[1] !== day || Number(precise[2]) > 23 || Number(precise[3] || 0) > 59 || Number(precise[4] || 0) > 59) return { issue: '业务时刻与日期不一致或无效' }
		at = dayStart(day) + (Number(precise[2]) * 3600 + Number(precise[3] || 0) * 60 + Number(precise[4] || 0)) * 1000
	} else if (text !== day) return { issue: '业务时刻格式无效' }
	else if (kind === 'filling' && row.ended_at != null && row.ended_at !== '') {
		const value = numberOrNull(row.ended_at)
		if (value == null || !Number.isSafeInteger(value) || value <= 0 ||
			!Number.isFinite(new Date(value + OFFSET).getTime()) || dayText(value) !== day) return { issue: '登记完成时刻无效或与业务日期不一致' }
		at = value
	}
	if (at == null && day === range.today) return { issue: '当日记录缺少可核对的业务时刻' }
	return { include: at == null || at <= endAt }
}

function stationInboundKg(row) {
	const keys = ['net_weight_t', 'station_weight_t', 'direct_sale_weight_t']
	const values = {}
	for (const key of keys) {
		if (row[key] == null || row[key] === '') { values[key] = null; continue }
		const value = numberOrNull(row[key])
		if (value == null || !Number.isSafeInteger(Math.round(value * 1000000))) return null
		values[key] = value
	}
	let net = values.net_weight_t, station = values.station_weight_t, direct = values.direct_sale_weight_t
	// Legacy gas-in finalization derives net from gross/tare only when no net was saved.
	if (net == null) {
		const gross = numberOrNull(row.gross_weight_t), tare = numberOrNull(row.tare_weight_t)
		if (gross == null || tare == null || gross < tare) return null
		net = Math.round((gross - tare) * 1000) / 1000
	}
	if (station == null && direct == null) { station = net; direct = 0 }
	else if (station == null) station = Math.round((net - direct) * 1000) / 1000
	else if (direct == null) direct = Math.round((net - station) * 1000) / 1000
	if (station < 0 || direct < 0 || Math.abs(Math.round((station + direct - net) * 1000)) > 1) return null
	return roundKg(station * 1000)
}

function sumInbound(rows, range, endAt, issues) {
	let mills = 0, valid = true
	for (const row of rows) {
		const time = businessTime(row, 'inbound', range, endAt)
		if (time.issue) { issues.push({ code: 'inbound_time_unknown', message: `入罐记录 ${row._id}：${time.issue}` }); valid = false; continue }
		if (!time.include) continue
		const weight = stationInboundKg(row)
		if (weight == null || !Number.isSafeInteger(Math.round(weight * 1000))) {
			issues.push({ code: 'inbound_weight_invalid', message: `入罐记录 ${row._id}：重量缺失、无效或入罐分配不守恒` }); valid = false; continue
		}
		mills += Math.round(weight * 1000)
		if (!Number.isSafeInteger(mills)) throw new FinancialReadError('quantity_overflow', { source: 'inbound' })
	}
	return valid ? mills / 1000 : null
}

async function readTankLoss(db, data = {}, now = Date.now()) {
	const range = resolveRange({ section: 'tank_loss', period: data.period }, now)
	if (!range) return { code: 400, msg: '请选择今天、昨天或本月' }
	const started = Date.now(), command = db.command, queries = []
	const startAt = dayStart(range.start)
	const nextDay = dayText(dayStart(range.end) + DAY)
	const endAt = range.end === range.today ? now : dayStart(nextDay)
	const dateWhere = command.and([{ date: command.gte(range.start) }, { date: command.lt(nextDay) }])
	async function businessRead(name) {
		return guardedRead(name, async () => {
			const rows = await readComplete(db.collection(name), dateWhere, { command, source: `tank_loss:${name}` })
			queries.push({ name, where: dateWhere, count: rows.length }); return rows
		})
	}
	const [openingRows, closingRows, inbound, fillings] = await Promise.all([
		readBoundaryLogs(db, startAt, queries), readBoundaryLogs(db, endAt, queries),
		businessRead('crm_gas_in'), businessRead('crm_fillings')
	])
	const issues = []
	let opening = boundaryEstimate(openingRows, 'opening', issues), closing = boundaryEstimate(closingRows, 'closing', issues)
	if (opening && closing && opening.gateway_id !== closing.gateway_id) {
		issues.push({ code: 'gateway_changed', message: '期初与期末主罐采样网关不同，无法确认同一来源' })
	}
	const inboundKg = sumInbound(inbound, range, endAt, issues)
	const outflow = summarizeGasOutflow(fillings, { resolveTime: row => businessTime(row, 'filling', range, endAt) })
	const outflowKg = outflow.weight_kg
	issues.push(...outflow.issues)
	for (const { name, where, count } of queries) {
		await guardedRead(name, async () => {
			const collection = db.collection(name)
			if (countValue(await collection.where(where).count(), name) !== count) throw new FinancialReadError('membership_changed_during_tank_loss', { source: name, read_started_at: started })
			const changed = await collection.where(command.and([where, command.or([
				{ updated_at: command.gte(started) }, { created_at: command.gt(started) }
			])])).limit(1).get()
			if (!Array.isArray(changed.data) || changed.data.length) throw new FinancialReadError('records_changed_during_tank_loss', { source: name, read_started_at: started })
		})
	}
	const available = issues.length === 0
	const consumption = opening && closing && opening.gateway_id === closing.gateway_id && inboundKg != null
		? (Math.round(opening.weight_kg * 1000) + Math.round(inboundKg * 1000) - Math.round(closing.weight_kg * 1000)) / 1000 : null
	if (consumption != null && !Number.isSafeInteger(Math.round(consumption * 1000))) throw new FinancialReadError('quantity_overflow', { source: 'tank_loss' })
	const loss = available ? (Math.round(consumption * 1000) - Math.round(outflowKg * 1000)) / 1000 : null
	if (available && !Number.isSafeInteger(Math.round(loss * 1000))) throw new FinancialReadError('quantity_overflow', { source: 'tank_loss' })
	return { code: 0, data: { section: 'tank_loss', version: VERSION, period: data.period || 'yesterday', range,
		complete: true, status: available ? 'available' : 'insufficient_data', opening, closing,
		inbound_kg: inboundKg, recorded_outflow_kg: outflowKg, outflow,
		estimated_consumption_kg: consumption, estimated_loss_kg: loss, issues,
		updated_at: Date.now(), estimate_version: TANK_ESTIMATE_VERSION, read_started_at: started,
		read_completed_at: Date.now(), snapshot_consistent: false, tank_id: 'main',
		observation_time_basis: 'server_received_at', observation_time_note: '边界采样使用服务器接收时间，不代表现场开阀时刻',
		business_time_note: '小时级、分钟级业务记录按登记时段起点归属；当日仅有日期时无法计算',
		boundary_max_age_ms: MAX_SAMPLE_AGE, period_started_at: startAt, period_ended_at: endAt } }
}

module.exports = { readTankLoss }
