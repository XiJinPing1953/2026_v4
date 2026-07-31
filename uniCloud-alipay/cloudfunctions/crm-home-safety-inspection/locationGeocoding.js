'use strict'

const AMAP_COORDINATE_CONVERT_URL = 'https://restapi.amap.com/v3/assistant/coordinate/convert'
const AMAP_REVERSE_GEOCODE_URL = 'https://restapi.amap.com/v3/geocode/regeo'
const DEFAULT_TIMEOUT_MS = 8000

function normalizeComponent(value) {
	if (Array.isArray(value)) {
		for (const item of value) {
			const normalized = normalizeComponent(item)
			if (normalized) return normalized
		}
		return ''
	}
	if (value == null || typeof value === 'object') return ''
	return String(value).replace(/\s+/g, ' ').trim()
}

function firstComponent(...values) {
	for (const value of values) {
		const normalized = normalizeComponent(value)
		if (normalized) return normalized
	}
	return ''
}

function namedComponent(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
	return normalizeComponent(value.name)
}

function extractAddressComponents(addressComponent) {
	const source =
		addressComponent && typeof addressComponent === 'object' && !Array.isArray(addressComponent)
			? addressComponent
			: {}
	const streetNumber =
		source.streetNumber && typeof source.streetNumber === 'object' && !Array.isArray(source.streetNumber)
			? source.streetNumber
			: {}
	return {
		district: firstComponent(source.district, source.county),
		township: firstComponent(source.township, source.town, source.subdistrict),
		community_or_village: firstComponent(
			source.community_or_village,
			source.village,
			source.village_name,
			source.villageName,
			namedComponent(source.neighborhood)
		),
		street: firstComponent(streetNumber.street, source.street, source.road)
	}
}

function appendAddressPart(parts, value) {
	const text = normalizeComponent(value)
	if (!text) return
	const current = parts.join('')
	if (!current) {
		parts.push(text)
		return
	}
	if (current === text || current.endsWith(text) || current.includes(text)) return
	if (text.startsWith(current)) {
		parts.splice(0, parts.length, text)
		return
	}
	const previous = parts[parts.length - 1]
	if (previous && text.startsWith(previous)) {
		parts[parts.length - 1] = text
		return
	}
	parts.push(text)
}

function buildAddressText(addressComponent) {
	const components = extractAddressComponents(addressComponent)
	const parts = []
	appendAddressPart(parts, components.district)
	appendAddressPart(parts, components.township)
	appendAddressPart(parts, components.community_or_village)
	appendAddressPart(parts, components.street)
	return parts.join('')
}

function finiteCoordinate(value) {
	if (value == null || typeof value === 'boolean') return null
	if (typeof value === 'string' && !value.trim()) return null
	const number = Number(value)
	return Number.isFinite(number) ? number : null
}

function validateWgs84Coordinates(latitude, longitude) {
	const normalizedLatitude = finiteCoordinate(latitude)
	const normalizedLongitude = finiteCoordinate(longitude)
	if (
		normalizedLatitude == null ||
		normalizedLongitude == null ||
		normalizedLatitude < -90 ||
		normalizedLatitude > 90 ||
		normalizedLongitude < -180 ||
		normalizedLongitude > 180
	) {
		return { ok: false, code: 'invalid_coordinates', message: '定位坐标无效' }
	}
	return {
		ok: true,
		latitude: normalizedLatitude,
		longitude: normalizedLongitude
	}
}

function normalizeTimeout(value) {
	const number = Number(value)
	if (!Number.isFinite(number)) return DEFAULT_TIMEOUT_MS
	return Math.min(Math.max(Math.round(number), 1000), 30000)
}

function buildRequestUrl(baseUrl, params) {
	const query = Object.entries(params)
		.filter(([, value]) => value !== undefined && value !== null && value !== '')
		.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
		.join('&')
	return `${baseUrl}?${query}`
}

function formatCoordinate(value) {
	return Number(value).toFixed(6).replace(/\.?0+$/, '')
}

function responseBody(response) {
	if (response == null) return null
	if (typeof response === 'string') {
		try {
			return JSON.parse(response)
		} catch (_) {
			return null
		}
	}
	if (typeof response !== 'object') return null
	const statusCode = finiteCoordinate(response.statusCode ?? response.status_code)
	if (statusCode != null && (statusCode < 200 || statusCode >= 300)) return null
	if (
		Object.prototype.hasOwnProperty.call(response, 'data') &&
		response.data &&
		typeof response.data === 'object'
	) {
		return response.data
	}
	return response
}

