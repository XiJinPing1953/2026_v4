import { normalizePdaScanLocation, getPdaBottleScanLocation, createPdaScanLocationFailure } from './location'

const CLIENT = 'com.amap.api.location.AMapLocationClient'
const OPTIONS = 'com.amap.api.location.AMapLocationClientOption'
const FINE_LOCATION = 'android.permission.ACCESS_FINE_LOCATION'
const MAX_FIX_AGE_MS = 30000
const REQUEST_TIMEOUT_MS = 23000

export function readSaleLocationChoice(owner) {
	if (!owner) return ''
	try {
		return uni.getStorageSync('pda.sale.amap.choice.v1.' + owner) || ''
	} catch {
		return ''
	}
}

export function saveSaleLocationChoice(owner, choice) {
	if (!owner || !['amap', 'system'].includes(choice)) return
	uni.setStorageSync('pda.sale.amap.choice.v1.' + owner, choice)
}

export function readAmapFix(android, location, now) {
	if (!location) return null
	const get = method => android.invoke(location, method)
	if (Number(get('getErrorCode')) !== 0 || ![5, 6].includes(Number(get('getLocationType')))) return null
	if (get('isMock') || get('isFromMockProvider')) return null
	const time = Number(get('getTime'))
	const coordinateType = String(get('getCoordType')).toLowerCase().replace('-', '')
	const latitude = get('getLatitude')
	const longitude = get('getLongitude')
	const accuracy = get('getAccuracy')
	if (!['gcj02', 'wgs84'].includes(coordinateType) || !Number.isFinite(time) || time > now + 2000 || now - time > MAX_FIX_AGE_MS) return null
	if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || (!latitude && !longitude)) return null
	if (!Number.isFinite(accuracy) || accuracy <= 0) return null
	return { status: 'ok', coordinateType, capturedAt: time, latitude, longitude, accuracy }
}

// Each open sale page owns its client. Overlapping bottle lookups may await
// the same live fix, but a completed request is never cached for the next row.
export function createSaleLocationSession(mayUseAmap) {
	let active = null
	let generation = 0

	function cancel() {
		generation++
		active?.finish(null)
	}

	function requestNetworkFix(canContinue) {
		if (active) {
			active.waiters.add(canContinue)
			return active.promise
		}
		const android = plus.android
		let client, listener, timer, resolve
		const promise = new Promise(done => { resolve = done })
		const request = { promise, finish, waiters: new Set([canContinue]) }
		active = request

		function finish(fix) {
			if (active !== request) return
			active = null
			clearTimeout(timer)
			if (client) {
				try { android.invoke(client, 'stopLocation') } catch {}
				try { if (listener) android.invoke(client, 'unRegisterLocationListener', listener) } catch {}
				try { android.invoke(client, 'onDestroy') } catch {}
			}
			resolve(fix)
		}

		function start() {
			if (active !== request || !mayUseAmap() || ![...request.waiters].some(valid => valid())) return finish(null)
			try {
				const context = android.invoke(android.runtimeMainActivity(), 'getApplicationContext')
				const sdk = android.importClass(CLIENT)
				sdk.updatePrivacyShow(context, true, true)
				sdk.updatePrivacyAgree(context, true)
				const options = android.newObject(OPTIONS)
				const modes = android.importClass(OPTIONS + '$AMapLocationMode')
				android.invoke(options, 'setLocationMode', modes.Battery_Saving)
				android.invoke(options, 'setOnceLocation', true)
				android.invoke(options, 'setOnceLocationLatest', true)
				android.invoke(options, 'setLocationCacheEnable', false)
				android.invoke(options, 'setNeedAddress', false)
				android.invoke(options, 'setHttpTimeOut', 16000)
				client = android.newObject(CLIENT, context)
				listener = android.implements('com.amap.api.location.AMapLocationListener', {
					onLocationChanged(location) {
						if (active !== request) return
						try { finish(mayUseAmap() ? readAmapFix(android, location, Date.now()) : null) }
						catch { finish(null) }
					}
				})
				android.invoke(client, 'setLocationListener', listener)
				android.invoke(client, 'setLocationOption', options)
				android.invoke(client, 'startLocation')
			} catch { finish(null) }
		}

		timer = setTimeout(() => finish(null), REQUEST_TIMEOUT_MS)
		try {
			android.requestPermissions([FINE_LOCATION], result => {
				if (result?.granted?.includes(FINE_LOCATION)) start()
				else finish({ permissionDenied: true })
			}, () => finish(null))
		} catch { finish(null) }
		return promise
	}

	async function locate(options) {
		const canContinue = () => !options.shouldContinue || options.shouldContinue()
		if (!canContinue()) return null
		if (mayUseAmap() && typeof plus !== 'undefined' && plus.android) {
			const ticket = generation
			const fix = await requestNetworkFix(canContinue)
			if (ticket !== generation || !canContinue()) return null
			if (fix?.permissionDenied) return createPdaScanLocationFailure({ code: 'permission_denied', message: '系统未授权定位' }, options.capturedAt, options.source)
			if (fix && mayUseAmap()) return normalizePdaScanLocation({ ...fix, source: options.source })
		}
		return getPdaBottleScanLocation(options)
	}

	return { locate, cancel }
}
