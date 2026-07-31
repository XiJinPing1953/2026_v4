'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
	reverseGeocodeWgs84,
	createUniCloudRequester,
	buildAddressText,
	normalizeComponent,
	validateWgs84Coordinates
} = require('../uniCloud-alipay/cloudfunctions/crm-home-safety-inspection/locationGeocoding')

const TEST_API_KEY = 'test-amap-key'
const repoRoot = path.resolve(__dirname, '..')
const locationPolicyPromise = import(
	'../src/services/homeSafetyInspectionLocationPolicy.mjs'
)

function successfulRequester(addressComponent) {
	const calls = []
	const requester = async (url, options) => {
		calls.push({ url, options })
		if (calls.length === 1) {
			return { status: '1', info: 'ok', locations: '121.480001,31.220001' }
		}
		return {
			status: '1',
			info: 'ok',
			regeocode: { addressComponent }
		}
	}
	return { calls, requester }
}

test('WGS84 坐标先转换为高德坐标，再按区县、乡镇/村、街道返回地址', async () => {
	const { calls, requester } = successfulRequester({
		district: '黄浦区',
		township: '南京东路街道',
		neighborhood: { name: '福州路社区', type: '地名地址信息' },
		streetNumber: { street: '九江路' }
	})
	const result = await reverseGeocodeWgs84({
		latitude: 31.2304,
		longitude: 121.4737,
		apiKey: TEST_API_KEY,
		requester
	})

	assert.equal(result.ok, true)
	assert.equal(result.data.address_text, '黄浦区南京东路街道福州路社区九江路')
	assert.equal(result.data.coordinate_type, 'wgs84')
	assert.equal(result.data.latitude, 31.2304)
	assert.equal(result.data.longitude, 121.4737)
	assert.equal(result.data.amap_coordinate_type, 'gcj02')
	assert.equal(result.data.amap_latitude, 31.220001)
	assert.equal(result.data.amap_longitude, 121.480001)
	assert.equal(calls.length, 2)

	const convertUrl = new URL(calls[0].url)
	assert.equal(convertUrl.pathname, '/v3/assistant/coordinate/convert')
	assert.equal(convertUrl.searchParams.get('coordsys'), 'gps')
	assert.equal(convertUrl.searchParams.get('locations'), '121.4737,31.2304')
	assert.equal(convertUrl.searchParams.get('key'), TEST_API_KEY)
	assert.equal(calls[0].options.method, 'GET')

	const reverseUrl = new URL(calls[1].url)
	assert.equal(reverseUrl.pathname, '/v3/geocode/regeo')
	assert.equal(reverseUrl.searchParams.get('location'), '121.480001,31.220001')
	assert.equal(reverseUrl.searchParams.get('extensions'), 'base')
	assert.equal(reverseUrl.searchParams.get('key'), TEST_API_KEY)
})

test('高德空数组字段会清洗为空字符串，不污染拼接地址', async () => {
	const { requester } = successfulRequester({
		province: [],
		city: [],
		district: '崇明区',
		township: '新海镇',
		village: [],
		streetNumber: []
	})
	const result = await reverseGeocodeWgs84({
		latitude: '31.623',
		longitude: '121.397',
		apiKey: TEST_API_KEY,
		requester
	})

	assert.equal(result.ok, true)
	assert.equal(result.data.address_text, '崇明区新海镇')
	assert.deepEqual(result.data.components, {
		district: '崇明区',
		township: '新海镇',
		community_or_village: '',
		street: ''
	})
	assert.equal(normalizeComponent([]), '')
})

test('只有区县、缺少乡镇村或街道时不自动填入模糊地址', async () => {
	const { requester } = successfulRequester({
		district: '崇明区',
		township: [],
		neighborhood: [],
		streetNumber: []
	})
	const result = await reverseGeocodeWgs84({
		latitude: 31.623,
		longitude: 121.397,
		apiKey: TEST_API_KEY,
		requester
	})
	assert.deepEqual(result, {
		ok: false,
		code: 'partial_address',
		message: '定位地址解析结果不完整'
	})
})

test('地址字段清洗并去除重复行政区划', () => {
	assert.equal(
		buildAddressText({
			district: '  朝阳区 ',
			township: '朝阳区',
			village: ['朝阳区'],
			streetNumber: { street: ' 朝阳路 ' }
		}),
		'朝阳区朝阳路'
	)
	assert.equal(
		buildAddressText({
			district: '长安区',
			township: '长安区东大街街道',
			streetNumber: { street: '东大街' }
		}),
		'长安区东大街街道'
	)
})

