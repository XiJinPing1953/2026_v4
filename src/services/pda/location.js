import { normalizeText, toNumber } from './shared'

export const PDA_SCAN_LOCATION_COORDINATE_TYPE = 'wgs84'
export const PDA_SCAN_LOCATION_SOURCE = 'pda_bottle_scan'

const DEFAULT_LOCATION_TIMEOUT_MS = 8000

function nowTimestamp() {
	return Date.now()
}

function normalizeErrorCode(err) {
	return normalizeText(err?.errCode || err?.code || err?.errorCode || 'get_location_failed')
}

function normalizeErrorMessage(err) {
	return normalizeText(err?.errMsg || err?.message || err?.errorMessage || '定位失败')
}

export function normalizePdaScanLocation(value) {
	if (!value || typeof value !== 'object') return null
	const status = normalizeText(value.status || (value.latitude != null && value.longitude != null ? 'ok' : 'failed')) || 'failed'
	const capturedAt = toNumber(value.capturedAt ?? value.captured_at, null) || nowTimestamp()
	const base = {
		status,
		coordinateType: normalizeText(value.coordinateType || value.coordinate_type) || PDA_SCAN_LOCATION_COORDINATE_TYPE,
		capturedAt,
		source: normalizeText(value.source) || PDA_SCAN_LOCATION_SOURCE
	}
	if (status === 'ok') {
		const latitude = toNumber(value.latitude, null)
		const longitude = toNumber(value.longitude, null)
		if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
			return {
				...base,
				status: 'failed',
				errorCode: 'invalid_location',
				errorMessage: '定位结果缺少经纬度'
			}
		}
		const accuracy = toNumber(value.accuracy, null)
		return {
			...base,
			latitude,
			longitude,
			accuracy: Number.isFinite(accuracy) ? accuracy : null
		}
	}
	return {
		...base,
		status: 'failed',
		errorCode: normalizeText(value.errorCode || value.error_code) || 'get_location_failed',
		errorMessage: normalizeText(value.errorMessage || value.error_message) || '定位失败'
	}
}

function createSuccessLocation(res, capturedAt) {
	return normalizePdaScanLocation({
		status: 'ok',
		coordinateType: PDA_SCAN_LOCATION_COORDINATE_TYPE,
		latitude: res?.latitude,
		longitude: res?.longitude,
		accuracy: res?.accuracy,
		capturedAt,
		source: PDA_SCAN_LOCATION_SOURCE
	})
}

export function createPdaScanLocationFailure(err, capturedAt = nowTimestamp()) {
	return normalizePdaScanLocation({
		status: 'failed',
		coordinateType: PDA_SCAN_LOCATION_COORDINATE_TYPE,
		capturedAt,
		source: PDA_SCAN_LOCATION_SOURCE,
		errorCode: normalizeErrorCode(err),
		errorMessage: normalizeErrorMessage(err)
	})
}

export function getPdaBottleScanLocation(options = {}) {
	const timeoutMs = Math.max(Number(options.timeoutMs || DEFAULT_LOCATION_TIMEOUT_MS), 1000)
	const capturedAt = nowTimestamp()
	if (typeof uni === 'undefined' || typeof uni.getLocation !== 'function') {
		return Promise.resolve(createPdaScanLocationFailure({
			code: 'unsupported',
			message: '当前环境不支持定位'
		}, capturedAt))
	}
	return new Promise((resolve) => {
		let settled = false
		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			resolve(createPdaScanLocationFailure({
				code: 'timeout',
				message: '定位超时'
			}, capturedAt))
		}, timeoutMs)

		const finish = (value) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			resolve(value)
		}

		try {
			uni.getLocation({
				type: PDA_SCAN_LOCATION_COORDINATE_TYPE,
				isHighAccuracy: true,
				geocode: false,
				success: (res) => finish(createSuccessLocation(res, capturedAt)),
				fail: (err) => finish(createPdaScanLocationFailure(err, capturedAt))
			})
		} catch (err) {
			finish(createPdaScanLocationFailure(err, capturedAt))
		}
	})
}
