'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

test('standalone auth package loads without warnings and preserves token checks and explicit PDA denies', async (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-auth-package-'))
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
	const source = path.join(__dirname, '../uniCloud-alipay/cloudfunctions/crm-auth')
	for (const name of ['index.js', 'pageAclLocal.js', 'pageAclRegistry.js', 'pageAclRegistryLocal.js']) {
		fs.copyFileSync(path.join(source, name), path.join(directory, name))
	}
	const packagedRequire = createRequire(path.join(directory, 'index.js'))
	const acl = packagedRequire('./pageAclLocal')
	const rootPermissions = acl.buildRoleTemplatePermissions('superadmin')
	const rows = [
		{ _id: 'root', username: '__test_root', role: 'superadmin', role_template: 'superadmin', password_hash: 'existing', page_permissions: rootPermissions },
		{ _id: 'pda', username: 'pda', token: 'test-token', password_hash: 'private-hash', role: 'pda_operator', role_template: 'pda_operator', page_permissions: { '/pages/pda/reweigh': { view: false, create: false } } }
	]
	const warnings = []
	const exports = {}
	vm.runInNewContext(fs.readFileSync(path.join(directory, 'index.js'), 'utf8'), {
		exports,
		require: (name) => name === 'bcryptjs' ? {} : packagedRequire(name),
		process: { env: { SUPERADMIN_USERNAME: '__test_root', SUPERADMIN_PASSWORD: 'test-only' } },
		console: { warn: (...args) => warnings.push(args), error: (...args) => { throw new Error(args.join(' ')) } },
		uniCloud: { database: () => ({ collection: (name) => {
			assert.equal(name === 'crm_users' || name === 'crm_operation_logs', true)
			return { where: (query) => ({ limit() { return this }, get: async () => ({ data: rows.filter(row => Object.entries(query).every(([key, value]) => row[key] === value)) }) }) }
		} }) }
	}, { filename: 'crm-auth/index.js' })
	const valid = await exports.main({ action: 'check', token: 'test-token' }, {})
	assert.equal(valid.code, 0)
	assert.equal(valid.user._id, 'pda')
	assert.equal(valid.user.page_permissions['/pages/pda/reweigh'].view, false)
	assert.equal(valid.user.page_permissions['/pages/pda/reweigh'].create, false)
	assert.equal('token' in valid.user, false)
	assert.equal('password_hash' in valid.user, false)
	const invalid = await exports.main({ action: 'check', token: 'invalid-token' }, {})
	assert.equal(invalid.code, 401)
	assert.deepEqual(warnings, [])
})
