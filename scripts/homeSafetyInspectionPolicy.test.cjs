'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	TEMPLATE,
	CURRENT_TEMPLATE,
	STANDARD_TEMPLATE_V1,
	LEGACY_TEMPLATE,
	TEMPLATES,
	getTemplate,
	normalizeClientSubmissionId,
	normalizeEditablePayload
} = require('../uniCloud-alipay/cloudfunctions/crm-home-safety-inspection/inspectionPolicy')

function cloudFile(name) {
	return `cloud://test-space/home-safety-inspection/${name}.png`
}

function validPayload(template = TEMPLATE) {
	return {
		location_text: '客户现场 1 号气瓶间',
		location_capture: {
			status: 'failed',
			coordinate_type: 'wgs84',
			error_message: '用户拒绝定位',
			captured_at: 123456,
			source: 'home_safety_inspection_h5'
		},
		template_code: template.code,
		template_version: template.version,
		items: template.items.map((item, index) => {
			const base = {
				item_code: item.code,
				issue_note: '',
				photo_file_ids: [cloudFile(`item-${index}`)]
			}
			if (Array.isArray(item.checks)) {
				base.answers = item.checks.map((check) => ({
					check_code: check.code,
					option_code: check.options[0].code
				}))
			} else {
				base.option_code = item.options[0].code
			}
			return base
		}),
		customer_signer_name: '客户代表',
		inspector_name: '巡检员甲'
	}
}

function findItemPayload(payload, code) {
	return payload.items.find((item) => item.item_code === code)
}

test('正式模板为当前八项版本，Demo 模板仍可按原版本解析', () => {
	assert.equal(TEMPLATE, CURRENT_TEMPLATE)
	assert.equal(CURRENT_TEMPLATE.code, 'home_safety_standard')
	assert.equal(CURRENT_TEMPLATE.version, 2)
	assert.equal(CURRENT_TEMPLATE.items.length, 8)
	assert.deepEqual(
		CURRENT_TEMPLATE.items.map((item) => item.code),
		[
			'storage_environment_leak',
			'cylinder_appearance',
			'multiple_gas_sources',
			'appliance_connection_hose',
			'valve_appearance_leak',
			'regulator_appearance_leak',
			'gas_leak_alarm_power',
			'vaporizer_appearance'
		]
	)
	for (const item of CURRENT_TEMPLATE.items) {
		assert.equal(item.min_photos, 1)
		assert.equal(item.max_photos, 3)
		assert.ok(Array.isArray(item.checks))
		assert.ok(item.checks.length >= 1)
	}
	const currentVaporizer = CURRENT_TEMPLATE.items.find(
		(item) => item.code === 'vaporizer_appearance'
	)
	assert.deepEqual(
		currentVaporizer.checks[0].options.map((option) => option.code),
		['normal', 'abnormal']
	)

	assert.equal(LEGACY_TEMPLATE.code, 'home_safety_demo')
	assert.equal(LEGACY_TEMPLATE.version, 1)
	assert.equal(LEGACY_TEMPLATE.items.length, 3)
	assert.equal(STANDARD_TEMPLATE_V1.code, 'home_safety_standard')
	assert.equal(STANDARD_TEMPLATE_V1.version, 1)
	assert.equal(TEMPLATES.length, 3)
	assert.equal(getTemplate('home_safety_demo', 1), LEGACY_TEMPLATE)
	assert.equal(getTemplate('home_safety_standard', 1), STANDARD_TEMPLATE_V1)
	assert.equal(getTemplate('home_safety_standard', 2), CURRENT_TEMPLATE)
	assert.equal(getTemplate('unknown', 1), null)
})

