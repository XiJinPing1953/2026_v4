'use strict'

const MAX_EXPORT_RECORDS = 200
const MAX_EXPORT_PHOTOS = 2400
const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000
const SHANGHAI_OFFSET = '+08:00'

function normalizeString(value) {
	return value == null ? '' : String(value).trim()
}

function isValidDateText(value) {
	const text = normalizeString(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
	const timestamp = Date.parse(`${text}T00:00:00${SHANGHAI_OFFSET}`)
	if (!Number.isFinite(timestamp)) return false
	const normalized = new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
	return normalized === text
}

function resolveDateRange(data = {}) {
	const scope = normalizeString(data.scope).toLowerCase() === 'all' ? 'all' : 'range'
	if (scope === 'all') {
		return {
			ok: true,
			data: { scope, start_date: '', end_date: '', start_at: null, end_at_exclusive: null }
		}
	}
	const startDate = normalizeString(data.start_date ?? data.startDate)
	const endDate = normalizeString(data.end_date ?? data.endDate)
	if (!isValidDateText(startDate) || !isValidDateText(endDate)) {
		return { ok: false, msg: '请选择有效的开始日期和结束日期' }
	}
	if (startDate > endDate) return { ok: false, msg: '开始日期不能晚于结束日期' }
	const startAt = Date.parse(`${startDate}T00:00:00${SHANGHAI_OFFSET}`)
	const endAtExclusive = Date.parse(`${endDate}T00:00:00${SHANGHAI_OFFSET}`) + 24 * 60 * 60 * 1000
	return {
		ok: true,
		data: {
			scope,
			start_date: startDate,
			end_date: endDate,
			start_at: startAt,
			end_at_exclusive: endAtExclusive
		}
	}
}

function normalizeClientRequestId(value) {
	const text = normalizeString(value)
	if (!/^[a-zA-Z0-9_-]{8,80}$/.test(text)) return ''
	return text
}

function collectInspectionPhotoFileIds(inspection = {}) {
	return (Array.isArray(inspection.items) ? inspection.items : []).flatMap((item) =>
		(Array.isArray(item?.photo_file_ids) ? item.photo_file_ids : [])
			.map(normalizeString)
			.filter((fileId) => fileId.startsWith('cloud://'))
	)
}

function collectInspectionMediaFileIds(inspection = {}) {
	return Array.from(new Set(collectInspectionPhotoFileIds(inspection)))
}

function sanitizeFilenamePart(value, fallback = '未命名') {
	const text = normalizeString(value)
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
		.replace(/\s+/g, ' ')
		.replace(/[. ]+$/g, '')
	return (text || fallback).slice(0, 60)
}

function buildInspectionXlsxFileName(inspection = {}) {
	const inspectionNo = sanitizeFilenamePart(inspection.inspection_no, '未编号')
	const customer = sanitizeFilenamePart(inspection.customer_name_snapshot, '未命名客户')
	const date = sanitizeFilenamePart(inspection.inspection_date, '未知日期')
	return `${inspectionNo}_${customer}_${date}.xlsx`
}

function buildExportZipFileName(range = {}, total = 0) {
	const period = range.scope === 'all' ? '全部' : `${range.start_date}至${range.end_date}`
	return `入户随瓶安全巡检_${period}_${Math.max(Number(total || 0) || 0, 0)}单.zip`
}

function exportLimitMessage(recordCount, photoCount) {
	if (recordCount > MAX_EXPORT_RECORDS) return `当前范围超过 ${MAX_EXPORT_RECORDS} 单，请缩小日期范围`
	if (photoCount > MAX_EXPORT_PHOTOS) return `当前范围超过 ${MAX_EXPORT_PHOTOS} 张现场照片，请缩小日期范围`
	return ''
}

module.exports = {
	MAX_EXPORT_RECORDS,
	MAX_EXPORT_PHOTOS,
	EXPORT_RETENTION_MS,
	normalizeString,
	isValidDateText,
	resolveDateRange,
	normalizeClientRequestId,
	collectInspectionPhotoFileIds,
	collectInspectionMediaFileIds,
	sanitizeFilenamePart,
	buildInspectionXlsxFileName,
	buildExportZipFileName,
	exportLimitMessage
}
