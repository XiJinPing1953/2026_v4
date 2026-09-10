import { customerPeriodSummaryRows, normalizeCustomerPeriodSummary, describePeriodSummaryIssue } from '@/services/mappers/customerPeriodSummary.js'

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNumber(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function fix2(value) {
	return Number(toNumber(value, 0).toFixed(2))
}

function fixByScale(value, scale = 2) {
	const digits = Number(scale) === 3 ? 3 : 2
	return Number(toNumber(value, 0).toFixed(digits))
}

function sanitizeFilePart(value) {
	return normalizeString(value).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '')
}

function formatNowForFile() {
	const now = new Date()
	const y = now.getFullYear()
	const m = String(now.getMonth() + 1).padStart(2, '0')
	const d = String(now.getDate()).padStart(2, '0')
	const hh = String(now.getHours()).padStart(2, '0')
	const mm = String(now.getMinutes()).padStart(2, '0')
	const ss = String(now.getSeconds()).padStart(2, '0')
	return `${y}${m}${d}_${hh}${mm}${ss}`
}

function formatDateTime(value) {
	const ts = Number(value || 0)
	if (!Number.isFinite(ts) || ts <= 0) return ''
	const date = new Date(ts)
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const hh = String(date.getHours()).padStart(2, '0')
	const mm = String(date.getMinutes()).padStart(2, '0')
	const ss = String(date.getSeconds()).padStart(2, '0')
	return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function formatDateForFile(value) {
	const ts = Number(value || 0)
	if (!Number.isFinite(ts) || ts <= 0) return formatNowForFile().slice(0, 8)
	const date = new Date(ts)
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}${m}${d}`
}

function escapeXml(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function moneyCell(value) {
	return { type: 'Number', style: 'sMoney', value: fix2(value) }
}

function moneyCellByScale(value, scale = 2) {
	const style = Number(scale) === 3 ? 'sMoney3' : 'sMoney'
	return { type: 'Number', style, value: fixByScale(value, scale) }
}

function numberOrSlashCell(value) {
	if (value == null || value === '') return { type: 'String', value: '/' }
	const num = Number(value)
	if (!Number.isFinite(num)) return { type: 'String', value: '/' }
	return moneyCell(num)
}

function buildCellXml(cell = {}) {
	const type = cell.type === 'Number' ? 'Number' : 'String'
	const styleId = normalizeString(cell.style)
	const styleText = styleId ? ` ss:StyleID="${escapeXml(styleId)}"` : ''
	if (type === 'Number') {
		const num = Number(cell.value)
		if (!Number.isFinite(num)) return `<Cell${styleText}><Data ss:Type="String"></Data></Cell>`
		return `<Cell${styleText}><Data ss:Type="Number">${num}</Data></Cell>`
	}
	return `<Cell${styleText}><Data ss:Type="String">${escapeXml(cell.value == null ? '' : cell.value)}</Data></Cell>`
}

function buildRowXml(cells = []) {
	return `<Row>${cells.map((cell) => buildCellXml(cell)).join('')}</Row>`
}

function buildWorksheetXml(name, rows = []) {
	const body = rows.map((row) => buildRowXml(row)).join('')
	return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${body}</Table></Worksheet>`
}

function buildWorkbookXml(sheets = []) {
	return [
		'<?xml version="1.0"?>',
		'<?mso-application progid="Excel.Sheet"?>',
		'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:o="urn:schemas-microsoft-com:office:office"',
		' xmlns:x="urn:schemas-microsoft-com:office:excel"',
		' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:html="http://www.w3.org/TR/REC-html40">',
		'<Styles>',
		'<Style ss:ID="sMoney"><NumberFormat ss:Format="0.00"/></Style>',
		'<Style ss:ID="sMoney3"><NumberFormat ss:Format="0.000"/></Style>',
		'</Styles>',
		sheets.join(''),
		'</Workbook>'
	].join('')
}

function sanitizeSheetName(value) {
	const text = normalizeString(value).replace(/[:\\/?*\[\]]/g, ' ').replace(/\s+/g, ' ')
	return text || '会计明细账'
}

function trimSheetName(value, maxLen = 31) {
	const text = sanitizeSheetName(value)
	if (text.length <= maxLen) return text
	return text.slice(0, Math.max(1, maxLen))
}

