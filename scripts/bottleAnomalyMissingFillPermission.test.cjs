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
globalThis.__missingFillPermissionHelpers = {
	isMissingFillDifferenceBeyondNormalLimit,
	canUserAcceptMissingFillDifference
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
	return sandbox.__missingFillPermissionHelpers
}

const helpers = loadHelpers()

test('净重差值在正负10kg边界内允许普通有权用户处理', () => {
	for (const diff of [-10, -5, 0, 5, 10]) {
		assert.equal(helpers.isMissingFillDifferenceBeyondNormalLimit(diff), false)
		assert.equal(helpers.canUserAcceptMissingFillDifference({ role: 'admin' }, diff), true)
	}
})

test('绝对差值超过10kg时仅超级管理员可处理', () => {
	for (const diff of [-10.001, -25, 10.001, 25]) {
		assert.equal(helpers.isMissingFillDifferenceBeyondNormalLimit(diff), true)
		assert.equal(helpers.canUserAcceptMissingFillDifference({ role: 'admin' }, diff), false)
		assert.equal(helpers.canUserAcceptMissingFillDifference({ role: 'superadmin' }, diff), true)
	}
})

test('超级管理员角色判断兼容大小写和空格', () => {
	assert.equal(helpers.canUserAcceptMissingFillDifference({ role: ' SuperAdmin ' }, 12), true)
})
