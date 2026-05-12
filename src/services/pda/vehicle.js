import { resolveVehicleQrCodeV1, searchVehiclesV1 } from '@/services/vehicle'
import { normalizePlateNo, normalizeQrCode, normalizeText } from './shared'

const VEHICLE_QR_CACHE_TTL_MS = 30 * 1000
const vehicleQrCache = new Map()

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

export async function listPdaVehicles(params = {}) {
	const res = await searchVehiclesV1({
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

export async function resolvePdaVehicleByQrCode(qrCode) {
	const normalized = normalizeQrCode(qrCode)
	if (!normalized) return { code: 400, msg: '车辆二维码必填', data: null }
	const cached = readCache(vehicleQrCache, normalized)
	if (cached) return { code: 0, msg: '', data: cached }
	const res = await resolveVehicleQrCodeV1({ qr_code: normalized })
	if (res?.code !== 0) return { code: res?.code ?? -1, msg: res?.msg || '车辆扫码失败', data: null }
	const vehicle = res?.data?.vehicle || null
	return {
		code: 0,
		msg: '',
		data: writeCache(vehicleQrCache, normalized, vehicle
			? {
					...vehicle,
					plate_no: normalizePlateNo(vehicle.plate_no)
				}
			: null, VEHICLE_QR_CACHE_TTL_MS)
	}
}
