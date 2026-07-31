import { finiteLocationNumber } from './homeSafetyInspectionLocationPolicy.mjs'

const LOCATION_TIMEOUT_MS = 12000

function failedLocation(errorCode, errorMessage) {
	return {
		status: 'failed',
		coordinate_type: 'wgs84',
		latitude: null,
		longitude: null,
		accuracy: null,
		error_code: String(errorCode || ''),
		error_message: String(errorMessage || '定位失败'),
		captured_at: Date.now(),
		source: 'home_safety_inspection_h5'
	}
}

export function captureWgs84Location() {
	return new Promise((resolve) => {
		let settled = false
		let timeoutId = null
		const finish = (result) => {
			if (settled) return
			settled = true
			if (timeoutId) clearTimeout(timeoutId)
			resolve(result)
		}
		timeoutId = setTimeout(
			() => finish(failedLocation('location_timeout', '定位超时')),
			LOCATION_TIMEOUT_MS
		)
		try {
			uni.getLocation({
				type: 'wgs84',
				isHighAccuracy: true,
				highAccuracyExpireTime: 8000,
				success(res) {
					const latitude = finiteLocationNumber(res.latitude)
					const longitude = finiteLocationNumber(res.longitude)
					if (
						latitude == null ||
						longitude == null ||
						latitude < -90 ||
						latitude > 90 ||
						longitude < -180 ||
						longitude > 180
					) {
						finish(failedLocation('invalid_coordinates', '定位坐标无效'))
						return
					}
					const rawAccuracy = res.accuracy
					const accuracy = finiteLocationNumber(rawAccuracy)
					finish({
						status: 'ok',
						coordinate_type: 'wgs84',
						latitude,
						longitude,
						accuracy,
						captured_at: Date.now(),
						source: 'home_safety_inspection_h5'
					})
				},
				fail(err) {
					finish(failedLocation(err?.errCode, err?.errMsg))
				}
			})
		} catch (err) {
			finish(failedLocation('location_exception', err?.message))
		}
	})
}
