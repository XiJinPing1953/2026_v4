'use strict'

const { normalizeString, normalizePhotoIds } = require('./inspectionPolicy')

const HAZARD_STATUSES = Object.freeze([
	'pending_rectification',
	'pending_verification',
	'closed',
	'cancelled'
])

function normalizeRectificationPayload(data = {}) {
	const note = normalizeString(data.rectification_note ?? data.rectificationNote)
	if (!note) return { ok: false, msg: '请填写实际整改措施' }
	if (note.length > 1000) return { ok: false, msg: '实际整改措施最多 1000 字' }
	const rawPhotos = data.rectification_photo_file_ids ?? data.rectificationPhotoFileIds
	const rawCount = Array.isArray(rawPhotos) ? rawPhotos.length : 0
	if (rawCount < 1 || rawCount > 3) return { ok: false, msg: '整改完成后需上传 1–3 张照片' }
	const photos = normalizePhotoIds(rawPhotos, 3)
	if (photos.length !== rawCount) return { ok: false, msg: '整改照片文件无效或重复' }
	return { ok: true, data: { rectification_note: note, rectification_photo_file_ids: photos } }
}

function normalizeVerificationPayload(data = {}) {
	const result = normalizeString(data.verification_result ?? data.verificationResult)
	if (!['passed', 'rejected'].includes(result)) return { ok: false, msg: '请选择验证通过或验证退回' }
	const note = normalizeString(data.verification_note ?? data.verificationNote)
	if (!note) return { ok: false, msg: '请填写验证结论' }
	if (note.length > 1000) return { ok: false, msg: '验证结论最多 1000 字' }
	const rawPhotos = data.verification_photo_file_ids ?? data.verificationPhotoFileIds
	const rawCount = Array.isArray(rawPhotos) ? rawPhotos.length : 0
	if (rawCount > 3) return { ok: false, msg: '验证照片最多 3 张' }
	const photos = normalizePhotoIds(rawPhotos, 3)
	if (photos.length !== rawCount) return { ok: false, msg: '验证照片文件无效或重复' }
	return {
		ok: true,
		data: {
			verification_result: result,
			verification_note: note,
			verification_photo_file_ids: photos,
			status: result === 'passed' ? 'closed' : 'pending_rectification'
		}
	}
}

function buildHazardSnapshot(inspection, item) {
	return {
		inspection_id: inspection._id,
		inspection_no: inspection.inspection_no || '',
		station_id: inspection.station_id || '',
		station_name_snapshot: inspection.station_name_snapshot || '',
		inspection_at: Number(inspection.inspection_at || 0),
		inspection_date: inspection.inspection_date || '',
		inspector_name_snapshot: inspection.inspector_name || '',
		area_code: item.area_code || '',
		area_label_snapshot: item.area_label_snapshot || '',
		item_code: item.item_code || '',
		item_label_snapshot: item.item_label_snapshot || '',
		hazard_category: item.hazard_category_snapshot || '厂站设施',
		issue_note: item.issue_note || '',
		hazard_level: item.hazard_level || 'general',
		responsible_name: item.responsible_name || '',
		responsible_signature_file_id: item.responsible_signature_file_id || '',
		planned_measure: item.planned_measure || '',
		planned_complete_date: item.planned_complete_date || '',
		inspection_photo_file_ids: Array.isArray(item.photo_file_ids) ? item.photo_file_ids : []
	}
}

function isHazardOverdue(hazard = {}, today = '') {
	const status = normalizeString(hazard.status)
	const due = normalizeString(hazard.planned_complete_date)
	return ['pending_rectification', 'pending_verification'].includes(status) && /^\d{4}-\d{2}-\d{2}$/.test(due) && Boolean(today) && due < today
}

function resolveHazardSyncTransition(currentStatus, remainsAbnormal) {
	const status = normalizeString(currentStatus)
	if (!remainsAbnormal) {
		return status === 'cancelled'
			? { action: 'none', status: 'cancelled', reset_closure: false }
			: { action: 'cancel', status: 'cancelled', reset_closure: false }
	}
	if (status === 'cancelled') return { action: 'reopen', status: 'pending_rectification', reset_closure: true }
	return {
		action: 'update',
		status: HAZARD_STATUSES.includes(status) ? status : 'pending_rectification',
		reset_closure: false
	}
}

module.exports = {
	HAZARD_STATUSES,
	normalizeRectificationPayload,
	normalizeVerificationPayload,
	buildHazardSnapshot,
	isHazardOverdue,
	resolveHazardSyncTransition
}
