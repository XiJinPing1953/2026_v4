'use strict'

const { readComplete, FinancialReadError } = require('./financialReadLocal')
const REPORT_NOTE = '本功能结清收益，并非公司全部营业外收入'
const SOURCE = 'crm_customer_opening_debts:prepay_writeoff'

function validDate(value) {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
		Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function incomplete(reason, row) {
	throw new FinancialReadError(reason, { source: SOURCE, source_id: row?._id || '' })
}

function amountUnits(row) {
	const text = String(row.amount == null ? '' : row.amount)
	if (!/^(0|[1-9]\d*)(\.\d{1,3})?$/.test(text)) incomplete('invalid_settlement_amount', row)
	const [whole, fraction = ''] = text.split('.')
	const units = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'))
	if (!Number.isSafeInteger(units) || units <= 0) incomplete('invalid_settlement_amount', row)
	return units
}

async function settlementIncomeV1(db, data = {}) {
	const dateFrom = String(data.date_from || '').trim()
	const dateTo = String(data.date_to || '').trim()
	if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) {
		return { code: 400, msg: '请填写有效的起止日期（YYYY-MM-DD）' }
	}
	// Read the dedicated source category completely, including invalid dates, so a
	// missing business date cannot silently disappear from a period total.
	const sources = await readComplete(db.collection('crm_customer_opening_debts'), {
		source_type: 'balance_adjustment', adjustment_kind: 'prepay_writeoff', status: 'posted'
	}, { command: db.command, source: SOURCE, sort: ['biz_date'] })
	const periodRows = sources.filter(row => {
		if (!validDate(row.biz_date)) incomplete('invalid_settlement_date', row)
		return row.biz_date >= dateFrom && row.biz_date <= dateTo
	})
	const customerIds = [...new Set(periodRows.map(row => String(row.customer_id || '').trim()))]
	if (customerIds.includes('')) incomplete('missing_settlement_customer')
	const customerMap = new Map()
	for (let start = 0; start < customerIds.length; start += 100) {
		const customers = await readComplete(db.collection('crm_customers'), {
			_id: db.command.in(customerIds.slice(start, start + 100))
		}, { command: db.command, field: { name: true, default_price_unit: true }, source: 'crm_customers:settlement_income' })
		for (const customer of customers) customerMap.set(customer._id, customer)
	}
	const groups = new Map()
	let totalUnits = 0
	let reportScale = 2
	for (const row of periodRows) {
		const customerId = String(row.customer_id).trim()
		const customer = customerMap.get(customerId)
		const units = amountUnits(row)
		const scale = Number(row.money_scale) === 3 ? 3 : Number(row.money_scale) === 2 ? 2 : customer?.default_price_unit === 'm3' ? 3 : 2
		if (scale === 2 && units % 10 !== 0) incomplete('settlement_precision_mismatch', row)
		if (!groups.has(customerId)) groups.set(customerId, {
			customer_id: customerId, customer_name: String(row.customer_name || customer?.name || customerId),
			money_scale: scale, amount_units: 0, count: 0, items: []
		})
		const group = groups.get(customerId)
		group.money_scale = Math.max(group.money_scale, scale)
		group.amount_units += units
		group.count += 1
		totalUnits += units
		if (!Number.isSafeInteger(totalUnits)) incomplete('settlement_total_overflow', row)
		reportScale = Math.max(reportScale, scale)
		group.items.push({
			_id: row._id, biz_date: row.biz_date, amount: units / 1000, money_scale: scale,
			adjustment_source: row.adjustment_source || {}, adjustment_evidence: row.adjustment_evidence || '',
			note: String(row.note || ''), created_by_name: String(row.created_by_name || '')
		})
	}
	const customers = [...groups.values()].map(({ amount_units, ...group }) => ({ ...group, amount: amount_units / 1000 }))
	customers.sort((left, right) => right.amount - left.amount || left.customer_id.localeCompare(right.customer_id))
	return { code: 0, data: {
		date_from: dateFrom, date_to: dateTo, total_amount: totalUnits / 1000, money_scale: reportScale,
		count: periodRows.length, customer_count: customers.length, customers, read_complete: true, note: REPORT_NOTE
	} }
}

module.exports = { settlementIncomeV1 }
