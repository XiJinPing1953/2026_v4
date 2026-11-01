const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const code = fs.readFileSync('src/services/pageAcl.js', 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const registry = [{ pagePath: '/pages/pda/reweigh', supports: { view: true, create: true, update: true } }]
const acl = vm.runInNewContext(`${code}\n;({canViewPage, canPageAction, isPageRegistered})`, {
	PAGE_REGISTRY: registry, PAGE_REGISTRY_MAP: { '/pages/pda/reweigh': registry[0] },
	buildRoleTemplatePermissions: () => ({ '/pages/pda/reweigh': { view: false, create: false } }),
	normalizeRoleTemplate: role => role, getUser: () => null
})
test('floor route uses exactly existing filling reweigh view and create permissions', () => {
	const user = { role: 'pda_operator', page_permissions: { '/pages/pda/reweigh': { view: true, create: false } } }
	assert.equal(acl.isPageRegistered('/pages/pda/floor-reweigh'), true)
	assert.equal(acl.canViewPage('/pages/pda/floor-reweigh', user), true)
	assert.equal(acl.canPageAction('/pages/pda/floor-reweigh', 'create', user), false)
	user.page_permissions['/pages/pda/reweigh'].view = false
	assert.equal(acl.canViewPage('/pages/pda/floor-reweigh', user), false)
})