function buildUniqueSheetName(baseName, usedNames = new Set()) {
	let next = trimSheetName(baseName)
	if (!usedNames.has(next)) {
		usedNames.add(next)
		return next
	}
	for (let index = 2; index <= 999; index += 1) {
		const suffix = `(${index})`
		const head = trimSheetName(baseName, 31 - suffix.length)
		next = `${head}${suffix}`
		if (!usedNames.has(next)) {
			usedNames.add(next)
			return next
		}
	}
	const fallback = trimSheetName(`会计明细账${Date.now()}`)
	usedNames.add(fallback)
	return fallback
}

function paymentStatusText(value) {
	const text = normalizeString(value)
	if (text === 'paid' || text === '已结清') return '已结清'
	if (text === 'partial' || text === '部分付') return '部分付'
	return '未付款'
}

export function buildStatementSheetRows(payload = {}) {
	const companyName = normalizeString(payload.company_name) || '新拓能源'
	const customerName = normalizeString(payload?.customer?.name) || '-'
	const contact = normalizeString(payload?.customer?.contact)
	const phone = normalizeString(payload?.customer?.phone)
	const periodFrom = normalizeString(payload?.period?.date_from)
	const periodTo = normalizeString(payload?.period?.date_to)
	const currentBalance = payload.statement_balance_version === 'customer-statement-ledger/2026-09-10.1'
	const moneyScale = payload.money_scale
	const summary = normalizeCustomerPeriodSummary(payload.period_summary, { dateFrom: periodFrom, dateTo: periodTo })
	const cashStatus = summary?.complete === true ? '系统收退款无待核项' : `现金完整性待核${summary ? `（${summary.unresolved_count || 0}项）` : ''}`
	const textCell = value => ({ type: 'String', value })
	const checkedMoney = value => {
		if (!currentBalance || ![2, 3].includes(moneyScale) || typeof value !== 'number' || !Number.isFinite(value)) return textCell('待核')
		return moneyCellByScale(value, moneyScale)
	}
	const columns = [
		['amount', '金额（元，含历史款项）'],
		['cash_received', '已登记收款（元）'],
		['refund', '已登记退款（元）'],
		['legacy_received', '历史已收差额（元，日期待核）'],
		['legacy_refund', '历史退款差额（元，日期待核）'],
		['opening_prepay', '期初预付款转入（元，非收款）'],
		['rounding', '抹零（元，非收款）'],
		['balance', '结余（元，正欠款/负预付款）']
	]
	const result = [
		[textCell(`${companyName}对账单`)],
		[textCell(`客户：${customerName}${contact || phone ? `（${[contact, phone].filter(Boolean).join(' / ')}）` : ''}`)],
		[textCell(`（${periodFrom || '-'} - ${periodTo || '-'}）`)],
		[textCell(currentBalance
			? `${cashStatus}；结余沿用会计账簿，含期初欠款、预付款及历史推导。历史差额按源单日期列示，非独立收退款凭证；期间之前的事项计入期初。非现金冲抵按源单反映，不重复扣款。`
			: '旧版导出缺少账簿结余依据，请更新服务后重新导出；缺失金额显示待核。')],
		[textCell('日期'), textCell('重量（公斤）'), textCell('单价（元/公斤）'), ...columns.map(([, label]) => textCell(label)), textCell('备注')],
		[textCell('期初余额'), textCell('/'), textCell('/'), ...columns.map(([field]) => field === 'balance' ? checkedMoney(payload.opening_balance) : textCell('')), textCell('包含期间之前的账簿事项，抹零不重复计入本期')]
	]
	for (const row of Array.isArray(payload.rows) ? payload.rows : []) {
		result.push([
			textCell(normalizeString(row.biz_date)), numberOrSlashCell(row.weight_kg), numberOrSlashCell(row.unit_price),
			...columns.map(([field]) => checkedMoney(row[field])), textCell(normalizeString(row.note))
		])
	}
	const totals = payload.totals || {}
	result.push([
		textCell('合计'), numberOrSlashCell(totals.weight_kg), textCell('/'),
		...columns.map(([field]) => checkedMoney(field === 'balance' ? payload.closing_balance : totals[field])),
		textCell('结余列为期末余额，不是每日余额之和')
	])
	return result
}

