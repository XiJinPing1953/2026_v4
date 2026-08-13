'use strict'

const COMPANY_NAME = '无极县新拓能源开发有限公司'

function normalizeString(value) {
	return value == null ? '' : String(value).trim()
}

function formatDateTime(value) {
	const timestamp = Number(value)
	if (!Number.isFinite(timestamp) || timestamp <= 0) return '-'
	const date = new Date(timestamp + 8 * 60 * 60 * 1000)
	const text = date.toISOString().slice(0, 16).replace('T', ' ')
	return text
}

function locationText(capture = {}) {
	if (capture?.status !== 'ok') return '未取得定位'
	const latitude = Number(capture.latitude)
	const longitude = Number(capture.longitude)
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '未取得定位'
	const accuracy = Number(capture.accuracy)
	return `WGS84 纬度 ${latitude.toFixed(6)}，经度 ${longitude.toFixed(6)}${Number.isFinite(accuracy) ? `，精度约 ${Math.round(accuracy)} 米` : ''}`
}

function answerText(item = {}) {
	const answers = Array.isArray(item.answers) ? item.answers : []
	if (answers.length) {
		return answers
			.map((answer) => `${normalizeString(answer.check_label_snapshot) || '检查'}：${normalizeString(answer.option_label_snapshot) || '-'}`)
			.join('\n')
	}
	return normalizeString(item.option_label_snapshot || item.result_label_snapshot) || '-'
}

function resultText(item = {}) {
	if (item.is_not_applicable || item.result_code === 'not_applicable') return '不适用'
	return item.is_abnormal ? '不合格' : '合格'
}

function applyBorder(cell) {
	cell.border = {
		top: { style: 'thin', color: { argb: 'FF4B5563' } },
		left: { style: 'thin', color: { argb: 'FF4B5563' } },
		bottom: { style: 'thin', color: { argb: 'FF4B5563' } },
		right: { style: 'thin', color: { argb: 'FF4B5563' } }
	}
}

function styleRange(worksheet, startRow, endRow, startColumn = 1, endColumn = 8) {
	for (let row = startRow; row <= endRow; row += 1) {
		for (let column = startColumn; column <= endColumn; column += 1) {
			const cell = worksheet.getCell(row, column)
			applyBorder(cell)
			cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
			cell.font = { name: 'Microsoft YaHei', size: 10 }
		}
	}
}

function addEmbeddedImage(workbook, worksheet, media, options) {
	if (!media?.buffer) return false
	const imageId = workbook.addImage({
		buffer: media.buffer,
		extension: media.extension === 'png' ? 'png' : 'jpeg'
	})
	worksheet.addImage(imageId, {
		tl: { col: options.column - 1 + 0.08, row: options.row - 1 + 0.08 },
		ext: { width: options.width || 112, height: options.height || 86 },
		editAs: 'oneCell'
	})
	return true
}

