// Presentation only: use the amounts and evidence returned by the same check.
const TYPE_LABELS = {
	mapping: '客户对应待核', unmapped: '客户对应待核', evidence: '依据待核', evidence_missing: '依据待核', insufficient_evidence: '依据待核',
	amount: '金额待核', amount_difference: '金额待核', date: '日期待核', date_difference: '日期待核',
	classification: '分类待核', classification_difference: '分类待核', duplicate: '疑似重复', suspected_duplicate: '疑似重复',
	unposted: '未找到对应', internal_integrity: 'CRM 内部待核', source_changed: '来源待复核', cache_stale: '汇总缓存待刷新'
}
const BUSINESS_LABELS = {
	sale: '销售单', flow_settlement: '流量结算', receipt: '收款或余额来源', cashier_intake: '到账登记',
	receipt_rounding: '收款抹零', sale_rounding_fallback: '销售单抹零', flow_settlement_rounding_fallback: '流量结算抹零',
	other_fee: '其他费用', opening_debt: '期初欠款', opening_prepay: '期初预付款', deposit_transfer: '押金转气款',
	settlement_fee: '收款手续费', sale_offset_credit: '退气抵款', sale_offset_credit_repair: '退气抵款', customer_cash_refund: '现金退款', refund: '退款',
	rounding_reversal: '抹零冲回', prepay_writeoff: '多收款结清', balance_adjustment: '余额调整', receipt_adjustment: '收款调整',
	allocation: '收款分配', customer: '客户汇总', goods_revenue: '销售货款', settlement_writeoff_income: '多收款结清收益', rounding: '抹零'
}
const FIELD_LABELS = {
	amount: '原登记金额', should_receive: '减免前应收', rounding_amount: '原单减免', effective_should_receive: '减免后应收',
	amount_received: '原单已收', receipt_rounding_amount: '收款抹零', unallocated_amount: '可用余额', allocate_amount: '分配金额'
}
const CONTROLS = { opening_milli: '期初', debit_milli: '本期发生', credit_milli: '本期收回', closing_milli: '期末' }
const ACTIONS = {
	verify_receipt_identity: '双方核对原单和凭证，确认是否同一笔业务后，再决定哪边需要改日期。',
	verify_classification_evidence: '双方核对原单、到账凭据及会计凭证的业务分类，确认后再处理。',
	verify_amount_evidence: '双方核对原单金额和凭证；先确认是否同一笔或拆并入账，再决定改哪边。',
	verify_original_record: '双方核对原单与凭证，确认是否重复；不能仅凭同日同额删除记录。',
	verify_accounting_entry: '先核对好会计的凭证及最新明细；确认确实未入账后，再由会计处理。',
	verify_crm_entry: '先核对 CRM 原单及到账依据，确认是否漏记或拆并记录后再处理。',
	import_accounting_details: '双方核对同期间的最新明细账，逐笔定位；不要只按期末差额改账。'
}
const EXPLANATIONS = {
	INTERNAL_CHECK_INCOMPLETE: ['CRM 内部仍有检查提示未核清。', '请逐项核对下方原单与依据；这不是一笔独立错账。', '先核对 CRM 来源，再继续比较两边账务。'],
	source_rounding_exceeded: ['核查规则读取到的原单减免高于应收金额。', '还需核实原单是销售、退气抵款还是其他调整；不能仅凭此提示认定欠款错误。', '先核对 CRM 原单的业务性质与金额，再决定是否需要处理。'],
	noncash_source_requires_review: ['这笔余额来源仍需核对独立来源账，当前检查没有确认其依据。', '需补核退气、押金转款或手续费对应的原始记录及关联凭据。', '先核对 CRM 来源关系及原始凭据，不能把余额来源再次计为到账。'],
	pending_receipt_adjustment: ['原记录仍带有未完成的收款调整标记。', '还需核对该次调整的提交、作废或回读结果；标记本身不能证明调整仍在进行。', '先核对 CRM 的调整记录和操作结果，确认前不要重复调整。'],
	CONTROL_TOTAL_DIFFERENCE: ['两边的期初、发生、收回或期末金额存在差额。', '还需用同期间明细定位差额；余额相同也不能证明逐笔一致。', ACTIONS.import_accounting_details],
	POSSIBLE_DATE_DIFFERENCE: ['找到金额相同、日期不同的对应候选。', '还缺同一笔业务的原单或凭证依据；候选可能属于不同业务。', ACTIONS.verify_receipt_identity],
	NONCASH_CLASSIFICATION_CANDIDATE: ['找到同日的非现金或费用记录，金额或分类尚未对应。', '还需核对凭证如何拆分现金、优惠及其他调整；借贷金额不能直接当作到账。', ACTIONS.verify_classification_evidence],
	BUSINESS_KIND_DIFFERENCE: ['两边日期和借贷金额相同，但已有依据的业务分类不同。', '还需核对原单与会计凭证，确认哪边分类需要处理。', ACTIONS.verify_classification_evidence],
	POSSIBLE_AMOUNT_DIFFERENCE: ['找到同日、金额不同的对应候选。', '还需核实是否同一笔业务，以及是否存在拆分或合并入账。', ACTIONS.verify_amount_evidence],
	POSSIBLE_DUPLICATE: ['一边还有额外的同日同额记录。', '还需原单和凭证证明是否重复；同日同额也可能是正常多笔业务。', ACTIONS.verify_original_record],
	ACCOUNTING_ENTRY_NOT_MATCHED: ['这笔 CRM 记录在本批好会计资料中未找到对应项。', '还需核对最新明细及拆并入账情况；旧资料中的未匹配不等于现在仍未入账。', ACTIONS.verify_accounting_entry],
	CRM_ENTRY_NOT_MATCHED: ['这笔好会计记录在本次 CRM 明细中未找到对应项。', '还需核对原单、到账依据及拆并记录，尚不能认定 CRM 漏账。', ACTIONS.verify_crm_entry],
	MAPPING_REQUIRED: ['本户尚未确认对应的好会计科目。', '需核对客户档案与会计科目，名称相同只能作为候选。', '在本页确认客户对应关系后重新核查。'],
	MAPPED_SUBJECT_MISSING: ['已对应的会计科目不在本批报表内。', '需确认报表范围和客户对应关系是否完整。', '先核对好会计原始报表，再检查本页客户对应。'],
	CRM_READ_INCOMPLETE: ['本次 CRM 资料读取或期间汇总尚未完整完成。', '完整资料返回前，不能判断两边是否一致。', '先完成 CRM 读取或核实待补资料，再重新核查。'],
	customer_summary_cache_stale: ['原始账务规则已通过，客户汇总缓存需要刷新。', '无需据此认定原始单据有误。', '可显式开启汇总刷新后重新核查；刷新结果仍需回读验证。']
}

