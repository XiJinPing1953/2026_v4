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
	if (data.analysis == null) return data
	try { return { ...data, analysis: mapOperatingAnalysis(data.analysis, data.range.today, period) } }
	catch (_) { return { ...data, analysis: null, analysis_error: '比较与趋势依据未通过核对，请刷新；本期数字仍按各自状态展示。' } }
}

const ANALYSIS_VERSION = 'operating-analysis/2026-10-26.1'
const ANALYSIS_METRICS = ['sale_weight_kg', 'business_net', 'cash_net', 'customer_count']
function sameUnits(a, b) { return Math.abs(a - b) < 0.0000001 }
export function mapOperatingAnalysis(data, today, period) {
	if (data?.version !== ANALYSIS_VERSION || !isDay(today)) invalidSummary()
	const day = 86400000, shift = n => new Date(Date.parse(today) + n * day).toISOString().slice(0, 10)
	if (data.trend?.range?.start !== shift(-7) || data.trend?.range?.end !== shift(-1) || data.trend.points?.length !== 7) invalidSummary()
	for (const [i, point] of data.trend.points.entries()) {
		if (point.date !== shift(i - 7) || !['available', 'unavailable'].includes(point.status)) invalidSummary()
		requireIssues(point.issues)
		if (point.status === 'available' ? !isNumber(point.value) || !Number.isSafeInteger(point.source_count) || point.source_count < 0 || point.issues.length : point.value !== null || !point.issues.length) invalidSummary()
	}
	const comparison = data.comparison
	if (!comparison || !['available', 'partial', 'unavailable', 'not_comparable'].includes(comparison.status)) invalidSummary()
	let currentRange = null, baselineRange = null
	if (period === 'yesterday') {
		currentRange = { start: shift(-1), end: shift(-1) }; baselineRange = { start: shift(-2), end: shift(-2) }
	} else if (period === 'month') {
		const monthStart = `${today.slice(0, 7)}-01`, lastDay = new Date(Date.parse(monthStart) - day).toISOString().slice(0, 10)
		const n = Math.min(Number(today.slice(8)) - 1, Number(lastDay.slice(8)))
		if (n > 0) { currentRange = { start: monthStart, end: `${today.slice(0, 7)}-${String(n).padStart(2, '0')}` }; baselineRange = { start: `${lastDay.slice(0, 7)}-01`, end: `${lastDay.slice(0, 7)}-${String(n).padStart(2, '0')}` } }
	}
	if (!currentRange) {
		if (comparison.status !== 'not_comparable') invalidSummary()
	} else if (comparison.current_range?.start !== currentRange.start || comparison.current_range?.end !== currentRange.end || comparison.baseline_range?.start !== baselineRange.start || comparison.baseline_range?.end !== baselineRange.end) invalidSummary()
	for (const key of ANALYSIS_METRICS) {
		const metric = comparison.metrics?.[key]
		if (!metric || !['available', 'unavailable', 'not_comparable'].includes(metric.status)) invalidSummary()
		requireIssues(metric.issues)
		if (metric.status === 'available') {
			if (!currentRange || ['current', 'baseline', 'delta'].some(k => !isNumber(metric[k])) || !sameUnits(metric.current - metric.baseline, metric.delta)) invalidSummary()
			if (metric.baseline <= 0 ? metric.rate !== null : !isNumber(metric.rate) || Math.abs(metric.rate - metric.delta / metric.baseline) > 0.00001) invalidSummary()
		} else if (metric.delta !== null || metric.rate !== null ||
			['current', 'baseline'].some(k => metric.status === 'not_comparable' ? metric[k] !== null : metric[k] !== null && !isNumber(metric[k]))) invalidSummary()
	}
	const drivers = data.drivers
	if (!drivers || !Array.isArray(drivers.items) || drivers.items.length > 3) invalidSummary()
	if (drivers.status === 'available') {
		if (comparison.metrics.business_net.status !== 'available' || !isNumber(drivers.other_delta) || !sameUnits(drivers.total_delta, comparison.metrics.business_net.delta)) invalidSummary()
		const ids = new Set()
		for (const row of drivers.items) {
			if (!row.customer_id || ids.has(row.customer_id) || typeof row.name !== 'string' || ['current', 'baseline', 'delta'].some(k => !isNumber(row[k])) || !sameUnits(row.current - row.baseline, row.delta)) invalidSummary()
			ids.add(row.customer_id)
		}
		if (!sameUnits(drivers.items.reduce((sum, row) => sum + row.delta, drivers.other_delta), drivers.total_delta)) invalidSummary()
	} else if (drivers.items.length || drivers.other_delta != null || drivers.total_delta != null) invalidSummary()
	if (!data.evidence || typeof data.evidence.token !== 'string' || !data.evidence.token || data.evidence.snapshot_consistent !== false || data.evidence.external_verified !== false) invalidSummary()
	return data
}

