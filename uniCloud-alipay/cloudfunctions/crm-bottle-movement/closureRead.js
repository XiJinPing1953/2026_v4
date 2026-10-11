'use strict'

const { readComplete, FinancialReadError } = require('./financialReadLocal')
const { buildFillingClosure } = require('./fillingClosure')
const { analyzeTankBeforeFilling } = require('./tankBeforeFilling')
const { buildTruckQuantityClosure } = require('./truckQuantityClosure')
const truckQuantityFacts = require('./truckQuantityFacts.json')

const text = value => String(value == null ? '' : value).trim()
const number = value => value == null || text(value) === '' || !Number.isFinite(Number(value)) ? null : Number(value)
const dayOf = value => text(value).slice(0, 10)
const dayStart = day => Date.parse(`${day}T00:00:00+08:00`)
const round = value => Math.round((value + Number.EPSILON) * 1000) / 1000
const chunks = (rows, size = 80) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))

async function boundedRead(work, source, timeoutMs = 12000) {
	let timer
	try {
		return await Promise.race([work(), new Promise((_, reject) => {
			timer = setTimeout(() => reject(new FinancialReadError('source_read_timeout', { source })), timeoutMs)
		})])
	} catch (error) {
		if (error.code === 'FINANCIAL_READ_INCOMPLETE') throw error
		throw new FinancialReadError('source_read_failed', { source })
	} finally { clearTimeout(timer) }
}

function validDay(day) {
	return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(dayStart(day)) && new Date(dayStart(day) + 28800000).toISOString().slice(0, 10) === day
}

function fillingKind(row) {
	const type = text(row.record_type) || 'normal_fill'
	if (type === 'truck_out_agent_sale') return 'agent'
	if (type === 'truck_out_no_sale') return 'self_use'
	if (type !== 'normal_fill') return 'unknown'
	return /^TRUCK(?:[-_]|$)/i.test(text(row.bottle_no)) ? 'truck' : 'ordinary'
}

function sourceEvent(row, type, bottleNo, id, context = {}) {
	const time = text(row.filling_time || row.date)
	const match = time.match(/^(\d{4}-\d{2}-\d{2})(?:[- T](\d{2})(?:[:-](\d{2}))?)?/)
	const day = match ? match[1] : ''
	return {
		_id: id, type, bottle_no: text(bottleNo), date: time, event_day: day,
		event_at: validDay(day) ? dayStart(day) + Number(match[2] || 0) * 3600000 + Number(match[3] || 0) * 60000 : null,
		type_order: { back: 10, fill: 20, out: 30, boundary: 15 }[type],
		source_type: type === 'fill' ? 'filling' : 'sale', source_id: row._id,
		created_at: row.created_at, source_version: row.source_version,
		context: { time_precision: match && match[2] ? (match[3] ? 'minute' : 'hour') : 'day', ...context }
	}
}

