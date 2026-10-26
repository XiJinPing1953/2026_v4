'use strict'

const { readComplete, FinancialReadError } = require('./financialReadLocal')
const { sumMoneyByScale } = require('./saleAccountingLocal')
const { buildNotHiddenCustomerFieldsWhere, mergeWhere } = require('./customerVisibilityLocal')
const { validateSaleOperations } = require('./saleSourceValidation')
const { summarizeGasOutflow } = require('./gasOutflow')
const F = require('./operatingBriefFinance')
const { createHash } = require('crypto')

const VERSION = 'operating-brief/2026-10-23.1'
const DAY = 86400000
const sum = values => sumMoneyByScale(values, 3)
const dateText = value => new Date(value).toISOString().slice(0, 10)

function validDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const timestamp = Date.parse(`${value}T00:00:00Z`)
	return Number.isFinite(timestamp) && dateText(timestamp) === value
}

function resolveRange(data = {}, now = Date.now()) {
	const today = dateText(now + 8 * 3600000)
	if (data.section === 'daily_report') {
		const start = data.date_start, end = data.date_end
		if (!validDate(start) || !validDate(end) || start > end || end > today ||
			(Date.parse(end) - Date.parse(start)) / DAY >= 31) return null
		return { start, end, today }
	}
	const period = data.period || 'yesterday'
	if (!['today', 'yesterday', 'month'].includes(period)) return null
	const selected = period === 'yesterday' ? dateText(Date.parse(today) - DAY) : today
	return { start: period === 'month' ? `${today.slice(0, 7)}-01` : selected, end: selected, today }
}

function daysInRange(range) {
	const result = []
	for (let ts = Date.parse(range.start); ts <= Date.parse(range.end); ts += DAY) result.push(dateText(ts))
	return result
}

function requiredMoney(value, source, id) {
	if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value))) {
		throw new FinancialReadError('invalid_money', { source, source_id: id, complete: false })
	}
	return Number(value)
}

// Preserve existing dashboard physical definitions; sales money remains in saleAccounting.
function summarizeOperations(sales, fillings, helpers) {
	const customers = new Set()
	const result = { sale_weight_kg: 0, sale_bottle_count: 0, customer_count: 0,
		fill_bottle_weight_kg: 0, fill_bottle_count: 0, local_weight_kg: 0, local_count: 0,
		vehicle_weight_kg: 0, vehicle_count: 0, other_weight_kg: 0, other_count: 0, complete: true }
	const saleWeights = []
	for (const row of sales) {
		validateSaleOperations(row)
		const key = helpers.buildCustomerKey(row)
		if (key) customers.add(key)
		saleWeights.push(helpers.computeSaleWeight(row))
		result.sale_bottle_count += helpers.computeSaleBottleCount(row)
	}
	// Date-based operational reports share channel classification with the
	// time-bounded tank balance. Their distinct time basis stays explicit.
	const outflow = summarizeGasOutflow(fillings, { resolveTime: () => ({ include: true }) })
	if (!outflow.complete) throw new FinancialReadError('invalid_filling_source', { source: 'crm_fillings', source_id: outflow.issues[0]?.source_id })
	for (const channel of outflow.channels) {
		const prefix = channel.key === 'bottle' ? 'fill_bottle' : channel.key
		result[`${prefix}_count`] = channel.count
		result[`${prefix}_weight_kg`] = channel.weight_kg
	}
	result.sale_weight_kg = sum(saleWeights)
	result.recorded_outflow_kg = outflow.weight_kg
	result.customer_count = customers.size
	return result
}

function dailyRows(sales, fillings, range, helpers) {
	const groups = new Map(daysInRange(range).map(date => [date, { sales: [], fillings: [] }]))
	for (const row of sales) groups.get(row.date)?.sales.push(row)
	for (const row of fillings) groups.get(row.date)?.fillings.push(row)
	return [...groups.entries()].reverse().map(([date, docs]) => {
		const row = summarizeOperations(docs.sales, docs.fillings, helpers)
		return { date, fill_bottle_count: row.fill_bottle_count, fill_bottle_weight: row.fill_bottle_weight_kg,
			local_count: row.local_count, local_weight: row.local_weight_kg,
			vehicle_count: row.vehicle_count, vehicle_weight: row.vehicle_weight_kg,
			other_count: row.other_count, other_weight: row.other_weight_kg,
			fill_total_weight: row.recorded_outflow_kg,
			sale_customer_count: row.customer_count, sale_bottle_count: row.sale_bottle_count, sale_weight: row.sale_weight_kg }
	})
}