function buildSaleDetailSheetRows(payload = {}) {
	const saleRows = Array.isArray(payload.sale_rows) ? payload.sale_rows : []
	const rows = [
		[
			{ type: 'String', value: '日期' },
			{ type: 'String', value: '销售单号' },
			{ type: 'String', value: '应收（元）' },
			{ type: 'String', value: '实收（元）' },
			{ type: 'String', value: '抹零（元）' },
			{ type: 'String', value: '未收（元）' },
			{ type: 'String', value: '付款状态' },
			{ type: 'String', value: '备注' }
		]
	]
	let shouldReceiveTotal = 0
	let amountReceivedTotal = 0
	let roundingTotal = 0
	let outstandingTotal = 0
	saleRows.forEach((row) => {
		const shouldReceive = fix2(row?.should_receive)
		const amountReceived = fix2(row?.amount_received)
		const roundingAmount = fix2(row?.rounding_amount)
		const outstanding = fix2(row?.outstanding)
		shouldReceiveTotal = fix2(shouldReceiveTotal + shouldReceive)
		amountReceivedTotal = fix2(amountReceivedTotal + amountReceived)
		roundingTotal = fix2(roundingTotal + roundingAmount)
		outstandingTotal = fix2(outstandingTotal + outstanding)
		rows.push([
			{ type: 'String', value: normalizeString(row?.biz_date) },
			{ type: 'String', value: normalizeString(row?.sale_id) },
			moneyCell(shouldReceive),
			moneyCell(amountReceived),
			moneyCell(roundingAmount),
			moneyCell(outstanding),
			{ type: 'String', value: paymentStatusText(row?.payment_status) },
			{ type: 'String', value: normalizeString(row?.note) }
		])
	})
	rows.push([
		{ type: 'String', value: '合计' },
		{ type: 'String', value: '' },
		moneyCell(shouldReceiveTotal),
		moneyCell(amountReceivedTotal),
		moneyCell(roundingTotal),
		moneyCell(outstandingTotal),
		{ type: 'String', value: '' },
		{ type: 'String', value: '' }
	])
	return rows
}

function moneyOrBlankCell(value, scale = 2) {
	const amount = fixByScale(value, scale)
	if (amount === 0) return { type: 'String', value: '' }
	return moneyCellByScale(amount, scale)
}

function balanceCell(row = {}, scale = 2) {
	const abs = row.balance_abs == null ? Math.abs(toNumber(row.balance, 0)) : row.balance_abs
	return moneyCellByScale(abs, scale)
}

function buildAccountingLedgerSheetRows(payload = {}) {
	const companyName = normalizeString(payload.company_name) || '新拓能源'
	const moneyScale = Number(payload.money_scale) === 3 ? 3 : 2
	const subjectTitle = normalizeString(payload?.subject?.title)
		|| `${normalizeString(payload?.subject?.code) || '1122'} ${normalizeString(payload?.subject?.name) || '应收账款'}`
	const periodFrom = normalizeString(payload?.period?.date_from)
	const periodTo = normalizeString(payload?.period?.date_to)
	const periodMonth = normalizeString(periodFrom).slice(0, 7) || normalizeString(payload?.period?.month) || normalizeString(periodTo).slice(0, 7)
	const rows = Array.isArray(payload.display_rows)
		? payload.display_rows
		: (Array.isArray(payload.rows) ? payload.rows : [])
	const opening = payload.opening || {
		direction: toNumber(payload.opening_balance, 0) > 0 ? '借' : (toNumber(payload.opening_balance, 0) < 0 ? '贷' : '平'),
		balance_abs: Math.abs(toNumber(payload.opening_balance, 0))
	}
	const result = []

	result.push([{ type: 'String', value: subjectTitle }])
	result.push([{ type: 'String', value: `${companyName} ${periodFrom || '-'} 至 ${periodTo || '-'}` }])
	result.push([{ type: 'String', value: '' }])
	result.push([
		{ type: 'String', value: '日期' },
		{ type: 'String', value: '凭证号' },
		{ type: 'String', value: '摘要' },
		{ type: 'String', value: '借方' },
		{ type: 'String', value: '贷方' },
		{ type: 'String', value: '方向' },
		{ type: 'String', value: '余额' }
	])
	result.push([
		{ type: 'String', value: periodMonth },
		{ type: 'String', value: '' },
		{ type: 'String', value: '期初余额' },
		{ type: 'String', value: '' },
		{ type: 'String', value: '' },
		{ type: 'String', value: normalizeString(opening.direction) || '平' },
		balanceCell(opening, moneyScale)
	])

	rows.forEach((row) => {
		result.push([
			{ type: 'String', value: normalizeString(row.biz_date) },
			{ type: 'String', value: normalizeString(row.voucher_no) },
			{ type: 'String', value: normalizeString(row.summary) },
			moneyOrBlankCell(row.debit, moneyScale),
			moneyOrBlankCell(row.credit, moneyScale),
			{ type: 'String', value: normalizeString(row.direction) || '平' },
			balanceCell(row, moneyScale)
		])
	})

	return result
}

