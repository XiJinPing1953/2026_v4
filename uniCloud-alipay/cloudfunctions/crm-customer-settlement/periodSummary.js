'use strict'

const { readComplete, FinancialReadError } = require('./financialReadLocal')
const { isOpeningPrepayReceipt } = require('./receiptSource')
const VERSION = 'customer-period-summary/2026-09-08.2'
const id = value => String(value || '').trim()
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(id(value)) ? id(value) : ''
const active = row => !row.status || row.status === 'posted'

// Receipts establish cash and its date. Allocations only explain where that cash went.
function calculatePeriodSummary(input, rules) {
	const { dateFrom = '', dateTo = '', moneyScale = 2, sales = [], flows = [], debts = [], receipts = [], allocations = [] } = input
	const sum = values => rules.sum(values, moneyScale)
	const inRange = value => Boolean(date(value)) && (!dateFrom || value >= dateFrom) && (!dateTo || value <= dateTo)
	const pending = []
	const issue = (source_type, row, reason, amount = null) => pending.push({ source_type, source_id: id(row._id), reason, amount })
	const targets = [
		...sales.map(row => ({ row, type: 'sale', bizDate: date(row.date), snapshot: rules.sale(row) })),
		...flows.filter(row => row.status === 'posted').map(row => ({ row, type: 'flow_settlement', bizDate: date(row.biz_date), snapshot: rules.flow(row) })),
		...debts.filter(row => row.status === 'posted').map(row => ({ row, type: rules.debtType(row), bizDate: date(row.biz_date), snapshot: rules.debt(row, moneyScale) }))
	]
	const targetMap = new Map(targets.map(item => [`${item.type}:${id(item.row._id)}`, item]))
	const receiptMap = new Map(receipts.map(row => [id(row._id), row]))
	const backed = new Map()
	const cashAllocations = new Map()
	const allocatedByReceipt = new Map()
	for (const row of allocations.filter(active)) {
		if (id(row.allocate_kind || 'receipt') !== 'receipt') continue
		const amount = sum([Number(row.allocate_amount) || 0])
		if (!(amount > 0)) continue
		const type = id(row.target_type || 'sale')
		const targetId = id(row.target_id || row.sale_id || row.flow_settlement_id)
		const key = `${type}:${targetId}`
		const receipt = receiptMap.get(id(row.receipt_id))
		const offset = rules.isOffsetAllocation(row) || (receipt && rules.isOffsetReceipt(receipt))
		if (offset || (receipt && receipt.status === 'posted')) backed.set(key, sum([backed.get(key) || 0, amount]))
		if (offset || isOpeningPrepayReceipt(receipt)) continue
		if (!receipt || receipt.status !== 'posted') {
			issue('allocation', row, 'active_allocation_without_posted_receipt', amount)
			continue
		}
		if (!inRange(date(receipt.biz_date))) continue
		if (!targetMap.has(key)) issue('allocation', row, 'allocation_target_missing', amount)
		allocatedByReceipt.set(id(receipt._id), sum([allocatedByReceipt.get(id(receipt._id)) || 0, amount]))
		if (type === 'opening_debt' && targetMap.has(key)) cashAllocations.set(id(row._id), amount)
	}
	let businessRevenue = 0
	let historicalReceivable = 0
	for (const item of targets) {
		const { row, type, bizDate, snapshot } = item
		const amount = type === 'opening_debt' || type === 'other_fee' ? snapshot.should_receive_effective : snapshot.should_receive
		if (inRange(bizDate)) {
			if (type === 'opening_debt') historicalReceivable = sum([historicalReceivable, amount])
			else businessRevenue = sum([businessRevenue, amount])
		} else if (!bizDate && amount) issue(type, row, 'business_date_missing', amount)
		const received = sum([snapshot.amount_received || 0])
		const unbacked = received < 0 ? received : sum([received, -(backed.get(`${type}:${id(row._id)}`) || 0)])
		// No cash date exists on legacy embedded totals. Do not assign the sale date to it.
		if (unbacked && (received < 0 || unbacked > 0)) issue(type, row, received < 0 ? 'refund_date_missing' : 'receipt_date_missing', unbacked)
	}
	let cashReceived = 0
	let refundTotal = 0
	for (const row of receipts) {
		if (row.status !== 'posted' || rules.isOffsetReceipt(row) || isOpeningPrepayReceipt(row)) continue
		const amount = sum([Number(row.amount) || 0])
		if (!date(row.biz_date)) { if (amount) issue('receipt', row, 'receipt_date_missing', amount); continue }
		if (!inRange(row.biz_date)) continue
		if (amount >= 0) cashReceived = sum([cashReceived, amount])
		else refundTotal = sum([refundTotal, -amount])
		if ((allocatedByReceipt.get(id(row._id)) || 0) > Math.max(amount, 0)) issue('receipt', row, 'allocations_exceed_receipt', amount)
	}
	const openingCredits = receipts.filter(row => row.status === 'posted' && isOpeningPrepayReceipt(row))
	const openingTransferred = sum(openingCredits.filter(row => inRange(row.biz_date)).map(row => row.amount))
	const sourceNotes = flows.filter(row => row.status === 'posted' && inRange(row.biz_date) && row.period_start_date && row.period_start_date.slice(0, 4) !== row.biz_date.slice(0, 4))
		.map(row => ({ source_type: 'flow_settlement', source_id: row._id,
			text: `${row.biz_date}流量结算包含${row.period_start_date}至${row.period_end_date || row.biz_date}的跨年用气；按结算日期计营收，未拆分为本年实际用气。` }))
	for (const row of openingCredits) if (!date(row.biz_date) || !(Number(row.amount) >= 0)) issue('opening_prepay', row, 'opening_prepay_source_invalid', row.amount)
	const knownCash = {
		cash_received: cashReceived,
		historical_debt_collected: sum([...cashAllocations.values()]),
		refund_total: refundTotal,
		net_cash_received: sum([cashReceived, -refundTotal])
	}
	const cashComplete = !pending.some(row => row.reason !== 'business_date_missing')
	const businessComplete = !pending.some(row => row.reason === 'business_date_missing')
	return {
		rule_version: VERSION, date_from: dateFrom, date_to: dateTo, money_scale: moneyScale,
		read_complete: true, complete: pending.length === 0, status: pending.length ? 'needs_review' : 'complete',
		business_revenue: businessComplete ? businessRevenue : null,
		historical_receivable: businessComplete ? historicalReceivable : null,
		receivable_total: businessComplete ? sum([businessRevenue, historicalReceivable]) : null,
		...Object.fromEntries(Object.entries(knownCash).map(([key, value]) => [key, cashComplete ? value : null])),
		opening_prepay_transferred: openingTransferred, source_notes: sourceNotes,
		known_cash: knownCash, unresolved_count: pending.length, unresolved_sources: pending
	}
}

async function readPeriodSummary({ collections, command, customerId, saleWhere, dateFrom, dateTo, moneyScale }, rules) {
	const started = Date.now()
	const inputs = {}
	const sourceWhere = { customer_id: customerId }
	// Read full customer history to detect undated embedded receipts, even outside the selected period.
	for (const [name, collection] of Object.entries(collections)) {
		inputs[name] = await readComplete(collection, name === 'sales' ? saleWhere : sourceWhere,
			{ command, source: `period_summary.${name}` })
	}
	for (const [name, collection] of Object.entries(collections)) {
		const where = name === 'sales' ? saleWhere : sourceWhere
		const changed = await collection.where(command.and([where, command.or([
			{ updated_at: command.gt(started) }, { created_at: command.gt(started) }
		])])).limit(1).get()
		if (!Array.isArray(changed.data) || changed.data.length) throw new FinancialReadError('period_sources_changed', { source: name })
	}
	return { ...calculatePeriodSummary({ ...inputs, dateFrom, dateTo, moneyScale }, rules),
		read_started_at: started, read_completed_at: Date.now(), consistency: 'live_read_non_atomic' }
}

module.exports = { VERSION, calculatePeriodSummary, readPeriodSummary }