test('缺少地图 API Key 时直接返回可预期错误且不发请求', async () => {
	let requestCount = 0
	const result = await reverseGeocodeWgs84({
		latitude: 31.2304,
		longitude: 121.4737,
		apiKey: '',
		requester: async () => {
			requestCount += 1
		}
	})

	assert.deepEqual(result, {
		ok: false,
		code: 'missing_api_key',
		message: '地图服务未配置'
	})
	assert.equal(requestCount, 0)
})

test('高德坐标转换和逆地理编码 API 失败时返回对应错误', async (t) => {
	await t.test('坐标转换失败', async () => {
		const result = await reverseGeocodeWgs84({
			latitude: 31.2304,
			longitude: 121.4737,
			apiKey: TEST_API_KEY,
			requester: async () => ({ status: '0', info: 'INVALID_USER_KEY' })
		})
		assert.deepEqual(result, {
			ok: false,
			code: 'coordinate_convert_failed',
			message: '定位坐标转换失败'
		})
	})

	await t.test('逆地理编码失败', async () => {
		let requestCount = 0
		const result = await reverseGeocodeWgs84({
			latitude: 31.2304,
			longitude: 121.4737,
			apiKey: TEST_API_KEY,
			requester: async () => {
				requestCount += 1
				if (requestCount === 1) return { status: '1', locations: '121.48,31.22' }
				return { status: '0', info: 'SERVICE_NOT_AVAILABLE' }
			}
		})
		assert.deepEqual(result, {
			ok: false,
			code: 'reverse_geocode_failed',
			message: '定位地址解析失败'
		})
	})

	await t.test('网络请求异常', async () => {
		const result = await reverseGeocodeWgs84({
			latitude: 31.2304,
			longitude: 121.4737,
			apiKey: TEST_API_KEY,
			requester: async () => {
				throw new Error(`sensitive URL must not escape: ${TEST_API_KEY}`)
			}
		})
		assert.deepEqual(result, {
			ok: false,
			code: 'request_failed',
			message: '地图服务请求失败'
		})
		assert.equal(result.message.includes(TEST_API_KEY), false)
	})
})

test('坐标校验拒绝空值和越界值，接受合法 WGS84 字符串', () => {
	assert.equal(validateWgs84Coordinates('', 121).ok, false)
	assert.equal(validateWgs84Coordinates(31, 181).code, 'invalid_coordinates')
	assert.deepEqual(validateWgs84Coordinates('31.2', '121.4'), {
		ok: true,
		latitude: 31.2,
		longitude: 121.4
	})
})

test('巡检云函数登记地址识别权限并只从服务端环境变量读取地图 Key', () => {
	const backend = fs.readFileSync(
		path.join(
			repoRoot,
			'uniCloud-alipay/cloudfunctions/crm-home-safety-inspection/index.js'
		),
		'utf8'
	)
	assert.match(
		backend,
		/reverseGeocodeV1:\s*\[\{\s*pagePath:\s*FORM_PATH,\s*action:\s*'create'\s*\}\]/
	)
	assert.match(backend, /process\.env\.AMAP_WEB_SERVICE_KEY/)
	assert.match(backend, /if \(action === 'reverseGeocodeV1'\) return reverseGeocodeV1\(user, data\)/)
	assert.match(backend, /REVERSE_GEOCODE_RATE_LIMIT/)
	assert.match(backend, /reverseGeocodeCache/)
	assert.match(backend, /reverseGeocodeInFlight/)

	const frontend = [
		fs.readFileSync(
			path.join(repoRoot, 'src/services/homeSafetyInspection.js'),
			'utf8'
		),
		fs.readFileSync(
			path.join(
				repoRoot,
				'src/components/domain/homeSafetyInspection/HomeSafetyInspectionFormView.vue'
			),
			'utf8'
		)
	].join('\n')
	assert.doesNotMatch(frontend, /AMAP_WEB_SERVICE_KEY|test-amap-key/)

	const geocoder = fs.readFileSync(
		path.join(
			repoRoot,
			'uniCloud-alipay/cloudfunctions/crm-home-safety-inspection/locationGeocoding.js'
		),
		'utf8'
	)
	assert.match(geocoder, /Promise\.race/)
	assert.match(geocoder, /const deadline = Date\.now\(\) \+ timeout/)
})

test('地址自动填入受客户档案、人工修正、客户切换及请求序号共同保护', () => {
	const form = fs.readFileSync(
		path.join(
			repoRoot,
			'src/components/domain/homeSafetyInspection/HomeSafetyInspectionFormView.vue'
		),
		'utf8'
	)
	assert.match(form, /\(selectedCustomer\.value\?\._id \|\| ''\) !== customerIdAtStart/)
	assert.match(form, /!locationTextTouched\.value/)
	assert.match(form, /canApplyGeocodedAddress/)
	assert.match(form, /requestSequence !== locationRequestSequence/)
	assert.match(form, /@input="markLocationTextEdited"/)
	assert.match(form, /invalidateAutomaticAddressForNewCapture/)
})

