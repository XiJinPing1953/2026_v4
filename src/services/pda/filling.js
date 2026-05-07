import { createFillingV1 } from '@/services/filling'
import { getPdaScaleLatestV1, normalizePdaScaleSnapshot, PDA_SCALE_DEFAULT_CODE } from './scale'
import { normalizeBottleNo, normalizeText, todayDate, toNumber } from './shared'

const FILLING_WEIGHT_DECIMALS = 3

function roundFillingWeight(value) {
	const num = toNumber(value, null)
	if (num == null) return null
	return Number(num.toFixed(FILLING_WEIGHT_DECIMALS))
}

export function createPdaFillingForm(user = {}) {
	return {
		date: todayDate(),
		bottleNo: '',
		weightStart: '',
		targetInputMode: 'net',
		targetNetWeight: '',
		targetGrossWeight: '',
		weightEnd: '',
		actualNetWeight: '',
		deviation: '',
		fillWeight: '',
		fillWeightResolved: false,
		startedAt: null,
		endedAt: null,
		status: 'pending',
		alarmState: false,
		remark: '',
		operator: normalizeText(user?.nickname || user?.username),
		operatorId: normalizeText(user?._id),
		captureMeta: {
			bottle: null,
			startWeight: null,
			targetWeight: null,
			endWeight: null
		}
	}
}

export function buildPdaFillingPayload(form = {}, user = {}) {
	const weightStart = roundFillingWeight(form.weightStart)
	const targetNetWeight = roundFillingWeight(form.targetNetWeight)
	const targetGrossWeight = roundFillingWeight(form.targetGrossWeight)
	const weightEnd = roundFillingWeight(form.weightEnd)
	const actualNetWeight = roundFillingWeight(form.actualNetWeight ?? form.fillWeight)
	const deviation = roundFillingWeight(form.deviation)
	const endMeta = form.captureMeta?.endWeight || null
	const startMeta = form.captureMeta?.startWeight || null
	const startedAt = toNumber(form.startedAt ?? form.started_at, null)
	const endedAt = toNumber(form.endedAt ?? form.ended_at, null)
	return {
		date: normalizeText(form.date) || todayDate(),
		bottle_no: normalizeBottleNo(form.bottleNo),
		record_type: 'normal_fill',
		operator: normalizeText(form.operator) || normalizeText(user?.nickname || user?.username),
		operator_id: normalizeText(form.operatorId) || normalizeText(user?._id),
		fill_weight: actualNetWeight,
		weight_start: weightStart,
		target_net_weight: targetNetWeight,
		target_gross_weight: targetGrossWeight,
		weight_end: weightEnd,
		actual_net_weight: actualNetWeight,
		deviation,
		scale_source: 'C606+',
		scale_read_mode: normalizeText(endMeta?.scale_read_mode || endMeta?.scaleReadMode || startMeta?.scale_read_mode || startMeta?.scaleReadMode),
		started_at: startedAt,
		ended_at: endedAt,
		status: normalizeText(form.status) || 'completed',
		alarm_state: Boolean(form.alarmState ?? form.alarm_state),
		raw_scale_payload: {
			start: startMeta || null,
			target: form.captureMeta?.targetWeight || null,
			end: endMeta || null
		},
		remark: normalizeText(form.remark)
	}
}

export function validatePdaFillingForm(form = {}, user = {}) {
	const payload = buildPdaFillingPayload(form, user)
	if (!payload.date) return { ok: false, msg: '请选择日期' }
	if (!payload.bottle_no) return { ok: false, msg: '请填写瓶号' }
	if (!(payload.weight_start > 0)) return { ok: false, msg: '请先读取瓶上秤重量' }
	if (!(payload.target_net_weight > 0)) return { ok: false, msg: '目标净充重量必须大于 0' }
	if (!(payload.target_gross_weight > payload.weight_start)) return { ok: false, msg: '目标总重必须大于瓶上秤重量' }
	if (!(payload.started_at > 0)) return { ok: false, msg: '请先确认开始充装' }
	if (!(payload.weight_end > 0)) return { ok: false, msg: '请在充装结束后读取最终毛重' }
	if (!(payload.ended_at > 0)) return { ok: false, msg: '请读取结束总重' }
	if (!(payload.fill_weight > 0)) return { ok: false, msg: '实际净充重量必须大于 0' }
	return { ok: true, payload }
}

export async function resolvePdaScaleGrossWeight(options = {}) {
	const scaleSnapshot =
		options.scaleSnapshot && typeof options.scaleSnapshot === 'object'
			? normalizePdaScaleSnapshot(options.scaleSnapshot, options.scaleSnapshot.scaleCode || PDA_SCALE_DEFAULT_CODE)
			: await (async () => {
					try {
						const res = await getPdaScaleLatestV1({ scale_code: options.scaleCode || PDA_SCALE_DEFAULT_CODE })
						return res.data
					} catch (error) {
						return {
							hasData: false,
							scaleCode: options.scaleCode || PDA_SCALE_DEFAULT_CODE,
							weightKg: null,
							isStable: false,
							isOnline: false,
							sampledAt: null,
							gatewayAt: null,
							errorCode: 'scale_fetch_failed',
							errorMessage: normalizeText(error?.message) || '秤状态读取失败'
						}
					}
				})()

	if (!scaleSnapshot?.hasData) {
		return {
			code: 400,
			msg: '暂无可用 C606+ 秤值'
		}
	}
	if (!scaleSnapshot.isOnline) {
		return {
			code: 400,
			msg: scaleSnapshot.errorMessage || 'C606+ 秤离线'
		}
	}
	if (!scaleSnapshot.isStable) {
		return {
			code: 400,
			msg: '当前 C606+ 毛重未稳定，请稍后重试'
		}
	}
	if (!(scaleSnapshot.weightKg > 0)) {
		return {
			code: 400,
			msg: '当前 C606+ 毛重无效'
		}
	}
	const weightKg = roundFillingWeight(scaleSnapshot.weightKg)
	return {
		code: 0,
		msg: '',
		data: {
			weightKg,
			meta: {
				source: 'scale_gateway',
				scale_source: 'C606+',
				scale_read_mode: scaleSnapshot.scaleReadMode || '',
				raw: String(weightKg),
				scale_code: scaleSnapshot.scaleCode || PDA_SCALE_DEFAULT_CODE,
				sampled_at: scaleSnapshot.sampledAt || null,
				gateway_at: scaleSnapshot.gatewayAt || null,
				raw_scale_payload: scaleSnapshot.rawScalePayload || null
			}
		}
	}
}

export async function submitPdaFilling(form = {}, user = {}) {
	const validation = validatePdaFillingForm(form, user)
	if (!validation.ok) return { code: 400, msg: validation.msg }
	return createFillingV1(validation.payload)
}