export function reconciliationIssueType(type) { return TYPE_LABELS[type] || '检查提示' }
export function reconciliationResolutionLabel(kind) {
	return ({ accepted_date_difference: '已接受日期差', merged_into_issue: '已并入其他事项' })[kind] || '历史解释'
}
export function reconciliationResolutionStatus(resolution, stale = false) {
	if (resolution?.status === 'invalidated') return '解释已失效 · 重新待核'
	if (stale || resolution?.status === 'needs_recheck' || resolution?.valid !== true) return '历史解释 · 待复核'
	return '解释有效'
}
export function reconciliationIssueSummary(problem) {
	const shown = presentReconciliationIssue(problem), record = shown.records[0]
	return record ? `${record.date} · ${record.business} · ${record.amount}` : shown.finding
}
const finite = value => typeof value === 'number' && Number.isFinite(value)
function yuan(value) {
	if (!finite(value)) return '金额未提供'
	// Never round an invalid precision into an apparently valid amount.
	const valueText = Math.abs(value * 1000 - Math.round(value * 1000)) > 0.00001 ? String(value)
		: value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 3 })
	return `¥${valueText}`
}
function milli(value) { return Number.isSafeInteger(value) ? yuan(value / 1000) : '金额未提供' }
function business(facts = {}, fallback = '') {
	if (BUSINESS_LABELS[facts.source_type]) return BUSINESS_LABELS[facts.source_type]
	if (['offset', 'offset_credit'].includes(facts.entry_kind)) return '退气抵款'
	if (facts.entry_kind === 'refund') return '退款'
	return BUSINESS_LABELS[fallback] || '业务类型待核'
}
function sourceRecord(problem) {
	const facts = problem.source_facts || {}, amounts = facts.amounts || {}
	const isReceivable = [problem.source_type, facts.source_type].some(type => ['sale', 'flow_settlement'].includes(type))
	const keys = isReceivable ? ['should_receive', 'rounding_amount', 'effective_should_receive'] : ['amount', 'unallocated_amount', 'receipt_rounding_amount']
	const field = facts.field || problem.details?.field
	if (FIELD_LABELS[field] && !keys.includes(field)) keys.push(field)
	const values = keys.filter(key => finite(amounts[key])).map(key => `${FIELD_LABELS[key]} ${yuan(amounts[key])}`)
	if (!finite(amounts[isReceivable ? 'should_receive' : 'amount'])) values.unshift('原单金额未提供')
	return { side: 'CRM 原单', date: facts.biz_date || '原单日期未提供', business: business(facts, problem.source_type),
		amount: values.join(' · '), reference: facts.source_number ? `单号 ${facts.source_number}` : '', summary: '' }
}
function ledgerRecord(row, side) {
	const values = []
	// Debit/credit are accounting directions, not a claim about cash received.
	if (row.debit_milli !== 0 || !Number.isSafeInteger(row.debit_milli)) values.push(`借方 ${milli(row.debit_milli)}`)
	if (row.credit_milli !== 0 || !Number.isSafeInteger(row.credit_milli)) values.push(`贷方 ${milli(row.credit_milli)}`)
	if (!values.length) values.push('借方 ¥0.00 · 贷方 ¥0.00')
	return { side, date: row.date || row.biz_date || '日期未提供', business: side === 'CRM' ? business(row) : '会计记录',
		amount: values.join(' · '), reference: row.voucher ? `凭证 ${row.voucher}` : '', summary: typeof row.summary === 'string' ? row.summary : '' }
}

