import { createFillingV1 } from '@/services/filling'
import { normalizeBottleNo, normalizeText, todayDate, toNumber } from './shared'

export function createPdaFillingForm(user = {}) {
	return {
		date: todayDate(),
		bottleNo: '',
		fillWeight: '',
		remark: '',
		operator: normalizeText(user?.nickname || user?.username),
		operatorId: normalizeText(user?._id)
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

export async function submitPdaFilling(form = {}, user = {}) {
	const validation = validatePdaFillingForm(form, user)
	if (!validation.ok) return { code: 400, msg: validation.msg }
	return createFillingV1(validation.payload)
}
