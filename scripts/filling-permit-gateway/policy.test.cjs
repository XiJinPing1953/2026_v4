'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const policy = require('../../uniCloud-alipay/cloudfunctions/crm-filling-permit-gateway/permitPolicy')

const NOW = Date.parse('2026-07-20T04:00:00.000Z')

function validBottle(overrides = {}) {
	return {
		_id: 'bottle-1',
		bottle_no: 'Y013',
		is_active: true,
		status: 'in_station',
		bottle_next_check_date: '2026-07-22',
		pressure_gauge_next_check_date: '2026-07-22',
		safety_valve_next_check_date: '2026-07-22',
		updated_at: NOW,
		...overrides
	}
}

test('瓶号统一去空白并转大写，支持数字和字母数字', () => {
	assert.equal(policy.normalizeBottleNo(' y 013 '), 'Y013')
	for (const value of ['12345', 'Y013', 'X046', 'J71', 'AB_01', 'AB-01']) assert.equal(policy.isValidBottleNo(value), true)
	assert.equal(policy.isValidBottleNo(''), false)
	assert.equal(policy.isValidBottleNo('A'.repeat(17)), false)
	assert.equal(policy.isValidBottleNo('中文1'), false)
})

test('日期缺失和非法值禁止', () => {
	for (const value of ['', '2026-02-30', '2026/07/22', 'not-a-date']) {
		const result = policy.evaluatePermit({ bottleNo: 'Y013', bottles: [validBottle({ bottle_next_check_date: value })], now: NOW })
		assert.equal(result.allowed, false)
		assert.equal(result.reason_key, 'bottle_date_invalid')
	}
})

test('提前一天禁用：昨天、今天、明天禁止，后天通过', () => {
	for (const date of ['2026-07-19', '2026-07-20', '2026-07-21']) {
		const result = policy.evaluatePermit({ bottleNo: 'Y013', bottles: [validBottle({ bottle_next_check_date: date })], now: NOW })
		assert.equal(result.allowed, false, date)
		assert.equal(result.reason_key, 'bottle_date_blocked', date)
	}
	assert.equal(policy.evaluatePermit({ bottleNo: 'Y013', bottles: [validBottle()], now: NOW }).allowed, true)
})

test('闰日和跨年按自然日正确判定', () => {
	assert.equal(policy.parseDateDay('2028-02-29') != null, true)
	assert.equal(policy.parseDateDay('2027-02-29'), null)
	const yearEnd = Date.parse('2026-12-31T10:00:00.000Z')
	assert.equal(policy.dateCheck('2027-01-01', yearEnd).blocked, true)
	assert.equal(policy.dateCheck('2027-01-02', yearEnd).blocked, false)
})

test('气瓶必须唯一、启用且状态合法', () => {
	assert.equal(policy.evaluatePermit({ bottleNo: 'Y013', bottles: [], now: NOW }).reason_key, 'bottle_not_found')
	assert.equal(policy.evaluatePermit({ bottleNo: 'Y013', bottles: [validBottle(), validBottle()], now: NOW }).reason_key, 'bottle_not_unique')
	assert.equal(policy.evaluatePermit({ bottleNo: 'Y013', bottles: [validBottle({ is_active: false })], now: NOW }).reason_key, 'bottle_inactive')
	assert.equal(policy.evaluatePermit({ bottleNo: 'Y013', bottles: [validBottle({ status: 'scrapped' })], now: NOW }).reason_key, 'bottle_scrapped')
	assert.equal(policy.evaluatePermit({ bottleNo: 'Y013', bottles: [validBottle({ status: 'lost' })], now: NOW }).reason_key, 'bottle_lost')
	assert.equal(policy.evaluatePermit({ bottleNo: 'Y013', bottles: [validBottle({ status: 'mystery' })], now: NOW }).reason_key, 'status_invalid')
	for (const status of ['unknown', 'in_station', 'at_customer']) {
		assert.equal(policy.evaluatePermit({ bottleNo: 'Y013', bottles: [validBottle({ status })], now: NOW }).allowed, true, status)
	}
})

test('三项日期同时失败时保留全部明细并按固定优先级选主原因', () => {
	const result = policy.evaluatePermit({
		bottleNo: 'Y013',
		bottles: [
			validBottle({
				bottle_next_check_date: '2026-07-20',
				pressure_gauge_next_check_date: '',
				safety_valve_next_check_date: '2026-07-21'
			})
		],
		now: NOW
	})
	assert.equal(result.reason_key, 'bottle_date_blocked')
	assert.deepEqual(result.failure_keys, ['bottle_date_blocked', 'pressure_gauge_date_invalid', 'safety_valve_date_blocked'])
	assert.equal((result.detail_mask & (1 << policy.DETAIL_BITS.pressure_gauge_date_invalid)) !== 0, true)
	assert.equal((result.detail_mask & (1 << policy.DETAIL_BITS.safety_valve_date_blocked)) !== 0, true)
})

test('系统故障结果永远禁止并带32位明细掩码', () => {
	for (const key of ['system_timeout_or_network', 'system_database', 'system_auth', 'system_cloud_audit', 'system_internal', 'system_local_audit', 'system_protocol', 'system_busy']) {
		const result = policy.systemDenied(key, { now: NOW })
		assert.equal(result.allowed, false, key)
		assert.equal(result.outcome, 'system_denied', key)
		assert.equal(result.detail_mask > 0, true, key)
		assert.equal((result.detail_mask_low | (result.detail_mask_high << 16)) >>> 0, result.detail_mask, key)
	}
})
