function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNumber(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function paymentStatusText(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'paid' || text === '已结清') return '已结清'
	if (text === 'partial' || text === '部分付') return '部分付'
	if (text === 'unpaid' || text === '未付款') return '未付款'
	return normalizeString(value) || '-'
}

const REPORT_SCOPE_NOTE = '本表按销售业务日期列示有效销售单，不含另行登记的流量结算货款；流量客户送气不重复计货款。'
const SETTLEMENT_NOTE = '已抵货款为当前原单核销，含非现金抵款；负数表示原单退款或冲回。销售抹零、收款抹零单列，均不代表期间现金收入。'
const BALANCE_NOTE = '账面待结净额直接采用后端结果，负数表示待退或待抵余额；已计入退气转抵款处理，不是历史日末余额，不能跨客户相抵作为客户欠款合计。'

function requiredNumber(value, label) {
	if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value))) {
		throw new Error(`${label}尚未取得权威数值，暂不能导出`)
	}
	return Number(value)
}

function normalizeExportSales(rows) {
	const ids = new Set()
	return rows.map(row => {
		const id = normalizeString(row?._id || row?.id), customerId = normalizeString(row?.customer_id)
		if (!id || ids.has(id) || !customerId || row.status === 'void' || row.accounting?.status !== 'resolved' || row.accounting?.complete === false) {
			throw new Error('销售来源、客户归属或账务状态未核实，暂不能导出')
		}
		ids.add(id)
		return { ...row, _id: id, customer_id: customerId, report_values: {
			weight: requiredNumber(row.operating_weight_kg, '销售净气量'),
			principal: requiredNumber(row.should_receive, '货款'),
			allocated: requiredNumber(row.amount_received, '已抵货款'),
			saleRounding: requiredNumber(row.rounding_amount, '销售抹零'),
			receiptRounding: requiredNumber(row.receipt_rounding_amount ?? 0, '收款抹零'),
			outstanding: requiredNumber(row.net_outstanding_effective, '账面待结净额')
		} }
	})
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
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function numberCell(value, digits = null) {
	const num = requiredNumber(value, '导出数据')
	const finalNum = digits != null && Number.isInteger(digits) ? Number(num.toFixed(digits)) : num
	return {
		__cell_type: 'Number',
		value: finalNum,
		digits
	}
}

function buildCellXml(cell = '') {
	if (cell && typeof cell === 'object' && cell.__cell_type === 'Number') {
		const style = cell.digits === 3 ? ' ss:StyleID="Decimal3"' : cell.digits === 0 ? ' ss:StyleID="Integer"' : ''
		return `<Cell${style}><Data ss:Type="Number">${escapeXml(cell.value)}</Data></Cell>`
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
	rows.push([REPORT_SCOPE_NOTE])
	rows.push([SETTLEMENT_NOTE])
	rows.push([BALANCE_NOTE])
	rows.push(['钢瓶充装瓶次', '钢瓶充装重量(kg)', '地方车充装次数', '地方车充装重量(kg)', '车辆燃气补给次数', '车辆燃气补给重量(kg)', '成交客户户次（每日去重后相加）', '销售瓶数', '销售净气量(kg)', '其他出罐次数', '其他出罐重量(kg)'])
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
			acc.otherCount += toNumber(row.otherCount, 0)
			acc.otherWeightKg += toNumber(row.otherWeightKg, 0)
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
			saleWeightKg: 0, otherCount: 0, otherWeightKg: 0
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
		numberCell(total.saleWeightKg, 3),
		numberCell(total.otherCount, 0),
		numberCell(total.otherWeightKg, 3)
	])
	return rows
}

function unitPriceCell(row) {
	return row.unit_price == null || row.unit_price === '' ? '-' : numberCell(requiredNumber(row.unit_price, '单价'))
}

function newTotals() {
	return { orderCount: 0, weight: 0, principal: 0, allocated: 0, saleRounding: 0, receiptRounding: 0, outstanding: 0 }
}
function addTotals(total, row) {
	total.orderCount += 1
	for (const field of ['weight', 'principal', 'allocated', 'saleRounding', 'receiptRounding', 'outstanding']) {
		const units = Math.round(row.report_values[field] * 1000)
		if (!Number.isSafeInteger(units) || !Number.isSafeInteger(total[field] + units)) throw new Error('导出合计超出安全范围')
		total[field] += units
	}
}
function totalCells(label, total) {
	return [label, `共${total.orderCount}单`, numberCell(total.weight / 1000, 3), '', '',
		numberCell(total.principal / 1000, 3), '', numberCell(total.allocated / 1000, 3),
		numberCell(total.saleRounding / 1000, 3), numberCell(total.receiptRounding / 1000, 3),
		numberCell(total.outstanding / 1000, 3), '', '']
}
function buildDailyDetailRows({ salesRows = [], periodLabel = '' } = {}) {
	const rows = [], groupMap = new Map(), allTotals = newTotals()
	for (const row of sortRowsForExport(salesRows)) {
		const date = normalizeString(row.date) || '-'
		if (!groupMap.has(date)) groupMap.set(date, [])
		groupMap.get(date).push(row)
	}
	rows.push(['无极新拓能源销售出库单'], [`导出范围：${periodLabel || '-'}`],
		[REPORT_SCOPE_NOTE], [SETTLEMENT_NOTE], [BALANCE_NOTE], [])
	if (!groupMap.size) { rows.push(['无销售记录']); return rows }
	for (const [date, list] of groupMap) {
		const dayTotals = newTotals()
		rows.push([`日期：${formatDateToCn(date)}`])
		rows.push(['序号', '客户名称', '销售净气量(kg)', '计价单位', '单价', '货款(元)', '原单付款状态',
			'已抵货款(元)', '销售抹零(元)', '收款抹零(元)', '账面待结净额(元)', '来源单号', '备注'])
		list.forEach((row, index) => {
			const value = row.report_values
			addTotals(dayTotals, row); addTotals(allTotals, row)
			rows.push([numberCell(index + 1, 0), normalizeString(row.customer_name) || '-', numberCell(value.weight, 3),
				normalizeString(row.price_unit) || '-', unitPriceCell(row), numberCell(value.principal, 3),
				paymentStatusText(row.payment_status), numberCell(value.allocated, 3), numberCell(value.saleRounding, 3),
				numberCell(value.receiptRounding, 3), numberCell(value.outstanding, 3), row._id, buildRemarkText(row)])
		})
		rows.push(totalCells('当日汇总', dayTotals), [])
	}
	if (groupMap.size > 1) rows.push(totalCells('期间总汇总', allTotals))
	return rows
}

