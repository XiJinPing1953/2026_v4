const BRIEF_VERSION = 'operating-brief/2026-10-23.1'
const FINANCE_VERSION = 'operating-brief-finance/2026-10-23.1'
const CURRENT_VERSION = 'operating-brief-current/2026-10-24.1'

function requireEnvelope(data, section) {
	if (!data || data.section !== section || data.version !== BRIEF_VERSION || typeof data.complete !== 'boolean') {
		throw new Error('完整数据暂不可用，请稍后刷新')
	}
}

function requireComplete(data, section) {
	requireEnvelope(data, section)
	if (data.complete !== true) {
		throw new Error('完整数据暂不可用，请稍后刷新')
	}
}

function isNumber(value) {
	return typeof value === 'number' && Number.isFinite(value)
}

function invalidSummary() { throw new Error('汇总数据读取未完成或状态不一致，请稍后刷新') }

function requireIssues(issues) {
	if (!Array.isArray(issues) || issues.some(row => !row || typeof row.code !== 'string' || !row.code ||
		typeof row.message !== 'string' || !row.message)) invalidSummary()
}

function requireValues(block, names, available, { nonnegative = [], counts = [] } = {}) {
	if (!block || names.some(name => available ? !isNumber(block[name]) : block[name] !== null)) invalidSummary()
	if (available && (nonnegative.some(name => block[name] < 0) ||
		counts.some(name => !Number.isSafeInteger(block[name]) || block[name] < 0))) invalidSummary()
}

// Each financial domain owns its status. A failed sibling cannot turn a known
// value into zero or suppress an independently complete domain.
function requireDomain(block, names = [], options) {
	if (!block || !['available', 'unavailable'].includes(block.status) ||
		block.complete !== (block.status === 'available')) invalidSummary()
	requireIssues(block.issues)
	if (block.complete ? block.issues.length !== 0 : block.issues.length === 0) invalidSummary()
	if (block.issue_count != null && (!Number.isSafeInteger(block.issue_count) || block.issue_count < block.issues.length)) invalidSummary()
	requireValues(block, names, block.complete, options)
	return block.complete
}

