function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNumber(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function fixByScale(value, scale = 2) {
	const digits = Number(scale) === 3 ? 3 : 2
	return Number(toNumber(value, 0).toFixed(digits))
}

function escapeXml(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
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

function normalizeReceiptPaymentMethod(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'cash' || text === '现金') return 'cash'
	if (text === 'bank' || text === '银行' || text === '转账' || text === '银行转账') return 'bank'
	if (text === 'wechat' || text === '微信') return 'wechat'
	if (text === 'alipay' || text === '支付宝') return 'alipay'
	if (text === 'check' || text === 'cheque' || text === '支票') return 'check'
	return 'cash'
}

function paymentMethodText(value) {
	const method = normalizeReceiptPaymentMethod(value)
	if (method === 'bank') return '银行转账'
	if (method === 'wechat') return '微信'
	if (method === 'alipay') return '支付宝'
	if (method === 'check') return '支票'
	return '现金'
}

function buildCellXml(cell = {}) {
	const type = cell.type === 'Number' ? 'Number' : 'String'
	if (type === 'Number') {
		const num = Number(cell.value)
		if (!Number.isFinite(num)) return '<Cell><Data ss:Type="String"></Data></Cell>'
		return `<Cell><Data ss:Type="Number">${num}</Data></Cell>`
	}
	return `<Cell><Data ss:Type="String">${escapeXml(cell.value)}</Data></Cell>`
}

function buildRowXml(cells = []) {
	return `<Row>${cells.map((cell) => buildCellXml(cell)).join('')}</Row>`
}

function buildWorksheetXml(name, rows = []) {
	const body = rows.map((row) => buildRowXml(row)).join('')
	return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${body}</Table></Worksheet>`
}

function formatTargetPreview(row = {}) {
	const preview = Array.isArray(row.allocation_targets_preview) ? row.allocation_targets_preview : []
	if (!preview.length) return ''
	const parts = preview.map((target) => {
		const date = normalizeString(target?.target_date) || '-'
		const type = normalizeString(target?.target_type_label) || '目标'
		const kind = normalizeString(target?.allocate_kind_label)
		const scale = Number(row?.money_scale) === 3 ? 3 : 2
		const amount = fixByScale(target?.amount, scale).toFixed(scale)
		return kind ? `${date} ${type} ${kind} ¥${amount}` : `${date} ${type} ¥${amount}`
	})
	const total = toNumber(row?.allocation_target_count, parts.length)
	if (total > preview.length) parts.push(`等${total}条`)
	return parts.join('；')
}

function buildSummaryRows(payload = {}) {
	const rows = Array.isArray(payload.rows) ? payload.rows : []
	const filter = payload.filter || {}
	const customerLabel = normalizeString(filter.customerLabel) || '全部客户'
	const dateStart = normalizeString(filter.dateStart) || '不限'
	const dateEnd = normalizeString(filter.dateEnd) || '不限'
	let amountTotal = 0
	let allocatedTotal = 0
	let unallocatedTotal = 0
	rows.forEach((row) => {
		amountTotal += toNumber(row?.amount, 0)
		allocatedTotal += toNumber(row?.allocated_total, 0)
		unallocatedTotal += toNumber(row?.unallocated_amount, 0)
	})
	return [
		[{ type: 'String', value: '出纳收款登记导出（汇总）' }],
		[{ type: 'String', value: '导出时间' }, { type: 'String', value: formatDateTime(Date.now()) }],
		[{ type: 'String', value: '筛选客户' }, { type: 'String', value: customerLabel }],
		[{ type: 'String', value: '日期范围' }, { type: 'String', value: `${dateStart} ~ ${dateEnd}` }],
		[{ type: 'String', value: '记录数' }, { type: 'Number', value: rows.length }],
		[{ type: 'String', value: '收款合计(元)' }, { type: 'Number', value: Number(amountTotal.toFixed(2)) }],
		[{ type: 'String', value: '已分配合计(元)' }, { type: 'Number', value: Number(allocatedTotal.toFixed(2)) }],
		[{ type: 'String', value: '未分配合计(元)' }, { type: 'Number', value: Number(unallocatedTotal.toFixed(2)) }]
	]
}

function buildDetailRows(payload = {}) {
	const rows = Array.isArray(payload.rows) ? payload.rows : []
	const result = [
		[
			{ type: 'String', value: '业务日期' },
			{ type: 'String', value: '客户' },
			{ type: 'String', value: '收款方式' },
			{ type: 'String', value: '收款(元)' },
			{ type: 'String', value: '已分配(元)' },
			{ type: 'String', value: '未分配(元)' },
			{ type: 'String', value: '分配状态' },
			{ type: 'String', value: '分配去向摘要' },
			{ type: 'String', value: '凭证数' },
			{ type: 'String', value: '收款单号' },
			{ type: 'String', value: '更新时间' }
		]
	]
	rows.forEach((row) => {
		const scale = Number(row?.money_scale) === 3 ? 3 : 2
		result.push([
			{ type: 'String', value: normalizeString(row?.biz_date) },
			{ type: 'String', value: normalizeString(row?.customer_name) },
			{ type: 'String', value: paymentMethodText(row?.payment_method) },
			{ type: 'Number', value: fixByScale(row?.amount, scale) },
			{ type: 'Number', value: fixByScale(row?.allocated_total, scale) },
			{ type: 'Number', value: fixByScale(row?.unallocated_amount, scale) },
			{ type: 'String', value: normalizeString(row?.allocation_status_text) },
			{ type: 'String', value: formatTargetPreview(row) },
			{ type: 'Number', value: toNumber(row?.proof_images_count, 0) },
			{ type: 'String', value: normalizeString(row?._id) },
			{ type: 'String', value: formatDateTime(row?.updated_at || row?.created_at) }
		])
	})
	return result
}

export function buildCashierReceiptIntakeWorkbookXml(payload = {}) {
	const sheets = [
		buildWorksheetXml('汇总', buildSummaryRows(payload)),
		buildWorksheetXml('收款明细', buildDetailRows(payload))
	]
	return [
		'<?xml version="1.0"?>',
		'<?mso-application progid="Excel.Sheet"?>',
		'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:o="urn:schemas-microsoft-com:office:office"',
		' xmlns:x="urn:schemas-microsoft-com:office:excel"',
		' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:html="http://www.w3.org/TR/REC-html40">',
		sheets.join(''),
		'</Workbook>'
	].join('')
}

export function buildCashierReceiptIntakeExportFileName(payload = {}) {
	const filter = payload.filter || {}
	const customerLabel = sanitizeFilePart(filter.customerLabel || '全部客户')
	const dateStart = sanitizeFilePart(filter.dateStart || '起')
	const dateEnd = sanitizeFilePart(filter.dateEnd || '止')
	const total = Math.max(toNumber(payload.total, 0), 0)
	return `出纳收款登记_客户-${customerLabel}_日期-${dateStart}_${dateEnd}_${total}条_${formatNowForFile()}.xls`
}
