import { normalizeBottleNo, normalizeText } from './shared'

export const PDA_SCAN_LOCATION_COORDINATE_TYPE = 'wgs84'
export const PDA_SCAN_LOCATION_SOURCE = 'pda_bottle_scan'
export const PDA_FILLING_LABEL_LOCATION_SOURCE = 'pda_bottle_filling_label'
export const PDA_MANUAL_LOCATION_SOURCE = 'pda_bottle_manual'

export const PDA_LOCATION_ERROR_PENDING_AT_SUBMIT = 'pending_at_submit'
export const PDA_LOCATION_ERROR_INTERRUPTED_BACKGROUND = 'interrupted_background'
export const PDA_LOCATION_ERROR_INTERRUPTED_CONTEXT_CHANGED = 'interrupted_context_changed'

const DEFAULT_HIGH_ACCURACY_TIMEOUT_MS = 6000
const DEFAULT_FALLBACK_TIMEOUT_MS = 6000
const NON_FALLBACK_ERROR_PATTERN = /permission|auth|deny|denied|unsupported|拒绝|未授权|权限/i

function nowTimestamp() {
	return Date.now()
}

function normalizeErrorCode(err) {
	return normalizeText(err?.errCode || err?.code || err?.errorCode || 'get_location_failed')
}

function normalizeErrorMessage(err) {
	return normalizeText(err?.errMsg || err?.message || err?.errorMessage || '定位失败')
}

function normalizeLocationSource(value, fallback = PDA_SCAN_LOCATION_SOURCE) {
	return normalizeText(value) || fallback
}

function isNonFallbackError(err) {
	const code = normalizeErrorCode(err)
	const message = normalizeErrorMessage(err)
	return NON_FALLBACK_ERROR_PATTERN.test(code) || NON_FALLBACK_ERROR_PATTERN.test(message)
}

function toFiniteNumber(value) {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'string') {
		const text = value.trim()
		if (!text) return null
		const num = Number(text)
		return Number.isFinite(num) ? num : null
	}
	return null
}

function normalizePositiveTimestamp(value) {
	const num = toFiniteNumber(value)
	return num != null && num > 0 ? num : nowTimestamp()
}

function isValidCoordinate(latitude, longitude) {
	return latitude != null && longitude != null
		&& Number.isFinite(latitude) && Math.abs(latitude) <= 90
		&& Number.isFinite(longitude) && Math.abs(longitude) <= 180
}

function normalizeAccuracy(value) {
	const num = toFiniteNumber(value)
	return num != null && num >= 0 ? num : null
}

export function normalizePdaScanLocation(value) {
	if (!value || typeof value !== 'object') return null
	const status = normalizeText(value.status || (value.latitude != null && value.longitude != null ? 'ok' : 'failed')) || 'failed'
	const capturedAt = normalizePositiveTimestamp(value.capturedAt ?? value.captured_at)
	const base = {
		status,
		coordinateType: normalizeText(value.coordinateType || value.coordinate_type) || PDA_SCAN_LOCATION_COORDINATE_TYPE,
		capturedAt,
		source: normalizeLocationSource(value.source)
	}
	if (status === 'pending') {
		return base
	}
	if (status === 'ok') {
		const latitude = toFiniteNumber(value.latitude)
		const longitude = toFiniteNumber(value.longitude)
		if (!isValidCoordinate(latitude, longitude)) {
			return {
				...base,
				status: 'failed',
				errorCode: 'invalid_location',
				errorMessage: '定位坐标无效'
			}
		}
		return {
			...base,
			latitude,
			longitude,
			accuracy: normalizeAccuracy(value.accuracy)
		}
	}
	return {
		...base,
		status: 'failed',
		errorCode: normalizeText(value.errorCode || value.error_code) || 'get_location_failed',
		errorMessage: normalizeText(value.errorMessage || value.error_message) || '定位失败'
	}
}

export function createPdaScanLocationPending(options = {}) {
	return normalizePdaScanLocation({
		status: 'pending',
		coordinateType: PDA_SCAN_LOCATION_COORDINATE_TYPE,
		capturedAt: normalizePositiveTimestamp(options.capturedAt ?? options.captured_at),
		source: normalizeLocationSource(options.source)
	})
}

