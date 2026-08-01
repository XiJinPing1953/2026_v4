'use strict'

const MAX_EXPORT_RECORDS = 50
const MAX_EXPORT_MEDIA = 2000
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
	return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) === text
}

function resolveFilters(data = {}) {
	const scope = normalizeString(data.scope).toLowerCase() === 'all' ? 'all' : 'range'
	let startDate = ''
	let endDate = ''
	let startAt = null
	let endAtExclusive = null
	if (scope === 'range') {
		startDate = normalizeString(data.start_date ?? data.startDate)
		endDate = normalizeString(data.end_date ?? data.endDate)
		if (!isValidDateText(startDate) || !isValidDateText(endDate)) return { ok: false, msg: '请选择有效的开始日期和结束日期' }
		if (startDate > endDate) return { ok: false, msg: '开始日期不能晚于结束日期' }
		startAt = Date.parse(`${startDate}T00:00:00${SHANGHAI_OFFSET}`)
		endAtExclusive = Date.parse(`${endDate}T00:00:00${SHANGHAI_OFFSET}`) + 24 * 60 * 60 * 1000
	}
	const inspectionResult = normalizeString(data.inspection_result ?? data.inspectionResult)
	if (inspectionResult && !['normal', 'abnormal'].includes(inspectionResult)) return { ok: false, msg: '巡检结果筛选无效' }
	const hazardStatus = normalizeString(data.hazard_status ?? data.hazardStatus)
	if (hazardStatus && !['pending_rectification', 'pending_verification', 'closed', 'cancelled'].includes(hazardStatus)) {
		return { ok: false, msg: '隐患状态筛选无效' }
	}
	return {
		ok: true,
		data: {
			scope,
			start_date: startDate,
			end_date: endDate,
			start_at: startAt,
			end_at_exclusive: endAtExclusive,
			inspection_result: inspectionResult,
			hazard_status: hazardStatus
		}
	}
}

function normalizeClientRequestId(value) {
	const text = normalizeString(value)
	return /^[a-zA-Z0-9_-]{8,80}$/.test(text) ? text : ''
}

function validCloudFileIds(values) {
	return (Array.isArray(values) ? values : []).map(normalizeString).filter((value) => value.startsWith('cloud://'))
}

function collectInspectionMediaFileIds(inspection = {}) {
	const values = []
	for (const item of Array.isArray(inspection.items) ? inspection.items : []) {
		values.push(...validCloudFileIds(item?.photo_file_ids))
		values.push(...validCloudFileIds([item?.responsible_signature_file_id]))
	}
	return Array.from(new Set(values))
}

function collectHazardMediaFileIds(hazard = {}) {
	return Array.from(new Set([
		...validCloudFileIds(hazard.inspection_photo_file_ids),
		...validCloudFileIds(hazard.rectification_photo_file_ids),
		...validCloudFileIds(hazard.verification_photo_file_ids),
		...validCloudFileIds([hazard.responsible_signature_file_id])
	]))
}

function buildExportFileName(filters = {}, count = 0) {
	const period = filters.scope === 'all' ? '全部' : `${filters.start_date}至${filters.end_date}`
	return `厂站安全巡检与隐患整改_${period}_${Math.max(Number(count || 0) || 0, 0)}单.xlsx`
}

function exportLimitMessage(recordCount, mediaCount) {
	if (recordCount > MAX_EXPORT_RECORDS) return `当前范围超过 ${MAX_EXPORT_RECORDS} 张巡检单，请缩小日期范围`
	if (mediaCount > MAX_EXPORT_MEDIA) return `当前范围超过 ${MAX_EXPORT_MEDIA} 个媒体文件，请缩小日期范围`
	return ''
}

module.exports = {
	MAX_EXPORT_RECORDS,
	MAX_EXPORT_MEDIA,
	EXPORT_RETENTION_MS,
	normalizeString,
	isValidDateText,
	resolveFilters,
	normalizeClientRequestId,
	collectInspectionMediaFileIds,
	collectHazardMediaFileIds,
	buildExportFileName,
	exportLimitMessage
}
