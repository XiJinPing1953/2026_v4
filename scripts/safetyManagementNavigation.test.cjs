'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const context = vm.createContext({
	normalizeText: value => String(value ?? '').trim(),
	canViewPage: (pagePath, user) => Boolean(user?.allowedPages?.includes(pagePath))
})
const source = fs.readFileSync(path.join(root, 'src/services/pda/entry.js'), 'utf8')
	.replace(/^import[^\n]*\n/gm, '')
	.replace(/^export /gm, '')
	.replace(/\s*\/\/ #ifdef APP-PLUS[\s\S]*?\/\/ #endif/g, '')
vm.runInContext(source, context)
const managementPages = ['home', 'daily', 'weekly', 'monthly', 'settings', 'print']
	.map(page => `/pages/safety-management/${page}`)

test('安全巡检员可打开六个台账页面，刷新和登录恢复保留日期深链', () => {
	const pages = [...fs.readFileSync(path.join(root, 'src/pages.json'), 'utf8').matchAll(/"path"\s*:\s*"([^"]+)"/g)].map(match => `/${match[1]}`)
	assert.deepEqual(pages.filter(page => page.startsWith('/pages/safety-management/')).sort(), [...managementPages].sort())
	for (const user of [{ role: 'safety_inspector' }, { role: 'user', role_template: 'safety_inspector' }]) {
		assert.equal(context.resolveHomePath(user), '/pages/safety-inspection/home')
		for (const page of managementPages) {
			const deepLink = `${page}?date=2026-10-16&month=2026-10#details`
			assert.equal(context.isSafetyInspectionPagePath(deepLink), true, page)
			assert.equal(context.shouldRedirectToPreferredHome(deepLink, user), false, page)
			assert.equal(context.resolveLoginRedirectForRuntime(deepLink.slice(1), user), deepLink, page)
		}
	}
})

test('巡检员保留原巡检入口，并继续拒绝销售、PDA 和未登记的台账路径', () => {
	const user = { role: 'safety_inspector' }
	for (const page of ['/pages/safety-inspection/home', '/pages/home-safety-inspection/form', '/pages/station-safety-inspection/hazards']) {
		assert.equal(context.isSafetyInspectionPagePath(page), true)
		assert.equal(context.shouldRedirectToPreferredHome(page, user), false)
	}
	for (const page of ['/pages/index/index', '/pages/sale/list', '/pages/pda/home', '/pages/user/list', '/pages/safety-management/unknown', '/pages/safety-management-extra/home']) {
		assert.equal(context.isSafetyInspectionPagePath(page), false, page)
		assert.equal(context.shouldRedirectToPreferredHome(page, user), true, page)
		assert.equal(context.resolveLoginRedirectForRuntime(page, user), '', page)
	}
	assert.equal(context.shouldRedirectToPreferredHome('/pages/login/login', user), false)
})

test('普通用户与 PDA 操作员的默认入口、PDA 页面权限限制不变', () => {
	assert.equal(context.resolveHomePath({ role: 'user' }), '/pages/index/index')
	assert.equal(context.resolveHomePath({ role: 'pda_operator' }), '/pages/pda/home')
	assert.equal(context.shouldRedirectToPreferredHome('/pages/safety-management/daily', { role: 'user' }), false)
	assert.equal(context.resolveLoginRedirectForRuntime('/pages/pda/home', { role: 'user' }), '')
	assert.equal(context.resolveLoginRedirectForRuntime('/pages/pda/home?task=1', { role: 'user', allowedPages: ['/pages/pda/home'] }), '/pages/pda/home?task=1')
})
