'use strict'

const COMPANY_NAME = '无极县新拓能源开发有限公司'

function text(value) {
	return value == null ? '' : String(value).trim()
}

function formatDateTime(value) {
	const timestamp = Number(value)
	if (!Number.isFinite(timestamp) || timestamp <= 0) return '-'
	return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')
}

function hazardLevel(value) {
	return value === 'major' ? '重大' : value === 'general' ? '一般' : '-'
}

function hazardStatus(value) {
	return ({
		pending_rectification: '待整改',
		pending_verification: '待验证',
		closed: '已关闭',
		cancelled: '已取消'
	})[value] || '-'
}

function applyTableStyle(worksheet, rowNumber, columnCount, header = false) {
	for (let column = 1; column <= columnCount; column += 1) {
		const cell = worksheet.getCell(rowNumber, column)
		cell.border = {
			top: { style: 'thin', color: { argb: 'FFD0D5DD' } },
			left: { style: 'thin', color: { argb: 'FFD0D5DD' } },
			bottom: { style: 'thin', color: { argb: 'FFD0D5DD' } },
			right: { style: 'thin', color: { argb: 'FFD0D5DD' } }
		}
		cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
		cell.font = { name: 'Microsoft YaHei', size: 10, bold: header }
		if (header) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEFEA' } }
	}
}

function addImage(workbook, worksheet, media, row, column, options = {}) {
	if (!media?.buffer) return false
	const imageId = workbook.addImage({ buffer: media.buffer, extension: media.extension === 'png' ? 'png' : 'jpeg' })
	worksheet.addImage(imageId, {
		tl: { col: column - 1 + Number(options.offset || 0) + 0.05, row: row - 1 + 0.08 },
		ext: { width: Number(options.width || 92), height: Number(options.height || 70) },
		editAs: 'oneCell'
	})
	return true
}

function addPhotoColumns(workbook, worksheet, mediaByFileId, ids, row, startColumn) {
	let missing = 0
	const photos = Array.isArray(ids) ? ids.slice(0, 3) : []
	for (let index = 0; index < 3; index += 1) {
		const fileId = text(photos[index])
		if (!fileId) continue
		if (!addImage(workbook, worksheet, mediaByFileId[fileId], row, startColumn + index)) {
			worksheet.getCell(row, startColumn + index).value = '图片读取失败'
			missing += 1
		}
	}
	return missing
}

function addPhotoGroupInCell(workbook, worksheet, mediaByFileId, ids, row, column) {
	let missing = 0
	const photos = (Array.isArray(ids) ? ids : []).slice(0, 3)
	photos.forEach((rawFileId, index) => {
		const fileId = text(rawFileId)
		if (!fileId) return
		if (!addImage(workbook, worksheet, mediaByFileId[fileId], row, column, { offset: index * 0.31, width: 48, height: 58 })) missing += 1
	})
	if (missing) worksheet.getCell(row, column).value = `${missing}张读取失败`
	return missing
}

function setupSheet(worksheet, columns, headers) {
	worksheet.views = [{ state: 'frozen', ySplit: 1 }]
	worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } }
	worksheet.columns = columns.map((width) => ({ width }))
	headers.forEach((label, index) => { worksheet.getCell(1, index + 1).value = label })
	worksheet.getRow(1).height = 32
	applyTableStyle(worksheet, 1, headers.length, true)
}

