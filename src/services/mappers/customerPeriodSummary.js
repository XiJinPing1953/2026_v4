const fields = ['business_revenue', 'historical_receivable', 'receivable_total', 'cash_received', 'historical_debt_collected', 'refund_total', 'net_cash_received']

export function normalizeCustomerPeriodSummary(value, expected = {}) {
	if (!value || value.read_complete !== true || !['customer-period-summary/2026-09-08.1', 'customer-period-summary/2026-09-08.2', 'customer-period-summary/2026-09-12.3'].includes(value.rule_version)) return null
	if (expected.dateFrom != null && value.date_from !== expected.dateFrom) return null
	if (expected.dateTo != null && value.date_to !== expected.dateTo) return null
	if (![2, 3].includes(value.money_scale)) return null
	if (fields.some(key => value[key] !== null && (typeof value[key] !== 'number' || !Number.isFinite(value[key])))) return null
	if (value.rule_version === 'customer-period-summary/2026-09-12.3' &&
		(value.rounding_total !== null && (typeof value.rounding_total !== 'number' || !Number.isFinite(value.rounding_total)))) return null
	return value
}

export function customerPeriodSummaryRows(value) {
	const summary = normalizeCustomerPeriodSummary(value)
	return [
		['business_revenue', '期间营收（不含历史转入）'],
		['historical_receivable', '期间历史款项'],
		['receivable_total', '所选期间应收合计（含历史款项）'],
		['cash_received', '期间实际收款'],
		['rounding_total', '期间抹零汇总（不计实际收款）'],
		['historical_debt_collected', '其中收回历史欠款'],
		['refund_total', '期间退款'],
		['net_cash_received', '扣除退款后的净收款'],
		['opening_prepay_transferred', '期间期初预付款转入（非收款）']
	].map(([key, label]) => ({ key, label, value: summary ? (summary[key] ?? (key === 'opening_prepay_transferred' && summary.rule_version.endsWith('.1') ? 0 : null)) : null }))
}

export function describePeriodSummaryIssue(row = {}) {
	const reasons = {
		receipt_date_missing: '缺少可确认的收款日期', refund_date_missing: '缺少可确认的退款日期',
		business_date_missing: '缺少业务日期', active_allocation_without_posted_receipt: '分配对应的有效收款单缺失',
		allocation_target_missing: '分配对应的应收单缺失', allocations_exceed_receipt: '分配金额超过实际收款',
		rounding_date_missing: '抹零缺少可确认的业务日期', rounding_allocation_without_posted_receipt: '抹零分配对应的有效收款单缺失',
		rounding_allocation_date_missing: '后续抹零缺少有效分配单的登记业务日期',
		rounding_noncash_origin_unverified: '非现金来源抹零的发生日期及归属待核',
		rounding_target_missing: '抹零分配对应的应收单缺失', rounding_allocation_mismatch: '收款抹零与有效分配不一致',
		rounding_exceeds_target: '抹零分配超过源单已登记抹零', rounding_void_allocation_residual: '作废抹零分配后源单仍有余额待核'
	}
	return `单据 ${String(row.source_id || '').slice(-6)}：${reasons[row.reason] || '账务依据待核'}`
}