export function mapOperatingSources(data, query) {
	if (data?.section !== 'brief_sources' || data.version !== ANALYSIS_VERSION || data.metric !== query.metric || data.scope !== (query.scope || 'period') || data.evidence_token !== query.evidence_token || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < data.items.length || data.next_cursor !== null && !/^\d+$/.test(data.next_cursor)) throw new Error('来源明细已变化或不完整，请刷新简报后重试')
	if (!isDay(data.range?.start) || !isDay(data.range?.end) || data.range.start > data.range.end ||
		query.expected_range && (data.range.start !== query.expected_range.start || data.range.end !== query.expected_range.end) || data.read_complete !== true) throw new Error('来源日期或读取范围无法确认')
	requireDomain(data, ['value'])
	const offset = Number(query.cursor || 0), next = offset + data.items.length
	if (!Number.isSafeInteger(offset) || offset < 0 || next > data.total ||
		(data.next_cursor === null ? next !== data.total : Number(data.next_cursor) !== next || !data.items.length || next >= data.total)) throw new Error('来源分页位置无法确认')
	const ids = new Set()
	for (const row of data.items) {
		if (!['crm_sale_records', 'crm_customer_flow_settlements', 'crm_customer_receipts'].includes(row.source_type) || typeof row.source_id !== 'string' || !row.source_id || ids.has(`${row.source_type}:${row.source_id}`) || !isDay(row.date) || row.date < data.range.start || row.date > data.range.end ||
			!['available', 'unavailable'].includes(row.status) || (row.status === 'available' ? !isNumber(row.value) : row.value !== null) || typeof row.unit !== 'string') throw new Error('来源明细无法确认')
		requireIssues(row.issues)
		ids.add(`${row.source_type}:${row.source_id}`)
	}
	return data
}

export function mapOperatingCurrent(data) {
	requireEnvelope(data, 'current')
	if (data.current_version != null && data.current_version !== CURRENT_VERSION || data.money_scale !== 3 || !data.current || typeof data.current.complete !== 'boolean') invalidSummary()
	const block = data.current
	if (block.chain_evidence != null) {
		const chain = block.chain_evidence, coverage = chain.coverage
		if (!['available', 'partial', 'unavailable'].includes(chain.status) || chain.complete !== (chain.status === 'available') || chain.external_verified !== false || !coverage || typeof coverage.complete !== 'boolean') invalidSummary()
		requireIssues(chain.issues)
		if (!Number.isSafeInteger(chain.issue_count) || chain.issue_count < chain.issues.length || typeof chain.issues_complete !== 'boolean' || chain.issues_complete && chain.issue_count !== chain.issues.length) invalidSummary()
		if (coverage.complete) {
			requireValues(coverage, ['total_customers', 'verified_customers', 'pending_customers'], true, { counts: ['total_customers', 'verified_customers', 'pending_customers'] })
			if (coverage.verified_customers + coverage.pending_customers !== coverage.total_customers || chain.complete && coverage.pending_customers !== 0) invalidSummary()
		} else if (chain.complete || ['total_customers', 'verified_customers', 'pending_customers'].some(k => coverage[k] !== null)) invalidSummary()
	}
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
	const modern = data.daily_version === 'operating-daily/2026-10-26.1'
	if (modern && (!Array.isArray(data.sale_ids) || data.sale_ids.some(id => typeof id !== 'string' || !id) || new Set(data.sale_ids).size !== data.sale_ids.length || typeof data.source_token !== 'string' || !data.source_token)) throw new Error('日报来源清单未完成')
	if (modern && (!Array.isArray(data.sale_weights) || data.sale_weights.length !== data.sale_ids.length ||
		new Set(data.sale_weights.map(row => row.source_id)).size !== data.sale_ids.length ||
		data.sale_weights.some(row => !data.sale_ids.includes(row.source_id) || !isNumber(row.weight_kg)))) throw new Error('日报逐单净气量依据未完成')
	if (modern && data.export_evidence != null) {
		if (typeof data.export_evidence.complete !== 'boolean') throw new Error('日报导出账务依据未完成')
		requireIssues(data.export_evidence.issues)
		if (data.export_evidence.complete && data.export_evidence.issues.length) throw new Error('日报导出账务状态不一致')
	}
	const rows = rawRows.map(row => {
		if (!isDay(row?.date) || row.date < range.start || row.date > range.end || seen.has(row.date)) throw new Error('日报日期不完整或重复，请重新读取')
		seen.add(row.date)
		const result = { date: row.date }
		for (const [name, legacy] of Object.entries(DAILY_FIELDS)) {
			const value = row[name] ?? row[legacy]
			if (!isNumber(value)) throw new Error('日报业务量读取未完成')
			result[name] = value
		}
		if (modern && (!isNumber(row.other_count) || row.other_count < 0 || !Number.isSafeInteger(row.other_count) || !isNumber(row.other_weight) || row.other_weight < 0)) throw new Error('其他出罐数据未完成')
		result.otherCount = modern ? row.other_count : null
		result.otherWeightKg = modern ? row.other_weight : null
		return result
	}).sort((a, b) => b.date.localeCompare(a.date))
	return { rows, range: { ...range }, complete: true, classificationComplete: modern, saleIds: modern ? data.sale_ids : null, saleWeights: modern ? data.sale_weights : null,
		exportEvidence: modern ? data.export_evidence : null, sourceToken: modern ? data.source_token : null, updated_at: data.updated_at }
}