async function readOperatingBrief(db, data, helpers, now = Date.now()) {
	const range = resolveRange(data, now)
	if (!range) return { code: 400, msg: '请选择今天、昨天、本月，或不超过31天且不晚于今天的完整日期范围' }
	if (data.section !== 'daily_report') return require('./operatingBriefFinanceRead').readBriefFinance(db, data, helpers, range, {
		version: VERSION, summarizeOperations
	})
	const command = db.command
	const started = Date.now()
	const queries = []
	async function read(name, where = {}, field) {
		const rows = await readComplete(db.collection(name), where, { command, field, source: `operating_brief:${name}` })
		queries.push({ name, where, count: rows.length })
		return rows
	}
	// Visibility itself must be complete: the old list helper silently capped hidden IDs.
	const customerRows = await read('crm_customers', {}, { is_hidden: true, settlement_customer_id: true, default_price_unit: true })
	const hidden = customerRows.filter(row => row.is_hidden === true).map(row => row._id)
	const dateWhere = key => command.and([{ [key]: command.gte(range.start) }, { [key]: command.lte(range.end) }])
	const saleWhere = mergeWhere(command, dateWhere('date'), buildNotHiddenCustomerFieldsWhere(command, hidden, ['customer_id', 'delivery_customer_id']))
	const [sales, fillings] = await Promise.all([
		read('crm_sale_records', saleWhere),
		read('crm_fillings', dateWhere('date'), { date: true, bottle_no: true, record_type: true, fill_weight: true })
	])
	const eligibleSales = sales.filter(row => F.active(row, 'sales'))
	const scope = F.scopeFor(customerRows)
	for (const row of eligibleSales) scope.owner(row, 'sales')
	const saleWeights = eligibleSales.map(row => ({ source_id: row._id, weight_kg: helpers.computeSaleWeight(row) }))
	// A physical report may remain readable with a missing price. Exporting
	// monetary columns additionally requires the existing finance validation;
	// listV2's classification flag alone does not certify those source amounts.
	const exportFinance = F.businessSummary({ sales: eligibleSales, customers: customerRows })
	const exportSettlement = exportFinance.positive_settlement
	const exportEvidence = F.state([...exportFinance.issues, ...exportSettlement.issues])
	exportEvidence.complete = exportFinance.complete && exportSettlement.complete
	exportEvidence.issues_complete = exportFinance.issue_count === exportFinance.issues.length &&
		exportSettlement.issue_count === exportSettlement.issues.length && exportEvidence.issue_count === exportEvidence.issues.length
	const sourceToken = createHash('sha256').update(JSON.stringify([customerRows, sales, fillings])).digest('hex')
	const result = { section: 'daily_report', version: VERSION, daily_version: 'operating-daily/2026-10-26.1', range,
		time_basis: 'registered_business_date', source_token: sourceToken, sale_ids: eligibleSales.map(row => row._id),
		sale_weights: saleWeights, export_evidence: exportEvidence,
		daily_report: { rows: dailyRows(eligibleSales, fillings, range, helpers) }, complete: true }
	// Detect timestamped writes across the whole read window, not just each collection's page loop.
	// Deletions without tombstones and old rows without timestamps still preclude an atomic snapshot claim.
	for (const query of queries) {
		const count = await db.collection(query.name).where(query.where).count()
		if (!['number', 'string'].includes(typeof count.total) || String(count.total).trim() === '' || Number(count.total) !== query.count) {
			throw new FinancialReadError('membership_changed_during_brief', { source: query.name, read_started_at: started })
		}
		const changed = await db.collection(query.name).where(command.and([query.where, command.or([
			{ updated_at: command.gte(started) }, { created_at: command.gte(started) }
		])])).limit(1).get()
		if (!Array.isArray(changed.data) || changed.data.length) throw new FinancialReadError('records_changed_during_brief', { source: query.name, read_started_at: started })
	}
	return { code: 0, data: { ...result, updated_at: Date.now() } }
}

module.exports = { VERSION, resolveRange, requiredMoney, summarizeOperations, dailyRows, readOperatingBrief }