export function presentReconciliationIssue(problem = {}) {
	let [finding, missing, handling] = EXPLANATIONS[problem.code] || [
		'核查返回了一项待核提示，尚不能据此认定账务有误。',
		'本项尚无完整的通俗说明，请展开技术详情查看原始提示及依据。',
		ACTIONS[problem.suggested_action] || '先由财务核对双方原始记录，确认事实后再决定处理哪边。'
	]
	if (problem.code === 'invalid_amount') {
		const facts = problem.source_facts || {}, field = facts.field || problem.details?.field
		const failure = { missing: '未提供', negative: '为负数', precision: '超出允许精度', invalid: '无法识别为有效金额', out_of_range: '超出可核验范围' }[facts.validation_failure]
		finding = `核查规则提示${FIELD_LABELS[field] || '相关金额'}${failure || '缺失、为负或精度待核'}。`
		missing = field === 'effective_should_receive' && facts.validation_failure === 'negative'
			? '负数可能来自退气抵款，需核对原单；不能仅据此认定欠款错误。'
			: '还需核对原单金额、业务性质及计价精度，不能把未知金额按零处理。'
		handling = '先核对 CRM 原单及业务依据，再决定是否需要处理。'
	}
	const records = [], comparisons = []
	if (problem.source_facts || problem.source_id || problem.record_id) records.push(sourceRecord(problem))
	if (problem.code === 'CONTROL_TOTAL_DIFFERENCE') {
		for (const [key, label] of Object.entries(CONTROLS)) {
			if (problem.difference?.[key] !== 0) comparisons.push(`${label}：CRM ${milli(problem.crm?.[key])}；好会计 ${milli(problem.accounting?.[key])}；差额 ${milli(problem.difference?.[key])}（CRM − 好会计）`)
		}
	} else {
		for (const [side, rows] of [['CRM', problem.crm], ['好会计候选', problem.accounting]]) {
			for (const row of Array.isArray(rows) ? rows : rows ? [rows] : []) records.push(ledgerRecord(row, side))
		}
	}
	if (finite(problem.details?.actual) || finite(problem.details?.expected)) comparisons.push(`原记录 ${yuan(problem.details.actual)}；核对依据 ${yuan(problem.details.expected)}；差额 ${yuan(problem.details.difference)}（原记录 − 依据）`)
	return { category: reconciliationIssueType(problem.type), finding, missing, handling, records, comparisons,
		diagnostic: JSON.stringify(problem, null, 2) }
}