function buildAccountingLedgerBatchSummaryRows(payload = {}) {
	const sheets = Array.isArray(payload.ledgerSheets) ? payload.ledgerSheets : []
	const errors = Array.isArray(payload.ledgerSheetErrors) ? payload.ledgerSheetErrors : []
	const filter = payload.filter || payload.filters || {}
	const dateStart = normalizeString(filter.dateStart || filter.statementDateStart) || '不限'
	const dateEnd = normalizeString(filter.dateEnd || filter.statementDateEnd) || '不限'
	const customerLabel = normalizeString(filter.customerLabel) || '当前筛选客户'
	return [
		[{ type: 'String', value: '客户会计明细账导出' }],
		[{ type: 'String', value: '导出时间' }, { type: 'String', value: formatNowForFile() }],
		[{ type: 'String', value: '导出客户' }, { type: 'String', value: customerLabel }],
		[{ type: 'String', value: '日期范围' }, { type: 'String', value: `${dateStart} ~ ${dateEnd}` }],
		[{ type: 'String', value: '成功客户数' }, { type: 'Number', value: sheets.length }],
		[{ type: 'String', value: '失败客户数' }, { type: 'Number', value: errors.length }]
	]
}

function buildAccountingLedgerErrorRows(errors = []) {
	const rows = [
		[
			{ type: 'String', value: '客户ID' },
			{ type: 'String', value: '客户名称' },
			{ type: 'String', value: '失败原因' }
		]
	]
	;(Array.isArray(errors) ? errors : []).forEach((item) => {
		rows.push([
			{ type: 'String', value: normalizeString(item.customer_id) },
			{ type: 'String', value: normalizeString(item.customer_name) },
			{ type: 'String', value: normalizeString(item.msg) || '未知错误' }
		])
	})
	return rows
}

function buildPeriodSummarySheetRows(payload = {}) {
	const summary = normalizeCustomerPeriodSummary(payload.period_summary)
	const scale = summary?.money_scale || 2
	const period = payload.period || {}
	return [
		[{ type: 'String', value: '对账汇总说明' }],
		[{ type: 'String', value: '查询期间' }, { type: 'String', value: `${period.date_from || summary?.date_from || ''} ~ ${period.date_to || summary?.date_to || ''}` }],
		...customerPeriodSummaryRows(summary).map(row => [
			{ type: 'String', value: row.label },
			row.value == null ? { type: 'String', value: summary ? '待核' : '未完成' } : moneyCellByScale(row.value, scale)
		]),
		[{ type: 'String', value: '说明' }, { type: 'String', value: '营收不含历史转入；实际收款按收款日期，包含预收及待分配款，不含期初预付款转入、非现金冲抵和抹零。借贷合计不等同实际收款。' }],
		[{ type: 'String', value: '核查状态' }, { type: 'String', value: summary?.complete ? '完整' : summary ? `待核 ${summary.unresolved_count} 项` : '未完成' }],
		...(summary?.source_notes || []).map(row => [{ type: 'String', value: '期间依据' }, { type: 'String', value: row.text }]),
		...(summary?.unresolved_sources || []).map(row => [{ type: 'String', value: row.source_id }, { type: 'String', value: describePeriodSummaryIssue(row) }])
	]
}

