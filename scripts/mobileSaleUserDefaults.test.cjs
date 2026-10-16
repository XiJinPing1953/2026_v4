'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { makeDb } = require('./lib/accountingTestHarness.cjs')
const acl = require('../uniCloud-alipay/cloudfunctions/common/pageAcl')

const salePage = '/pages/pda/sale-create'
const ids = { delivery1_id: 'driver-1', delivery2_id: 'driver-2', vehicle_id: 'vehicle-1' }
const expectedDefaults = { ...ids, delivery1: '测试配送甲', delivery2: '测试配送乙', vehicle_no: 'TEST38U7G' }
const copy = value => JSON.parse(JSON.stringify(value))
function minimumPermissions() {
	const permissions = Object.fromEntries(acl.PAGE_REGISTRY.map(({ pagePath }) => [pagePath, {}]))
	permissions[salePage] = { view: true, create: true }
	return permissions
}
function harness() {
	const tables = {
		crm_users: [
			{ _id: 'super', username: 'superadmin', role: 'superadmin', token: 'super' },
			{ _id: 'admin', username: 'administrator', role: 'admin', token: 'admin' },
			{ _id: 'ordinary', username: 'ordinary', role: 'user', token: 'ordinary' },
			{ _id: 'safety', username: 'inspector', role: 'safety_inspector', token: 'safety' },
			{ _id: 'target', username: 'mobile-existing', role: 'user', mobile_sale_defaults: copy(expectedDefaults) }
		],
		crm_delivery_men: [
			{ _id: 'driver-1', name: '测试配送甲', is_active: true },
			{ _id: 'driver-2', name: '测试配送乙', is_active: true }
		],
		crm_vehicles: [{ _id: 'vehicle-1', plate_no: 'TEST38U7G', is_active: true }]
	}
	const db = makeDb(tables, { mutate: true })
	const filename = path.resolve(__dirname, '../uniCloud-alipay/cloudfunctions/crm-user/index.js')
	const localRequire = createRequire(filename)
	const context = { exports: {}, require: name => name === 'bcryptjs' ? { hash: async () => 'synthetic-hash' } : localRequire(name),
		uniCloud: { database: () => db }, console: { log() {}, warn() {}, error() {} }, process, Date, Math, Set }
	vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename })
	return { tables, writes: db.writes,
		invoke: (action, data, token = 'super') => context.exports.main({ action, data, token }, {}),
		create: (extra = {}) => ({ username: 'mobile-new', nickname: '测试手机账号', password: 'synthetic-password', role_template: 'user', ...extra }),
		edit: (extra = {}) => ({ userId: 'target', role_template: 'user', page_permissions: minimumPermissions(), ...extra }) }
}

test('actual user handlers require superadmin before creating accounts or changing defaults', async () => {
	for (const token of ['', 'ordinary', 'admin', 'safety']) {
		const h = harness()
		for (const [action, data] of [['createV1', h.create({ mobile_sale_defaults: ids })], ['savePermissionsV1', h.edit({ mobile_sale_defaults: ids })]]) {
			const res = await h.invoke(action, data, token)
			assert.equal(res.code, token ? 403 : 401)
		}
		assert.equal(h.writes.filter(write => write.name === 'crm_users').length, 0)
	}
})

test('create atomically stores minimum page permissions and server-resolved editable sale defaults', async () => {
	const h = harness()
	const result = await h.invoke('createV1', h.create({ page_permissions: minimumPermissions(), mobile_sale_defaults: {
		...ids, delivery1_id: ' driver-1 ', delivery1: '伪造姓名', vehicle_no: '伪造车牌' } }))
	assert.equal(result.code, 0, result.msg)
	const account = h.tables.crm_users.find(row => row._id === result.data._id)
	assert.deepEqual(account.mobile_sale_defaults, expectedDefaults)
	const allowed = Object.entries(account.page_permissions).filter(([, actions]) => Object.values(actions).some(Boolean))
	assert.deepEqual(allowed.map(([page]) => page), [salePage])
	assert.equal(account.page_permissions[salePage].create, true)
	assert.equal(account.page_permissions[salePage].update, false)
	const writes = h.writes.filter(write => write.name === 'crm_users')
	assert.equal(writes.length, 1)
	const list = await h.invoke('listManageV1', {})
	const exposed = list.data.find(row => row._id === account._id)
	assert.deepEqual(copy(exposed.mobile_sale_defaults), expectedDefaults)
	assert.equal('password_hash' in exposed, false)
	assert.equal('token' in exposed, false)
})

