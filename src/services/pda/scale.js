import { callCloud } from '@/services/api'
import { normalizeText } from './shared'

export const PDA_SCALE_DEFAULT_CODE = 'filling_scale_main'

function normalizeScaleCode(value) {
	return normalizeText(value) || PDA_SCALE_DEFAULT_CODE
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

export function normalizePdaScaleSnapshot(data = null, scaleCode = PDA_SCALE_DEFAULT_CODE) {
	if (!data || typeof data !== 'object') {
		return {
			hasData: false,
			scaleCode: normalizeScaleCode(scaleCode),
			weightKg: null,
			isStable: false,
			isOnline: false,
			sampledAt: null,
			gatewayAt: null,
			errorCode: 'not_reported',
			errorMessage: '秤网关尚未上报'
		}
	}
	return {
		hasData: data.has_data === true || data.hasData === true,
		scaleCode: normalizeScaleCode(data.scale_code ?? data.scaleCode ?? scaleCode),
		weightKg: toNullableNumber(data.weight_kg ?? data.weightKg),
		isStable: Boolean(data.is_stable ?? data.isStable),
		isOnline: Boolean(data.is_online ?? data.isOnline),
		sampledAt: toNullableTimestamp(data.sampled_at ?? data.sampledAt),
		gatewayAt: toNullableTimestamp(data.gateway_at ?? data.gatewayAt),
		errorCode: normalizeText(data.error_code ?? data.errorCode) || null,
		errorMessage: normalizeText(data.error_message ?? data.errorMessage) || null
	}
}

export async function getPdaScaleLatestV1(params = {}) {
	const scaleCode = normalizeScaleCode(params.scale_code ?? params.scaleCode)
	const res = await callCloud('crm-pda-scale', {
		action: 'getLatestV1',
		data: {
			scale_code: scaleCode
		},
		timeout: Number(params.timeout || 4000) || 4000
	})
	return {
		code: res?.code ?? -1,
		msg: res?.msg || '',
		data: normalizePdaScaleSnapshot(res?.data || null, scaleCode)
	}
}
