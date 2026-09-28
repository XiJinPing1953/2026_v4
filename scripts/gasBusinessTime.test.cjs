'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
	formatBusinessTimeByTs,
	isValidGasBusinessTimeString,
	normalizeGasBusinessTime,
	parseShanghaiBusinessTime
} = require('../uniCloud-alipay/cloudfunctions/crm-gas-in/gasBusinessTime')

test('normalizes the inbound business time to yyyy-mm-dd-hh-mm', () => {
	assert.equal(normalizeGasBusinessTime('2026-08-29-14-05'), '2026-08-29-14-05')
	assert.equal(normalizeGasBusinessTime('2026-08-29 14:05:59'), '2026-08-29-14-05')
	assert.equal(normalizeGasBusinessTime('2026-08-29'), '2026-08-29-00-00')
})

test('rejects invalid business times', () => {
	assert.equal(normalizeGasBusinessTime('2026-02-29-10-30'), '')
	assert.equal(normalizeGasBusinessTime('2026-08-29-24-00'), '')
	assert.equal(isValidGasBusinessTimeString('2026-08-29-14-05'), true)
	assert.equal(isValidGasBusinessTimeString('2026-08-29 14:05'), false)
})

test('parses the business time in Shanghai timezone independently of server timezone', () => {
	const expected = Date.parse('2026-08-29T14:05:00+08:00')
	assert.equal(parseShanghaiBusinessTime('2026-08-29-14-05'), expected)
	assert.equal(formatBusinessTimeByTs(expected), '2026-08-29-14-05')
})