export function buildCustomerAccountingLedgerWorkbookXml(payload = {}) {
	return buildWorkbookXml([
		buildWorksheetXml('会计明细账', buildAccountingLedgerSheetRows(payload)),
		buildWorksheetXml('汇总说明', buildPeriodSummarySheetRows(payload))
	])
}

export function buildCustomerAccountingLedgerBatchWorkbookXml(payload = {}) {
	const usedSheetNames = new Set()
	const sheets = []
	const pushSheet = (name, rows) => {
		sheets.push(buildWorksheetXml(buildUniqueSheetName(name, usedSheetNames), rows))
	}
	pushSheet('导出说明', buildAccountingLedgerBatchSummaryRows(payload))
	const ledgerSheets = Array.isArray(payload.ledgerSheets) ? payload.ledgerSheets : []
	ledgerSheets.forEach((sheet, index) => {
		const customerName = normalizeString(sheet?.customer?.name) || `客户${index + 1}`
		pushSheet(`会计-${customerName}`, buildAccountingLedgerSheetRows(sheet))
	})
	const errors = Array.isArray(payload.ledgerSheetErrors) ? payload.ledgerSheetErrors : []
	if (errors.length) pushSheet('会计导出失败', buildAccountingLedgerErrorRows(errors))
	return buildWorkbookXml(sheets)
}

function debtSnapshotMoneyCell(row = {}, key = '') {
	return moneyCellByScale(row?.[key], row?.money_scale)
}

function resolveDebtSnapshotPeriod(payload = {}) {
	const period = payload.period || {}
	const dateFrom = normalizeString(period.date_from || period.dateFrom)
	const dateTo = normalizeString(period.date_to || period.dateTo)
	return dateFrom && dateTo ? { dateFrom, dateTo } : null
}

function buildDebtSnapshotSummaryRows(payload = {}) {
	const summaryRows = Array.isArray(payload.summary_rows) ? payload.summary_rows : []
	const totals = payload.totals || {}
	const period = resolveDebtSnapshotPeriod(payload)
	const title = period
		? `未结清欠款表（业务日期：${period.dateFrom} ~ ${period.dateTo}）`
		: '未结清欠款表（截至导出时点）'
	const rows = [
		[{ type: 'String', value: title }],
		[{ type: 'String', value: '导出时间' }, { type: 'String', value: formatDateTime(payload.snapshot_at || Date.now()) }],
		[{ type: 'String', value: '客户数' }, { type: 'Number', value: toNumber(totals.customer_count, summaryRows.length) }],
		[{ type: 'String', value: '未结清欠款合计' }, moneyCellByScale(totals.debt_total, 3)],
		[{ type: 'String', value: '待分配收款合计' }, moneyCellByScale(totals.receipt_unallocated_total, 3)],
		[{ type: 'String', value: '净额合计' }, moneyCellByScale(totals.net_total, 3)],
		[{ type: 'String', value: '' }],
		[
			{ type: 'String', value: '客户名称' },
			{ type: 'String', value: '联系人' },
			{ type: 'String', value: '电话' },
			{ type: 'String', value: '状态' },
			{ type: 'String', value: '未结清欠款' },
			{ type: 'String', value: '欠款笔数' },
			{ type: 'String', value: '最早欠款日期' },
			{ type: 'String', value: '最近欠款日期' },
			{ type: 'String', value: '待分配收款' },
			{ type: 'String', value: '预付款' },
			{ type: 'String', value: '冲抵池' },
			{ type: 'String', value: '净额' },
			{ type: 'String', value: '存瓶数' },
			{ type: 'String', value: '跟进备注' },
			{ type: 'String', value: '承诺付款日' }
		]
	]
	summaryRows.forEach((row) => {
		rows.push([
			{ type: 'String', value: normalizeString(row.customer_name) },
			{ type: 'String', value: normalizeString(row.contact) },
			{ type: 'String', value: normalizeString(row.phone) },
			{ type: 'String', value: normalizeString(row.status) },
			debtSnapshotMoneyCell(row, 'receivable_balance'),
			{ type: 'Number', value: toNumber(row.debt_count, 0) },
			{ type: 'String', value: normalizeString(row.earliest_debt_date) },
			{ type: 'String', value: normalizeString(row.latest_debt_date) },
			debtSnapshotMoneyCell(row, 'receipt_unallocated_balance'),
			debtSnapshotMoneyCell(row, 'prepay_manual_balance'),
			debtSnapshotMoneyCell(row, 'offset_credit_balance'),
			debtSnapshotMoneyCell(row, 'net_balance'),
			{ type: 'Number', value: toNumber(row.deposit_count, 0) },
			{ type: 'String', value: normalizeString(row.follow_up_note) },
			{ type: 'String', value: normalizeString(row.promise_pay_date) }
		])
	})
	return rows
}