function addInspectionSheet(workbook, inspections, mediaByFileId) {
	const worksheet = workbook.addWorksheet('巡检明细', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 } })
	const headers = ['厂站', '巡检编号', '巡检时间', '巡检员', '区域', '检查项', '结果', '异常说明', '隐患等级', '整改责任人', '计划完成日期', '现场照片1', '现场照片2', '现场照片3']
	setupSheet(worksheet, [30, 20, 20, 16, 18, 36, 10, 34, 12, 16, 16, 17, 17, 17], headers)
	let rowNumber = 2
	let missingFileCount = 0
	for (const inspection of inspections) {
		for (const item of Array.isArray(inspection.items) ? inspection.items : []) {
			const values = [
				text(inspection.station_name_snapshot) || COMPANY_NAME,
				text(inspection.inspection_no),
				formatDateTime(inspection.inspection_at),
				text(inspection.inspector_name),
				text(item.area_label_snapshot),
				text(item.item_label_snapshot),
				item.is_abnormal ? '异常' : '正常',
				text(item.issue_note) || '-',
				item.is_abnormal ? hazardLevel(item.hazard_level) : '-',
				text(item.responsible_name) || '-',
				text(item.planned_complete_date) || '-'
			]
			values.forEach((value, index) => { worksheet.getCell(rowNumber, index + 1).value = value })
			worksheet.getRow(rowNumber).height = 76
			applyTableStyle(worksheet, rowNumber, headers.length)
			if (item.is_abnormal) {
				for (let column = 6; column <= 10; column += 1) {
					worksheet.getCell(rowNumber, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E4' } }
				}
			}
			missingFileCount += addPhotoColumns(workbook, worksheet, mediaByFileId, item.photo_file_ids, rowNumber, 12)
			rowNumber += 1
		}
	}
	worksheet.pageSetup.printArea = `A1:N${Math.max(rowNumber - 1, 1)}`
	return missingFileCount
}

function addHazardSheet(workbook, hazards, mediaByFileId) {
	const worksheet = workbook.addWorksheet('隐患整改台账', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 } })
	const headers = ['序号', '隐患类别', '隐患具体描述', '隐患等级', '排查发现日期', '整改责任人', '整改措施', '计划完成时间', '整改状态', '整改完成时间', '验证人', '备注', '现场照片', '整改照片', '验证照片']
	setupSheet(worksheet, [8, 14, 36, 12, 16, 16, 34, 16, 14, 18, 16, 38, 26, 26, 26], headers)
	let missingFileCount = 0
	hazards.forEach((hazard, index) => {
		const rowNumber = index + 2
		const noteParts = [
			`巡检单：${text(hazard.inspection_no) || '-'}`,
			`区域/项目：${text(hazard.area_label_snapshot) || '-'} / ${text(hazard.item_label_snapshot) || '-'}`,
			text(hazard.verification_note) ? `验证结论：${text(hazard.verification_note)}` : '',
			hazard.status === 'cancelled' ? '巡检项已改为正常，关联隐患已取消' : ''
		].filter(Boolean).join('\n')
		const values = [
			index + 1,
			text(hazard.hazard_category) || '厂站设施',
			text(hazard.issue_note) || '-',
			hazardLevel(hazard.hazard_level),
			text(hazard.inspection_date) || '-',
			text(hazard.responsible_name) || '-',
			text(hazard.rectification_note || hazard.planned_measure) || '-',
			text(hazard.planned_complete_date) || '-',
			hazardStatus(hazard.status),
			formatDateTime(hazard.rectified_at),
			text(hazard.verified_by_name) || '-',
			noteParts
		]
		values.forEach((value, columnIndex) => { worksheet.getCell(rowNumber, columnIndex + 1).value = value })
		worksheet.getRow(rowNumber).height = 70
		applyTableStyle(worksheet, rowNumber, headers.length)
		missingFileCount += addPhotoGroupInCell(workbook, worksheet, mediaByFileId, hazard.inspection_photo_file_ids, rowNumber, 13)
		missingFileCount += addPhotoGroupInCell(workbook, worksheet, mediaByFileId, hazard.rectification_photo_file_ids, rowNumber, 14)
		missingFileCount += addPhotoGroupInCell(workbook, worksheet, mediaByFileId, hazard.verification_photo_file_ids, rowNumber, 15)
	})
	worksheet.pageSetup.printArea = `A1:O${Math.max(hazards.length + 1, 1)}`
	return missingFileCount
}

async function buildStationSafetyWorkbookBuffer({ inspections = [], hazards = [], mediaByFileId = {} }) {
	const ExcelJS = require('exceljs')
	const workbook = new ExcelJS.Workbook()
	workbook.creator = COMPANY_NAME
	workbook.created = new Date()
	const inspectionMissing = addInspectionSheet(workbook, inspections, mediaByFileId)
	const hazardMissing = addHazardSheet(workbook, hazards, mediaByFileId)
	const raw = await workbook.xlsx.writeBuffer()
	return { buffer: Buffer.from(raw), missingFileCount: inspectionMissing + hazardMissing }
}

module.exports = {
	COMPANY_NAME,
	formatDateTime,
	hazardLevel,
	hazardStatus,
	buildStationSafetyWorkbookBuffer
}
