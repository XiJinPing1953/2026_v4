import {
	addCashierMoney,
	normalizeCashierKind,
	normalizeCashierMoney,
	normalizeCashierMoneyScale,
	normalizeCashierPurpose,
	normalizeCashierText,
	sumCashierMoney
} from '@/services/mappers/cashierIntake'

function escapeXml(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function sanitizeFilePart(value) {
	return normalizeCashierText(value).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '')
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

function formatDateTime(timestamp) {
	const time = Number(timestamp || 0)
	if (!Number.isFinite(time) || time <= 0) return ''
	const date = new Date(time)
	if (Number.isNaN(date.getTime())) return ''
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const hh = String(date.getHours()).padStart(2, '0')
	const mm = String(date.getMinutes()).padStart(2, '0')
	const ss = String(date.getSeconds()).padStart(2, '0')
	return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function paymentMethodText(value) {
	const method = normalizeCashierText(value).toLowerCase()
	if (method === 'cash' || method === '现金') return '现金'
	if (['bank', '银行', '转账', '银行转账'].includes(method)) return '银行转账'
	if (method === 'wechat' || method === '微信') return '微信'
	if (method === 'alipay' || method === '支付宝') return '支付宝'
	if (['check', 'cheque', '支票'].includes(method)) return '支票'
	if (method === 'unknown' || !method) return '渠道待核'
	return normalizeCashierText(value)
}

function kindText(value) {
	const kind = normalizeCashierKind(value)
	if (kind === 'deposit') return '押金'
	if (kind === 'mixed') return '气款+押金'
	return '气款'
}

function purposeText(value, kind) {
	const purpose = normalizeCashierPurpose(value, kind)
	if (purpose === 'prepay') return '预付'
	if (purpose === 'settlement') return '结账'
	return purpose === 'unspecified' ? '未注明' : '用途待核'
}

function sourceText(row = {}) {
	const explicit = normalizeCashierText(row.source_text || row.source)
	if (explicit === 'cashier_intake') return '出纳登记'
	if (explicit) return explicit
	if (row.legacy) return '历史收款'
	return '出纳登记'
}

function rowIntakeId(row = {}) {
	const direct = normalizeCashierText(row.intake_id)
	if (direct) return direct
	const id = normalizeCashierText(row._id)
	return row.legacy && id ? `legacy:${id}` : id
}

function rowAmountScale(row = {}) {
	return normalizeCashierKind(row.kind) === 'deposit' ? 2 : normalizeCashierMoneyScale(row.money_scale)
}

function zeroMoney(scale) {
	return Number(scale) === 3 ? '0.000' : '0.00'
}

function assertCompleteMoneyRow(row = {}) {
	const id = rowIntakeId(row)
	if (!id) throw new Error('导出数据不完整：记录缺少登记编号')
	const status = normalizeCashierText(row.status).toLowerCase()
	if (!['posted', 'void'].includes(status)) throw new Error(`导出数据不完整：${id}状态待核`)
	if (!normalizeCashierPurpose(row.purpose, row.kind)) throw new Error(`导出数据不完整：${id}用途待核`)
	const rawKind = normalizeCashierText(row.kind).toLowerCase()
	if (!['gas', 'deposit', 'mixed'].includes(rawKind)) throw new Error(`导出数据不完整：${id}缺少资金类型`)
	const rawScale = Number(row.money_scale)
	if (![2, 3].includes(rawScale)) throw new Error(`导出数据不完整：${id}缺少金额精度`)
	const totalScale = rawKind === 'deposit' ? 2 : rawScale
	const amount = normalizeCashierMoney(row.amount, totalScale)
	const gas = normalizeCashierMoney(row.gas_amount, rawScale)
	const deposit = normalizeCashierMoney(row.deposit_amount, 2)
	if (!amount || !gas || !deposit) throw new Error(`导出数据不完整：${id}金额字段缺失或超出精度`)
	if (rawKind === 'gas' && (amount !== gas || deposit !== '0.00')) throw new Error(`导出数据不完整：${id}气款合计不一致`)
	if (rawKind === 'deposit' && (amount !== deposit || gas !== zeroMoney(rawScale))) throw new Error(`导出数据不完整：${id}押金合计不一致`)
	if (rawKind === 'mixed') {
		const expected = addCashierMoney(gas, rawScale, deposit, 2, rawScale)
		if (!expected || amount !== expected) throw new Error(`导出数据不完整：${id}混合收款合计不一致`)
	}
	return row
}

function moneyCell(value, scale) {
	const normalized = normalizeCashierMoney(value, scale)
	return normalized
		? { type: 'Number', value: normalized, style: Number(scale) === 3 ? 'sMoney3' : 'sMoney2' }
		: { type: 'String', value: '待核' }
}

function buildCellXml(cell = {}) {
	const style = normalizeCashierText(cell.style)
	const styleAttr = style ? ` ss:StyleID="${escapeXml(style)}"` : ''
	if (cell.type === 'Number') {
		const value = normalizeCashierText(cell.value)
		if (!/^\d+(?:\.\d+)?$/.test(value)) return `<Cell${styleAttr}><Data ss:Type="String">待核</Data></Cell>`
		return `<Cell${styleAttr}><Data ss:Type="Number">${value}</Data></Cell>`
	}
	return `<Cell${styleAttr}><Data ss:Type="String">${escapeXml(cell.value)}</Data></Cell>`
}

function buildRowXml(cells = []) {
	return `<Row>${cells.map((cell) => buildCellXml(cell)).join('')}</Row>`
}

function buildWorksheetXml(name, rows = []) {
	return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${rows.map((row) => buildRowXml(row)).join('')}</Table></Worksheet>`
}

function textCell(value) {
	return { type: 'String', value: value == null ? '' : String(value) }
}

function numberCell(value) {
	return { type: 'Number', value: String(value) }
}

function effectiveRows(rows = []) {
	return rows.filter((row) => normalizeCashierText(row?.status).toLowerCase() !== 'void')
}

export function buildCashierReceiptIntakeTotals(rows = []) {
	const allRows = (Array.isArray(rows) ? rows : []).map(assertCompleteMoneyRow)
	const posted = effectiveRows(allRows)
	const totalScale = posted.some((row) => rowAmountScale(row) === 3) ? 3 : 2
	const gasScale = posted.some((row) => normalizeCashierKind(row?.kind) !== 'deposit' && normalizeCashierMoneyScale(row?.money_scale) === 3) ? 3 : 2
	const total = sumCashierMoney(posted, rowAmountScale, (row) => row?.amount)
	const gasRows = posted
		.filter((row) => normalizeCashierKind(row?.kind) !== 'deposit')
		.map((row) => ({ value: row?.gas_amount, scale: normalizeCashierMoneyScale(row?.money_scale) }))
	const depositRows = posted.map((row) => ({ value: row?.deposit_amount, scale: 2 }))
	return {
		count: posted.length,
		total: total || (totalScale === 3 ? '0.000' : '0.00'),
		total_scale: totalScale,
		gas_total: sumCashierMoney(gasRows, (row) => row.scale, (row) => row.value) || (gasScale === 3 ? '0.000' : '0.00'),
		gas_scale: gasScale,
		deposit_total: sumCashierMoney(depositRows, () => 2, (row) => row.value) || '0.00',
		deposit_scale: 2
	}
}

function buildSummaryRows(payload = {}) {
	const rows = Array.isArray(payload.rows) ? payload.rows : []
	const filter = payload.filter || {}
	const totals = buildCashierReceiptIntakeTotals(rows)
	return [
		[textCell('出纳收款登记导出（汇总）')],
		[textCell('导出时间'), textCell(formatDateTime(Date.now()))],
		[textCell('筛选客户'), textCell(normalizeCashierText(filter.customer_id ? (filter.customer_label || filter.customerLabel) : '') || '全部客户')],
		[textCell('日期范围'), textCell(`${normalizeCashierText(filter.date_from || filter.dateStart) || '不限'} ~ ${normalizeCashierText(filter.date_to || filter.dateEnd) || '不限'}`)],
		[textCell('资金类型'), textCell(filter.kind ? kindText(filter.kind) : '全部')],
		[textCell('气款用途'), textCell(filter.purpose ? purposeText(filter.purpose, 'gas') : '全部')],
		[textCell('导出明细数'), numberCell(rows.length)],
		[textCell('有效记录数（不含作废）'), numberCell(totals.count)],
		[textCell('有效总金额(元)'), moneyCell(totals.total, totals.total_scale)],
		[textCell('其中气款(元)'), moneyCell(totals.gas_total, totals.gas_scale)],
		[textCell('其中押金(元)'), moneyCell(totals.deposit_total, 2)]
	]
}

function buildDetailRows(payload = {}) {
	const rows = Array.isArray(payload.rows) ? payload.rows : []
	const result = [[
		textCell('业务日期'), textCell('客户'), textCell('资金类型'), textCell('气款用途'), textCell('渠道'),
		textCell('总金额(元)'), textCell('气款(元)'), textCell('押金(元)'), textCell('已分配(元)'),
		textCell('抹零分配(元)'), textCell('未分配(元)'), textCell('分配状态'), textCell('凭证数'),
		textCell('来源'), textCell('登记人'), textCell('备注'), textCell('状态'), textCell('登记编号'),
		textCell('收款编号'), textCell('押金编号'), textCell('版本')
	]]
	rows.forEach((row) => {
		const gasScale = normalizeCashierMoneyScale(row?.money_scale)
		const totalScale = rowAmountScale(row)
		result.push([
			textCell(normalizeCashierText(row?.biz_date)), textCell(normalizeCashierText(row?.customer_name)),
			textCell(kindText(row?.kind)), textCell(purposeText(row?.purpose, row?.kind)),
			textCell(paymentMethodText(row?.payment_method)), moneyCell(row?.amount, totalScale),
			moneyCell(row?.gas_amount, gasScale), moneyCell(row?.deposit_amount, 2),
			moneyCell(row?.allocated_amount, gasScale), moneyCell(row?.rounding_allocated_amount, gasScale),
			moneyCell(row?.unallocated_amount, gasScale),
			textCell(normalizeCashierText(row?.allocation_status_text || row?.allocation_status)),
			numberCell(Math.max(Number(row?.proof_images_count || 0), 0)), textCell(sourceText(row)),
			textCell(normalizeCashierText(row?.created_by_name) || '未知'), textCell(normalizeCashierText(row?.note)),
			textCell(normalizeCashierText(row?.status) === 'void' ? '已作废' : '有效'), textCell(rowIntakeId(row)),
			textCell(normalizeCashierText(row?.receipt_id)), textCell(normalizeCashierText(row?.deposit_entry_id)),
			numberCell(Number.isInteger(Number(row?.version)) ? Number(row.version) : 0)
		])
	})
	return result
}

export function buildCashierReceiptIntakeWorkbookXml(payload = {}) {
	const sheets = [buildWorksheetXml('汇总', buildSummaryRows(payload)), buildWorksheetXml('收款明细', buildDetailRows(payload))]
	return [
		'<?xml version="1.0"?>', '<?mso-application progid="Excel.Sheet"?>',
		'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:o="urn:schemas-microsoft-com:office:office"', ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
		' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"', ' xmlns:html="http://www.w3.org/TR/REC-html40">',
		'<Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/></Style>',
		'<Style ss:ID="sMoney2"><NumberFormat ss:Format="0.00"/></Style>',
		'<Style ss:ID="sMoney3"><NumberFormat ss:Format="0.000"/></Style></Styles>',
		sheets.join(''), '</Workbook>'
	].join('')
}

export function buildCashierReceiptIntakeExportFileName(payload = {}) {
	const filter = payload.filter || {}
	const customer = sanitizeFilePart(filter.customer_label || filter.customerLabel || '全部客户')
	const dateStart = sanitizeFilePart(filter.date_from || filter.dateStart || '起')
	const dateEnd = sanitizeFilePart(filter.date_to || filter.dateEnd || '止')
	const total = Math.max(Number(payload.total || 0), 0)
	return `出纳收款登记_客户-${customer}_日期-${dateStart}_${dateEnd}_${total}条_${formatNowForFile()}.xls`
}

function stableSnapshot(value) {
	if (value == null || value === '') return ''
	if (typeof value === 'string' || typeof value === 'number') return String(value)
	if (Array.isArray(value)) return `[${value.map(stableSnapshot).join(',')}]`
	if (typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${key}:${stableSnapshot(value[key])}`).join(',')}}`
	return String(value)
}

export async function collectCashierReceiptIntakeExportRows(fetchPage, filter = {}, options = {}) {
	if (typeof fetchPage !== 'function') throw new Error('导出查询方法不可用')
	const pageSize = Number.isInteger(Number(options.page_size)) && Number(options.page_size) > 0 ? Number(options.page_size) : 100
	const maxPages = Number.isInteger(Number(options.max_pages)) && Number(options.max_pages) > 0 ? Number(options.max_pages) : 500
	const allRows = []
	const ids = new Set()
	const cursors = new Set([''])
	let cursor = ''
	let expectedTotal = null
	let snapshot = ''
	for (let page = 0; page < maxPages; page += 1) {
		if (typeof options.is_current === 'function' && !options.is_current()) throw new Error('导出期间筛选条件已变化，请重新导出')
		const result = await fetchPage({ ...filter, cursor, page_size: pageSize, export_mode: true })
		if (result?.code !== 0) throw new Error(result?.msg || '导出查询失败')
		const batch = Array.isArray(result.data) ? result.data : null
		const paging = result?.paging
		if (!batch || !paging || !Number.isInteger(Number(paging.total)) || Number(paging.total) < 0) throw new Error('导出数据不完整：分页信息缺失')
		const pageSnapshot = stableSnapshot(paging.snapshot)
		if (!pageSnapshot) throw new Error('导出数据不完整：快照标识缺失')
		if (!snapshot) snapshot = pageSnapshot
		else if (snapshot !== pageSnapshot) throw new Error('导出期间数据已变化，请重新导出')
		if (expectedTotal == null) expectedTotal = Number(paging.total)
		else if (expectedTotal !== Number(paging.total)) throw new Error('导出期间记录总数已变化，请重新导出')
		if (!batch.length && (paging.hasMore || allRows.length < expectedTotal)) throw new Error('导出数据不完整：分页提前结束')
		for (const row of batch) {
			const id = rowIntakeId(row)
			if (!id) throw new Error('导出数据不完整：记录缺少登记编号')
			if (ids.has(id)) throw new Error(`导出数据重复：${id}`)
			assertCompleteMoneyRow(row)
			ids.add(id)
			allRows.push(row)
		}
		if (!paging.hasMore) {
			if (allRows.length !== expectedTotal) throw new Error(`导出数据不完整：应有${expectedTotal}条，实际${allRows.length}条`)
			return allRows
		}
		const nextCursor = paging.next_cursor
		const nextCursorKey = stableSnapshot(nextCursor)
		if (!nextCursorKey || nextCursorKey === stableSnapshot(cursor) || cursors.has(nextCursorKey)) throw new Error('导出分页异常：游标未前进')
		cursors.add(nextCursorKey)
		cursor = nextCursor
	}
	throw new Error('导出分页超过安全上限，请缩小筛选范围')
}
