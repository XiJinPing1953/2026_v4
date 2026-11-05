const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const code = fs.readFileSync('src/services/pageAcl.js', 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const registry = [{ pagePath: '/pages/pda/reweigh', supports: { view: true, create: true, update: true } }, { pagePath: '/pages/pda/return-reweigh', supports: { view: true, create: true } }]
const acl = vm.runInNewContext(`${code}\n;({canViewPage, canPageAction, isPageRegistered})`, {
	PAGE_REGISTRY: registry, PAGE_REGISTRY_MAP: Object.fromEntries(registry.map(row=>[row.pagePath,row])),
	buildRoleTemplatePermissions: () => ({ '/pages/pda/reweigh': { view: false, create: false } }),
	normalizeRoleTemplate: role => role, getUser: () => null
})
test('floor return inherits return permission and cannot borrow filling permission',()=>{
 const user={role:'pda_operator',page_permissions:{'/pages/pda/reweigh':{view:true,create:true},'/pages/pda/return-reweigh':{view:true,create:false}}}
 assert.equal(acl.isPageRegistered('/pages/pda/floor-return-reweigh'),true)
 assert.equal(acl.canViewPage('/pages/pda/floor-return-reweigh',user),true)
 assert.equal(acl.canPageAction('/pages/pda/floor-return-reweigh','create',user),false)
 user.page_permissions['/pages/pda/return-reweigh'].create=true
 assert.equal(acl.canPageAction('/pages/pda/floor-return-reweigh','create',user),true)
})
test('floor route uses exactly existing filling reweigh view and create permissions', () => {
	const user = { role: 'pda_operator', page_permissions: { '/pages/pda/reweigh': { view: true, create: false } } }
	assert.equal(acl.isPageRegistered('/pages/pda/floor-reweigh'), true)
	assert.equal(acl.canViewPage('/pages/pda/floor-reweigh', user), true)
	assert.equal(acl.canPageAction('/pages/pda/floor-reweigh', 'create', user), false)
	user.page_permissions['/pages/pda/reweigh'].view = false
	assert.equal(acl.canViewPage('/pages/pda/floor-reweigh', user), false)
})
test('standalone calibration inherits the existing update permission on reweigh', () => {
 const user={role:'pda_operator',page_permissions:{'/pages/pda/reweigh':{view:true,create:true,update:false}}}
 assert.equal(acl.canPageAction('/pages/pda/floor-calibration','update',user),false)
 user.page_permissions['/pages/pda/reweigh'].update=true
 assert.equal(acl.canPageAction('/pages/pda/floor-calibration','update',user),true)
})
