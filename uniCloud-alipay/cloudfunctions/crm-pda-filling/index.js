'use strict'

const { ensureActionAcl } = require('./pageAclLocal')

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const bottles = db.collection('crm_bottles')
const tasks = db.collection('crm_pda_filling_tasks')
const scaleLatest = db.collection('crm_pda_scale_latest')

const STALE_AFTER_MS = 5000
const ZERO_THRESHOLD_KG = 0.2
const START_THRESHOLD_KG = 0.2
const COMPLETE_TOLERANCE_KG = 0.3
const ACTIVE_TASK_STATUSES = ['write_pending', 'write_claimed', 'ready', 'error']
const STATIONS = [
	{ station_code: 'station_1', station_name: '1号机', scale_code: 'filling_scale_main' },
	{ station_code: 'station_2', station_name: '2号机', scale_code: 'filling_scale_2' },
	{ station_code: 'station_3', station_name: '3号机', scale_code: 'filling_scale_3' }
]
const PAGE_ACTION_RULES = {
	getBoardV1: [{ pagePath: '/pages/pda/filling-board', action: 'view' }],
	getStationV1: [{ pagePath: '/pages/pda/filling-station', action: 'view' }],
	getTaskV1: [{ pagePath: '/pages/pda/filling-complete', action: 'view' }],
	createTaskV1: [{ pagePath: '/pages/pda/filling-create', action: 'create' }],
	completeTaskV1: [{ pagePath: '/pages/pda/filling-complete', action: 'update' }],
	markAbnormalV1: [{ pagePath: '/pages/pda/filling-complete', action: 'update' }],
	claimTargetWriteV1: [{ pagePath: '/pages/pda/filling-board', action: 'update' }],
	finishTargetWriteV1: [{ pagePath: '/pages/pda/filling-board', action: 'update' }]
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function toNumber(value, fallback = null) {
	if (value == null || value === '') return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function roundWeight(value) {
	const num = toNumber(value, null)
	if (num == null) return null
	return Number(num.toFixed(3))
}

function toTimestamp(value, fallback = null) {
	const num = Number(value)
	return Number.isFinite(num) && num > 0 ? num : fallback
}

function getCNDate(ts = Date.now()) {
	return new Date(ts + 8 * 60 * 60 * 1000)
}

function formatDateCN(date) {
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, '0')
	const d = String(date.getUTCDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function todayDate() {
	return formatDateCN(getCNDate())
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

function getStation(stationCode) {
	const code = normalizeString(stationCode)
	return STATIONS.find((item) => item.station_code === code) || null
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
		console.error('[crm-pda-filling] recordLog failed', action, err)
	}
}

function normalizeScaleSnapshot(doc = null, scaleCode = '') {
	if (!doc) {
		return {
			has_data: false,
			scale_code: normalizeString(scaleCode),
			weight_kg: null,
			scale_read_mode: null,
			raw_scale_payload: null,
			is_stable: false,
			is_online: false,
			sampled_at: null,
			gateway_at: null,
			error_code: 'not_reported',
			error_message: 'C606+称重网关尚未上报'
		}
	}
	const gatewayAt = toTimestamp(doc.gateway_at, null)
	const sampledAt = toTimestamp(doc.sampled_at, null)
	const lastSeenAt = gatewayAt || sampledAt || 0
	const isFresh = Boolean(lastSeenAt) && Date.now() - lastSeenAt <= STALE_AFTER_MS
	const isOnline = Boolean(doc.is_online) && isFresh
	return {
		has_data: true,
		scale_code: normalizeString(doc.scale_code || scaleCode),
		weight_kg: roundWeight(doc.weight_kg),
		scale_read_mode: normalizeString(doc.scale_read_mode) || null,
		raw_scale_payload: doc.raw_scale_payload && typeof doc.raw_scale_payload === 'object' ? doc.raw_scale_payload : null,
		is_stable: Boolean(doc.is_stable),
		is_online: isOnline,
		sampled_at: sampledAt,
		gateway_at: gatewayAt,
		error_code: normalizeString(doc.error_code) || (isOnline ? null : 'stale_or_offline'),
		error_message: isOnline ? normalizeString(doc.error_message) || null : normalizeString(doc.error_message) || 'C606+称重网关心跳超时'
	}
}

async function fetchScaleSnapshot(scaleCode) {
	const code = normalizeString(scaleCode)
	const res = await scaleLatest.where({ scale_code: code }).limit(1).get()
	const doc = Array.isArray(res.data) ? res.data[0] || null : null
	return normalizeScaleSnapshot(doc, code)
}

async function fetchScaleSnapshotMap(stations = STATIONS) {
	const scaleCodes = Array.from(new Set(stations.map((item) => item.scale_code).filter(Boolean)))
	if (!scaleCodes.length) return new Map()
	const res = await scaleLatest.where({ scale_code: dbCmd.in(scaleCodes) }).get()
	const map = new Map()
	;(res.data || []).forEach((doc) => {
		const scaleCode = normalizeString(doc && doc.scale_code)
		if (scaleCode) map.set(scaleCode, normalizeScaleSnapshot(doc, scaleCode))
	})
	scaleCodes.forEach((scaleCode) => {
		if (!map.has(scaleCode)) map.set(scaleCode, normalizeScaleSnapshot(null, scaleCode))
	})
	return map
}

async function findActiveTaskByStation(stationCode) {
	const res = await tasks
		.where({
			station_code: normalizeString(stationCode),
			status: dbCmd.in(ACTIVE_TASK_STATUSES)
		})
		.orderBy('created_at', 'desc')
		.limit(1)
		.get()
	return Array.isArray(res.data) ? res.data[0] || null : null
}

async function fetchActiveTaskMap() {
	const res = await tasks
		.where({ status: dbCmd.in(ACTIVE_TASK_STATUSES) })
		.orderBy('created_at', 'desc')
		.limit(30)
		.get()
	const map = new Map()
	;(res.data || []).forEach((task) => {
		const stationCode = normalizeString(task && task.station_code)
		if (stationCode && !map.has(stationCode)) map.set(stationCode, task)
	})
	return map
}

async function fetchTaskById(taskId) {
	const id = normalizeString(taskId)
	if (!id) return null
	const res = await tasks.doc(id).get()
	return Array.isArray(res.data) ? res.data[0] || null : null
}

function buildTaskView(task = null, scaleSnapshot = null) {
	if (!task) return null
	const weightStart = roundWeight(task.weight_start)
	const currentWeight = roundWeight(scaleSnapshot && scaleSnapshot.is_online ? scaleSnapshot.weight_kg : null)
	const currentNet = currentWeight != null && weightStart != null ? roundWeight(currentWeight - weightStart) : null
	return {
		_id: task._id,
		station_code: normalizeString(task.station_code),
		station_name: normalizeString(task.station_name),
		scale_code: normalizeString(task.scale_code),
		date: normalizeString(task.date),
		bottle_id: normalizeString(task.bottle_id) || null,
		bottle_no: normalizeBottleNo(task.bottle_no),
		suggested_fill_weight_kg: roundWeight(task.suggested_fill_weight_kg),
		target_net_weight: roundWeight(task.target_net_weight),
		target_gross_weight: roundWeight(task.target_gross_weight),
		weight_start: weightStart,
		weight_end: roundWeight(task.weight_end),
		current_net_weight: currentNet,
		actual_net_weight: roundWeight(task.actual_net_weight),
		deviation: roundWeight(task.deviation),
		status: normalizeString(task.status),
		effective_status: '',
		target_write_status: normalizeString(task.target_write_status),
		target_write_error: normalizeString(task.target_write_error) || null,
		target_write_readback: roundWeight(task.target_write_readback),
		started_at: toTimestamp(task.started_at, null),
		ended_at: toTimestamp(task.ended_at, null),
		completed_at: toTimestamp(task.completed_at, null),
		filling_record_id: normalizeString(task.filling_record_id) || null,
		alarm_state: Boolean(task.alarm_state),
		remark: normalizeString(task.remark),
		created_at: toTimestamp(task.created_at, null),
		updated_at: toTimestamp(task.updated_at, null),
		created_by_name: normalizeString(task.created_by_name)
	}
}

function resolveEffectiveStatus(task = null, scaleSnapshot = null) {
	if (!task) {
		const weight = roundWeight(scaleSnapshot && scaleSnapshot.is_online ? scaleSnapshot.weight_kg : null)
		return weight != null && weight > ZERO_THRESHOLD_KG ? 'wait_zero' : 'idle'
	}
	const status = normalizeString(task.status)
	const writeStatus = normalizeString(task.target_write_status)
	if (status === 'error' || writeStatus === 'failed') return 'abnormal'
	if (writeStatus === 'pending' || writeStatus === 'claimed' || status === 'write_pending' || status === 'write_claimed') return 'writing'
	const view = buildTaskView(task, scaleSnapshot)
	if (view.current_net_weight != null && view.target_net_weight != null && view.current_net_weight >= view.target_net_weight) return 'reached'
	if (view.current_net_weight != null && view.current_net_weight > START_THRESHOLD_KG) return 'filling'
	return 'ready'
}

function buildStationView(station, task, scaleSnapshot) {
	const taskView = buildTaskView(task, scaleSnapshot)
	const effectiveStatus = resolveEffectiveStatus(task, scaleSnapshot)
	if (taskView) taskView.effective_status = effectiveStatus
	return {
		...station,
		status: effectiveStatus,
		scale: scaleSnapshot,
		task: taskView
	}
}

function buildSummary(stations = []) {
	const summary = {
		idle: 0,
		writing: 0,
		ready: 0,
		filling: 0,
		reached: 0,
		abnormal: 0,
		wait_zero: 0
	}
	stations.forEach((station) => {
		const key = normalizeString(station.status)
		if (summary[key] == null) summary[key] = 0
		summary[key] += 1
	})
	return summary
}

async function getBoardV1() {
	const taskMap = await fetchActiveTaskMap()
	const scaleMap = await fetchScaleSnapshotMap(STATIONS)
	const stationViews = STATIONS.map((station) => buildStationView(station, taskMap.get(station.station_code) || null, scaleMap.get(station.scale_code)))
	return {
		code: 0,
		msg: '',
		data: {
			stations: stationViews,
			summary: buildSummary(stationViews),
			refreshed_at: Date.now()
		}
	}
}

async function getStationV1(data = {}) {
	const station = getStation(data.station_code ?? data.stationCode)
	if (!station) return { code: 400, msg: '工位无效' }
	const task = await findActiveTaskByStation(station.station_code)
	const scale = await fetchScaleSnapshot(station.scale_code)
	return {
		code: 0,
		msg: '',
		data: buildStationView(station, task, scale)
	}
}

async function getTaskV1(data = {}) {
	const task = await fetchTaskById(data.task_id ?? data.taskId ?? data._id)
	if (!task) return { code: 404, msg: '任务不存在' }
	const scale = await fetchScaleSnapshot(task.scale_code)
	const station = getStation(task.station_code) || {
		station_code: normalizeString(task.station_code),
		station_name: normalizeString(task.station_name),
		scale_code: normalizeString(task.scale_code)
	}
	return {
		code: 0,
		msg: '',
		data: {
			station: buildStationView(station, task, scale),
			task: buildTaskView(task, scale),
			scale
		}
	}
}

async function resolveBottleForTask(bottleNo) {
	const normalizedBottleNo = normalizeBottleNo(bottleNo)
	if (!normalizedBottleNo) return { code: 400, msg: '瓶号必填' }
	const res = await bottles.where({ bottle_no: normalizedBottleNo }).limit(2).get()
	const rows = Array.isArray(res.data) ? res.data : []
	if (!rows.length) return { code: 404, msg: '未找到钢瓶档案' }
	if (rows.length > 1) return { code: 409, msg: '钢瓶档案重复，请先清洗主数据' }
	const bottle = rows[0]
	if (bottle.is_active === false) return { code: 400, msg: '钢瓶档案已停用' }
	return { code: 0, msg: '', data: bottle }
}

function assertUsableScale(scale) {
	if (!scale || !scale.has_data) return 'C606+称重网关尚未上报'
	if (!scale.is_online) return scale.error_message || 'C606+秤离线'
	if (!scale.is_stable) return '当前 C606+ 毛重未稳定'
	if (!(scale.weight_kg > 0)) return '当前 C606+ 毛重无效'
	return ''
}

async function createTaskV1(user, data = {}) {
	const station = getStation(data.station_code ?? data.stationCode)
	if (!station) return { code: 400, msg: '请选择工位' }
	const existing = await findActiveTaskByStation(station.station_code)
	if (existing) return { code: 409, msg: `${station.station_name}已有待处理任务，请先完成或标记异常` }
	const bottleRes = await resolveBottleForTask(data.bottle_no ?? data.bottleNo)
	if (bottleRes.code !== 0) return bottleRes
	const bottle = bottleRes.data
	const targetNetWeight = roundWeight(data.target_net_weight ?? data.targetNetWeight ?? bottle.suggested_fill_weight_kg)
	if (!(targetNetWeight > 0)) return { code: 400, msg: '目标净充重量必须大于 0' }
	const scale = await fetchScaleSnapshot(station.scale_code)
	const scaleError = assertUsableScale(scale)
	if (scaleError) return { code: 400, msg: scaleError }
	const weightStart = roundWeight(scale.weight_kg)
	const now = Date.now()
	const doc = {
		station_code: station.station_code,
		station_name: station.station_name,
		scale_code: station.scale_code,
		date: todayDate(),
		bottle_id: bottle._id || null,
		bottle_no: normalizeBottleNo(bottle.bottle_no),
		suggested_fill_weight_kg: roundWeight(bottle.suggested_fill_weight_kg),
		target_net_weight: targetNetWeight,
		target_gross_weight: roundWeight(weightStart + targetNetWeight),
		weight_start: weightStart,
		weight_end: null,
		actual_net_weight: null,
		deviation: null,
		status: 'write_pending',
		target_write_status: 'pending',
		target_write_claimed_at: null,
		target_write_finished_at: null,
		target_write_attempts: 0,
		target_write_error: null,
		target_write_payload: null,
		target_write_readback: null,
		started_at: null,
		ended_at: null,
		completed_at: null,
		filling_record_id: null,
		alarm_state: false,
		raw_scale_payload: {
			start: {
				scale_code: scale.scale_code,
				scale_read_mode: scale.scale_read_mode,
				sampled_at: scale.sampled_at,
				gateway_at: scale.gateway_at,
				raw_scale_payload: scale.raw_scale_payload
			}
		},
		remark: normalizeString(data.remark),
		created_at: now,
		updated_at: now,
		created_by: user?._id || null,
		created_by_name: normalizeString(user?.username || user?.nickname),
		updated_by: user?._id || null,
		updated_by_name: normalizeString(user?.username || user?.nickname)
	}
	const res = await tasks.add(doc)
	await recordLog(user, 'pda_filling_task_create_v1', {
		id: res.id,
		station_code: station.station_code,
		bottle_no: doc.bottle_no,
		target_net_weight: targetNetWeight
	})
	return {
		code: 0,
		msg: '任务已创建，等待写入 C606+ 目标',
		data: {
			_id: res.id,
			...buildTaskView({ _id: res.id, ...doc }, scale)
		}
	}
}

async function callFillingCreate(user, token, requestId, payload) {
	const res = await uniCloud.callFunction({
		name: 'crm-filling',
		data: {
			action: 'createV1',
			token,
			request_id: requestId,
			data: payload
		}
	})
	return res && res.result ? res.result : {}
}

function buildCompletionStatus(actualNetWeight, targetNetWeight, alarmState) {
	if (alarmState) return 'error'
	const deviation = Number(actualNetWeight) - Number(targetNetWeight)
	if (deviation > COMPLETE_TOLERANCE_KG) return 'overweight'
	if (deviation < -COMPLETE_TOLERANCE_KG) return 'underweight'
	return 'completed'
}

async function completeTaskInternal(user, token, requestId, data = {}, options = {}) {
	const task = await fetchTaskById(data.task_id ?? data.taskId ?? data._id)
	if (!task) return { code: 404, msg: '任务不存在' }
	if (task.filling_record_id) {
		return {
			code: 0,
			msg: '任务已保存',
			data: { task_id: task._id, filling_record_id: task.filling_record_id }
		}
	}
	if (!ACTIVE_TASK_STATUSES.includes(normalizeString(task.status))) return { code: 400, msg: '任务状态不可完成' }
	const scale = await fetchScaleSnapshot(task.scale_code)
	const scaleError = assertUsableScale(scale)
	if (scaleError) return { code: 400, msg: scaleError }
	const weightStart = roundWeight(task.weight_start)
	const weightEnd = roundWeight(scale.weight_kg)
	const actualNetWeight = roundWeight(weightEnd - weightStart)
	const targetNetWeight = roundWeight(task.target_net_weight)
	if (!(actualNetWeight > 0)) return { code: 400, msg: '实际净充重量必须大于 0' }
	const now = Date.now()
	const alarmState = options.alarmState === true
	const fillingPayload = {
		date: normalizeString(task.date) || todayDate(),
		bottle_no: normalizeBottleNo(task.bottle_no),
		record_type: 'normal_fill',
		operator: normalizeString(user?.nickname || user?.username),
		operator_id: normalizeString(user?._id) || null,
		fill_weight: actualNetWeight,
		weight_start: weightStart,
		target_net_weight: targetNetWeight,
		target_gross_weight: roundWeight(task.target_gross_weight),
		weight_end: weightEnd,
		actual_net_weight: actualNetWeight,
		deviation: roundWeight(actualNetWeight - targetNetWeight),
		scale_source: 'C606+',
		scale_read_mode: normalizeString(scale.scale_read_mode),
		started_at: toTimestamp(task.target_write_finished_at, null) || toTimestamp(task.created_at, null) || now,
		ended_at: now,
		status: buildCompletionStatus(actualNetWeight, targetNetWeight, alarmState),
		alarm_state: alarmState,
		raw_scale_payload: {
			task: {
				task_id: task._id,
				station_code: task.station_code,
				station_name: task.station_name,
				target_write_status: task.target_write_status,
				target_write_payload: task.target_write_payload || null,
				target_write_readback: task.target_write_readback == null ? null : task.target_write_readback
			},
			start: task.raw_scale_payload?.start || null,
			end: {
				scale_code: scale.scale_code,
				scale_read_mode: scale.scale_read_mode,
				sampled_at: scale.sampled_at,
				gateway_at: scale.gateway_at,
				raw_scale_payload: scale.raw_scale_payload
			}
		},
		remark: normalizeString(data.remark) || normalizeString(task.remark)
	}
	const fillingRes = await callFillingCreate(user, token, requestId, fillingPayload)
	if (fillingRes.code !== 0) return fillingRes
	const fillingRecordId = normalizeString(fillingRes?.data?._id)
	const nextStatus = alarmState ? 'abnormal' : 'completed'
	await tasks.doc(task._id).update({
		status: nextStatus,
		weight_end: weightEnd,
		actual_net_weight: actualNetWeight,
		deviation: fillingPayload.deviation,
		ended_at: now,
		completed_at: now,
		filling_record_id: fillingRecordId || null,
		alarm_state: alarmState,
		remark: fillingPayload.remark,
		updated_at: now,
		updated_by: user?._id || null,
		updated_by_name: normalizeString(user?.username || user?.nickname)
	})
	await recordLog(user, alarmState ? 'pda_filling_task_abnormal_v1' : 'pda_filling_task_complete_v1', {
		task_id: task._id,
		filling_record_id: fillingRecordId,
		station_code: task.station_code,
		bottle_no: task.bottle_no,
		actual_net_weight: actualNetWeight,
		deviation: fillingPayload.deviation
	}, requestId)
	return {
		code: 0,
		msg: alarmState ? '异常记录已保存' : '灌装记录已保存',
		data: {
			task_id: task._id,
			filling_record_id: fillingRecordId,
			actual_net_weight: actualNetWeight,
			deviation: fillingPayload.deviation,
			status: nextStatus
		}
	}
}

async function completeTaskV1(user, token, requestId, data) {
	return completeTaskInternal(user, token, requestId, data, { alarmState: false })
}

async function markAbnormalV1(user, token, requestId, data) {
	return completeTaskInternal(user, token, requestId, data, { alarmState: true })
}

async function claimTargetWriteV1(user, data = {}) {
	const scaleCode = normalizeString(data.scale_code ?? data.scaleCode)
	if (!scaleCode) return { code: 400, msg: 'scale_code 必填' }
	const res = await tasks
		.where({
			scale_code: scaleCode,
			status: 'write_pending',
			target_write_status: 'pending'
		})
		.orderBy('created_at', 'asc')
		.limit(1)
		.get()
	const task = Array.isArray(res.data) ? res.data[0] || null : null
	if (!task) return { code: 0, msg: '', data: { task: null } }
	const now = Date.now()
	await tasks.doc(task._id).update({
		status: 'write_claimed',
		target_write_status: 'claimed',
		target_write_claimed_at: now,
		target_write_attempts: Number(task.target_write_attempts || 0) + 1,
		updated_at: now,
		updated_by: user?._id || null,
		updated_by_name: normalizeString(user?.username || user?.nickname)
	})
	return {
		code: 0,
		msg: '',
		data: {
			task: {
				_id: task._id,
				station_code: task.station_code,
				station_name: task.station_name,
				scale_code: task.scale_code,
				bottle_no: task.bottle_no,
				target_net_weight: roundWeight(task.target_net_weight),
				target_register: '0x00CA',
				target_register_decimal: 202,
				target_value_kind: 'target_net_weight'
			}
		}
	}
}

async function finishTargetWriteV1(user, data = {}) {
	const taskId = normalizeString(data.task_id ?? data.taskId ?? data._id)
	if (!taskId) return { code: 400, msg: 'task_id 必填' }
	const task = await fetchTaskById(taskId)
	if (!task) return { code: 404, msg: '任务不存在' }
	const success = data.success === true || data.ok === true
	const now = Date.now()
	const patch = {
		status: success ? 'ready' : 'error',
		target_write_status: success ? 'success' : 'failed',
		target_write_finished_at: now,
		target_write_error: success ? null : (normalizeString(data.error || data.msg) || 'C606+目标写入失败'),
		target_write_payload: data.payload && typeof data.payload === 'object' ? data.payload : null,
		target_write_readback: roundWeight(data.readback ?? data.target_write_readback ?? data.targetWriteReadback),
		updated_at: now,
		updated_by: user?._id || null,
		updated_by_name: normalizeString(user?.username || user?.nickname)
	}
	await tasks.doc(task._id).update(patch)
	await recordLog(user, success ? 'pda_filling_target_write_success_v1' : 'pda_filling_target_write_failed_v1', {
		task_id: task._id,
		station_code: task.station_code,
		scale_code: task.scale_code,
		target_net_weight: task.target_net_weight,
		error: patch.target_write_error
	})
	return {
		code: 0,
		msg: success ? '目标写入结果已确认' : '目标写入失败已记录',
		data: { task_id: task._id, status: patch.status, target_write_status: patch.target_write_status }
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
		cloudFunction: 'crm-pda-filling'
	})
	if (!acl.ok) return { code: acl.code || 403, msg: acl.msg || '无权限执行该操作' }

	try {
		if (action === 'getBoardV1') return getBoardV1(user, data)
		if (action === 'getStationV1') return getStationV1(data)
		if (action === 'getTaskV1') return getTaskV1(data)
		if (action === 'createTaskV1') return createTaskV1(user, data, requestId)
		if (action === 'completeTaskV1') return completeTaskV1(user, token, requestId, data)
		if (action === 'markAbnormalV1') return markAbnormalV1(user, token, requestId, data)
		if (action === 'claimTargetWriteV1') return claimTargetWriteV1(user, data)
		if (action === 'finishTargetWriteV1') return finishTargetWriteV1(user, data)
		return { code: 400, msg: '未知 action' }
	} catch (err) {
		console.error('[crm-pda-filling] action failed', action, err)
		return {
			code: 500,
			msg: normalizeString(err && err.message) || 'PDA灌装任务处理失败'
		}
	}
}
