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

function formatMoney(value) {
	return fix2(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

function buildCellXml(value = '') {
	return `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`
}

function buildRowXml(values = []) {
	const cells = values.map((value) => buildCellXml(value)).join('')
	return `<Row>${cells}</Row>`
}

function formatNullableValue(value, { slashWhenEmpty = false } = {}) {
	if (value == null || value === '') return slashWhenEmpty ? '/' : ''
	return formatMoney(value)
}

function buildStatementRows(payload = {}) {
	const companyName = normalizeString(payload.company_name) || '新拓能源'
	const customerName = normalizeString(payload?.customer?.name) || '-'
	const contact = normalizeString(payload?.customer?.contact)
	const phone = normalizeString(payload?.customer?.phone)
	const periodFrom = normalizeString(payload?.period?.date_from)
	const periodTo = normalizeString(payload?.period?.date_to)
	const openingBalance = fix2(payload.opening_balance)
	const closingBalance = fix2(payload.closing_balance)
	const dataRows = Array.isArray(payload.rows) ? payload.rows : []
	const totals = payload.totals || {}
	const totalWeight = toNumber(totals.weight_kg, 0)
	const totalAmount = toNumber(totals.amount, 0)
	const totalReceipt = toNumber(totals.receipt, 0)

	const result = []
	result.push([`${companyName}对账单`, '', '', '', '', '', ''])
	result.push([`客户：${customerName}${contact || phone ? `（${[contact, phone].filter(Boolean).join(' / ')}）` : ''}`, '', '', '', '', '', ''])
	result.push([`（${periodFrom || '-'} - ${periodTo || '-'}）`, '', '', '', '', '', ''])
	result.push(['', '', '', '', '', '', ''])
	result.push(['日期', '重量（公斤）', '单价（元/公斤）', '金额（元）', '收款（元）', '欠款（元）', '备注'])
	result.push(['期初余额', '/', '/', '', '', formatMoney(openingBalance), ''])

	dataRows.forEach((row) => {
		result.push([
			normalizeString(row.biz_date),
			formatNullableValue(row.weight_kg, { slashWhenEmpty: true }),
			formatNullableValue(row.unit_price, { slashWhenEmpty: true }),
			formatNullableValue(row.amount),
			formatNullableValue(row.receipt),
			formatNullableValue(row.balance),
			normalizeString(row.note)
		])
	})

	result.push([
		'合计',
		totalWeight > 0 ? formatMoney(totalWeight) : '/',
		'/',
		formatMoney(totalAmount),
		formatMoney(totalReceipt),
		formatMoney(closingBalance),
		''
	])

	return result
}

export function buildCustomerStatementWorkbookXml(payload = {}) {
	const rows = buildStatementRows(payload).map((row) => buildRowXml(row)).join('')
	return [
		'<?xml version="1.0"?>',
		'<?mso-application progid="Excel.Sheet"?>',
		'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:o="urn:schemas-microsoft-com:office:office"',
		' xmlns:x="urn:schemas-microsoft-com:office:excel"',
		' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:html="http://www.w3.org/TR/REC-html40">',
		`<Worksheet ss:Name="${escapeXml('客户对账单')}"><Table>${rows}</Table></Worksheet>`,
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
