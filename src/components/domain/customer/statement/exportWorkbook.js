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

function buildStatementSheetRows(payload = {}) {
	const companyName = normalizeString(payload.company_name) || '新拓能源'
	const customerName = normalizeString(payload?.customer?.name) || '-'
	const contact = normalizeString(payload?.customer?.contact)
	const phone = normalizeString(payload?.customer?.phone)
	const periodFrom = normalizeString(payload?.period?.date_from)
	const periodTo = normalizeString(payload?.period?.date_to)
	const openingBalance = fix2(payload.opening_balance)
	const openingRounding = fix2(payload.opening_rounding)
	const closingBalance = fix2(payload.closing_balance)
	const dataRows = Array.isArray(payload.rows) ? payload.rows : []
	const totals = payload.totals || {}
	const totalWeight = toNumber(totals.weight_kg, 0)
	const totalAmount = toNumber(totals.amount, 0)
	const totalReceipt = toNumber(totals.receipt, 0)
	const totalRounding = toNumber(totals.rounding, 0)

	const result = []
	result.push([{ type: 'String', value: `${companyName}对账单` }])
	result.push([{ type: 'String', value: `客户：${customerName}${contact || phone ? `（${[contact, phone].filter(Boolean).join(' / ')}）` : ''}` }])
	result.push([{ type: 'String', value: `（${periodFrom || '-'} - ${periodTo || '-'}）` }])
	result.push([{ type: 'String', value: '' }])
	result.push([
		{ type: 'String', value: '日期' },
		{ type: 'String', value: '重量（公斤）' },
		{ type: 'String', value: '单价（元/公斤）' },
		{ type: 'String', value: '金额（元）' },
		{ type: 'String', value: '收款（元）' },
		{ type: 'String', value: '抹零（元）' },
		{ type: 'String', value: '欠款（元）' },
		{ type: 'String', value: '备注' }
	])
	result.push([
		{ type: 'String', value: '期初余额' },
		{ type: 'String', value: '/' },
		{ type: 'String', value: '/' },
		{ type: 'String', value: '' },
		{ type: 'String', value: '' },
		openingRounding > 0 ? moneyCell(openingRounding) : { type: 'String', value: '' },
		moneyCell(openingBalance),
		{ type: 'String', value: '' }
	])

	dataRows.forEach((row) => {
		result.push([
			{ type: 'String', value: normalizeString(row.biz_date) },
			numberOrSlashCell(row.weight_kg),
			numberOrSlashCell(row.unit_price),
			moneyCell(row.amount),
			moneyCell(row.receipt),
			moneyCell(row.rounding),
			moneyCell(row.balance),
			{ type: 'String', value: normalizeString(row.note) }
		])
	})

	result.push([
		{ type: 'String', value: '合计' },
		totalWeight > 0 ? moneyCell(totalWeight) : { type: 'String', value: '/' },
		{ type: 'String', value: '/' },
		moneyCell(totalAmount),
		moneyCell(totalReceipt),
		moneyCell(totalRounding),
		moneyCell(closingBalance),
		{ type: 'String', value: '' }
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

export function buildCustomerAccountingLedgerWorkbookXml(payload = {}) {
	return buildWorkbookXml([
		buildWorksheetXml('会计明细账', buildAccountingLedgerSheetRows(payload))
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
		buildWorksheetXml('销售明细', buildSaleDetailSheetRows(payload))
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