function buildDebtSnapshotDetailRows(payload = {}) {
	const detailRows = Array.isArray(payload.detail_rows) ? payload.detail_rows : []
	const rows = [
		[
			{ type: 'String', value: '客户名称' },
			{ type: 'String', value: '送达地点' },
			{ type: 'String', value: '单据类型' },
			{ type: 'String', value: '业务日期' },
			{ type: 'String', value: '单据号' },
			{ type: 'String', value: '应收' },
			{ type: 'String', value: '已分配收款' },
			{ type: 'String', value: '收款抹零' },
			{ type: 'String', value: '已冲抵' },
			{ type: 'String', value: '未结清欠款' },
			{ type: 'String', value: '备注' }
		]
	]
	detailRows.forEach((row) => {
		rows.push([
			{ type: 'String', value: normalizeString(row.customer_name) },
			{ type: 'String', value: normalizeString(row.delivery_customer_name) },
			{ type: 'String', value: normalizeString(row.target_type_label) },
			{ type: 'String', value: normalizeString(row.biz_date) },
			{ type: 'String', value: normalizeString(row.target_id) },
			debtSnapshotMoneyCell(row, 'should_receive'),
			debtSnapshotMoneyCell(row, 'receipt_amount'),
			debtSnapshotMoneyCell(row, 'receipt_rounding_amount'),
			debtSnapshotMoneyCell(row, 'offset_amount'),
			debtSnapshotMoneyCell(row, 'outstanding'),
			{ type: 'String', value: normalizeString(row.note) }
		])
	})
	return rows
}

export function buildCustomerDebtSnapshotWorkbookXml(payload = {}) {
	return buildWorkbookXml([
		buildWorksheetXml('欠款汇总', buildDebtSnapshotSummaryRows(payload)),
		buildWorksheetXml('欠款明细', buildDebtSnapshotDetailRows(payload))
	])
}

export function buildCustomerDebtSnapshotExportFileName(payload = {}) {
	const total = Math.max(toNumber(payload?.totals?.customer_count, 0), 0)
	const period = resolveDebtSnapshotPeriod(payload)
	if (period) {
		const dateFrom = sanitizeFilePart(period.dateFrom)
		const dateTo = sanitizeFilePart(period.dateTo)
		return `未结清欠款表_业务日期-${dateFrom}_至-${dateTo}_${total}客户_${formatNowForFile()}.xls`
	}
	const dateText = sanitizeFilePart(formatDateForFile(payload?.snapshot_at || Date.now()))
	return `未结清欠款表_截至-${dateText}_${total}客户_${formatNowForFile()}.xls`
}

export function buildCustomerAccountingLedgerExportFileName(payload = {}) {
	const customerName = sanitizeFilePart(payload?.customer?.name || '客户')
	const periodFrom = sanitizeFilePart(payload?.period?.date_from || '起')
	const periodTo = sanitizeFilePart(payload?.period?.date_to || '止')
	return `${customerName}_会计明细账_${periodFrom}_${periodTo}_${formatNowForFile()}.xls`
}

export function buildCustomerAccountingLedgerBatchExportFileName(payload = {}) {
	const filter = payload.filter || payload.filters || {}
	const dateStart = sanitizeFilePart(filter.dateStart || filter.statementDateStart || '起')
	const dateEnd = sanitizeFilePart(filter.dateEnd || filter.statementDateEnd || '止')
	const total = Math.max(toNumber(payload.total, 0), 0)
	return `客户会计明细账_日期-${dateStart}_${dateEnd}_${total}客户_${formatNowForFile()}.xls`
}