async function buildInspectionWorkbookBuffer({ inspection, mediaByFileId = {} }) {
	const ExcelJS = require('exceljs')
	const workbook = new ExcelJS.Workbook()
	workbook.creator = COMPANY_NAME
	workbook.created = new Date()
	const worksheet = workbook.addWorksheet('安全检查表', {
		pageSetup: {
			paperSize: 9,
			orientation: 'landscape',
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
			margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
		}
	})
	worksheet.properties.defaultRowHeight = 22
	worksheet.columns = [
		{ width: 7 },
		{ width: 25 },
		{ width: 26 },
		{ width: 13 },
		{ width: 24 },
		{ width: 20 },
		{ width: 20 },
		{ width: 20 }
	]

	worksheet.mergeCells('A1:H1')
	worksheet.getCell('A1').value = COMPANY_NAME
	worksheet.getCell('A1').font = { name: 'Microsoft YaHei', size: 16, bold: true }
	worksheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
	worksheet.getRow(1).height = 28
	worksheet.mergeCells('A2:H2')
	worksheet.getCell('A2').value = '入户随瓶安全巡检表'
	worksheet.getCell('A2').font = { name: 'Microsoft YaHei', size: 20, bold: true }
	worksheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' }
	worksheet.getRow(2).height = 34

	worksheet.mergeCells('A3:B3')
	worksheet.getCell('A3').value = `巡检编号：${normalizeString(inspection.inspection_no) || '未编号'}`
	worksheet.mergeCells('C3:E3')
	worksheet.getCell('C3').value = `巡检时间：${formatDateTime(inspection.inspection_at)}`
	worksheet.mergeCells('F3:H3')
	worksheet.getCell('F3').value = `整单结果：${inspection.overall_result === 'abnormal' ? '有异常' : '正常'}`
	worksheet.mergeCells('A4:D4')
	worksheet.getCell('A4').value = `客户：${normalizeString(inspection.customer_name_snapshot) || '-'}`
	worksheet.mergeCells('E4:H4')
	worksheet.getCell('E4').value = `巡检员：${normalizeString(inspection.inspector_name) || '-'}`
	worksheet.mergeCells('A5:H5')
	worksheet.getCell('A5').value = `客户档案地址：${normalizeString(inspection.customer_address_snapshot) || '-'}`
	worksheet.mergeCells('A6:H6')
	worksheet.getCell('A6').value = `本单实际地点：${normalizeString(inspection.location_text) || '-'}`
	worksheet.mergeCells('A7:H7')
	worksheet.getCell('A7').value = `定位凭证：${locationText(inspection.location_capture)}`
	styleRange(worksheet, 3, 7)
	for (let row = 3; row <= 7; row += 1) {
		worksheet.getRow(row).height = 25
		for (let column = 1; column <= 8; column += 1) {
			worksheet.getCell(row, column).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
		}
	}

	const headerRow = 8
	const headers = ['序号', '检查项目', '检查内容与结果', '判定', '异常说明', '现场照片 1', '现场照片 2', '现场照片 3']
	headers.forEach((value, index) => {
		const cell = worksheet.getCell(headerRow, index + 1)
		cell.value = value
		cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEFEA' } }
		cell.font = { name: 'Microsoft YaHei', size: 10, bold: true }
	})
	worksheet.getRow(headerRow).height = 30
	styleRange(worksheet, headerRow, headerRow)

	const items = Array.isArray(inspection.items) ? inspection.items : []
	let missingFileCount = 0
	items.forEach((item, itemIndex) => {
		const rowNumber = headerRow + itemIndex + 1
		const row = worksheet.getRow(rowNumber)
		row.height = 88
		worksheet.getCell(rowNumber, 1).value = itemIndex + 1
		worksheet.getCell(rowNumber, 2).value = normalizeString(item.item_label_snapshot) || '-'
		worksheet.getCell(rowNumber, 3).value = answerText(item)
		worksheet.getCell(rowNumber, 4).value = resultText(item)
		worksheet.getCell(rowNumber, 5).value = normalizeString(item.issue_note) || '-'
		styleRange(worksheet, rowNumber, rowNumber)
		if (item.is_abnormal) {
			for (const column of [2, 3, 4, 5]) {
				worksheet.getCell(rowNumber, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD9D9' } }
				worksheet.getCell(rowNumber, column).font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FFB42318' }, bold: column === 4 }
			}
		}
		const photos = Array.isArray(item.photo_file_ids) ? item.photo_file_ids.slice(0, 3) : []
		for (let photoIndex = 0; photoIndex < 3; photoIndex += 1) {
			const fileId = normalizeString(photos[photoIndex])
			if (!fileId) continue
			const media = mediaByFileId[fileId]
			if (!addEmbeddedImage(workbook, worksheet, media, { row: rowNumber, column: 6 + photoIndex })) {
				const cell = worksheet.getCell(rowNumber, 6 + photoIndex)
				cell.value = '图片读取失败'
				cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FFB42318' }, bold: true }
				cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E4' } }
				missingFileCount += 1
			}
		}
	})

	let rowNumber = headerRow + Math.max(items.length, 1) + 1
	if (!items.length) {
		worksheet.mergeCells(`A${headerRow + 1}:H${headerRow + 1}`)
		worksheet.getCell(headerRow + 1, 1).value = '本单没有可识别的检查项目'
		styleRange(worksheet, headerRow + 1, headerRow + 1)
	}
	const abnormalNotes = items
		.filter((item) => item?.is_abnormal)
		.map((item) => `${normalizeString(item.item_label_snapshot) || '检查项'}：${normalizeString(item.issue_note) || '未填写说明'}`)
	worksheet.mergeCells(`A${rowNumber}:H${rowNumber}`)
	worksheet.getCell(rowNumber, 1).value = `整改事项：${abnormalNotes.length ? abnormalNotes.join('；') : '无'}`
	worksheet.getRow(rowNumber).height = Math.max(32, 18 + abnormalNotes.length * 12)
	styleRange(worksheet, rowNumber, rowNumber)
	worksheet.getCell(rowNumber, 1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }

	rowNumber += 1
	worksheet.mergeCells(`A${rowNumber}:D${rowNumber}`)
	worksheet.mergeCells(`E${rowNumber}:H${rowNumber}`)
	worksheet.getCell(rowNumber, 1).value = `客户现场人员：${normalizeString(inspection.customer_signer_name) || '-'}`
	worksheet.getCell(rowNumber, 5).value = `巡检员：${normalizeString(inspection.inspector_name) || '-'}\n账号：${normalizeString(inspection.inspector_username_snapshot) || '-'}`
	worksheet.getRow(rowNumber).height = 42
	styleRange(worksheet, rowNumber, rowNumber)
	worksheet.getCell(rowNumber, 1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
	worksheet.getCell(rowNumber, 5).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }

	rowNumber += 1
	worksheet.mergeCells(`A${rowNumber}:H${rowNumber}`)
	worksheet.getCell(rowNumber, 1).value = Number(inspection.revision_no || 0) > 0
		? `管理员已修改 · 修订 ${Number(inspection.revision_no || 0)} 次 · 最后修改：${formatDateTime(inspection.last_edited_at)} · 修改人：${normalizeString(inspection.last_edited_by_name) || '-'} · 原因：${normalizeString(inspection.last_edit_reason) || '-'}`
		: `原始提交记录 · 模板：${normalizeString(inspection.template_code) || '未知'}@${Number(inspection.template_version || 0)}`
	worksheet.getCell(rowNumber, 1).font = { name: 'Microsoft YaHei', size: 9, color: { argb: Number(inspection.revision_no || 0) > 0 ? 'FFB54708' : 'FF667085' } }
	worksheet.getCell(rowNumber, 1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
	styleRange(worksheet, rowNumber, rowNumber)
	worksheet.getRow(rowNumber).height = 34
	worksheet.pageSetup.printArea = `A1:H${rowNumber}`
	worksheet.headerFooter.oddFooter = `&L${COMPANY_NAME}&R第 &P 页，共 &N 页`

	const raw = await workbook.xlsx.writeBuffer()
	return { buffer: Buffer.from(raw), missingFileCount }
}

module.exports = {
	COMPANY_NAME,
	formatDateTime,
	locationText,
	answerText,
	resultText,
	buildInspectionWorkbookBuffer
}
