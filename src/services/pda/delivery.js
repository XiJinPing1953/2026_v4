import { resolveDeliveryQrCodeV1, searchDeliveriesV1 } from '@/services/delivery'
import { normalizeQrCode, normalizeText } from './shared'

const DELIVERY_QR_CACHE_TTL_MS = 30 * 1000
const deliveryQrCache = new Map()

function readCache(cache, key) {
	if (!key || !cache.has(key)) return null
	const cached = cache.get(key)
	if (!cached || Number(cached.expireAt || 0) <= Date.now()) {
		cache.delete(key)
		return null
	}
	return cached.data || null
}

function writeCache(cache, key, data, ttlMs) {
	if (!key || !data) return data
	cache.set(key, {
		data,
		expireAt: Date.now() + Math.max(Number(ttlMs) || 0, 1000)
	})
	return data
}

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
	const cached = readCache(deliveryQrCache, normalized)
	if (cached) return { code: 0, msg: '', data: cached }
	const res = await resolveDeliveryQrCodeV1({ qr_code: normalized })
	if (res?.code !== 0) return { code: res?.code ?? -1, msg: res?.msg || '配送员扫码失败', data: null }
	return {
		code: 0,
		msg: '',
		data: writeCache(deliveryQrCache, normalized, res?.data?.delivery || null, DELIVERY_QR_CACHE_TTL_MS)
	}
}