function buildCustomerSheetRows({ customerId = '', customerName = '', rows = [], periodLabel = '' } = {}) {
	const result = [[`${normalizeString(customerName) || '未命名客户'} 销售详单`],
		[`客户ID：${customerId || '-'}；导出范围：${periodLabel || '-'}`], [REPORT_SCOPE_NOTE], [SETTLEMENT_NOTE], [BALANCE_NOTE],
		['日期', '业务模式', '计价单位', '销售净气量(kg)', '单价', '货款(元)', '已抵货款(元)',
			'销售抹零(元)', '收款抹零(元)', '账面待结净额(元)', '来源单号', '业务备注', '系统备注', '收款备注']]
	for (const row of sortRowsForExport(rows)) {
		const value = row.report_values
		result.push([normalizeString(row.date), bizModeText(row.biz_mode), normalizeString(row.price_unit) || '-',
			numberCell(value.weight, 3), unitPriceCell(row), numberCell(value.principal, 3), numberCell(value.allocated, 3),
			numberCell(value.saleRounding, 3), numberCell(value.receiptRounding, 3), numberCell(value.outstanding, 3),
			row._id, normalizeString(row.remark), normalizeString(row.system_note), normalizeString(row.payment_note)])
	}
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

function validateWeightAgreement(summaryRows, salesRows) {
	const expected = new Map(), actual = new Map()
	const fields = ['fillBottleCount', 'fillBottleWeightKg', 'localCount', 'localWeightKg', 'vehicleCount',
		'vehicleWeightKg', 'saleCustomerCount', 'saleBottleCount', 'saleWeightKg', 'otherCount', 'otherWeightKg']
	for (const row of summaryRows) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || expected.has(row.date)) throw new Error('日报日期范围不完整或重复，暂不能导出')
		for (const key of fields) requiredNumber(row[key], '日报汇总')
		expected.set(row.date, Math.round(row.saleWeightKg * 1000))
	}
	for (const row of salesRows) {
		if (!expected.has(row.date)) throw new Error('销售明细不在日报范围内，暂不能导出')
		const total = (actual.get(row.date) || 0) + Math.round(row.report_values.weight * 1000)
		if (!Number.isSafeInteger(total)) throw new Error('销售净气量合计超出安全范围')
		actual.set(row.date, total)
	}
	for (const [date, weight] of expected) if (weight !== (actual.get(date) || 0)) throw new Error('销售明细与日报净气量不一致，暂不能导出')
}

export function buildDailyReportWorkbookXml(payload = {}) {
	const summaryRows = Array.isArray(payload.summaryRows) ? payload.summaryRows : []
	const salesRows = normalizeExportSales(Array.isArray(payload.salesRows) ? payload.salesRows : [])
	validateWeightAgreement(summaryRows, salesRows)
	const periodLabel = normalizeString(payload.periodLabel)
	const usedNames = new Set()
	const sheets = []

	const summarySheetName = ensureUniqueSheetName('总览汇总', usedNames)
	sheets.push(buildWorksheetXml(summarySheetName, buildSummarySheetRows({ summaryRows, periodLabel })))

	const dailySheetName = ensureUniqueSheetName('按日分项', usedNames)
	sheets.push(buildWorksheetXml(dailySheetName, buildDailyDetailRows({ salesRows, periodLabel })))

	const customerMap = new Map()
	salesRows.forEach((row) => {
		const customerId = row.customer_id
		const customerName = normalizeString(row.customer_name) || '未命名客户'
		if (!customerMap.has(customerId)) customerMap.set(customerId, { name: customerName, rows: [] })
		customerMap.get(customerId).rows.push(row)
	})
	if (!customerMap.size) customerMap.set('', { name: '未命名客户', rows: [] })
	const nameCounts = new Map()
	for (const { name } of customerMap.values()) nameCounts.set(name, (nameCounts.get(name) || 0) + 1)
	Array.from(customerMap.entries()).forEach(([customerId, { name: customerName, rows }]) => {
		const name = nameCounts.get(customerName) > 1 ? `${customerName} ${customerId.slice(-8)}` : customerName
		const sheetName = ensureUniqueSheetName(name, usedNames)
		sheets.push(buildWorksheetXml(sheetName, buildCustomerSheetRows({ customerId, customerName, rows, periodLabel })))
	})

	return [
		'<?xml version="1.0"?>',
		'<?mso-application progid="Excel.Sheet"?>',
		'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:o="urn:schemas-microsoft-com:office:office"',
		' xmlns:x="urn:schemas-microsoft-com:office:excel"',
		' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
		' xmlns:html="http://www.w3.org/TR/REC-html40">',
		'<Styles><Style ss:ID="Decimal3"><NumberFormat ss:Format="0.000"/></Style><Style ss:ID="Integer"><NumberFormat ss:Format="0"/></Style></Styles>',
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
