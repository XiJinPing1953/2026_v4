import { callCloud } from '@/services/api'
import { normalizeBottleNo, normalizeText } from './shared'

export const PDA_COMPLETION_VERSION = 'pda-completion-2026-09-08-v1'
const FILLING_VERSION = 'filling-consistency-2026-09-08-v2'

export const PDA_FILLING_STATION_STATUS = {
	COMPLETION_PENDING: 'completion_pending',
	IDLE: 'idle',
	WRITING: 'writing',
	READY: 'ready',
	FILLING: 'filling',
	REACHED: 'reached',
	ABNORMAL: 'abnormal',
	WAIT_ZERO: 'wait_zero'
}

const STATUS_LABELS = {
	completion_pending: '完成待确认',
	idle: '空闲',
	writing: '写入中',
	ready: '待启动',
	filling: '充装中',
	reached: '已到量',
	abnormal: '异常',
	wait_zero: '等待回零'
}

const STATUS_KINDS = {
	completion_pending: 'warning',
	idle: 'info',
	writing: 'warning',
	ready: 'info',
	filling: 'warning',
	reached: 'success',
	abnormal: 'danger',
	wait_zero: 'soft'
}

function toNullableNumber(value) {
	if (value == null || value === '') return null
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function toNullableTimestamp(value) {
	const num = Number(value)
	return Number.isFinite(num) && num > 0 ? num : null
}

export function formatPdaFillingWeight(value, digits = 1) {
	const num = toNullableNumber(value)
	if (num == null) return '--'
	return `${num.toFixed(digits)} kg`
}

export function getPdaFillingStatusLabel(status) {
	return STATUS_LABELS[normalizeText(status)] || '未知'
}

export function getPdaFillingStatusKind(status) {
	return STATUS_KINDS[normalizeText(status)] || 'info'
}

export function normalizePdaFillingScale(data = null) {
	if (!data || typeof data !== 'object') {
		return {
			hasData: false,
			scaleCode: '',
			weightKg: null,
			scaleReadMode: '',
			rawScalePayload: null,
			isStable: false,
			isOnline: false,
			sampledAt: null,
			gatewayAt: null,
			errorCode: 'not_reported',
			errorMessage: 'C606+称重网关尚未上报'
		}
	}
	return {
		hasData: data.has_data === true || data.hasData === true,
		scaleCode: normalizeText(data.scale_code ?? data.scaleCode),
		weightKg: toNullableNumber(data.weight_kg ?? data.weightKg),
		scaleReadMode: normalizeText(data.scale_read_mode ?? data.scaleReadMode),
		rawScalePayload: data.raw_scale_payload ?? data.rawScalePayload ?? null,
		isStable: Boolean(data.is_stable ?? data.isStable),
		isOnline: Boolean(data.is_online ?? data.isOnline),
		sampledAt: toNullableTimestamp(data.sampled_at ?? data.sampledAt),
		gatewayAt: toNullableTimestamp(data.gateway_at ?? data.gatewayAt),
		errorCode: normalizeText(data.error_code ?? data.errorCode),
		errorMessage: normalizeText(data.error_message ?? data.errorMessage)
	}
}

export function normalizePdaFillingTask(data = null) {
	if (!data || typeof data !== 'object') return null
	return {
		_id: normalizeText(data._id || data.id),
		completion: normalizePdaCompletion(data.completion),
		stationCode: normalizeText(data.station_code ?? data.stationCode),
		stationName: normalizeText(data.station_name ?? data.stationName),
		scaleCode: normalizeText(data.scale_code ?? data.scaleCode),
		date: normalizeText(data.date),
		bottleId: normalizeText(data.bottle_id ?? data.bottleId) || null,
		bottleNo: normalizeBottleNo(data.bottle_no ?? data.bottleNo),
		suggestedFillWeightKg: toNullableNumber(data.suggested_fill_weight_kg ?? data.suggestedFillWeightKg),
		targetNetWeight: toNullableNumber(data.target_net_weight ?? data.targetNetWeight),
		targetGrossWeight: toNullableNumber(data.target_gross_weight ?? data.targetGrossWeight),
		weightStart: toNullableNumber(data.weight_start ?? data.weightStart),
		weightEnd: toNullableNumber(data.weight_end ?? data.weightEnd),
		currentNetWeight: toNullableNumber(data.current_net_weight ?? data.currentNetWeight),
		actualNetWeight: toNullableNumber(data.actual_net_weight ?? data.actualNetWeight),
		deviation: toNullableNumber(data.deviation),
		status: normalizeText(data.status),
		effectiveStatus: normalizeText(data.effective_status ?? data.effectiveStatus),
		targetWriteStatus: normalizeText(data.target_write_status ?? data.targetWriteStatus),
		targetWriteError: normalizeText(data.target_write_error ?? data.targetWriteError),
		targetWriteReadback: toNullableNumber(data.target_write_readback ?? data.targetWriteReadback),
		startedAt: toNullableTimestamp(data.started_at ?? data.startedAt),
		endedAt: toNullableTimestamp(data.ended_at ?? data.endedAt),
		completedAt: toNullableTimestamp(data.completed_at ?? data.completedAt),
		fillingRecordId: normalizeText(data.filling_record_id ?? data.fillingRecordId),
		alarmState: Boolean(data.alarm_state ?? data.alarmState),
		remark: normalizeText(data.remark),
		createdAt: toNullableTimestamp(data.created_at ?? data.createdAt),
		updatedAt: toNullableTimestamp(data.updated_at ?? data.updatedAt),
		createdByName: normalizeText(data.created_by_name ?? data.createdByName)
	}
}

export function normalizePdaFillingStation(data = null) {
	if (!data || typeof data !== 'object') return null
	const task = normalizePdaFillingTask(data.task)
	const status = normalizeText(data.status) || task?.effectiveStatus || PDA_FILLING_STATION_STATUS.IDLE
	return {
		stationCode: normalizeText(data.station_code ?? data.stationCode),
		stationName: normalizeText(data.station_name ?? data.stationName),
		scaleCode: normalizeText(data.scale_code ?? data.scaleCode),
		status,
		scale: normalizePdaFillingScale(data.scale),
		task
	}
}

export function normalizePdaFillingBoard(data = null) {
	const rawStations = Array.isArray(data?.stations) ? data.stations : []
	return {
		stations: rawStations.map(normalizePdaFillingStation).filter(Boolean),
		summary: data?.summary && typeof data.summary === 'object' ? data.summary : {},
		refreshedAt: toNullableTimestamp(data?.refreshed_at ?? data?.refreshedAt)
	}
}

export async function getPdaFillingBoardV1() {
	const res = await callCloud('crm-pda-filling', {
		action: 'getBoardV1',
		data: {}
	})
	return {
		code: res?.code ?? -1,
		msg: res?.msg || '',
		data: normalizePdaFillingBoard(res?.data || null)
	}
}

export async function getPdaFillingStationV1(params = {}) {
	const res = await callCloud('crm-pda-filling', {
		action: 'getStationV1',
		data: {
			station_code: params.station_code || params.stationCode || ''
		}
	})
	return {
		code: res?.code ?? -1,
		msg: res?.msg || '',
		data: normalizePdaFillingStation(res?.data || null)
	}
}

export async function getPdaFillingTaskV1(params = {}) {
	const res = await callCloud('crm-pda-filling', {
		action: 'getTaskV1',
		data: {
			task_id: params.task_id || params.taskId || params._id || ''
		}
	})
	return {
		code: res?.code ?? -1,
		msg: res?.msg || '',
		data: {
			station: normalizePdaFillingStation(res?.data?.station || null),
			task: normalizePdaFillingTask(res?.data?.task || null),
			scale: normalizePdaFillingScale(res?.data?.scale || null)
		}
	}
}

export async function createPdaFillingTaskV1(params = {}) {
	await assertPdaCompletionCapabilities()
	return callCloud('crm-pda-filling', {
		action: 'createTaskV1',
		data: {
			completion_protocol: PDA_COMPLETION_VERSION,
			station_code: params.station_code || params.stationCode || '',
			bottle_no: params.bottle_no || params.bottleNo || '',
			target_net_weight: params.target_net_weight ?? params.targetNetWeight,
			remark: params.remark || ''
		}
	})
}

export async function completePdaFillingTaskV1(params = {}) {
	await assertPdaCompletionCapabilities()
	return callCloud('crm-pda-filling', {
		action: 'completeTaskV1',
		data: {
			completion_protocol: PDA_COMPLETION_VERSION,
			task_id: params.task_id || params.taskId || params._id || '',
			remark: params.remark || ''
		}
	})
}

export async function markPdaFillingTaskAbnormalV1(params = {}) {
	await assertPdaCompletionCapabilities()
	return callCloud('crm-pda-filling', {
		action: 'markAbnormalV1',
		data: {
			completion_protocol: PDA_COMPLETION_VERSION,
			task_id: params.task_id || params.taskId || params._id || '',
			remark: params.remark || ''
		}
	})
}

export function normalizePdaCompletion(data = {}) {
	return {
		protocol: normalizeText(data?.protocol),
		operationId: normalizeText(data?.operation_id),
		physicalComplete: data?.physical_complete === true,
		physicalStatus: normalizeText(data?.physical_status),
		operator: normalizeText(data?.operator),
		sourceSaved: data?.source_saved === true && Boolean(normalizeText(data?.filling_record_id)),
		fillingRecordId: normalizeText(data?.filling_record_id),
		processingStatus: normalizeText(data?.processing_status) || 'not_started',
		complete: data?.complete === true && data?.source_saved === true && Boolean(normalizeText(data?.filling_record_id)),
		taskLinked: data?.task_linked === true,
		remainingTotal: toNullableNumber(data?.remaining_total),
		processedTotal: toNullableNumber(data?.processed_total),
		targetTotal: toNullableNumber(data?.target_total),
		canRetry: data?.can_retry === true,
		lastError: normalizeText(data?.last_error),
		legacy: data?.legacy === true
	}
}

export function getPdaCompletionMessage(completion) {
	if (!completion?.sourceSaved) return completion?.physicalComplete ? '完成事实已冻结，源单尚未确认保存' : '源单尚未确认保存'
	if (completion.complete && completion.taskLinked) return '源单已保存，后续处理已完成'
	if (!completion.taskLinked) return '源单已保存，任务回链待确认'
	return '源单已保存，后续处理待完成'
}

export async function assertPdaCompletionCapabilities() {
	const res = await callCloud('crm-pda-filling', { action: 'capabilitiesV1', data: {} })
	if (res?.code !== 0 || res?.data?.completion_protocol !== PDA_COMPLETION_VERSION || res?.data?.filling_protocol !== FILLING_VERSION || res?.data?.durable_completion !== true) {
		throw new Error(res?.msg || 'PDA 灌装后台尚未配套升级，请联系管理员核对版本')
	}
}

export async function listPdaCompletionTasksV1(beforeId = '') {
	const res = await callCloud('crm-pda-filling', { action: 'listCompletionTasksV1', data: { before_id: beforeId } })
	return {
		code: res?.code ?? -1, msg: res?.msg || '',
		data: { items: (res?.data?.items || []).map(normalizePdaFillingTask), hasMore: res?.data?.has_more === true, nextBeforeId: res?.data?.next_before_id || '' }
	}
}