test('重新定位失败保留上一次成功的 WGS84 坐标，定位中不能抢先进入下一步', () => {
	const form = fs.readFileSync(
		path.join(
			repoRoot,
			'src/components/domain/homeSafetyInspection/HomeSafetyInspectionFormView.vue'
		),
		'utf8'
	)
	assert.match(form, /previousSuccessfulCapture/)
	assert.match(form, /locationCapture\.value = previousSuccessfulCapture/)
	assert.match(form, /手机定位或地址识别尚未完成，请稍候/)
})

test('地址状态策略执行客户地址优先、人工修正优先和旧请求隔离', async () => {
	const {
		canApplyGeocodedAddress,
		finiteLocationNumber,
		restoredLocationText,
		shouldInvalidateAutomaticAddress
	} = await locationPolicyPromise

	for (const invalid of [null, undefined, '', '   ', false, true, Number.NaN]) {
		assert.equal(finiteLocationNumber(invalid), null)
	}
	assert.equal(finiteLocationNumber('31.2304'), 31.2304)
	assert.equal(finiteLocationNumber(0), 0)

	assert.equal(
		canApplyGeocodedAddress({
			customerId: 'customer-a',
			requestCustomerId: 'customer-a',
			customerAddress: '',
			currentLocationText: '',
			previousGeocodedText: '',
			locationTextTouched: false
		}),
		true
	)
	for (const blocked of [
		{ customerAddress: '客户档案地址' },
		{ currentLocationText: '现场已修正地址', locationTextTouched: true },
		{ customerId: 'customer-b' }
	]) {
		assert.equal(
			canApplyGeocodedAddress({
				customerId: 'customer-a',
				requestCustomerId: 'customer-a',
				customerAddress: '',
				currentLocationText: '',
				previousGeocodedText: '',
				locationTextTouched: false,
				...blocked
			}),
			false
		)
	}

	assert.equal(
		shouldInvalidateAutomaticAddress({
			customerAddress: '',
			currentLocationText: '旧定位地址',
			previousGeocodedText: '旧定位地址',
			locationTextTouched: false
		}),
		true
	)
	assert.equal(
		shouldInvalidateAutomaticAddress({
			customerAddress: '',
			currentLocationText: '巡检员修正地址',
			previousGeocodedText: '旧定位地址',
			locationTextTouched: true
		}),
		false
	)

	assert.equal(
		restoredLocationText({
			currentCustomerAddress: '',
			draftCustomerAddress: '客户原档案地址',
			draftLocationText: '客户原档案地址',
			locationTextTouched: false
		}),
		''
	)
	assert.equal(
		restoredLocationText({
			currentCustomerAddress: '客户新档案地址',
			draftCustomerAddress: '',
			draftLocationText: '旧定位自动地址',
			locationTextTouched: false
		}),
		'客户新档案地址'
	)
	assert.equal(
		restoredLocationText({
			currentCustomerAddress: '客户新档案地址',
			draftCustomerAddress: '客户原档案地址',
			draftLocationText: '客户原档案地址',
			locationTextTouched: false
		}),
		'客户新档案地址'
	)
	assert.equal(
		restoredLocationText({
			currentCustomerAddress: '客户新档案地址',
			draftCustomerAddress: '客户原档案地址',
			draftLocationText: '巡检员现场修正地址',
			locationTextTouched: true
		}),
		'巡检员现场修正地址'
	)
	assert.equal(
		restoredLocationText({
			currentCustomerAddress: '客户新档案地址',
			draftCustomerAddress: '客户原档案地址',
			draftLocationText: '客户原档案地址'
		}),
		'客户新档案地址'
	)
	assert.equal(
		restoredLocationText({
			currentCustomerAddress: '',
			draftCustomerAddress: '客户原档案地址',
			draftLocationText: '客户原档案地址'
		}),
		''
	)
})

test('uniCloud httpclient 适配器透传 GET、JSON 和超时配置', async () => {
	let invocation = null
	const requester = createUniCloudRequester({
		async request(url, options) {
			invocation = { url, options }
			return { status: 200, data: { status: '1', locations: '121.48,31.22' } }
		}
	})

	assert.equal(typeof requester, 'function')
	assert.deepEqual(await requester('https://example.test/map', { timeout: 500 }), {
		status: '1',
		locations: '121.48,31.22'
	})
	assert.deepEqual(invocation, {
		url: 'https://example.test/map',
		options: {
			method: 'GET',
			dataType: 'json',
			timeout: 1000
		}
	})
	assert.equal(createUniCloudRequester(null), null)
})
