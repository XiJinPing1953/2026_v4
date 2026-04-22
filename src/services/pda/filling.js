import { createFillingV1, resolveFillingFillWeightV1 } from '@/services/filling'
import { getPdaScaleLatestV1, normalizePdaScaleSnapshot, PDA_SCALE_DEFAULT_CODE } from './scale'
import { normalizeBottleNo, normalizeText, todayDate, toNumber } from './shared'

export function createPdaFillingForm(user = {}) {
	return {
		date: todayDate(),
		bottleNo: '',
		afterFillTotalWeight: '',
		fillWeight: '',
		fillWeightResolved: false,
		remark: '',
		operator: normalizeText(user?.nickname || user?.username),
		operatorId: normalizeText(user?._id),
		captureMeta: {
			bottle: null,
			totalWeight: null
		}
	}
}

export function buildPdaFillingPayload(form = {}, user = {}) {
	return {
		date: normalizeText(form.date) || todayDate(),
		bottle_no: normalizeBottleNo(form.bottleNo),
		record_type: 'normal_fill',
		operator: normalizeText(form.operator) || normalizeText(user?.nickname || user?.username),
		operator_id: normalizeText(form.operatorId) || normalizeText(user?._id),
		fill_weight: toNumber(form.fillWeight, null),
		remark: normalizeText(form.remark)
	}
}

export function validatePdaFillingForm(form = {}, user = {}) {
	const payload = buildPdaFillingPayload(form, user)
	if (!payload.date) return { ok: false, msg: '请选择日期' }
	if (!payload.bottle_no) return { ok: false, msg: '请填写瓶号' }
	if (!(payload.fill_weight > 0)) return { ok: false, msg: '灌装重量必须大于 0' }
	return { ok: true, payload }
}

async function resolvePreferredTotalWeight(form = {}, options = {}) {
	const manualText = normalizeText(form.afterFillTotalWeight)
	if (manualText) {
		const manualWeight = toNumber(manualText, null)
		if (!(manualWeight > 0)) {
			return {
				code: 400,
				msg: '手工总重格式无效，请修正后重试'
			}
		}
		return {
			code: 0,
			msg: '',
			data: {
				afterFillTotalWeight: manualWeight,
				totalWeightMeta: {
					source: 'manual',
					raw: manualText,
					scale_code: '',
					sampled_at: null,
					gateway_at: null
				}
			}
		}
	}

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
			msg: '暂无可用秤值，请手工输入总重'
		}
	}
	if (!scaleSnapshot.isOnline) {
		return {
			code: 400,
			msg: scaleSnapshot.errorMessage || '秤离线，请手工输入总重'
		}
	}
	if (!scaleSnapshot.isStable) {
		return {
			code: 400,
			msg: '当前秤值未稳定，请稍后重试或手工输入总重'
		}
	}
	if (!(scaleSnapshot.weightKg > 0)) {
		return {
			code: 400,
			msg: '当前秤值无效，请手工输入总重'
		}
	}
	return {
		code: 0,
		msg: '',
		data: {
			afterFillTotalWeight: scaleSnapshot.weightKg,
			totalWeightMeta: {
				source: 'scale_gateway',
				raw: String(scaleSnapshot.weightKg),
				scale_code: scaleSnapshot.scaleCode || PDA_SCALE_DEFAULT_CODE,
				sampled_at: scaleSnapshot.sampledAt || null,
				gateway_at: scaleSnapshot.gatewayAt || null
			}
		}
	}
}

export async function resolvePdaFillingWeight(form = {}, options = {}) {
	const bottleNo = normalizeBottleNo(form.bottleNo)
	if (!bottleNo) return { code: 400, msg: '请先确认瓶号' }
	const totalWeightRes = await resolvePreferredTotalWeight(form, options)
	if (totalWeightRes?.code !== 0) return totalWeightRes
	const afterFillTotalWeight = totalWeightRes.data.afterFillTotalWeight
	const res = await resolveFillingFillWeightV1({
		date: normalizeText(form.date) || todayDate(),
		record_type: 'normal_fill',
		bottle_no: bottleNo,
		after_fill_total_weight: afterFillTotalWeight
	})
	if (res?.code !== 0) return res
	const fillWeight = toNumber(res?.data?.fill_weight, null)
	if (!(fillWeight > 0)) {
		return {
			code: 500,
			msg: '服务端未返回有效灌装重量'
		}
	}
	return {
		code: 0,
		msg: '',
		data: {
			fillWeight,
			afterFillTotalWeight,
			raw: res?.data || null,
			totalWeightMeta: totalWeightRes.data.totalWeightMeta || null
		}
	}
}

export async function submitPdaFilling(form = {}, user = {}) {
	const validation = validatePdaFillingForm(form, user)
	if (!validation.ok) return { code: 400, msg: validation.msg }
	return createFillingV1(validation.payload)
}
