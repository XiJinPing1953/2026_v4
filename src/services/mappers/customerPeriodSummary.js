const fields = ['business_revenue', 'historical_receivable', 'receivable_total', 'cash_received', 'historical_debt_collected', 'refund_total', 'net_cash_received']

export function normalizeCustomerPeriodSummary(value, expected = {}) {
	if (!value || value.read_complete !== true || value.rule_version !== 'customer-period-summary/2026-09-08.1') return null
	if (expected.dateFrom != null && value.date_from !== expected.dateFrom) return null
	if (expected.dateTo != null && value.date_to !== expected.dateTo) return null
	if (![2, 3].includes(value.money_scale)) return null
	if (fields.some(key => value[key] !== null && (typeof value[key] !== 'number' || !Number.isFinite(value[key])))) return null
	return value
}

export function customerPeriodSummaryRows(value) {
	const summary = normalizeCustomerPeriodSummary(value)
	return [
		['business_revenue', '期间营收（不含历史转入）'],
		['historical_receivable', '期间历史款项'],
		['receivable_total', '所选期间应收合计（含历史款项）'],
		['cash_received', '期间实际收款'],
		['historical_debt_collected', '其中收回历史欠款'],
		['refund_total', '期间退款'],
		['net_cash_received', '扣除退款后的净收款']
	].map(([key, label]) => ({ key, label, value: summary ? summary[key] : null }))
}

export function describePeriodSummaryIssue(row = {}) {
	const reasons = {
		receipt_date_missing: '缺少可确认的收款日期', refund_date_missing: '缺少可确认的退款日期',
		business_date_missing: '缺少业务日期', active_allocation_without_posted_receipt: '分配对应的有效收款单缺失',
		allocation_target_missing: '分配对应的应收单缺失', allocations_exceed_receipt: '分配金额超过实际收款'
	}
	return `单据 ${String(row.source_id || '').slice(-6)}：${reasons[row.reason] || '账务依据待核'}`
}