function isDay(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const date = new Date(`${value}T00:00:00Z`)
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function requirePeriod(data, period) {
	if (data.period !== period || !isDay(data.range?.start) || !isDay(data.range?.end) || data.range.start > data.range.end) throw new Error('统计期间无法确认，请重新读取')
	if (data.range.today != null) {
		if (!isDay(data.range.today)) throw new Error('统计日期无法确认，请重新读取')
		const end = period === 'yesterday' ? new Date(Date.parse(`${data.range.today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : data.range.today
		const start = period === 'month' ? `${data.range.today.slice(0, 7)}-01` : end
		if (data.range.start !== start || data.range.end !== end) throw new Error('统计期间与日期范围不一致，请重新读取')
	}
}

export function mapOperatingBrief(data, period) {
	requireEnvelope(data, 'brief')
	if (data.finance_version !== FINANCE_VERSION || data.money_scale !== 3) invalidSummary()
	requirePeriod(data, period)
	const business = requireDomain(data.business, ['sales', 'flow', 'total', 'net', 'positive', 'negative'], { nonnegative: ['positive', 'negative'] })
	const settlementFields = ['principal', 'allocated', 'sale_rounding', 'receipt_rounding', 'rounding', 'outstanding']
	const settlement = requireDomain(data.business.positive_settlement, settlementFields, { nonnegative: settlementFields })
	if (data.business.positive_settlement.as_of !== 'current' || !business && settlement) invalidSummary()
	const cash = requireDomain(data.cash, ['received', 'refund', 'net'], { nonnegative: ['received', 'refund'] })
	const evidence = requireDomain(data.cash.evidence)
	const destinationFields = ['same_period', 'prior_period', 'future_period', 'other', 'refunded_after_or_current',
		'remaining_prepay', 'remaining_settlement', 'remaining_unknown', 'total']
	const destinations = requireDomain(data.cash.destinations, destinationFields, { nonnegative: destinationFields })
	if (data.cash.destinations.basis !== 'current_allocation' || !cash && destinations) invalidSummary()
	const operationFields = ['sale_weight_kg', 'sale_bottle_count', 'customer_count', 'recorded_outflow_kg', 'fill_bottle_weight_kg',
		'fill_bottle_count', 'local_weight_kg', 'local_count', 'vehicle_weight_kg', 'vehicle_count']
	const operations = requireDomain(data.operations, operationFields, {
		nonnegative: operationFields.filter(name => name !== 'sale_weight_kg'),
		counts: ['sale_bottle_count', 'customer_count', 'fill_bottle_count', 'local_count', 'vehicle_count']
	})
	if (data.complete && ![business, settlement, cash, evidence, destinations, operations].every(Boolean)) invalidSummary()
	return data
}

export function mapOperatingCurrent(data) {
	requireEnvelope(data, 'current')
	if (data.current_version != null && data.current_version !== CURRENT_VERSION || data.money_scale !== 3 || !data.current || typeof data.current.complete !== 'boolean') invalidSummary()
	const block = data.current
	const modern = data.current_version === CURRENT_VERSION
	const readDomain = modern ? requireCurrentDomain : requireDomain
	const debt = readDomain(block.debt), funds = readDomain(block.available_funds)
	requireValues(block, ['receivable'], debt, { nonnegative: ['receivable'] })
	requireValues(block, ['prepay', 'offset_credit'], funds, { nonnegative: ['prepay', 'offset_credit'] })
	if (modern && (debt && block.debt.verified_subtotal !== block.receivable || funds && block.available_funds.verified_subtotal !== block.prepay)) invalidSummary()
	if (block.customer_count !== null && (!Number.isSafeInteger(block.customer_count) || block.customer_count < 0)) invalidSummary()
	if ((debt || funds) && block.customer_count === null || typeof block.prepay_label !== 'string' || !block.prepay_label) invalidSummary()
	if (funds) {
		const sourceFields = ['manual_prepay', 'receipt_unallocated', 'opening_prepay', 'deposit_transfer', 'settlement_fee']
		requireValues(block.prepay_sources, sourceFields, true, { nonnegative: sourceFields })
	} else if (block.prepay_sources !== null) invalidSummary()
	const pending = requireDomain(data.pending, ['count', 'amount'], { nonnegative: ['amount'], counts: ['count'] })
	if (block.complete && !(debt && funds) || data.complete && !(debt && funds && pending)) invalidSummary()
	requireDebtRanking(block.debt_ranking, debt, block.receivable, block.customer_count)
	if (modern) return data
	// The deployed previous contract has only whole-domain available/unavailable
	// states. Adapt those known states during rollout; never infer a partial sum.
	const legacyDomain = (domain, amount) => ({ ...domain, verified_subtotal: domain.complete ? amount : null,
		coverage: { complete: domain.complete, total_customers: domain.complete ? block.customer_count : null,
			verified_customers: domain.complete ? block.customer_count : null, pending_customers: domain.complete ? 0 : null },
		issue_count: domain.issue_count ?? domain.issues.length,
		issues_complete: domain.complete || domain.issue_count === domain.issues.length })
	return { ...data, current: { ...block, debt: legacyDomain(block.debt, block.receivable), available_funds: legacyDomain(block.available_funds, block.prepay) } }
}

function requireCurrentDomain(block) {
	if (!block || !['available', 'partial', 'unavailable'].includes(block.status) || block.complete !== (block.status === 'available')) invalidSummary()
	requireIssues(block.issues)
	if (!Number.isSafeInteger(block.issue_count) || block.issue_count < block.issues.length || typeof block.issues_complete !== 'boolean' ||
		block.issues_complete && block.issue_count !== block.issues.length ||
		(block.complete ? block.issue_count !== 0 : block.issue_count === 0)) invalidSummary()
	const coverage = block.coverage
	if (!coverage || typeof coverage.complete !== 'boolean') invalidSummary()
	const fields = ['total_customers', 'verified_customers', 'pending_customers']
	requireValues(coverage, fields, coverage.complete, { counts: fields })
	if (!coverage.complete) {
		if (block.status !== 'unavailable' || block.verified_subtotal !== null) invalidSummary()
	} else {
		const { total_customers: total, verified_customers: verified, pending_customers: pending } = coverage
		if (verified + pending !== total ||
			(block.status === 'available' ? pending !== 0 : block.status === 'partial' ? !(verified > 0 && pending > 0) : verified !== 0 || pending === 0)) invalidSummary()
		requireValues(block, ['verified_subtotal'], block.status !== 'unavailable', { nonnegative: ['verified_subtotal'] })
	}
	return block.complete
}

function requireDebtRanking(ranking, debtAvailable, receivable, customerCount) {
	const available = requireDomain(ranking, ['total_receivable', 'positive_customer_count'], {
		nonnegative: ['total_receivable'], counts: ['positive_customer_count']
	})
	if (available !== debtAvailable || !Array.isArray(ranking.items)) invalidSummary()
	if (!available) { if (ranking.items.length) invalidSummary(); return }
	if (ranking.total_receivable !== receivable || ranking.items.length !== Math.min(3, ranking.positive_customer_count) ||
		ranking.positive_customer_count > customerCount ||
		(receivable === 0) !== (ranking.positive_customer_count === 0)) invalidSummary()
	const seen = new Set()
	for (const row of ranking.items) {
		if (!row || typeof row.customer_id !== 'string' || !row.customer_id.trim() || seen.has(row.customer_id) ||
			typeof row.name !== 'string' || typeof row.code !== 'string' || !isNumber(row.amount) || row.amount <= 0 || row.amount > receivable ||
			!isNumber(row.share_of_total) || row.share_of_total < 0 || row.share_of_total > 1) invalidSummary()
		seen.add(row.customer_id)
	}
}

function requireGasOutflow(outflow, recordedWeight) {
	if (!outflow || typeof outflow.complete !== 'boolean' || !Array.isArray(outflow.channels) || outflow.channels.length !== 4) invalidSummary()
	requireIssues(outflow.issues)
	if (outflow.complete ? outflow.issues.length !== 0 : outflow.issues.length === 0) invalidSummary()
	requireValues(outflow, ['weight_kg'], outflow.complete, { nonnegative: ['weight_kg'] })
	if (outflow.weight_kg !== recordedWeight) invalidSummary()
	const keys = ['bottle', 'local', 'vehicle', 'other'], seen = new Set()
	for (const row of outflow.channels) {
		if (!row || !keys.includes(row.key) || seen.has(row.key) || typeof row.label !== 'string' || !row.label ||
			typeof row.complete !== 'boolean' || row.count_unit !== (row.key === 'bottle' ? '瓶次' : '次')) invalidSummary()
		seen.add(row.key)
		requireValues(row, ['weight_kg', 'count'], row.complete, { nonnegative: ['weight_kg'], counts: ['count'] })
	}
	if (outflow.complete !== outflow.channels.every(row => row.complete)) invalidSummary()
}

export function mapOperatingTankLoss(data, period) {
	requireComplete(data, 'tank_loss')
	requirePeriod(data, period)
	if (!['available', 'needs_review', 'insufficient_data'].includes(data.status) || !Array.isArray(data.issues)) throw new Error('估算损耗数据读取未完成')
	const available = data.status === 'available'
	const hasEvidence = data.status !== 'insufficient_data'
	requireIssues(data.issues)
	if (available ? data.issues.length !== 0 : data.issues.length === 0) invalidSummary()
	for (const field of ['opening', 'closing']) {
		const row = data[field]
		if (row === null && !hasEvidence) continue
		if (!row || !isNumber(row.weight_kg) || row.weight_kg < 0 || !isNumber(row.level_kpa) || row.level_kpa < 0 ||
			!isNumber(row.observed_at) || row.observed_at <= 0) throw new Error('储罐估算依据读取未完成')
	}
	for (const field of ['inbound_kg', 'recorded_outflow_kg', 'estimated_consumption_kg', 'estimated_loss_kg']) {
		if (data[field] === null && !hasEvidence) continue
		if (!isNumber(data[field])) throw new Error('估算损耗数据读取未完成')
	}
	if (!hasEvidence && data.estimated_loss_kg != null ||
		data.status === 'needs_review' && !(data.estimated_loss_kg < 0 || data.estimated_consumption_kg < 0)) throw new Error('估算损耗状态与数据不一致')
	if (data.inbound_kg != null && data.inbound_kg < 0) invalidSummary()
	if (data.estimated_consumption_kg != null && (!data.opening || !data.closing || data.inbound_kg === null ||
		data.opening.gateway_id && data.closing.gateway_id && data.opening.gateway_id !== data.closing.gateway_id)) invalidSummary()
	requireGasOutflow(data.outflow, data.recorded_outflow_kg)
	if (hasEvidence && !data.outflow.complete) invalidSummary()
	// The previous deployed endpoint labelled negative estimates available.
	// Downgrade that known shape during rollout without hiding its signed basis.
	if (available && (data.estimated_loss_kg < 0 || data.estimated_consumption_kg < 0)) return { ...data, status: 'needs_review',
		issues: [{ code: 'negative_estimated_difference', message: '液位估算与登记气量存在负差，请核对入库、出罐及液位依据' }] }
	return data
}

// Display sign only; all weights and the signed difference come from the server.
export function tankLossPresentation(data) {
	if (data?.status === 'needs_review' || isNumber(data?.estimated_loss_kg) && data.estimated_loss_kg < 0) return { label: '估算损耗', amount: null, needsReview: true }
	if (!data || data.status !== 'available' || !isNumber(data.estimated_loss_kg)) return { label: '估算损耗', amount: null, needsReview: false }
	return { label: '估算损耗', amount: data.estimated_loss_kg, needsReview: false }
}

// Keep every supplied issue, but combine affected metrics that refer to the
// same source. Routes only use entry points supported by the existing pages.
export function operatingReviewItems(groups) {
	const rows = new Map()
	const text = value => typeof value === 'string' ? value.trim() : ''
	for (const [label, block] of groups) {
		if (!block || block.complete !== false) continue
		const issues = block.issues?.length ? block.issues : [{ code: 'source_unavailable', message: '来源不完整，暂不显示合计' }]
		for (const issue of issues) {
			const source = text(issue.source) || text(issue.source_type), sourceId = text(issue.source_id)
			const customerId = text(issue.customer_id) || (source === 'crm_customers' ? sourceId : '')
			const key = sourceId ? `${source}:${sourceId}` : `${customerId}:${issue.code}:${issue.message}`
			let row = rows.get(key)
			if (!row) {
				const actions = []
				if (sourceId && ['crm_sale_records', 'sale'].includes(source)) actions.push({ label: '查看销售单', route: `/pages/sale/detail?_id=${encodeURIComponent(sourceId)}` })
				if (customerId) actions.push({ label: '查看客户账款', route: `/pages/customer/statement?_id=${encodeURIComponent(customerId)}` })
				if (['crm_cashier_intakes', 'crm_cashier_receipt_intakes'].includes(source)) actions.push({ label: '打开收款登记', route: '/pages/cashier/receipt-intake' })
				row = { key, labels: [], messages: [], actions, sourceId,
					context: [text(issue.customer_code), text(issue.customer_name), text(issue.source_date)].filter(Boolean).join(' · '),
					hint: issue.action === 'resume_receipt_adjustment' ? '进入客户账款后，在收款记录中继续未完成的调整。' : '' }
				rows.set(key, row)
			}
			if (!row.labels.includes(label)) row.labels.push(label)
			if (!row.messages.includes(issue.message)) row.messages.push(issue.message)
			if (issue.action === 'resume_receipt_adjustment') row.hint = '进入客户账款后，在收款记录中继续未完成的调整。'
		}
	}
	return [...rows.values()].map(row => ({ ...row, label: row.labels.join('、'), message: row.messages.join('；') }))
}

const DAILY_FIELDS = {
	fillBottleCount: 'fill_bottle_count',
	fillBottleWeightKg: 'fill_bottle_weight',
	localCount: 'local_count',
	localWeightKg: 'local_weight',
	vehicleCount: 'vehicle_count',
	vehicleWeightKg: 'vehicle_weight',
	saleCustomerCount: 'sale_customer_count',
	saleBottleCount: 'sale_bottle_count',
	saleWeightKg: 'sale_weight'
}

export function mapDashboardDailyReport(data, range) {
	requireComplete(data, 'daily_report')
	if (!isDay(range?.start) || !isDay(range?.end) || data.range?.start !== range.start || data.range?.end !== range.end) throw new Error('日报日期范围不完整，请重新读取')
	const rawRows = data.daily_report?.rows
	if (!Array.isArray(rawRows)) throw new Error('日报读取未完成')
	const count = (Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86400000 + 1
	if (count < 1 || count > 31 || rawRows.length !== count) throw new Error('日报未覆盖完整日期，暂不能导出')
	const seen = new Set()
	const rows = rawRows.map(row => {
		if (!isDay(row?.date) || row.date < range.start || row.date > range.end || seen.has(row.date)) throw new Error('日报日期不完整或重复，请重新读取')
		seen.add(row.date)
		const result = { date: row.date }
		for (const [name, legacy] of Object.entries(DAILY_FIELDS)) {
			const value = row[name] ?? row[legacy]
			if (!isNumber(value)) throw new Error('日报业务量读取未完成')
			result[name] = value
		}
		return result
	}).sort((a, b) => b.date.localeCompare(a.date))
	return { rows, range: { ...range }, complete: true, updated_at: data.updated_at }
}