function createSuccessLocation(res, capturedAt, source = PDA_SCAN_LOCATION_SOURCE) {
	return normalizePdaScanLocation({
		status: 'ok',
		coordinateType: PDA_SCAN_LOCATION_COORDINATE_TYPE,
		latitude: res?.latitude,
		longitude: res?.longitude,
		accuracy: res?.accuracy,
		capturedAt,
		source: normalizeLocationSource(source)
	})
}

export function createPdaScanLocationFailure(err, capturedAt = nowTimestamp(), source = '') {
	return normalizePdaScanLocation({
		status: 'failed',
		coordinateType: PDA_SCAN_LOCATION_COORDINATE_TYPE,
		capturedAt,
		source: normalizeLocationSource(source || err?.source),
		errorCode: normalizeErrorCode(err),
		errorMessage: normalizeErrorMessage(err)
	})
}

function resolveStageTimeouts(options = {}) {
	const hasExplicitStage = options.highAccuracyTimeoutMs != null || options.fallbackTimeoutMs != null
	if (hasExplicitStage) {
		return {
			highAccuracyTimeoutMs: Math.max(Number(options.highAccuracyTimeoutMs ?? DEFAULT_HIGH_ACCURACY_TIMEOUT_MS), 10),
			fallbackTimeoutMs: Math.max(Number(options.fallbackTimeoutMs ?? DEFAULT_FALLBACK_TIMEOUT_MS), 10)
		}
	}
	if (options.timeoutMs != null) {
		const total = Math.max(Number(options.timeoutMs), 20)
		const highAccuracyTimeoutMs = Math.max(Math.min(Math.floor(total * 0.55), DEFAULT_HIGH_ACCURACY_TIMEOUT_MS), 10)
		const fallbackTimeoutMs = Math.max(total - highAccuracyTimeoutMs, 10)
		return { highAccuracyTimeoutMs, fallbackTimeoutMs }
	}
	return {
		highAccuracyTimeoutMs: DEFAULT_HIGH_ACCURACY_TIMEOUT_MS,
		fallbackTimeoutMs: DEFAULT_FALLBACK_TIMEOUT_MS
	}
}

export function getPdaBottleScanLocation(options = {}) {
	const { highAccuracyTimeoutMs, fallbackTimeoutMs } = resolveStageTimeouts(options)
	const source = normalizeLocationSource(options.source)
	const capturedAt = normalizePositiveTimestamp(options.capturedAt ?? options.captured_at)
	const shouldContinue = typeof options.shouldContinue === 'function' ? options.shouldContinue : null
	const canContinue = () => !shouldContinue || Boolean(shouldContinue())
	if (!canContinue()) {
		return Promise.resolve(createPdaScanLocationFailure({
			code: 'cancelled',
			message: '定位已取消'
		}, capturedAt, source))
	}
	if (typeof uni === 'undefined' || typeof uni.getLocation !== 'function') {
		return Promise.resolve(createPdaScanLocationFailure({
			code: 'unsupported',
			message: '当前环境不支持定位'
		}, capturedAt, source))
	}
	return new Promise((resolve) => {
		let settled = false
		let fallbackStarted = false
		let highTimer = null
		let fallbackTimer = null

		const finish = (value) => {
			if (settled) return
			settled = true
			if (highTimer != null) clearTimeout(highTimer)
			if (fallbackTimer != null) clearTimeout(fallbackTimer)
			resolve(value)
		}

		const startFallback = () => {
			if (settled || fallbackStarted) return
			fallbackStarted = true
			if (highTimer != null) {
				clearTimeout(highTimer)
				highTimer = null
			}
			if (!canContinue()) {
				finish(createPdaScanLocationFailure({
					code: 'cancelled',
					message: '定位已取消'
				}, capturedAt, source))
				return
			}
			fallbackTimer = setTimeout(() => {
				finish(createPdaScanLocationFailure({
					code: 'timeout',
					message: '定位超时'
				}, capturedAt, source))
			}, fallbackTimeoutMs)

			try {
				uni.getLocation({
					type: PDA_SCAN_LOCATION_COORDINATE_TYPE,
					isHighAccuracy: false,
					highAccuracyExpireTime: fallbackTimeoutMs,
					geocode: false,
					success: (res) => finish(createSuccessLocation(res, capturedAt, source)),
					fail: (err) => finish(createPdaScanLocationFailure(err, capturedAt, source))
				})
			} catch (err) {
				finish(createPdaScanLocationFailure(err, capturedAt, source))
			}
		}

		highTimer = setTimeout(() => {
			startFallback()
		}, highAccuracyTimeoutMs)

		try {
			uni.getLocation({
				type: PDA_SCAN_LOCATION_COORDINATE_TYPE,
				isHighAccuracy: true,
				highAccuracyExpireTime: highAccuracyTimeoutMs,
				geocode: false,
				success: (res) => {
					const loc = createSuccessLocation(res, capturedAt, source)
					if (loc?.status === 'ok') {
						finish(loc)
						return
					}
					if (!fallbackStarted) startFallback()
				},
				fail: (err) => {
					if (fallbackStarted) return
					if (isNonFallbackError(err)) {
						finish(createPdaScanLocationFailure(err, capturedAt, source))
						return
					}
					startFallback()
				}
			})
		} catch (err) {
			if (isNonFallbackError(err)) {
				finish(createPdaScanLocationFailure(err, capturedAt, source))
				return
			}
			startFallback()
		}
	})
}