// Rebuild directly from current source rows: delayed movement projections never freeze a result.
// Manual effective facts remain separate; adjustment rows are not added again to physical differences.
function buildSourceEvents({ fillings = [], sales = [], manual = [], hiddenIds = [], hiddenNames = [], bottleNos = [] }) {
	const selected = new Set(bottleNos)
	const hidden = new Set(hiddenIds)
	const names = new Set(hiddenNames.map(text).filter(Boolean))
	const hiddenSource = row => hidden.has(text(row.customer_id)) || hidden.has(text(row.delivery_customer_id)) ||
		names.has(text(row.customer_name)) || names.has(text(row.delivery_customer_name))
	const events = []
	let restricted = false
	for (const row of fillings) {
		if (!selected.has(text(row.bottle_no))) continue
		const ordinary = fillingKind(row) === 'ordinary'
		const event = sourceEvent(row, ordinary ? 'fill' : 'boundary', row.bottle_no, `filling:${row._id}`, {
			weight_start: number(row.weight_start), weight_end: number(row.weight_end), tare: number(row.tare),
			source_issues: ordinary ? [] : ['此处有非普通钢瓶灌装，不能跨业务类型连接周期']
		})
		event.source_type = 'filling'
		event.net_weight = number(row.fill_weight)
		events.push(event)
	}
	for (const row of sales) {
		const isHidden = hiddenSource(row)
		const ordinary = text(row.biz_mode) === 'bottle' || !text(row.biz_mode)
		for (const [field, type] of [['back_items', 'back'], ['out_items', 'out'], ['agent_sale_items', 'boundary']]) {
			for (const [index, item] of (Array.isArray(row[field]) ? row[field] : []).entries()) {
				const bottle = text(item.bottle_no)
				if (!selected.has(bottle)) continue
				if (isHidden) {
					restricted = true
					const event = sourceEvent({ date: row.date }, 'boundary', bottle, `restricted:${events.length}`, {
						source_issues: ['部分流转受可见范围限制，需有权限人员核查']
					})
					event.source_id = null
					events.push(event)
					continue
				}
				const boundary = !ordinary || type === 'boundary'
				const gross = number(item.gross), tare = number(item.tare), net = number(item.net)
				const issues = boundary ? ['此处有代理或其他销售，不能按普通钢瓶连接周期'] : []
				if (!boundary && gross != null && tare != null && net != null && Math.abs(gross - tare - net) > 0.005) issues.push('销售源单毛重、皮重与净重不一致')
				const event = sourceEvent(row, boundary ? 'boundary' : type, bottle, `sale:${row._id}:${type}:${index}`, {
					gross, tare, source_issues: issues
				})
				event.net_weight = net
				events.push(event)
			}
		}
	}
	for (const row of manual) {
		if (!selected.has(text(row.bottle_no)) || !['back', 'fill', 'out'].includes(row.type)) continue
		if (hiddenSource(row)) {
			restricted = true
			events.push({ ...sourceEvent({ date: row.date }, 'boundary', row.bottle_no, `restricted:${events.length}`, {
				source_issues: ['部分流转受可见范围限制，需有权限人员核查']
			}), source_id: null })
		} else {
			events.push({ ...row, customer_id: undefined, customer_name: undefined, note: undefined,
				context: { time_precision: 'day', source_issues: ['存在人工流转依据，请核对源记录'] } })
		}
	}
	return { events, restricted }
}

function dailyFillings(rows) {
	const days = new Map()
	for (const row of rows) {
		const day = dayOf(row.date)
		if (!validDay(day)) continue
		if (!days.has(day)) days.set(day, { day, fill_count: 0, fill_kg: 0, unknown_count: 0, ordinary_fill_kg: 0, other_fill_kg: 0 })
		const value = days.get(day), weight = number(row.fill_weight)
		value.fill_count++
		if (weight == null) value.unknown_count++
		else {
			value.fill_kg = round(value.fill_kg + weight)
			const key = fillingKind(row) === 'ordinary' ? 'ordinary_fill_kg' : 'other_fill_kg'
			value[key] = round(value[key] + weight)
		}
	}
	return [...days.values()].map(row => row.unknown_count ? { ...row, known_fill_kg: row.fill_kg, fill_kg: null } : row)
		.sort((a, b) => b.day.localeCompare(a.day))
}