test('完整正常八项巡检通过并保存子检查文字快照', () => {
	const result = normalizeEditablePayload(validPayload(), { template: CURRENT_TEMPLATE, now: 999 })
	assert.equal(result.ok, true)
	assert.equal(result.data.overall_result, 'normal')
	assert.equal(result.data.items.length, 8)
	assert.equal(result.data.location_capture.status, 'failed')
	const hose = result.data.items.find((item) => item.item_code === 'appliance_connection_hose')
	assert.equal(hose.answers.length, 2)
	assert.deepEqual(Object.keys(hose.answers[0]), [
		'check_code',
		'check_label_snapshot',
		'option_code',
		'option_label_snapshot',
		'is_abnormal'
	])
	assert.equal(hose.is_abnormal, false)
	assert.equal(hose.result_code, 'normal')
	assert.equal(hose.result_label_snapshot, '正常')
	assert.equal(hose.is_not_applicable, false)
	assert.equal(result.data.customer_signature_file_id, undefined)
	assert.equal(result.data.inspector_signature_file_id, undefined)
})

test('任一子检查异常会标记项目和整单异常，且必须填写问题说明', () => {
	const payload = validPayload()
	const hose = findItemPayload(payload, 'appliance_connection_hose')
	hose.answers.find((answer) => answer.check_code === 'leakage').option_code = 'leak'
	let result = normalizeEditablePayload(payload, { template: CURRENT_TEMPLATE })
	assert.equal(result.ok, false)
	assert.match(result.msg, /问题说明/)

	hose.issue_note = '连接管接口检出泄漏'
	result = normalizeEditablePayload(payload, { template: CURRENT_TEMPLATE })
	assert.equal(result.ok, true)
	assert.equal(result.data.overall_result, 'abnormal')
	const normalizedHose = result.data.items.find((item) => item.item_code === hose.item_code)
	assert.equal(normalizedHose.is_abnormal, true)
	assert.equal(normalizedHose.result_code, 'abnormal')
	assert.equal(normalizedHose.result_label_snapshot, '异常')
	assert.equal(
		normalizedHose.answers.find((answer) => answer.check_code === 'leakage').option_label_snapshot,
		'有泄漏'
	)
})

test('报警器未安装时不提交通电答案，已安装时通电答案必填', () => {
	const notInstalled = validPayload()
	const alarm = findItemPayload(notInstalled, 'gas_leak_alarm_power')
	alarm.answers = [{ check_code: 'installed', option_code: 'no' }]
	alarm.issue_note = '现场未安装燃气泄漏报警器'
	let result = normalizeEditablePayload(notInstalled, { template: CURRENT_TEMPLATE })
	assert.equal(result.ok, true)
	assert.equal(result.data.overall_result, 'abnormal')
	assert.equal(
		result.data.items.find((item) => item.item_code === alarm.item_code).answers.length,
		1
	)

	const hiddenAnswer = validPayload()
	const hiddenAlarm = findItemPayload(hiddenAnswer, 'gas_leak_alarm_power')
	hiddenAlarm.answers.find((answer) => answer.check_code === 'installed').option_code = 'no'
	hiddenAlarm.issue_note = '现场未安装'
	result = normalizeEditablePayload(hiddenAnswer, { template: CURRENT_TEMPLATE })
	assert.equal(result.ok, false)
	assert.match(result.msg, /无需填写/)

	const missingPower = validPayload()
	findItemPayload(missingPower, 'gas_leak_alarm_power').answers = [
		{ check_code: 'installed', option_code: 'yes' }
	]
	result = normalizeEditablePayload(missingPower, { template: CURRENT_TEMPLATE })
	assert.equal(result.ok, false)
	assert.match(result.msg, /是否通电/)
})