async function requestJson(requester, url, timeoutMs) {
	let timeoutId = null
	try {
		const response = await Promise.race([
			requester(url, {
				method: 'GET',
				dataType: 'json',
				timeout: timeoutMs
			}),
			new Promise((_, reject) => {
				timeoutId = setTimeout(() => reject(new Error('map_request_timeout')), timeoutMs)
			})
		])
		const body = responseBody(response)
		return body
			? { ok: true, data: body }
			: { ok: false, code: 'request_failed', message: '地图服务请求失败' }
	} catch (_) {
		return { ok: false, code: 'request_failed', message: '地图服务请求失败' }
	} finally {
		if (timeoutId) clearTimeout(timeoutId)
	}
}

function parseConvertedCoordinates(value) {
	const text = normalizeComponent(value)
	const firstLocation = text.split(';')[0]
	const [longitudeText, latitudeText] = firstLocation.split(',')
	const validation = validateWgs84Coordinates(latitudeText, longitudeText)
	if (!validation.ok) return null
	return {
		longitude: validation.longitude,
		latitude: validation.latitude
	}
}

function createUniCloudRequester(httpclient) {
	if (!httpclient || typeof httpclient.request !== 'function') return null
	return async (url, options = {}) => {
		const response = await httpclient.request(url, {
			method: options.method || 'GET',
			dataType: options.dataType || 'json',
			timeout: normalizeTimeout(options.timeout)
		})
		const statusCode = finiteCoordinate(response && (response.statusCode ?? response.status))
		if (statusCode != null && (statusCode < 200 || statusCode >= 300)) {
			throw new Error('map_http_request_failed')
		}
		return response && Object.prototype.hasOwnProperty.call(response, 'data')
			? response.data
			: response
	}
}

async function reverseGeocodeWgs84({
	latitude,
	longitude,
	apiKey,
	requester,
	timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
	const coordinates = validateWgs84Coordinates(latitude, longitude)
	if (!coordinates.ok) return coordinates

	const key = normalizeComponent(apiKey)
	if (!key) return { ok: false, code: 'missing_api_key', message: '地图服务未配置' }
	if (typeof requester !== 'function') {
		return { ok: false, code: 'requester_unavailable', message: '地图服务请求器不可用' }
	}

	const timeout = normalizeTimeout(timeoutMs)
	const deadline = Date.now() + timeout
	const remainingTimeout = () => Math.max(deadline - Date.now(), 1)
	const convertUrl = buildRequestUrl(AMAP_COORDINATE_CONVERT_URL, {
		key,
		locations: `${formatCoordinate(coordinates.longitude)},${formatCoordinate(coordinates.latitude)}`,
		coordsys: 'gps',
		output: 'json'
	})
	const convertedResponse = await requestJson(requester, convertUrl, remainingTimeout())
	if (!convertedResponse.ok) return convertedResponse
	if (String(convertedResponse.data.status) !== '1') {
		return { ok: false, code: 'coordinate_convert_failed', message: '定位坐标转换失败' }
	}
	const amapCoordinates = parseConvertedCoordinates(convertedResponse.data.locations)
	if (!amapCoordinates) {
		return { ok: false, code: 'coordinate_convert_failed', message: '定位坐标转换失败' }
	}

	const reverseUrl = buildRequestUrl(AMAP_REVERSE_GEOCODE_URL, {
		key,
		location: `${formatCoordinate(amapCoordinates.longitude)},${formatCoordinate(amapCoordinates.latitude)}`,
		extensions: 'base',
		output: 'json'
	})
	if (Date.now() >= deadline) {
		return { ok: false, code: 'request_failed', message: '地图服务请求失败' }
	}
	const reverseResponse = await requestJson(requester, reverseUrl, remainingTimeout())
	if (!reverseResponse.ok) return reverseResponse
	if (String(reverseResponse.data.status) !== '1') {
		return { ok: false, code: 'reverse_geocode_failed', message: '定位地址解析失败' }
	}

	const regeocode =
		reverseResponse.data.regeocode &&
		typeof reverseResponse.data.regeocode === 'object' &&
		!Array.isArray(reverseResponse.data.regeocode)
			? reverseResponse.data.regeocode
			: {}
	const components = extractAddressComponents(regeocode.addressComponent)
	const addressText = buildAddressText(components)
	if (
		!addressText ||
		!components.district ||
		!(components.township || components.community_or_village || components.street)
	) {
		return { ok: false, code: 'partial_address', message: '定位地址解析结果不完整' }
	}

	return {
		ok: true,
		data: {
			address_text: addressText,
			provider: 'amap',
			coordinate_type: 'wgs84',
			latitude: coordinates.latitude,
			longitude: coordinates.longitude,
			amap_coordinate_type: 'gcj02',
			amap_latitude: amapCoordinates.latitude,
			amap_longitude: amapCoordinates.longitude,
			components
		}
	}
}

module.exports = {
	reverseGeocodeWgs84,
	createUniCloudRequester,
	buildAddressText,
	normalizeComponent,
	validateWgs84Coordinates
}
