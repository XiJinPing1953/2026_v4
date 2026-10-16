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
		inspection_photo_file_ids: Array.isArray(item.photo_file_ids) ? item.photo_file_ids : [],
		classification_version: Number(inspection.classification_version || 0),
		category_code: item.category_code || '',
		category_label_snapshot: item.category_label_snapshot || ''
	}
}

function buildHazardObservation(inspection, item, user, now = Date.now()) {
	const revision = Number(inspection.revision || 1)
	return {
		observation_key: `station_inspection:${inspection._id}:${item.item_code}:${revision}`,
		source_type: 'station_inspection', source_id: inspection._id, source_revision: revision,
		inspection_no: inspection.inspection_no || '', item_code: item.item_code,
		observed_at: Number(inspection.ended_at || inspection.inspection_at),
		inspection_date: inspection.inspection_date || '',
		issue_note: item.issue_note || '', result_code: item.result_code,
		photo_file_ids: item.photo_file_ids || [], category_code: item.category_code || '',
		report: item.report || null, on_site_rectification: item.on_site_rectification || null,
		correction_reason: inspection.revision_reason || '',
		recorded_at: now, recorded_by: normalizeString(user?._id), recorded_by_name: normalizeString(user?.nickname || user?.username)
	}
}

function buildSourceRevision(current, reason, user, now = Date.now()) {
	const snapshot = { ...current }
	delete snapshot.source_revisions
	return {
		revision: Number(current.revision || 1), reason: normalizeString(reason),
		revised_at: now, revised_by: normalizeString(user?._id), revised_by_name: normalizeString(user?.nickname || user?.username),
		snapshot
	}
}

function validateHazardLink(hazard, inspection, recurrence = false) {
	if (!hazard || hazard.station_id !== inspection.station_id) return { ok: false, msg: '关联隐患不存在或不属于当前厂站' }
	if (recurrence ? hazard.status !== 'closed' : !['pending_rectification', 'pending_verification'].includes(hazard.status)) {
		return { ok: false, msg: recurrence ? '复发须关联已关闭隐患' : '复见须关联尚未关闭的隐患' }
	}
	return { ok: true }
}

function isHazardOverdue(hazard = {}, today = '') {
	const status = normalizeString(hazard.status)
	const due = normalizeString(hazard.planned_complete_date)
	return ['pending_rectification', 'pending_verification'].includes(status) && /^\d{4}-\d{2}-\d{2}$/.test(due) && Boolean(today) && due < today
}

function resolveHazardSyncTransition(currentStatus, remainsAbnormal) {
	const status = normalizeString(currentStatus)
	if (!remainsAbnormal) {
		return { action: 'preserve', status, reset_closure: false }
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
	buildHazardObservation,
	buildSourceRevision,
	validateHazardLink,
	isHazardOverdue,
	resolveHazardSyncTransition
}