export function buildCustomerStatementWorkbookXml(payload = {}) {
	const sheets = [
		buildWorksheetXml('客户对账单', buildStatementSheetRows(payload)),
		buildWorksheetXml('销售明细', buildSaleDetailSheetRows(payload)),
		buildWorksheetXml('汇总说明', buildPeriodSummarySheetRows(payload))
	]
	return [
		'<?xml version="1.0"?>',
		'<?mso-application progid="Excel.Sheet"?>',
		'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:o="urn:schemas-microsoft-com:office:office"',
		' xmlns:x="urn:schemas-microsoft-com:office:excel"',
		' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:html="http://www.w3.org/TR/REC-html40">',
		'<Styles>',
		'<Style ss:ID="sMoney"><NumberFormat ss:Format="0.00"/></Style>',
		'<Style ss:ID="sMoney3"><NumberFormat ss:Format="0.000"/></Style>',
		'</Styles>',
		sheets.join(''),
		'</Workbook>'
	].join('')
}

export function buildCustomerStatementExportFileName(payload = {}) {
	const customerName = sanitizeFilePart(payload?.customer?.name || '客户')
	const periodFrom = sanitizeFilePart(payload?.period?.date_from || '起')
	const periodTo = sanitizeFilePart(payload?.period?.date_to || '止')
	return `${customerName}_对账单_${periodFrom}_${periodTo}_${formatNowForFile()}.xls`
}

export function downloadWorkbookOnH5(workbookText, fileName) {
	if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Blob === 'undefined') return false
	const blob = new Blob([`\uFEFF${workbookText}`], { type: 'application/vnd.ms-excel;charset=utf-8;' })
	const url = window.URL.createObjectURL(blob)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = fileName
	anchor.style.display = 'none'
	document.body.appendChild(anchor)
	anchor.click()
	document.body.removeChild(anchor)
	window.URL.revokeObjectURL(url)
	return true
}

function writeUniFile(fs, filePath, data) {
	return new Promise((resolve, reject) => {
		fs.writeFile({
			filePath,
			data,
			encoding: 'utf8',
			success: () => resolve(filePath),
			fail: reject
		})
	})
}

function saveUniFile(tempFilePath) {
	return new Promise((resolve, reject) => {
		if (typeof uni.saveFile !== 'function') {
			resolve(tempFilePath)
			return
		}
		uni.saveFile({
			tempFilePath,
			success: (res) => resolve(res?.savedFilePath || tempFilePath),
			fail: () => resolve(tempFilePath)
		})
	})
}

function openUniDocument(filePath) {
	return new Promise((resolve) => {
		if (typeof uni.openDocument !== 'function') {
			resolve(true)
			return
		}
		uni.openDocument({
			filePath,
			fileType: 'xls',
			showMenu: true,
			success: () => resolve(true),
			fail: () => resolve(false)
		})
	})
}

async function downloadWorkbookOnUni(workbookText, fileName) {
	if (typeof uni === 'undefined') return false
	if (typeof uni.getFileSystemManager !== 'function') return false
	const userPath = normalizeString(uni?.env?.USER_DATA_PATH)
	if (!userPath) return false
	const fs = uni.getFileSystemManager()
	if (!fs || typeof fs.writeFile !== 'function') return false
	const safeFileName = sanitizeFilePart(fileName || '客户对账单.xls') || '客户对账单.xls'
	const finalName = safeFileName.endsWith('.xls') ? safeFileName : `${safeFileName}.xls`
	const tempPath = `${userPath}/${finalName}`
	try {
		const text = `\uFEFF${workbookText || ''}`
		const writtenPath = await writeUniFile(fs, tempPath, text)
		const savedPath = await saveUniFile(writtenPath)
		const opened = await openUniDocument(savedPath)
		return Boolean(opened)
	} catch (err) {
		console.error('[customer-statement] downloadWorkbookOnUni failed', err)
		return false
	}
}

export async function downloadWorkbookFile(workbookText, fileName) {
	if (downloadWorkbookOnH5(workbookText, fileName)) return true
	return downloadWorkbookOnUni(workbookText, fileName)
}
