'use strict'

const crypto = require('crypto')
const { fingerprint } = require('./fillingPayloadLocal')
const COMPLETION_VERSION = 'pda-completion-2026-09-08-v1'
const FILLING_VERSION = 'filling-consistency-2026-09-08-v2'
const text = (value) => String(value == null ? '' : value).trim()
const operationIdForTask = (id) => `pda_complete_${crypto.createHash('sha256').update(String(id)).digest('hex')}`
const isAdmin = (user) => ['admin', 'superadmin'].includes(user?.role)
const ownerId = (task) => task.completion_intent?.payload?.operator_id
const canAccess = (task, user) => ownerId(task) === user?._id || isAdmin(user)

function createCompletionProtocol({ db, tasks, callFunction, recordLog, fetchTaskById, fetchScaleSnapshot, assertUsableScale, buildCompletionPayload, buildTaskView, activeStatuses }) {
	async function call(action, token, requestId, data = {}) {
		try {
			const result = await callFunction({ name: 'crm-filling', data: { action, token, request_id: requestId, data } })
			return result?.result || { code: 502, msg: '灌装服务未返回有效结果' }
		} catch (_) {
			// Never persist or echo a transport exception that may contain request credentials.
			return { code: 503, msg: '灌装服务确认中断，请使用原任务刷新或重试' }
		}
	}

	async function capabilities(token, requestId) {
		const result = await call('capabilitiesV1', token, requestId)
		if (result.code !== 0) return result
		if (result.data?.rule_version !== FILLING_VERSION || result.data?.durable_operations !== true || result.data?.source_status_query !== true || result.data?.source_payload_hash !== true) {
			return { code: 503, msg: '灌装后台尚未配套升级，请联系管理员核对版本' }
		}
		return { code: 0, data: { completion_protocol: COMPLETION_VERSION, filling_protocol: FILLING_VERSION, durable_completion: true } }
	}

	async function checkClient(data, token, requestId) {
		if (data.completion_protocol !== COMPLETION_VERSION) return { code: 426, msg: '请升级 PDA 灌装页面后继续，当前版本不能确认持久保存' }
		return capabilities(token, requestId)
	}

	function publicView(task, user = null) {
		const intent = task.completion_intent
		return {
			protocol: intent?.protocol || '', operation_id: intent?.payload?.operation_id || '',
			physical_complete: Boolean(intent), physical_status: intent?.payload?.status || '',
			frozen_at: intent?.payload?.ended_at || null,
			operator: intent?.payload?.operator || '', source_saved: false, source_status: 'unconfirmed',
			filling_record_id: '', processing_status: intent ? 'confirmation_required' : 'not_started',
			complete: false, task_linked: false, remaining_total: null, processed_total: null, target_total: null,
			can_retry: Boolean(intent && user && canAccess(task, user)), last_error: '',
			legacy: !intent && Boolean(task.filling_record_id || !activeStatuses.includes(task.status))
		}
	}

	function validateStatus(task, result) {
		const op = result.data
		return result.code === 0 && op?.rule_version === FILLING_VERSION
			&& op.operation_id === task.completion_intent.payload.operation_id
			&& op.input_hash === fingerprint(task.completion_intent.payload) && op.created_by === ownerId(task)
			&& op.accepted_total === 1 && Array.isArray(op.source_records) && op.source_records.length === 1
			&& text(op.source_records[0]._id) && op.source_records[0].bottle_no === task.bottle_no
			&& ['pending', 'processing', 'failed', 'complete'].includes(op.status)
	}

	async function linkSource(task, view, user, requestId) {
		if (!view.source_saved) return
		if (task.filling_record_id && task.filling_record_id !== view.filling_record_id) {
			view.can_retry = false
			view.complete = false
			view.last_error = '任务回链与已查询源单不一致，请联系管理员核查'
			return
		}
		try {
			if (!task.filling_record_id) {
				const patch = {
					status: task.completion_intent.payload.alarm_state ? 'abnormal' : 'completed',
					filling_record_id: view.filling_record_id, completed_at: Date.now(), updated_at: Date.now()
				}
				const linked = await tasks.where({ _id: task._id, filling_record_id: null, 'completion_intent.payload.operation_id': view.operation_id }).update(patch)
				if (linked.updated) await recordLog(user, task.alarm_state ? 'pda_filling_task_abnormal_v1' : 'pda_filling_task_complete_v1', {
					task_id: task._id, operation_id: view.operation_id, filling_record_id: view.filling_record_id,
					station_code: task.station_code, bottle_no: task.bottle_no, actual_net_weight: task.actual_net_weight, deviation: task.deviation
				}, requestId)
			}
			if (view.complete) {
				await tasks.where({ _id: task._id, filling_record_id: view.filling_record_id, completion_pending: true }).update({ completion_pending: false, updated_at: Date.now() })
			}
			const current = await fetchTaskById(task._id)
			view.task_linked = current?.filling_record_id === view.filling_record_id && (!view.complete || current.completion_pending === false)
			if (!view.task_linked) throw new Error('link pending')
			Object.assign(task, current)
		} catch (_) {
			view.task_linked = false
			view.last_error = '源单已查询确认，任务回链未确认，请刷新或重试原任务'
		}
	}

	async function legacyView(task, token, requestId) {
		const view = publicView(task)
		view.legacy = true
		view.can_retry = false
		view.processing_status = 'legacy_review'
		view.last_error = '旧任务缺少冻结完成事实，需核查原单；不能重新采秤补造记录'
		if (!task.filling_record_id) return view
		const found = await call('getV1', token, requestId, { _id: task.filling_record_id })
		const source = found.data
		if (found.code === 0 && source?._id === task.filling_record_id && source.raw_scale_payload?.task?.task_id === task._id && source.bottle_no === task.bottle_no) {
			Object.assign(view, { source_saved: true, source_status: 'saved', filling_record_id: source._id, task_linked: true,
				physical_complete: true, physical_status: source.status, last_error: '旧任务源单已确认；后续处理无持久进度凭据，需单独核查' })
		} else if (found.code !== 0) view.last_error = found.code === 404 ? '旧任务关联源单不存在，请联系管理员核查' : found.msg
		return view
	}

	async function inspect(task, user, token, requestId, knownResult = null) {
		if (!task.completion_intent) return publicView(task).legacy ? legacyView(task, token, requestId) : publicView(task, user)
		const view = publicView(task, user)
		if (!canAccess(task, user)) return { ...view, can_retry: false, last_error: '请由首次完成操作者或管理员查询和恢复此操作' }
		if (task.completion_intent.protocol !== COMPLETION_VERSION) return { ...view, can_retry: false, last_error: '冻结任务协议与后台不一致，请联系管理员核对版本' }
		const result = knownResult || await call('getOperationV1', token, requestId, { operation_id: view.operation_id })
		if (result.code !== 0) {
			view.processing_status = result.code === 404 ? 'not_submitted' : 'confirmation_required'
			view.last_error = result.msg || '尚未查询确认源单，请刷新或重试原任务'
			if ([401, 403].includes(result.code)) view.can_retry = false
			if (result.code === 404 && ownerId(task) !== user._id) {
				view.can_retry = false
				view.last_error = '尚未建立源操作，请首次完成操作者登录恢复，管理员不能代换操作归属'
			}
			if (result.code === 404 && task.filling_record_id) { view.processing_status = 'conflict'; view.can_retry = false; view.last_error = '已回链任务的持久操作缺失，请联系管理员核查' }
			return view
		}
		if (!validateStatus(task, result)) {
			const sameInput = result.data?.input_hash === fingerprint(task.completion_intent.payload) && result.data?.created_by === ownerId(task)
			return { ...view, processing_status: sameInput ? 'confirmation_required' : 'conflict', can_retry: false,
				last_error: sameInput ? '保存状态缺少有效源单查询凭据或协议不匹配，请核对后台' : '源操作内容或创建归属与冻结完成事实不一致，请联系管理员核查' }
		}
		const op = result.data
		const source = op.source_records[0]
		Object.assign(view, {
			source_saved: source.saved === true, source_status: source.saved === true ? 'saved' : 'not_saved',
			filling_record_id: source.saved === true ? source._id : '', processing_status: op.status,
			remaining_total: op.remaining_total, processed_total: op.processed_total, target_total: op.target_total,
			last_error: op.status === 'complete' ? '' : text(op.last_error), next_retry_at: op.next_retry_at || 0,
			complete: source.saved === true && source.version_matches === true && op.status === 'complete' && op.complete === true && op.remaining_total === 0 && op.pending_save_total === 0
		})
		if ((source.saved === true && source.version_matches !== true) || (source.saved !== true && (task.filling_record_id || op.status === 'complete'))) {
			view.processing_status = 'conflict'
			view.can_retry = false
			view.last_error = '源单版本或保存证据与原操作不一致，请联系管理员核查'
		}
		await linkSource(task, view, user, requestId)
		if (view.complete && view.task_linked) view.can_retry = false
		return view
	}

	function response(task, view, code = 0, msg = '') {
		return { code, msg: msg || (view.source_saved ? view.complete && view.task_linked ? '源单已保存，后续处理已完成' : '源单已保存，仍有后续处理或任务回链待确认' : '物理完成事实已冻结，源单尚未确认保存'),
			data: { task_id: task._id, filling_record_id: view.filling_record_id || null, status: task.status,
				actual_net_weight: task.actual_net_weight, deviation: task.deviation, completion: view, task: buildTaskView(task, null, view) } }
	}

	async function complete(user, token, requestId, data, alarmState) {
		const gate = await checkClient(data, token, requestId)
		if (gate.code !== 0) return gate
		let task = await fetchTaskById(data.task_id ?? data.taskId ?? data._id)
		if (!task) return { code: 404, msg: '任务不存在' }
		if (!task.completion_intent && publicView(task).legacy) return response(task, await legacyView(task, token, requestId), 409, '旧任务需核查原单，不能重新完成')
		if (!task.completion_intent) {
			const operation_id = operationIdForTask(task._id)
			const prior = await call('getOperationV1', token, requestId, { operation_id })
			if (prior.code !== 404) return prior.code === 0 ? { code: 409, msg: '任务缺少冻结事实但已有持久操作，请联系管理员核查' } : prior
			const scale = await fetchScaleSnapshot(task.scale_code)
			const scaleError = assertUsableScale(scale)
			if (scaleError) return { code: 400, msg: scaleError }
			let payload
			try { payload = { ...buildCompletionPayload(task, user, data, scale, alarmState), operation_id } }
			catch (error) { return { code: 400, msg: error.message } }
			// The only transition that writes frozen facts. All contenders re-read the winning document.
			try {
				const frozen = await tasks.where({ _id: task._id, status: db.command.in(activeStatuses), completion_intent: db.command.exists(false) }).update({
					completion_intent: { protocol: COMPLETION_VERSION, payload }, completion_pending: true,
					status: 'completion_pending', weight_end: payload.weight_end, actual_net_weight: payload.actual_net_weight,
					deviation: payload.deviation, started_at: payload.started_at, ended_at: payload.ended_at,
					completed_at: null, filling_record_id: null, alarm_state: payload.alarm_state, remark: payload.remark,
					updated_at: payload.ended_at, updated_by: user._id, updated_by_name: text(user.username || user.nickname)
				})
				if (frozen.updated) await recordLog(user, 'pda_filling_completion_frozen_v1', {
					task_id: task._id, operation_id, physical_status: payload.status, ended_at: payload.ended_at
				}, requestId)
			} catch (_) { /* A write acknowledgement can be lost after the atomic update; read before any downstream call. */ }
			task = await fetchTaskById(task._id)
			if (!task?.completion_intent) return { code: 409, msg: '完成事实尚未确认冻结或任务已变化，请刷新原任务后重试' }
		}
		if (!canAccess(task, user)) return response(task, publicView(task, user), 403, '仅首次完成操作者或管理员可恢复此操作')
		const operation_id = task.completion_intent.payload.operation_id
		const current = await call('getOperationV1', token, requestId, { operation_id })
		let view = await inspect(task, user, token, requestId, current)
		if (task.completion_intent.protocol !== COMPLETION_VERSION || !view.can_retry || view.complete) return response(task, view)
		let submitted
		if (current.code === 404) {
			if (ownerId(task) !== user._id) return response(task, view, 403, '尚未建立源操作，请首次完成操作者登录恢复，管理员不能代换操作归属')
			submitted = await call('createV1', token, requestId, task.completion_intent.payload)
		} else if (current.code === 0 && validateStatus(task, current)) {
			submitted = await call('retryOperationV1', token, requestId, { operation_id })
		} else return response(task, view, current.code || 503, current.msg)
		// code 0 and a returned _id only prove acceptance. Query the durable operation after every attempt,
		// including transport failure, before linking the task or saying the source has been saved.
		view = await inspect(task, user, token, requestId)
		if (submitted.code !== 0 && !view.complete) {
			view.last_error = submitted.msg || view.last_error
			return response(task, view, submitted.code || 503, view.last_error)
		}
		return response(task, view)
	}

	async function list(user, data = {}) {
		const where = { completion_pending: true }
		if (!isAdmin(user)) where['completion_intent.payload.operator_id'] = user._id
		if (text(data.before_id)) where._id = db.command.lt(text(data.before_id))
		const result = await tasks.where(where).orderBy('_id', 'desc').limit(21).get()
		if (!Array.isArray(result.data)) return { code: 503, msg: '待确认任务读取失败' }
		const rows = result.data.slice(0, 20)
		return { code: 0, data: { items: rows.map((task) => buildTaskView(task, null)), has_more: result.data.length > 20, next_before_id: rows[rows.length - 1]?._id || '' } }
	}

	return { capabilities, checkClient, publicView, inspect, complete, list }
}

module.exports = { COMPLETION_VERSION, FILLING_VERSION, operationIdForTask, createCompletionProtocol }
