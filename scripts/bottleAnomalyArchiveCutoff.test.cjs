#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')

function loadHelpers() {
	const filename = path.resolve(__dirname, '../uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js')
	const source = `${fs.readFileSync(filename, 'utf8')}
globalThis.__archiveCutoffHelpers = {
	resolveAnomalyIdentityDate,
	resolveAnomalyBusinessDay,
	isAnomalyAtOrBeforeCutoff,
	buildAnomalyFingerprint
}`
	const sandbox = {
		console,
		Date,
		Math,
		JSON,
		Map,
		Set,
		Promise,
		exports: {},
		module: { exports: {} },
		require() {
			return { ensureActionAcl: async () => ({ ok: true }) }
		},
		uniCloud: {
			database() {
				return {
					collection() {
						return {}
					}
				}
			}
		}
	}
	vm.runInNewContext(source, sandbox, { filename })
	return sandbox.__archiveCutoffHelpers
}

const helpers = loadHelpers()

test('封存截止日抑制截止日及以前的历史异常', () => {
	const row = {
		bottle_no: 'J77',
		anomaly_type: 'continuous_back',
		date: '2026-03-30',
		context: {
			last_back: { date: '2026-02-04' },
			next_back: { date: '2026-03-30' }
		}
	}
	assert.equal(helpers.resolveAnomalyBusinessDay(row), '2026-03-30')
	assert.equal(helpers.isAnomalyAtOrBeforeCutoff(row, '2026-08-27'), true)
})

test('封存截止日保留截止日之后的新异常', () => {
	const row = {
		bottle_no: '293',
		anomaly_type: 'missing_fill',
		date: '2026-08-29',
		context: {
			last_back: { date: '2026-08-25' },
			next_out: { date: '2026-08-29' }
		}
	}
	assert.equal(helpers.resolveAnomalyBusinessDay(row), '2026-08-29')
	assert.equal(helpers.isAnomalyAtOrBeforeCutoff(row, '2026-08-27'), false)
})

test('业务日期判断不改变现有异常指纹', () => {
	const row = {
		bottle_no: 'J77',
		anomaly_type: 'continuous_back',
		date: '2026-03-30',
		context: {
			last_back: {
				net: 0,
				date: '2026-02-04',
				customer: '肃宁-金颖',
				source_id: '6982ebeb9755e32cc9f7cda5',
				source_type: 'sale'
			},
			next_back: {
				net: 0,
				date: '2026-03-30',
				customer: '肃宁-金颖',
				source_id: '69cb370b5c28c95aacd41e44',
				source_type: 'sale'
			},
			has_fill_since_last_back: false
		}
	}
	assert.equal(
		helpers.buildAnomalyFingerprint(row),
		'j77|continuous_back|2026-03-30|2026-02-04|sale|6982ebeb9755e32cc9f7cda5|肃宁-金颖|0|2026-03-30|sale|69cb370b5c28c95aacd41e44|肃宁-金颖|0|0'
	)
})