test('旧版气化器不适用仍可解析，当前模板不再接受不适用', () => {
	const payload = validPayload(STANDARD_TEMPLATE_V1)
	const vaporizer = findItemPayload(payload, 'vaporizer_appearance')
	vaporizer.answers[0].option_code = 'not_applicable'
	let result = normalizeEditablePayload(payload, { template: STANDARD_TEMPLATE_V1 })
	assert.equal(result.ok, true)
	assert.equal(result.data.overall_result, 'normal')
	assert.equal(
		result.data.items.find((item) => item.item_code === vaporizer.item_code).answers[0]
			.option_label_snapshot,
		'现场未使用气化器（不适用）'
	)
	const normalizedVaporizer = result.data.items.find((item) => item.item_code === vaporizer.item_code)
	assert.equal(normalizedVaporizer.result_code, 'not_applicable')
	assert.equal(normalizedVaporizer.result_label_snapshot, '不适用')
	assert.equal(normalizedVaporizer.is_not_applicable, true)

	vaporizer.photo_file_ids = []
	result = normalizeEditablePayload(payload, { template: STANDARD_TEMPLATE_V1 })
	assert.equal(result.ok, false)
	assert.match(result.msg, /至少上传/)

	const currentPayload = validPayload()
	findItemPayload(currentPayload, 'vaporizer_appearance').answers[0].option_code =
		'not_applicable'
	result = normalizeEditablePayload(currentPayload, { template: CURRENT_TEMPLATE })
	assert.equal(result.ok, false)
	assert.match(result.msg, /请选择/)
})

test('逐项答案严格匹配模板，不接受缺失、重复、隐藏或未知子检查', () => {
	const duplicate = validPayload()
	const cylinder = findItemPayload(duplicate, 'cylinder_appearance')
	cylinder.answers.push({ ...cylinder.answers[0] })
	assert.equal(normalizeEditablePayload(duplicate, { template: CURRENT_TEMPLATE }).ok, false)

	const unknown = validPayload()
	findItemPayload(unknown, 'cylinder_appearance').answers[0].check_code = 'unknown_check'
	const result = normalizeEditablePayload(unknown, { template: CURRENT_TEMPLATE })
	assert.equal(result.ok, false)
	assert.match(result.msg, /选择|版本不匹配/)
})

test('逐项照片、地址和现场人员信息均为必填', () => {
	const cases = [
		[(payload) => { payload.location_text = '' }, /地点/],
		[(payload) => { payload.items[0].photo_file_ids = [] }, /至少上传/],
		[(payload) => { payload.customer_signer_name = '' }, /姓名/],
		[(payload) => { payload.inspector_name = '' }, /巡检员姓名/]
	]
	for (const [mutate, expected] of cases) {
		const payload = validPayload()
		mutate(payload)
		const result = normalizeEditablePayload(payload, { template: CURRENT_TEMPLATE })
		assert.equal(result.ok, false)
		assert.match(result.msg, expected)
	}
})

test('每项照片限制为一至三张且只接受不重复的 cloud:// 文件标识', () => {
	const maxAllowed = validPayload()
	maxAllowed.items[0].photo_file_ids = [
		cloudFile('max-1'),
		cloudFile('max-2'),
		cloudFile('max-3')
	]
	assert.equal(normalizeEditablePayload(maxAllowed, { template: CURRENT_TEMPLATE }).ok, true)

	const invalid = validPayload()
	invalid.items[0].photo_file_ids = ['https://example.com/photo.jpg']
	assert.equal(normalizeEditablePayload(invalid, { template: CURRENT_TEMPLATE }).ok, false)

	const duplicate = validPayload()
	duplicate.items[0].photo_file_ids = [cloudFile('same'), cloudFile('same')]
	assert.equal(normalizeEditablePayload(duplicate, { template: CURRENT_TEMPLATE }).ok, false)

	const tooMany = validPayload()
	tooMany.items[0].photo_file_ids = [
		cloudFile('1'),
		cloudFile('2'),
		cloudFile('3'),
		cloudFile('4')
	]
	const result = normalizeEditablePayload(tooMany, { template: CURRENT_TEMPLATE })
	assert.equal(result.ok, false)
	assert.match(result.msg, /最多上传 3 张/)

	const legacySignature = validPayload()
	legacySignature.customer_signature_file_id = '/tmp/signature.png'
	legacySignature.inspector_signature_file_id = cloudFile('old-inspector-signature')
	const signatureResult = normalizeEditablePayload(legacySignature, { template: CURRENT_TEMPLATE })
	assert.equal(signatureResult.ok, true)
	assert.equal(signatureResult.data.customer_signature_file_id, undefined)
	assert.equal(signatureResult.data.inspector_signature_file_id, undefined)
})

