'use strict'

const { ensureActionAcl } = require('../common/pageAcl')

const db = uniCloud.database()
const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const latestSnapshots = db.collection('crm_pda_scale_latest')

const DEFAULT_SCALE_CODE = 'filling_scale_main'
const PAGE_ACTION_RULES = {
	upsertLatestV1: [{ pagePath: '/pages/pda/filling-create', action: 'update' }],
	getLatestV1: [{ pagePath: '/pages/pda/filling-create', action: 'view' }]
}

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data && res.data[0]) || null
}

async function recordLog(user, action, detail = {}, requestId = '') {
	try {
		await logs.add({
			user_id: user?._id || null,
			username: user?.username || '',
			role: user?.role || '',
			action,
			detail,
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-pda-scale] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function normalizeScaleCode(value) {
	return normalizeString(value) || DEFAULT_SCALE_CODE
}

function toNullableNumber(value) {
	if (value == null || value === '') return null
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function toTimestamp(value) {
	const num = Number(value)
	return Number.isFinite(num) && num > 0 ? num : null
}

function normalizeSnapshotPayload(data = {}) {
	return {
		scale_code: normalizeScaleCode(data.scale_code ?? data.scaleCode),
		weight_raw: toNullableNumber(data.weight_raw ?? data.weightRaw),
		weight_kg: toNullableNumber(data.weight_kg ?? data.weightKg),
		scale_read_mode: normalizeString(data.scale_read_mode ?? data.scaleReadMode) || null,
		raw_scale_payload: data.raw_scale_payload && typeof data.raw_scale_payload === 'object'
			? data.raw_scale_payload
			: data.rawScalePayload && typeof data.rawScalePayload === 'object'
				? data.rawScalePayload
				: null,
		unit_code: toNullableNumber(data.unit_code ?? data.unitCode),
		decimal_places: toNullableNumber(data.decimal_places ?? data.decimalPlaces),
		stable_metric: toNullableNumber(data.stable_metric ?? data.stableMetric),
		stable_threshold: toNullableNumber(data.stable_threshold ?? data.stableThreshold),
		is_stable: Boolean(data.is_stable ?? data.isStable),
		is_online: Boolean(data.is_online ?? data.isOnline),
		sampled_at: toTimestamp(data.sampled_at ?? data.sampledAt),
		gateway_at: toTimestamp(data.gateway_at ?? data.gatewayAt) || Date.now(),
		error_code: normalizeString(data.error_code ?? data.errorCode) || null,
		error_message: normalizeString(data.error_message ?? data.errorMessage) || null
	}
}

function buildLatestView(doc = null, scaleCode = DEFAULT_SCALE_CODE) {
	if (!doc) {
		return {
			has_data: false,
			scale_code: normalizeScaleCode(scaleCode),
			weight_kg: null,
			is_stable: false,
			is_online: false,
			sampled_at: null,
			gateway_at: null,
			error_code: 'not_reported',
			error_message: 'C606+称重网关尚未上报'
		}
	}
	return {
		has_data: true,
		scale_code: normalizeScaleCode(doc.scale_code),
		weight_kg: toNullableNumber(doc.weight_kg),
		scale_read_mode: normalizeString(doc.scale_read_mode) || null,
		raw_scale_payload: doc.raw_scale_payload && typeof doc.raw_scale_payload === 'object' ? doc.raw_scale_payload : null,
		is_stable: Boolean(doc.is_stable),
		is_online: Boolean(doc.is_online),
		sampled_at: toTimestamp(doc.sampled_at),
		gateway_at: toTimestamp(doc.gateway_at),
		error_code: normalizeString(doc.error_code) || null,
		error_message: normalizeString(doc.error_message) || null
	}
}

async function upsertLatestV1(user, data) {
	void user
	const snapshot = normalizeSnapshotPayload(data)
	if (!snapshot.scale_code) return { code: 400, msg: 'scale_code 必填' }
	const now = Date.now()
	const patch = {
		...snapshot,
		updated_at: now,
		updated_by: user?._id || null,
		updated_by_name: normalizeString(user?.username || user?.nickname)
	}
	const existingRes = await latestSnapshots.where({ scale_code: snapshot.scale_code }).field({ _id: true, created_at: true }).limit(1).get()
	const existing = Array.isArray(existingRes.data) ? existingRes.data[0] || null : null
	if (existing?._id) {
		await latestSnapshots.doc(existing._id).update(patch)
		return {
			code: 0,
			msg: '',
			data: {
				scale_code: snapshot.scale_code,
				updated_at: now,
				created: false
			}
		}
	}
	await latestSnapshots.add({
		...patch,
		created_at: now
	})
	return {
		code: 0,
		msg: '',
		data: {
			scale_code: snapshot.scale_code,
			updated_at: now,
			created: true
		}
	}
}

async function getLatestV1(user, data) {
	void user
	const scaleCode = normalizeScaleCode(data.scale_code ?? data.scaleCode)
	const res = await latestSnapshots
		.where({ scale_code: scaleCode })
		.field({
			scale_code: true,
			weight_kg: true,
			scale_read_mode: true,
			raw_scale_payload: true,
			is_stable: true,
			is_online: true,
			sampled_at: true,
			gateway_at: true,
			error_code: true,
			error_message: true
		})
		.limit(1)
		.get()
	const doc = Array.isArray(res.data) ? res.data[0] || null : null
	return {
		code: 0,
		msg: '',
		data: buildLatestView(doc, scaleCode)
	}
}

exports.main = async (event, context) => {
	const { action, data = {}, token } = event || {}
	const requestId =
		normalizeString(event?.request_id || event?.requestId || context?.requestId || context?.request_id) ||
		generateRequestId()

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }
	const acl = await ensureActionAcl(user, action, PAGE_ACTION_RULES, [], {
		recordLog,
		requestId,
		cloudFunction: 'crm-pda-scale'
	})
	if (!acl.ok) return { code: acl.code || 403, msg: acl.msg || '无权限执行该操作' }

	try {
		if (action === 'upsertLatestV1') return upsertLatestV1(user, data)
		if (action === 'getLatestV1') return getLatestV1(user, data)
		return { code: 400, msg: '未知 action' }
	} catch (err) {
		console.error('[crm-pda-scale] action failed', action, err)
		return {
			code: 500,
			msg: normalizeString(err && err.message) || '秤状态处理失败'
		}
	}
}
