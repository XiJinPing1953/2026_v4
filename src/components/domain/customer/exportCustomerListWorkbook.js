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

function escapeXml(value) {
	return String(value ?? '')
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

function formatDateTime(value) {
	const ts = Number(value)
	if (!Number.isFinite(ts) || ts <= 0) return ''
	const d = new Date(ts)
	if (Number.isNaN(d.getTime())) return ''
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	const hh = String(d.getHours()).padStart(2, '0')
	const mm = String(d.getMinutes()).padStart(2, '0')
	const ss = String(d.getSeconds()).padStart(2, '0')
	return `${y}-${m}-${day} ${hh}:${mm}:${ss}`
}

function buildCellXml(cell = {}) {
	const type = cell.type === 'Number' ? 'Number' : 'String'
	if (type === 'Number') {
		const num = Number(cell.value)
		if (!Number.isFinite(num)) return '<Cell><Data ss:Type="String"></Data></Cell>'
		return `<Cell><Data ss:Type="Number">${num}</Data></Cell>`
	}
	return `<Cell><Data ss:Type="String">${escapeXml(cell.value == null ? '' : cell.value)}</Data></Cell>`
}

function buildRowXml(cells = []) {
	return `<Row>${cells.map((cell) => buildCellXml(cell)).join('')}</Row>`
}

function buildWorksheetXml(name, rows = []) {
	const body = rows.map((row) => buildRowXml(row)).join('')
	return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${body}</Table></Worksheet>`
}

function sanitizeSheetName(value) {
	const text = normalizeString(value).replace(/[:\\/?*\[\]]/g, ' ').replace(/\s+/g, ' ')
	if (!text) return '客户明细账'
	return text
}

function trimSheetName(name, maxLen = 31) {
	const text = sanitizeSheetName(name)
	if (text.length <= maxLen) return text
	return text.slice(0, Math.max(1, maxLen))
}

function buildUniqueSheetName(baseName, usedNames = new Set()) {
	let next = trimSheetName(baseName, 31)
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
	const fallback = `明细账${Date.now()}`
	usedNames.add(fallback)
	return fallback
}

function summarizeRows(rows = []) {
	const source = Array.isArray(rows) ? rows : []
	const summary = {
		total: source.length,
		active: 0,
		inactive: 0,
		priced: 0,
		receivableTotal: 0,
		prepayTotal: 0,
		netTotal: 0,
		depositTotal: 0
	}
	source.forEach((row) => {
		if (row?.is_active) summary.active += 1
		else summary.inactive += 1
		if (toNumber(row?.default_unit_price, 0) > 0) summary.priced += 1
		summary.receivableTotal = fix2(summary.receivableTotal + toNumber(row?.receivable_balance, 0))
		summary.prepayTotal = fix2(summary.prepayTotal + toNumber(row?.prepay_balance, 0))
		summary.netTotal = fix2(summary.netTotal + toNumber(row?.net_balance, 0))
		summary.depositTotal += toNumber(row?.deposit_count, 0)
	})
	return summary
}

function buildOverviewRows(payload = {}) {
	const rows = Array.isArray(payload.rows) ? payload.rows : []
	const summary = summarizeRows(rows)
	const keyword = normalizeString(payload?.filters?.keyword) || '（空）'
	const activeLabel = normalizeString(payload?.filters?.activeLabel) || '全部状态'
	const visibilityLabel = normalizeString(payload?.filters?.visibilityLabel) || '可见客户'
	const balanceLabel = normalizeString(payload?.filters?.balanceLabel) || '全部余额'
	const updatedDateRangeLabel = normalizeString(payload?.filters?.updatedDateRangeLabel) || '全部时间'
	const cashierUnallocatedLabel = normalizeString(payload?.filters?.cashierUnallocatedLabel) || '全部客户'
	const cashierDateRangeLabel = normalizeString(payload?.filters?.cashierDateRangeLabel) || '全部时间'
	const statementDateStart = normalizeString(payload?.filters?.statementDateStart) || '不限'
	const statementDateEnd = normalizeString(payload?.filters?.statementDateEnd) || '不限'
	const exportAt = formatDateTime(Date.now())

	return [
		[{ type: 'String', value: '客户列表导出（总览汇总）' }],
		[{ type: 'String', value: '' }],
		[{ type: 'String', value: '导出时间' }, { type: 'String', value: exportAt }],
		[{ type: 'String', value: '关键词' }, { type: 'String', value: keyword }],
		[{ type: 'String', value: '状态筛选' }, { type: 'String', value: activeLabel }],
		[{ type: 'String', value: '显隐范围' }, { type: 'String', value: visibilityLabel }],
		[{ type: 'String', value: '余额方向' }, { type: 'String', value: balanceLabel }],
		[{ type: 'String', value: '更新时间范围' }, { type: 'String', value: updatedDateRangeLabel }],
		[{ type: 'String', value: '出纳未分配筛选' }, { type: 'String', value: cashierUnallocatedLabel }],
		[{ type: 'String', value: '出纳日期范围' }, { type: 'String', value: cashierDateRangeLabel }],
		[{ type: 'String', value: '明细账导出区间' }, { type: 'String', value: `${statementDateStart} ~ ${statementDateEnd}` }],
		[{ type: 'String', value: '导出范围' }, { type: 'String', value: `当前筛选全量（${summary.total} 客户）` }],
		[{ type: 'String', value: '' }],
		[{ type: 'String', value: '统计项' }, { type: 'String', value: '数值' }],
		[{ type: 'String', value: '客户总数' }, { type: 'Number', value: summary.total }],
		[{ type: 'String', value: '启用客户' }, { type: 'Number', value: summary.active }],
		[{ type: 'String', value: '停用客户' }, { type: 'Number', value: summary.inactive }],
		[{ type: 'String', value: '已配定价' }, { type: 'Number', value: summary.priced }],
		[{ type: 'String', value: '应收余额合计' }, { type: 'Number', value: summary.receivableTotal }],
		[{ type: 'String', value: '预付余额合计' }, { type: 'Number', value: summary.prepayTotal }],
		[{ type: 'String', value: '净额合计' }, { type: 'Number', value: summary.netTotal }],
		[{ type: 'String', value: '存瓶总数' }, { type: 'Number', value: summary.depositTotal }]
	]
}

function buildDetailRows(payload = {}) {
	const source = Array.isArray(payload.rows) ? payload.rows : []
	const rows = [
		[
			{ type: 'String', value: '客户名称' },
			{ type: 'String', value: '联系人' },
			{ type: 'String', value: '电话' },
			{ type: 'String', value: '状态' },
			{ type: 'String', value: '计价单位' },
			{ type: 'String', value: '默认单价' },
			{ type: 'String', value: '应收余额' },
			{ type: 'String', value: '预付余额' },
			{ type: 'String', value: '净额' },
			{ type: 'String', value: '存瓶数' },
			{ type: 'String', value: '存瓶号' },
			{ type: 'String', value: '更新时间' }
		]
	]

	source.forEach((row) => {
		rows.push([
			{ type: 'String', value: normalizeString(row?.name) },
			{ type: 'String', value: normalizeString(row?.contact) },
			{ type: 'String', value: normalizeString(row?.phone) },
			{ type: 'String', value: row?.is_active ? '启用中' : '已停用' },
			{ type: 'String', value: normalizeString(row?.default_price_unit) || 'kg' },
			{ type: 'Number', value: row?.default_unit_price == null ? NaN : toNumber(row?.default_unit_price, NaN) },
			{ type: 'Number', value: toNumber(row?.receivable_balance, 0) },
			{ type: 'Number', value: toNumber(row?.prepay_balance, 0) },
			{ type: 'Number', value: toNumber(row?.net_balance, 0) },
			{ type: 'Number', value: toNumber(row?.deposit_count, 0) },
			{ type: 'String', value: Array.isArray(row?.deposit_bottle_nos) ? row.deposit_bottle_nos.join('、') : '' },
			{ type: 'String', value: formatDateTime(row?.updated_at) }
		])
	})
	return rows
}

function buildCustomerStatementDetailRows(payload = {}) {
	const customerName = normalizeString(payload?.customer?.name) || '客户'
	const periodFrom = normalizeString(payload?.period?.date_from || payload?.period?.dateFrom)
	const periodTo = normalizeString(payload?.period?.date_to || payload?.period?.dateTo)
	const openingBalance = fix2(payload?.opening_balance)
	const openingRounding = fix2(payload?.opening_rounding)
	const closingBalance = fix2(payload?.closing_balance)
	const totals = payload?.totals || {}
	const rows = Array.isArray(payload?.rows) ? payload.rows : []

	const result = [
		[{ type: 'String', value: `${customerName} 明细账` }],
		[{ type: 'String', value: `区间：${periodFrom || '-'} ~ ${periodTo || '-'}` }],
		[{ type: 'String', value: '' }],
		[
			{ type: 'String', value: '日期' },
			{ type: 'String', value: '重量(kg)' },
			{ type: 'String', value: '单价(元/kg)' },
			{ type: 'String', value: '应收(元)' },
			{ type: 'String', value: '收款(元)' },
			{ type: 'String', value: '抹零(元)' },
			{ type: 'String', value: '余额(元)' },
			{ type: 'String', value: '备注' }
		],
		[
			{ type: 'String', value: '期初余额' },
			{ type: 'String', value: '/' },
			{ type: 'String', value: '/' },
			{ type: 'String', value: '' },
			{ type: 'String', value: '' },
			{ type: 'Number', value: openingRounding },
			{ type: 'Number', value: openingBalance },
			{ type: 'String', value: '' }
		]
	]

	rows.forEach((row) => {
		const weightValue = row?.weight_kg == null || row?.weight_kg === '' ? '/' : fix2(row?.weight_kg)
		const unitPriceValue = row?.unit_price == null || row?.unit_price === '' ? '/' : fix2(row?.unit_price)
		result.push([
			{ type: 'String', value: normalizeString(row?.biz_date) },
			typeof weightValue === 'number' ? { type: 'Number', value: weightValue } : { type: 'String', value: weightValue },
			typeof unitPriceValue === 'number' ? { type: 'Number', value: unitPriceValue } : { type: 'String', value: unitPriceValue },
			{ type: 'Number', value: fix2(row?.amount) },
			{ type: 'Number', value: fix2(row?.receipt) },
			{ type: 'Number', value: fix2(row?.rounding) },
			{ type: 'Number', value: fix2(row?.balance) },
			{ type: 'String', value: normalizeString(row?.note) }
		])
	})

	result.push([
		{ type: 'String', value: '合计' },
		{ type: 'Number', value: fix2(totals?.weight_kg) },
		{ type: 'String', value: '/' },
		{ type: 'Number', value: fix2(totals?.amount) },
		{ type: 'Number', value: fix2(totals?.receipt) },
		{ type: 'Number', value: fix2(totals?.rounding) },
		{ type: 'Number', value: closingBalance },
		{ type: 'String', value: '' }
	])
	return result
}

function buildStatementErrorRows(payload = {}) {
	const source = Array.isArray(payload?.statementSheetErrors) ? payload.statementSheetErrors : []
	const rows = [
		[
			{ type: 'String', value: '客户ID' },
			{ type: 'String', value: '客户名称' },
			{ type: 'String', value: '失败原因' }
		]
	]
	source.forEach((item) => {
		rows.push([
			{ type: 'String', value: normalizeString(item?.customer_id) },
			{ type: 'String', value: normalizeString(item?.customer_name) },
			{ type: 'String', value: normalizeString(item?.msg) || '未知错误' }
		])
	})
	return rows
}

export function buildCustomerListWorkbookXml(payload = {}) {
	const sheets = []
	const usedSheetNames = new Set()
	const pushSheet = (name, rows) => {
		const uniqueName = buildUniqueSheetName(name, usedSheetNames)
		sheets.push(buildWorksheetXml(uniqueName, rows))
	}
	pushSheet('总览汇总', buildOverviewRows(payload))
	pushSheet('客户明细', buildDetailRows(payload))
	const statementSheets = Array.isArray(payload?.statementSheets) ? payload.statementSheets : []
	statementSheets.forEach((sheet, index) => {
		const customerName = normalizeString(sheet?.customer?.name) || `客户${index + 1}`
		pushSheet(`明细账-${customerName}`, buildCustomerStatementDetailRows(sheet))
	})
	const statementSheetErrors = Array.isArray(payload?.statementSheetErrors) ? payload.statementSheetErrors : []
	if (statementSheetErrors.length) {
		pushSheet('明细失败', buildStatementErrorRows({ statementSheetErrors }))
	}
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

export function buildCustomerListExportFileName(payload = {}) {
	const keyword = sanitizeFilePart(payload?.filters?.keyword || '')
	const activeLabel = sanitizeFilePart(payload?.filters?.activeLabel || '全部状态')
	const balanceLabel = sanitizeFilePart(payload?.filters?.balanceLabel || '全部余额')
	const updatedDateRangeLabel = sanitizeFilePart(payload?.filters?.updatedDateRangeLabel || '全部时间')
	const cashierUnallocatedLabel = sanitizeFilePart(payload?.filters?.cashierUnallocatedLabel || '全部客户')
	const cashierDateRangeLabel = sanitizeFilePart(payload?.filters?.cashierDateRangeLabel || '全部时间')
	const statementDateStart = sanitizeFilePart(payload?.filters?.statementDateStart || '起')
	const statementDateEnd = sanitizeFilePart(payload?.filters?.statementDateEnd || '止')
	const parts = ['客户列表导出']
	if (keyword) parts.push(`关键词-${keyword}`)
	parts.push(`状态-${activeLabel || '全部状态'}`)
	parts.push(`余额-${balanceLabel || '全部余额'}`)
	parts.push(`时间-${updatedDateRangeLabel || '全部时间'}`)
	parts.push(`出纳未分配-${cashierUnallocatedLabel || '全部客户'}`)
	parts.push(`出纳日期-${cashierDateRangeLabel || '全部时间'}`)
	parts.push(`明细区间-${statementDateStart}_${statementDateEnd}`)
	parts.push(formatNowForFile())
	return `${parts.join('_')}.xls`
}
