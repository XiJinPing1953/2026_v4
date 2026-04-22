import { resolveVehicleQrCodeV1, searchVehiclesV1 } from '@/services/vehicle'
import { normalizePlateNo, normalizeQrCode, normalizeText } from './shared'

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
	const res = await resolveVehicleQrCodeV1({ qr_code: normalized })
	if (res?.code !== 0) return { code: res?.code ?? -1, msg: res?.msg || '车辆扫码失败', data: null }
	const vehicle = res?.data?.vehicle || null
	return {
		code: 0,
		msg: '',
		data: vehicle
			? {
					...vehicle,
					plate_no: normalizePlateNo(vehicle.plate_no)
				}
			: null
	}
}