test('旧 Demo 单可按原模板校验，但不能伪装成当前模板提交', () => {
	const legacyPayload = validPayload(LEGACY_TEMPLATE)
	const legacy = normalizeEditablePayload(legacyPayload, { template: LEGACY_TEMPLATE })
	assert.equal(legacy.ok, true)
	assert.equal(legacy.data.items.length, 3)
	assert.equal(legacy.data.items[0].option_label_snapshot, '正常')
	assert.equal(legacy.data.items[0].answers, undefined)

	const asCurrent = normalizeEditablePayload(legacyPayload, { template: CURRENT_TEMPLATE })
	assert.equal(asCurrent.ok, false)
	assert.match(asCurrent.msg, /模板不匹配/)
})

test('定位拒绝或失败不阻止提交，成功定位保留 WGS84 坐标', () => {
	const failed = normalizeEditablePayload(validPayload(), { template: CURRENT_TEMPLATE })
	assert.equal(failed.ok, true)
	assert.equal(failed.data.location_capture.status, 'failed')

	const payload = validPayload()
	payload.location_capture = {
		status: 'ok',
		coordinate_type: 'wgs84',
		latitude: 31.2304,
		longitude: 121.4737,
		accuracy: 12,
		captured_at: 123456,
		source: 'home_safety_inspection_h5'
	}
	const ok = normalizeEditablePayload(payload, { template: CURRENT_TEMPLATE })
	assert.equal(ok.ok, true)
	assert.equal(ok.data.location_capture.coordinate_type, 'wgs84')
	assert.equal(ok.data.location_capture.latitude, 31.2304)

	const nullableAccuracy = validPayload()
	nullableAccuracy.location_capture = {
		status: 'ok',
		coordinate_type: 'wgs84',
		latitude: 31.2304,
		longitude: 121.4737,
		accuracy: null
	}
	const nullableAccuracyResult = normalizeEditablePayload(nullableAccuracy, {
		template: CURRENT_TEMPLATE
	})
	assert.equal(nullableAccuracyResult.ok, true)
	assert.equal(nullableAccuracyResult.data.location_capture.accuracy, null)

	const missingCoordinates = validPayload()
	missingCoordinates.location_capture = {
		status: 'ok',
		coordinate_type: 'wgs84',
		latitude: null,
		longitude: null
	}
	const missingCoordinatesResult = normalizeEditablePayload(missingCoordinates, {
		template: CURRENT_TEMPLATE
	})
	assert.equal(missingCoordinatesResult.ok, true)
	assert.equal(missingCoordinatesResult.data.location_capture.status, 'failed')

	const invalidPayload = validPayload()
	invalidPayload.location_capture = {
		status: 'ok',
		coordinate_type: 'gcj02',
		latitude: 31.2304,
		longitude: 121.4737
	}
	const invalid = normalizeEditablePayload(invalidPayload, { template: CURRENT_TEMPLATE })
	assert.equal(invalid.ok, true)
	assert.equal(invalid.data.location_capture.status, 'failed')
	assert.equal(invalid.data.location_capture.coordinate_type, 'wgs84')
})

test('客户端提交标识只接受稳定安全格式', () => {
	assert.equal(normalizeClientSubmissionId('hsi_abc12345'), 'hsi_abc12345')
	assert.equal(normalizeClientSubmissionId('short'), '')
	assert.equal(normalizeClientSubmissionId('invalid id with spaces'), '')
})
