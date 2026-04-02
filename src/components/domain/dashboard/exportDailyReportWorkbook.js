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

function fix3(value) {
	return Number(toNumber(value, 0).toFixed(3))
}

function paymentStatusText(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'paid' || text === '已结清') return '已结清'
	if (text === 'partial' || text === '部分付') return '部分付'
	if (text === 'unpaid' || text === '未付款') return '未付款'
	return normalizeString(value) || '-'
}

function resolveEffectiveShouldReceive(shouldReceive, roundingAmount = 0) {
	const should = toNumber(shouldReceive, 0)
	const rounding = Math.max(toNumber(roundingAmount, 0), 0)
	if (should > 0) return Number((should - rounding).toFixed(2))
	if (should < 0) return Number((should + rounding).toFixed(2))
	return 0
}

function bizModeText(value) {
	const map = {
		bottle: '瓶装',
		truck: '整车',
		agent_sale: '代理出站'
	}
	return map[normalizeString(value)] || normalizeString(value) || '-'
}

function escapeXml(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function numberCell(value, digits = null) {
	const num = toNumber(value, 0)
	const finalNum = Number.isFinite(Number(digits)) ? Number(num.toFixed(Number(digits))) : num
	return {
		__cell_type: 'Number',
		value: finalNum
	}
}

function buildCellXml(cell = '') {
	if (cell && typeof cell === 'object' && cell.__cell_type === 'Number') {
		return `<Cell><Data ss:Type="Number">${escapeXml(cell.value)}</Data></Cell>`
	}
	return `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`
}

function buildRowXml(values = []) {
	return `<Row>${values.map((value) => buildCellXml(value)).join('')}</Row>`
}

function sanitizeSheetName(value) {
	const raw = normalizeString(value) || 'Sheet'
	const cleaned = raw.replace(/[\\/:*?\[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet'
	return cleaned.slice(0, 31)
}

function ensureUniqueSheetName(baseName, used) {
	let name = sanitizeSheetName(baseName)
	if (!used.has(name)) {
		used.add(name)
		return name
	}
	let index = 2
	while (index < 999) {
		const suffix = `_${index}`
		const head = name.slice(0, Math.max(0, 31 - suffix.length)).trim() || 'Sheet'
		const candidate = `${head}${suffix}`
		if (!used.has(candidate)) {
			used.add(candidate)
			return candidate
		}
		index += 1
	}
	const fallback = `Sheet_${Date.now().toString().slice(-6)}`
	used.add(fallback)
	return fallback
}

function formatDateToCn(value) {
	const text = normalizeString(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || '-'
	const [y, m, d] = text.split('-')
	return `${Number(y)}年${Number(m)}月${Number(d)}日`
}

function buildRemarkText(row = {}) {
	const business = normalizeString(row.remark)
	const system = normalizeString(row.system_note)
	const payment = normalizeString(row.payment_note)
	const parts = []
	if (business) parts.push(`业务:${business}`)
	if (system) parts.push(`系统:${system}`)
	if (payment) parts.push(`收款:${payment}`)
	return parts.join('；')
}

function toKgDisplay(row = {}) {
	const num = Number(row.total_net_weight)
	if (!Number.isFinite(num)) return 0
	return fix3(num)
}

function sortRowsForExport(rows = []) {
	return [...rows].sort((a, b) => {
		const dateA = normalizeString(a?.date)
		const dateB = normalizeString(b?.date)
		if (dateA !== dateB) return dateA < dateB ? 1 : -1
		const createdA = Number(a?.created_at || 0)
		const createdB = Number(b?.created_at || 0)
		if (createdA !== createdB) return createdA < createdB ? 1 : -1
		const idA = normalizeString(a?._id)
		const idB = normalizeString(b?._id)
		if (idA !== idB) return idA < idB ? 1 : -1
		return 0
	})
}

function buildSummarySheetRows({ summaryRows = [], periodLabel = '' } = {}) {
	const rows = []
	rows.push([`业务日报汇总（${periodLabel || '-' }）`])
	rows.push(['充装瓶数', '充装重量(kg)', '地方车次', '地方车重(kg)', '车辆次', '车辆重(kg)', '客户数', '销售瓶数', '销售重量(kg)'])
	const source = Array.isArray(summaryRows) ? summaryRows : []
	const total = source.reduce(
		(acc, row) => {
			acc.fillBottleCount += Number(row.fillBottleCount || 0)
			acc.fillBottleWeightKg += toNumber(row.fillBottleWeightKg, 0)
			acc.localCount += Number(row.localCount || 0)
			acc.localWeightKg += toNumber(row.localWeightKg, 0)
			acc.vehicleCount += Number(row.vehicleCount || 0)
			acc.vehicleWeightKg += toNumber(row.vehicleWeightKg, 0)
			acc.saleCustomerCount += Number(row.saleCustomerCount || 0)
			acc.saleBottleCount += Number(row.saleBottleCount || 0)
			acc.saleWeightKg += toNumber(row.saleWeightKg, 0)
			return acc
		},
		{
			fillBottleCount: 0,
			fillBottleWeightKg: 0,
			localCount: 0,
			localWeightKg: 0,
			vehicleCount: 0,
			vehicleWeightKg: 0,
			saleCustomerCount: 0,
			saleBottleCount: 0,
			saleWeightKg: 0
		}
	)
	rows.push([
		numberCell(total.fillBottleCount, 0),
		numberCell(total.fillBottleWeightKg, 3),
		numberCell(total.localCount, 0),
		numberCell(total.localWeightKg, 3),
		numberCell(total.vehicleCount, 0),
		numberCell(total.vehicleWeightKg, 3),
		numberCell(total.saleCustomerCount, 0),
		numberCell(total.saleBottleCount, 0),
		numberCell(total.saleWeightKg, 3)
	])
	return rows
}

function buildDailyDetailRows({ salesRows = [], periodLabel = '' } = {}) {
	const rows = []
	const sorted = sortRowsForExport(salesRows)
	const groupMap = new Map()
	sorted.forEach((row) => {
		const date = normalizeString(row.date) || '-'
		if (!groupMap.has(date)) groupMap.set(date, [])
		groupMap.get(date).push(row)
	})
	rows.push(['无极新拓能源销售出库单'])
	rows.push([`导出范围：${periodLabel || '-'}`])
	rows.push([])
	if (!groupMap.size) {
		rows.push(['无销售记录'])
		return rows
	}
	const allTotals = {
		orderCount: 0,
		quantityKg: 0,
		amount: 0,
		paid: 0,
		unpaid: 0
	}
	const dates = Array.from(groupMap.keys())
	dates.forEach((date) => {
		const list = groupMap.get(date) || []
		const dayTotals = {
			orderCount: 0,
			quantityKg: 0,
			amount: 0,
			paid: 0,
			unpaid: 0
		}
		rows.push([`日期：${formatDateToCn(date)}`])
		rows.push(['序号', '客户名称', '数量kg', '单价', '金额', '付款状态', '已付', '未付', '备注'])
		list.forEach((row, index) => {
			const shouldReceive = toNumber(row.should_receive, 0)
			const amountReceived = toNumber(row.amount_received, 0)
			const roundingAmount = toNumber(row.rounding_amount, 0)
			const effectiveShouldReceive = resolveEffectiveShouldReceive(shouldReceive, roundingAmount)
			const outstanding = Number((effectiveShouldReceive - amountReceived).toFixed(2))
			const quantityKg = toKgDisplay(row)
			dayTotals.orderCount += 1
			dayTotals.quantityKg += quantityKg
			dayTotals.amount += shouldReceive
			dayTotals.paid += amountReceived
			dayTotals.unpaid += outstanding
			rows.push([
				numberCell(index + 1, 0),
				normalizeString(row.customer_name) || '-',
				numberCell(quantityKg, 3),
				numberCell(row.unit_price, 3),
				numberCell(row.should_receive, 2),
				paymentStatusText(row.payment_status),
				numberCell(amountReceived, 2),
				numberCell(outstanding, 2),
				buildRemarkText(row)
			])
		})
		rows.push([
			'当日汇总',
			`共${dayTotals.orderCount}单`,
			numberCell(dayTotals.quantityKg, 3),
			'',
			numberCell(dayTotals.amount, 2),
			'',
			numberCell(dayTotals.paid, 2),
			numberCell(dayTotals.unpaid, 2),
			''
		])
		allTotals.orderCount += dayTotals.orderCount
		allTotals.quantityKg += dayTotals.quantityKg
		allTotals.amount += dayTotals.amount
		allTotals.paid += dayTotals.paid
		allTotals.unpaid += dayTotals.unpaid
		rows.push([])
	})
	if (dates.length > 1) {
		rows.push([
			'期间总汇总',
			`共${allTotals.orderCount}单`,
			numberCell(allTotals.quantityKg, 3),
			'',
			numberCell(allTotals.amount, 2),
			'',
			numberCell(allTotals.paid, 2),
			numberCell(allTotals.unpaid, 2),
			''
		])
	}
	return rows
}

function buildCustomerSheetRows({ customerName = '', rows = [], periodLabel = '' } = {}) {
	const result = []
	result.push([`${normalizeString(customerName) || '未命名客户'} 销售详单`])
	result.push([`导出范围：${periodLabel || '-'}`])
	result.push(['日期', '业务模式', '计价单位', '数量kg', '单价', '金额', '实收', '未收', '业务备注', '系统备注', '收款备注'])
	sortRowsForExport(rows).forEach((row) => {
		const shouldReceive = toNumber(row.should_receive, 0)
		const amountReceived = toNumber(row.amount_received, 0)
		const roundingAmount = toNumber(row.rounding_amount, 0)
		const effectiveShouldReceive = resolveEffectiveShouldReceive(shouldReceive, roundingAmount)
		const outstanding = Number((effectiveShouldReceive - amountReceived).toFixed(2))
		result.push([
			normalizeString(row.date),
			bizModeText(row.biz_mode),
			normalizeString(row.price_unit) || '-',
			numberCell(toKgDisplay(row), 3),
			numberCell(row.unit_price, 3),
			numberCell(row.should_receive, 2),
			numberCell(row.amount_received, 2),
			numberCell(outstanding, 2),
			normalizeString(row.remark),
			normalizeString(row.system_note),
			normalizeString(row.payment_note)
		])
	})
	if (!rows.length) result.push(['无销售记录'])
	return result
}

function buildWorksheetXml(name, rows) {
	const rowXml = (Array.isArray(rows) ? rows : []).map((row) => buildRowXml(Array.isArray(row) ? row : [row])).join('')
	return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${rowXml}</Table></Worksheet>`
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
	return new Promise((resolve) => {
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

export function buildDailyReportWorkbookXml(payload = {}) {
	const summaryRows = Array.isArray(payload.summaryRows) ? payload.summaryRows : []
	const salesRows = Array.isArray(payload.salesRows) ? payload.salesRows : []
	const periodLabel = normalizeString(payload.periodLabel)
	const usedNames = new Set()
	const sheets = []

	const summarySheetName = ensureUniqueSheetName('总览汇总', usedNames)
	sheets.push(buildWorksheetXml(summarySheetName, buildSummarySheetRows({ summaryRows, periodLabel })))

	const dailySheetName = ensureUniqueSheetName('按日分项', usedNames)
	sheets.push(buildWorksheetXml(dailySheetName, buildDailyDetailRows({ salesRows, periodLabel })))

	const customerMap = new Map()
	salesRows.forEach((row) => {
		const customerName = normalizeString(row.customer_name) || '未命名客户'
		if (!customerMap.has(customerName)) customerMap.set(customerName, [])
		customerMap.get(customerName).push(row)
	})
	if (!customerMap.size) customerMap.set('未命名客户', [])
	Array.from(customerMap.entries()).forEach(([customerName, rows]) => {
		const sheetName = ensureUniqueSheetName(customerName, usedNames)
		sheets.push(buildWorksheetXml(sheetName, buildCustomerSheetRows({ customerName, rows, periodLabel })))
	})

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

export function buildDailyReportExportFileName(payload = {}) {
	const start = sanitizeFilePart(payload.dateStart || '起')
	const end = sanitizeFilePart(payload.dateEnd || '止')
	return `业务日报_${start}_${end}_${formatNowForFile()}.xls`
}

export function downloadWorkbookOnH5(workbookText, fileName) {
	if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Blob === 'undefined') return false
	const blob = new Blob([`\uFEFF${workbookText || ''}`], { type: 'application/vnd.ms-excel;charset=utf-8;' })
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

async function downloadWorkbookOnUni(workbookText, fileName) {
	if (typeof uni === 'undefined') return false
	if (typeof uni.getFileSystemManager !== 'function') return false
	const userPath = normalizeString(uni?.env?.USER_DATA_PATH)
	if (!userPath) return false
	const fs = uni.getFileSystemManager()
	if (!fs || typeof fs.writeFile !== 'function') return false
	const safeFileName = sanitizeFilePart(fileName || '业务日报.xls') || '业务日报.xls'
	const finalName = safeFileName.endsWith('.xls') ? safeFileName : `${safeFileName}.xls`
	const tempPath = `${userPath}/${finalName}`
	try {
		const text = `\uFEFF${workbookText || ''}`
		const writtenPath = await writeUniFile(fs, tempPath, text)
		const savedPath = await saveUniFile(writtenPath)
		const opened = await openUniDocument(savedPath)
		return Boolean(opened)
	} catch (err) {
		console.error('[dashboard] downloadWorkbookOnUni failed', err)
		return false
	}
}

export async function downloadWorkbookFile(workbookText, fileName) {
	if (downloadWorkbookOnH5(workbookText, fileName)) return true
	return downloadWorkbookOnUni(workbookText, fileName)
}