function formatLocationDateTime(value) {
	const num = typeof value === 'number' ? value : Number(value)
	const date = Number.isFinite(num) ? new Date(num) : new Date(String(value || ''))
	if (!date || Number.isNaN(date.getTime())) return normalizeText(value) || '-'
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const hh = String(date.getHours()).padStart(2, '0')
	const mm = String(date.getMinutes()).padStart(2, '0')
	const ss = String(date.getSeconds()).padStart(2, '0')
	return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function resolveLocationSourceLabel(source) {
	const normalized = normalizeText(source).toLowerCase()
	if (normalized === PDA_MANUAL_LOCATION_SOURCE) return 'PDA手输'
	if (normalized === PDA_FILLING_LABEL_LOCATION_SOURCE) return 'PDA充装标签扫码'
	if (normalized === PDA_SCAN_LOCATION_SOURCE || normalized === 'mobile_bottle_scan') return 'PDA扫码'
	return ''
}

function resolveSaleOriginKind(saleDoc) {
	if (!saleDoc || typeof saleDoc !== 'object') return 'unknown'
	const source = normalizeText(saleDoc.source).toLowerCase()
	if (
		source === 'mobile-sale-v1'
		|| Boolean(normalizeText(saleDoc.mobile_create_operation_key))
		|| Boolean(saleDoc.mobile_create_review)
	) {
		return 'mobile'
	}
	const id = normalizeText(saleDoc._id)
	const webKey = normalizeText(saleDoc.web_save_operation_key)
	if (id && webKey && id === webKey) {
		return 'web_manual'
	}
	return 'unknown'
}

export function formatSaleRowLocationText(location, saleDoc = null) {
	if (!location || typeof location !== 'object') {
		const origin = resolveSaleOriginKind(saleDoc)
		if (origin === 'web_manual') return '网页手工建单（未采集定位）'
		if (origin === 'mobile') return '未记录定位（历史记录或未回填）'
		return '未记录定位'
	}
	const sourceLabel = resolveLocationSourceLabel(location.source)
	const prefix = sourceLabel ? `${sourceLabel} · ` : ''
	const status = normalizeText(location.status)
	const capturedAt = location.captured_at || location.capturedAt
	const timeText = capturedAt ? ` / ${formatLocationDateTime(capturedAt)}` : ''

	if (status === 'ok') {
		const lat = toFiniteNumber(location.latitude)
		const lng = toFiniteNumber(location.longitude)
		if (!isValidCoordinate(lat, lng)) return `${prefix}未记录定位`
		const accuracy = normalizeAccuracy(location.accuracy)
		const accuracyText = accuracy != null ? ` / 精度${Math.round(accuracy)}m` : ''
		return `${prefix}${lat.toFixed(6)}, ${lng.toFixed(6)}${accuracyText}${timeText}`
	}

	const errorCode = normalizeText(location.error_code || location.errorCode).toLowerCase()
	const errorText = normalizeText(location.error_message || location.errorMessage)
	if (status === 'pending' || errorCode === PDA_LOCATION_ERROR_PENDING_AT_SUBMIT) {
		return `${prefix}交单时尚无定位结果${timeText}`
	}
	if (errorCode === PDA_LOCATION_ERROR_INTERRUPTED_BACKGROUND) {
		return `${prefix}${errorText || '定位未完成（页面切后台或中断）'}${timeText}`
	}
	if (errorCode === PDA_LOCATION_ERROR_INTERRUPTED_CONTEXT_CHANGED) {
		return `${prefix}${errorText || '定位未完成（客户或车辆已变更）'}${timeText}`
	}
	return errorText ? `${prefix}定位失败：${errorText}` : `${prefix}定位失败`
}

function stripRowLocation(row = {}) {
	if (!row || typeof row !== 'object') return row
	const { scan_location: _s1, scanLocation: _s2, originLocationKey: _k, ...rest } = row
	return rest
}

function countBottleNos(rows = []) {
	const counts = new Map()
	for (const row of rows || []) {
		const no = normalizeBottleNo(row?.bottle_no ?? row?.bottleNo)
		if (!no) continue
		counts.set(no, (counts.get(no) || 0) + 1)
	}
	return counts
}

export function preserveEditedSaleRowLocations(rows = [], options = {}) {
	const list = Array.isArray(rows) ? rows : []
	const originContext = options.originContext
	const currentRecordId = normalizeText(options.currentRecordId)
	const originRecordId = normalizeText(originContext?.recordId)
	const currentDeliveryCustomerId = normalizeText(options.currentDeliveryCustomerId)
	const originDeliveryCustomerId = normalizeText(originContext?.deliveryCustomerId)
	const currentCarNo = normalizeText(options.currentCarNo).toUpperCase()
	const originCarNo = normalizeText(originContext?.carNo).toUpperCase()
	const sameContext = Boolean(
		originContext
		&& currentRecordId && originRecordId && currentRecordId === originRecordId
		&& currentDeliveryCustomerId && originDeliveryCustomerId && currentDeliveryCustomerId === originDeliveryCustomerId
		&& currentCarNo === originCarNo
	)
	if (!sameContext) {
		return list.map(stripRowLocation)
	}
	const originRows = options.direction === 'back'
		? (Array.isArray(originContext.back) ? originContext.back : [])
		: (Array.isArray(originContext.out) ? originContext.out : [])
	const originCounts = countBottleNos(originRows)
	const currentCounts = countBottleNos(list)
	const originByKey = new Map()
	for (const row of originRows) {
		const key = normalizeText(row?.originLocationKey)
		if (!key) continue
		originByKey.set(key, row)
	}
	const currentKeyCounts = new Map()
	for (const row of list) {
		const key = normalizeText(row?.originLocationKey)
		if (!key) continue
		currentKeyCounts.set(key, (currentKeyCounts.get(key) || 0) + 1)
	}
	return list.map((row) => {
		const key = normalizeText(row?.originLocationKey)
		const clean = stripRowLocation(row)
		if (!key || currentKeyCounts.get(key) !== 1) return clean
		const originRow = originByKey.get(key)
		if (!originRow) return clean
		const originNo = normalizeBottleNo(originRow.bottle_no ?? originRow.bottleNo)
		const currentNo = normalizeBottleNo(clean?.bottle_no ?? clean?.bottleNo)
		if (!originNo || !currentNo || originNo !== currentNo) return clean
		if (originCounts.get(originNo) !== 1 || currentCounts.get(currentNo) !== 1) return clean
		const originBottleId = normalizeText(originRow.bottle_id ?? originRow.bottleId)
		const currentBottleId = normalizeText(clean.bottle_id ?? clean.bottleId)
		if (originBottleId && currentBottleId && originBottleId !== currentBottleId) return clean
		const originLoc = originRow.scan_location || originRow.scanLocation
		if (!originLoc || typeof originLoc !== 'object') return clean
		return {
			...clean,
			scan_location: { ...originLoc }
		}
	})
}
