import { resolveDeliveryQrCodeV1, searchDeliveriesV1 } from '@/services/delivery'
import { normalizeQrCode, normalizeText } from './shared'

export async function listPdaDeliveries(params = {}) {
	const res = await searchDeliveriesV1({
		keyword: normalizeText(params.keyword),
		page: Number(params.page || 1),
		pageSize: Number(params.pageSize || 20),
		isActive: params.isActive ?? true
	})
	return {
		code: res?.code ?? -1,
		msg: res?.msg || '',
		data: Array.isArray(res?.data) ? res.data : [],
		paging: res?.paging || {
			page: Number(params.page || 1),
			pageSize: Number(params.pageSize || 20),
			total: Array.isArray(res?.data) ? res.data.length : 0,
			hasMore: false
		}
	}
}

export async function resolvePdaDeliveryByQrCode(qrCode) {
	const normalized = normalizeQrCode(qrCode)
	if (!normalized) return { code: 400, msg: '配送员二维码必填', data: null }
	const res = await resolveDeliveryQrCodeV1({ qr_code: normalized })
	if (res?.code !== 0) return { code: res?.code ?? -1, msg: res?.msg || '配送员扫码失败', data: null }
	return {
		code: 0,
		msg: '',
		data: res?.data?.delivery || null
	}
}