function createClosureReader(db) {
	const command = db.command
	const collection = name => db.collection(name)
	const and = (...where) => command.and(where)
	const dateWhere = (start, end) => ({ date: start ? command.and([command.gte(start), command.lt(`${end}~`)]) : command.lt(`${end}~`) })
	async function readTankLogs(from, to) {
		const logs = collection('crm_operation_logs')
		const range = (a, b) => ({ created_at: command.and([command.gte(a), command.lte(b)]) })
		const count = async (where, label) => {
			const result = await boundedRead(() => logs.where(where).count(), `tank:count:${label}`), total = result?.total
			if (!['number', 'string'].includes(typeof total) || String(total).trim() === '' || !Number.isSafeInteger(Number(total)) || Number(total) < 0) throw new FinancialReadError('tank_count_unavailable', {})
			return Number(total)
		}
		const expected = await count(range(from, to), 'day')
		if (expected > 25000) throw new FinancialReadError('tank_row_limit', { expected_rows: expected })
		const offsets = Array.from({ length: Math.ceil(expected / 200) }, (_, index) => index * 200)
		const rows = []
		// Match the production log reader's fixed daily range and created_at index.
		// Empty-hour counts and _id cursors over telemetry time out on Alipay.
		// Reception time is immutable; count + unique IDs detect changes across pages.
		for (const batch of chunks(offsets, 4)) {
			const parts = await Promise.all(batch.map(async offset => {
				const page = await boundedRead(() => logs.where(range(from, to)).orderBy('created_at', 'desc').skip(offset).limit(200)
					.field({ _id: true, action: true, created_at: true, detail: true }).get(), `tank:page:${offset}`)
				if (!Array.isArray(page.data) || page.data.length !== Math.min(200, expected - offset)) throw new FinancialReadError('tank_page_incomplete', {})
				return page.data
			}))
			rows.push(...parts.flat())
		}
		if (rows.length !== expected || new Set(rows.map(row => row._id)).size !== expected || await count(range(from, to), 'day-final') !== expected) throw new FinancialReadError('tank_membership_changed', {})
		return rows.filter(row => row.action === 'tank_gateway_ingest')
	}

	function sourceSession(started) {
		const reads = []
		async function read(name, where, field) {
			const rows = await boundedRead(() => readComplete(collection(name), where, { command, source: `closure:${name}`, field }), `closure:${name}:${reads.length}`)
			reads.push({ name, where, count: rows.length })
			return rows
		}
		async function verify() {
			// Live reads are not an atomic snapshot. Reject changes across the full multi-source read too.
			for (const entry of reads) {
				const [count, changes] = await boundedRead(() => Promise.all([
					collection(entry.name).where(entry.where).count(),
					collection(entry.name).where(and(entry.where, command.or([{ updated_at: command.gte(started) }, { created_at: command.gte(started) }]))).limit(1).get()
				]), `closure:final:${entry.name}`)
				const validCount = ['number', 'string'].includes(typeof count.total) && String(count.total).trim() !== '' && Number.isSafeInteger(Number(count.total)) && Number(count.total) >= 0
				if (!validCount || Number(count.total) !== entry.count || !Array.isArray(changes.data) || changes.data.length) {
					throw new FinancialReadError('closure_sources_changed', { source: entry.name })
				}
			}
		}
		return { read, verify }
	}

	async function fillingClosureV1(data = {}) {
		const started = Date.now()
		const dateStart = text(data.dateStart), dateEnd = text(data.dateEnd), cutoffDay = text(data.cutoffDay)
		if (![dateStart, dateEnd, cutoffDay].every(validDay) || dateStart > dateEnd || cutoffDay < dateEnd || dayStart(dateEnd) - dayStart(dateStart) > 366 * 86400000) {
			return { code: 400, msg: '请选择有效灌装期间（最多一年），观察截止日不能早于期间结束' }
		}
		const session = sourceSession(started), { read } = session
		// Read the dated filling source once; the partial range + _id cursor has a
		// poor production query plan even though the matching period is small.
		const fillRows = await read('crm_fillings', dateWhere('', cutoffDay))
		const periodFillings = fillRows.filter(row => dayOf(row.date) >= dateStart && dayOf(row.date) <= dateEnd)
		const bottleNo = text(data.bottle_no)
		const selected = periodFillings.filter(row => fillingKind(row) === 'ordinary' && (!bottleNo || text(row.bottle_no) === bottleNo))
		const bottleNos = [...new Set(selected.map(row => text(row.bottle_no)).filter(Boolean))]
		const hiddenRows = await read('crm_customers', { is_hidden: true }, { _id: true, name: true, short_name: true })
		const targets = new Set(bottleNos)
		// Alipay's database does not reliably match nested array bottle_no with dot-path in.
		// Read the complete dated sale source once; matching to the target bottles is in buildSourceEvents.
		const sales = bottleNos.length ? await read('crm_sale_records', dateWhere('', cutoffDay), {
			date: true, biz_mode: true, out_items: true, back_items: true, agent_sale_items: true,
			customer_id: true, delivery_customer_id: true, customer_name: true, delivery_customer_name: true,
			created_at: true, updated_at: true
		}) : []
		const manualRows = bottleNos.length ? await read('crm_bottle_movements', { source_type: command.in(['manual', 'manual_fix']) }) : []
		const allFillings = fillRows.filter(row => targets.has(text(row.bottle_no)))
		const manual = manualRows.filter(row => targets.has(text(row.bottle_no)) && dayOf(row.event_day || row.date) <= cutoffDay)
		await session.verify()
		const source = buildSourceEvents({ fillings: allFillings, sales, manual,
			hiddenIds: hiddenRows.map(row => row._id), hiddenNames: hiddenRows.flatMap(row => [row.name, row.short_name]), bottleNos })
		const result = buildFillingClosure({ events: source.events, fillings: allFillings.filter(row => fillingKind(row) === 'ordinary'),
			dateStart, dateEnd, cutoffDay, bottleNo, selectedFillingIds: selected.map(row => row._id) })
		const excluded = Object.fromEntries(['truck', 'agent', 'self_use', 'unknown'].map(key => [key, { count: 0, fill_kg: 0, unknown_count: 0 }]))
		for (const row of periodFillings) {
			const kind = fillingKind(row)
			if (kind === 'ordinary') continue
			const bucket = excluded[kind], weight = number(row.fill_weight)
			bucket.count++
			if (weight == null) bucket.unknown_count++
			else bucket.fill_kg = round(bucket.fill_kg + weight)
		}
		for (const bucket of Object.values(excluded)) if (bucket.unknown_count) bucket.fill_kg = null
		const unidentified = selected.filter(row => !text(row.bottle_no))
		const warnings = source.restricted ? ['存在受可见范围限制的流转，相关周期已标为待核；不代表全厂核准结果'] : []
		if (unidentified.length) warnings.push(`${unidentified.length} 条灌装缺少瓶号，未能纳入逐瓶汇总，请先核对灌装源单`)
		const pageSize = Math.min(Math.max(Number(data.pageSize) || 30, 1), 100)
		const page = Math.max(Math.floor(Number(data.page) || 1), 1)
		const status = ['closed', 'unsold', 'pending'].includes(data.status) ? data.status : ''
		const cycles = result.cycles.filter(row => !status || row.status === status)
		return { code: 0, data: { ...result,
			cycles: cycles.slice((page - 1) * pageSize, page * pageSize), total: cycles.length, page, pageSize,
			days: dailyFillings(periodFillings), read_started_at: started, updated_at: Date.now(),
			scope: { ...result.scope, read_complete: true, source_basis: 'live_sources', snapshot_consistent: false, excluded,
				unidentified_filling_count: unidentified.length, warnings }
		} }
	}

	async function truckQuantityClosureV1(data = {}) {
		const started = Date.now()
		let dateStart = text(data.dateStart)
		const dateEnd = text(data.dateEnd), cutoffDay = text(data.cutoffDay)
		if ((dateStart && !validDay(dateStart)) || ![dateEnd, cutoffDay].every(validDay) ||
			(dateStart && dateStart > dateEnd) || cutoffDay < dateEnd) {
			return { code: 400, msg: '请选择有效进液日期和观察截止日，截止日不能早于进液结束日' }
		}
		const session = sourceSession(started), { read } = session
		const periods = await read('crm_gas_inventory_periods', { status: 'active' }, { cutoff_day: true, opening_tank_t: true, activated_at: true, updated_at: true })
		const period = periods.sort((a, b) => (b.activated_at || 0) - (a.activated_at || 0))[0]
		if (!dateStart) {
			if (!validDay(period?.cutoff_day)) return { code: 400, msg: '未取得当前账期起点，请明确选择进液开始日' }
			dateStart = period.cutoff_day
		}
		if (dateStart > dateEnd) return { code: 400, msg: '进液开始日不能晚于结束日' }
		// All inbound sources are needed: a source date may differ from confirmed
		// field timing. Filtering the DB first could silently discard that truck.
		const [gasIns, fillRows, hiddenRows] = await Promise.all([
			read('crm_gas_in', {}, { date: true, plate_no: true, tanker_no: true, gross_weight_t: true,
				tare_weight_t: true, net_weight_t: true, station_weight_t: true, direct_sale_weight_t: true,
				created_at: true, updated_at: true }),
			read('crm_fillings', {}, { date: true, filling_time: true, bottle_no: true, record_type: true,
				fill_weight: true, weight_start: true, weight_end: true, tare: true, created_at: true, updated_at: true }),
			read('crm_customers', { is_hidden: true }, { _id: true, name: true, short_name: true })
		])
		const observedFillings = fillRows.filter(row => !validDay(dayOf(row.date)) || dayOf(row.date) <= cutoffDay)
		const bottleNos = [...new Set(observedFillings.filter(row => fillingKind(row) === 'ordinary').map(row => text(row.bottle_no)).filter(Boolean))]
		const [sales, manualRows] = bottleNos.length ? await Promise.all([
			read('crm_sale_records', dateWhere('', cutoffDay), { date: true, biz_mode: true,
				out_items: true, back_items: true, agent_sale_items: true, customer_id: true,
				delivery_customer_id: true, customer_name: true, delivery_customer_name: true, created_at: true, updated_at: true }),
			read('crm_bottle_movements', { source_type: command.in(['manual', 'manual_fix']) })
		]) : [[], []]
		await session.verify()
		const source = buildSourceEvents({ fillings: observedFillings, sales,
			manual: manualRows.filter(row => dayOf(row.event_day || row.date) <= cutoffDay),
			hiddenIds: hiddenRows.map(row => row._id), hiddenNames: hiddenRows.flatMap(row => [row.name, row.short_name]), bottleNos })
		const closure = buildFillingClosure({ events: source.events,
			fillings: observedFillings.filter(row => fillingKind(row) === 'ordinary'), cutoffDay })
		const result = buildTruckQuantityClosure({ gasIns, fillings: observedFillings,
			cycles: closure.cycles, facts: truckQuantityFacts, dateStart, dateEnd, cutoffDay })
		return { code: 0, data: { ...result, updated_at: Date.now(), read_started_at: started,
			scope: { ...result.scope, inventory_period: period ? { cutoff_day: period.cutoff_day, opening_tank_t: period.opening_tank_t } : null, read_complete: true, read_only: true, source_basis: 'live_sources', snapshot_consistent: false,
				warnings: [...(result.scope?.warnings || []), ...(source.restricted ? ['存在受限销售来源，相关周期保持待核，不能视为全厂出售量已核清'] : [])] }
		} }
	}

	async function tankBeforeFillingV1(data = {}) {
		const day = text(data.day || data.dateStart)
		if (!validDay(day)) return { code: 400, msg: '请选择有效日期' }
		const started = Date.now(), from = dayStart(day), to = Math.min(from + 86400000 - 1, started - 1)
		if (to < from) return { code: 400, msg: '不能查询未来的储罐日志' }
		const [logs, fillings] = await Promise.all([
			readTankLogs(from, to),
			readComplete(collection('crm_fillings'), dateWhere(day, day), { command, source: 'closure:tank_fillings' })
		])
		const result = analyzeTankBeforeFilling({ day, logs, fillingFacts: fillings, coverage: { complete: true, from, to: to + 1, asOf: started } })
		return { code: 0, data: { ...result, updated_at: Date.now(), source_basis: 'tank_gateway_ingest', calibrated: false } }
	}
	return { fillingClosureV1, tankBeforeFillingV1, truckQuantityClosureV1 }
}

module.exports = { createClosureReader, buildSourceEvents, dailyFillings, fillingKind, validDay }