test('create with fields omitted keeps previous template behavior and adds no defaults', async () => {
	const h = harness()
	assert.equal((await h.invoke('createV1', h.create({ role_template: 'pda_operator' }))).code, 0)
	const account = h.tables.crm_users.find(row => row.username === 'mobile-new')
	assert.deepEqual(account.page_permissions, acl.buildRoleTemplatePermissions('pda_operator'))
	assert.equal('mobile_sale_defaults' in account, false)
})

test('missing, inactive and incomplete master records reject both handlers before user writes', async () => {
	for (const [field, collection, id, nameField] of [
		['delivery1_id', 'crm_delivery_men', 'driver-1', 'name'],
		['delivery2_id', 'crm_delivery_men', 'driver-2', 'name'],
		['vehicle_id', 'crm_vehicles', 'vehicle-1', 'plate_no']
	]) {
		for (const problem of ['missing', 'inactive', 'incomplete']) {
			const h = harness(), defaults = { ...ids }
			if (problem === 'missing') defaults[field] = 'missing'
			else Object.assign(h.tables[collection].find(row => row._id === id), problem === 'inactive' ? { is_active: false } : { [nameField]: '' })
			for (const [action, data] of [['createV1', h.create({ mobile_sale_defaults: defaults })], ['savePermissionsV1', h.edit({ mobile_sale_defaults: defaults })]]) {
				assert.equal((await h.invoke(action, data)).code, 400, `${action} ${field} ${problem}`)
			}
			assert.equal(h.writes.filter(write => write.name === 'crm_users').length, 0)
		}
	}
})

test('invalid defaults and malformed ID inputs are rejected', async () => {
	for (const value of [[], 'driver-1', false, { delivery1_id: {} }, { delivery2_id: 2 }, { vehicle_id: [] }]) {
		const h = harness()
		assert.equal((await h.invoke('createV1', h.create({ mobile_sale_defaults: value }))).code, 400)
		assert.equal((await h.invoke('savePermissionsV1', h.edit({ mobile_sale_defaults: value }))).code, 400)
		assert.equal(h.writes.filter(write => write.name === 'crm_users').length, 0)
	}
})

test('permission edits preserve omitted defaults and explicit null clears to schema-compatible object', async () => {
	const h = harness(), target = h.tables.crm_users.find(row => row._id === 'target')
	assert.equal((await h.invoke('savePermissionsV1', h.edit({ nickname: '新昵称' }))).code, 0)
	assert.deepEqual(target.mobile_sale_defaults, expectedDefaults)
	assert.equal('mobile_sale_defaults' in h.writes.find(write => write.name === 'crm_users').data, false)
	assert.equal((await h.invoke('savePermissionsV1', h.edit({ mobile_sale_defaults: null }))).code, 0)
	assert.deepEqual(target.mobile_sale_defaults, {})
	assert.equal((await h.invoke('createV1', h.create({ mobile_sale_defaults: null }))).code, 0)
	assert.deepEqual(h.tables.crm_users.find(row => row.username === 'mobile-new').mobile_sale_defaults, {})
})

test('explicit defaults replace previous values using fresh registered labels only', async () => {
	const h = harness(), target = h.tables.crm_users.find(row => row._id === 'target')
	h.tables.crm_delivery_men[1].name = '档案新姓名'
	assert.equal((await h.invoke('savePermissionsV1', h.edit({ mobile_sale_defaults: { delivery1_id: 'driver-2', delivery1: '伪造姓名' } }))).code, 0)
	assert.deepEqual(target.mobile_sale_defaults, { delivery1_id: 'driver-2', delivery1: '档案新姓名', delivery2_id: '', delivery2: '', vehicle_id: '', vehicle_no: '' })
})

test('superadmin permission lock remains intact when defaults are supplied', async () => {
	const h = harness()
	assert.equal((await h.invoke('savePermissionsV1', h.edit({ userId: 'super', mobile_sale_defaults: ids }))).code, 0)
	const account = h.tables.crm_users.find(row => row._id === 'super')
	assert.equal(account.role_template, 'superadmin')
	assert.deepEqual(account.page_permissions, acl.buildRoleTemplatePermissions('superadmin'))
	assert.deepEqual(account.mobile_sale_defaults, expectedDefaults)
})
