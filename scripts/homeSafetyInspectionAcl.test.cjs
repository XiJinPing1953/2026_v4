'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const registry = require('../uniCloud-alipay/cloudfunctions/common/pageAclRegistry')
const acl = require('../uniCloud-alipay/cloudfunctions/common/pageAcl')
const backendPath = path.join(
	repoRoot,
	'uniCloud-alipay/cloudfunctions/crm-home-safety-inspection/index.js'
)
const authPath = path.join(repoRoot, 'uniCloud-alipay/cloudfunctions/crm-auth/index.js')
const rfidPath = path.join(repoRoot, 'uniCloud-alipay/cloudfunctions/crm-rfid/index.js')
const userCloudPath = path.join(repoRoot, 'uniCloud-alipay/cloudfunctions/crm-user/index.js')
const regBridgePath = path.join(
	repoRoot,
	'uniCloud-alipay/cloudfunctions/crm-reg-bridge/index.js'
)
const pdaScalePath = path.join(
	repoRoot,
	'uniCloud-alipay/cloudfunctions/crm-pda-scale/index.js'
)
const bottleBatchOpsPath = path.join(
	repoRoot,
	'uniCloud-alipay/cloudfunctions/crm-bottle-batch-ops/index.js'
)
const vehicleImportOncePath = path.join(
	repoRoot,
	'uniCloud-alipay/cloudfunctions/crm-vehicle-import-once/index.js'
)
const mainSchemaPath = path.join(
	repoRoot,
	'uniCloud-alipay/database/crm_home_safety_inspections.schema.json'
)
const revisionSchemaPath = path.join(
	repoRoot,
	'uniCloud-alipay/database/crm_home_safety_revisions.schema.json'
)

test('安全巡检员仅拥有两类巡检及整改页面权限', () => {
	const permissions = registry.buildRoleTemplatePermissions('safety_inspector')
	const allowed = Object.entries(permissions)
		.filter(([, actions]) => actions.view || actions.create || actions.update || actions.delete)
		.map(([pagePath]) => pagePath)
	assert.ok(allowed.length >= 10)
	assert.ok(allowed.every((pagePath) =>
		pagePath === '/pages/safety-inspection/home' ||
		pagePath.startsWith('/pages/home-safety-inspection/') ||
		pagePath.startsWith('/pages/station-safety-inspection/')
	))
	assert.equal(permissions['/pages/home-safety-inspection/form'].create, true)
	assert.equal(permissions['/pages/home-safety-inspection/form'].update, false)
	assert.equal(permissions['/pages/station-safety-inspection/form'].create, true)
	assert.equal(permissions['/pages/station-safety-inspection/form'].update, false)
	assert.equal(permissions['/pages/station-safety-inspection/hazards'].update, true)
	assert.equal(permissions['/pages/sale/list'].view, false)
	assert.equal(permissions['/pages/pda/home'].view, false)
})

test('巡检专用角色即使存在旧的自定义权限也会被硬性收敛', () => {
	const permissions = acl.normalizePagePermissions(
		{
			'/pages/sale/list': { view: true, create: true, update: true, delete: true },
			'/pages/home-safety-inspection/form': { view: true, create: true, update: true, delete: true },
			'/pages/home-safety-inspection/export': { view: true },
			'/pages/station-safety-inspection/export': { view: true },
			'/pages/station-safety-inspection/form': { view: false, create: false, update: true }
		},
		'safety_inspector'
	)
	assert.equal(permissions['/pages/sale/list'].view, false)
	assert.equal(permissions['/pages/home-safety-inspection/form'].create, true)
	assert.equal(permissions['/pages/home-safety-inspection/form'].update, false)
	assert.equal(permissions['/pages/home-safety-inspection/export'].view, true)
	assert.equal(permissions['/pages/station-safety-inspection/export'].view, true)
	assert.equal(permissions['/pages/station-safety-inspection/form'].view, true)
	assert.equal(permissions['/pages/station-safety-inspection/form'].create, true)
	assert.equal(permissions['/pages/station-safety-inspection/form'].update, false)
})

test('公共 ACL 对巡检员的未登记动作默认拒绝，其他角色保持原行为', async () => {
	const deniedLogs = []
	const isolatedDenied = await acl.ensureActionAcl(
		{ role: 'safety_inspector' },
		'unregisteredV1',
		{},
		[],
		{
			cloudFunction: 'crm-customer',
			recordLog: async (...args) => deniedLogs.push(args)
		}
	)
	assert.equal(isolatedDenied.ok, false)
	assert.equal(isolatedDenied.code, 403)
	assert.equal(deniedLogs.length, 1)
	assert.equal(deniedLogs[0][2].reason, 'unregistered_action_for_isolated_role')

	const ordinaryAllowed = await acl.ensureActionAcl(
		{ role: 'user' },
		'unregisteredV1',
		{},
		[],
		{ cloudFunction: 'crm-customer' }
	)
	assert.equal(ordinaryAllowed.ok, true)

	const inspectionEntryAllowed = await acl.ensureActionAcl(
		{ role: 'safety_inspector' },
		'unregisteredV1',
		{},
		[],
		{ cloudFunction: 'crm-home-safety-inspection' }
	)
	assert.equal(inspectionEntryAllowed.ok, true)
	const stationEntryAllowed = await acl.ensureActionAcl(
		{ role: 'safety_inspector' },
		'unregisteredV1',
		{},
		[],
		{ cloudFunction: 'crm-station-safety-inspection' }
	)
	assert.equal(stationEntryAllowed.ok, true)
})

test('超级管理员拥有巡检查看、新建和修改权限', () => {
	const permissions = registry.buildRoleTemplatePermissions('superadmin')
	assert.equal(permissions['/pages/home-safety-inspection/home'].view, true)
	assert.equal(permissions['/pages/home-safety-inspection/form'].create, true)
	assert.equal(permissions['/pages/home-safety-inspection/form'].update, true)
	assert.equal(permissions['/pages/home-safety-inspection/detail'].update, true)
	assert.equal(permissions['/pages/home-safety-inspection/export'].view, true)
	assert.equal(permissions['/pages/safety-inspection/home'].view, true)
	assert.equal(permissions['/pages/station-safety-inspection/form'].update, true)
	assert.equal(permissions['/pages/station-safety-inspection/hazards'].update, true)
	assert.equal(permissions['/pages/station-safety-inspection/export'].view, true)
})

test('所有云函数 ACL fallback 与公共 registry 一致', () => {
	const result = spawnSync(process.execPath, ['scripts/syncPageAclRegistry.cjs'], {
		cwd: repoRoot,
		encoding: 'utf8'
	})
	assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('认证与 RFID 内联角色识别包含 safety_inspector', () => {
	assert.match(fs.readFileSync(authPath, 'utf8'), /safety_inspector/)
	assert.match(fs.readFileSync(rfidPath, 'utf8'), /safety_inspector/)
})

test('用户管理隔离巡检员，并对创建和更新角色执行原始值白名单校验', () => {
	const source = fs.readFileSync(userCloudPath, 'utf8')
	const denyIndex = source.indexOf("if (isSafetyInspector(user))")
	const dispatchIndex = source.indexOf("if (action === 'listV1')")
	assert.ok(denyIndex > 0 && dispatchIndex > denyIndex, '巡检员拒绝必须位于所有 action 分发之前')
	assert.match(source, /ROLE_TEMPLATE_WHITELIST\s*=\s*new Set/)
	assert.match(source, /normalizedRoles\.some\(\(role\) => !ROLE_TEMPLATE_WHITELIST\.has\(role\)\)/)

	for (const functionName of ['createV1', 'updateRoleV1', 'savePermissionsV1']) {
		const start = source.indexOf(`async function ${functionName}`)
		assert.ok(start >= 0, `${functionName} 不存在`)
		const next = source.indexOf('\nasync function ', start + 1)
		const body = source.slice(start, next >= 0 ? next : source.length)
		assert.match(body, /resolveRequestedRoleTemplate\(data\)/, `${functionName} 未校验原始角色`)
	}
})

test('旧认证兼容入口同样不能把未知角色归一成普通用户', () => {
	const source = fs.readFileSync(authPath, 'utf8')
	assert.match(source, /ROLE_TEMPLATE_WHITELIST\s*=\s*new Set/)
	assert.match(source, /normalizedRoles\.some\(\(role\) => !ROLE_TEMPLATE_WHITELIST\.has\(role\)\)/)
	for (const action of ["if (action === 'createUser')", "if (action === 'updateRole')"]) {
		const start = source.indexOf(action)
		assert.ok(start >= 0, `${action} 不存在`)
		const next = source.indexOf("\n\tif (action === '", start + action.length)
		const body = source.slice(start, next >= 0 ? next : source.length)
		assert.match(body, /resolveRequestedRoleTemplate\(data\)/)
	}
})

test('监管桥接明确拒绝巡检员 token，且未改动现有签名 secret 链路', () => {
	const source = fs.readFileSync(regBridgePath, 'utf8')
	assert.match(source, /if \(isSafetyInspector\(user\)\)[\s\S]{0,180}code:\s*403/)
	assert.match(source, /process\.env\.REG_SECRET/)
	assert.match(source, /hmacSha256Hex\(signInput,\s*config\.secret\)/)
})

test('PDA 秤云函数具备本地 ACL fallback 并纳入一致性同步', () => {
	const source = fs.readFileSync(pdaScalePath, 'utf8')
	assert.match(source, /require\('\.\.\/common\/pageAcl'\)/)
	assert.match(source, /require\('\.\/pageAclLocal'\)/)
	for (const filename of ['pageAclLocal.js', 'pageAclRegistry.js', 'pageAclRegistryLocal.js']) {
		const fallbackPath = path.join(path.dirname(pdaScalePath), filename)
		assert.ok(fs.existsSync(fallbackPath), `缺少 ${filename}`)
	}
})

test('一次性瓶档和车辆导入在读取载荷、写库之前要求超级管理员', () => {
	for (const [cloudPath, payloadCallPattern] of [
		[bottleBatchOpsPath, 'const payload = loadPayload()'],
		[vehicleImportOncePath, 'const payloadRows = readPayloadRows()']
	]) {
		const source = fs.readFileSync(cloudPath, 'utf8')
		const authIndex = source.indexOf('const user = await getUserByToken')
		const superadminIndex = source.indexOf('if (!isSuperAdmin(user))', authIndex)
		const payloadIndex = source.indexOf(payloadCallPattern)
		assert.ok(authIndex >= 0, `${path.basename(path.dirname(cloudPath))} 缺少 token 认证`)
		assert.ok(superadminIndex > authIndex, `${path.basename(path.dirname(cloudPath))} 缺少超级管理员校验`)
		assert.ok(payloadIndex > superadminIndex, `${path.basename(path.dirname(cloudPath))} 在鉴权前读取了载荷`)
		assert.match(source.slice(authIndex, payloadIndex), /code:\s*401/)
		assert.match(source.slice(authIndex, payloadIndex), /code:\s*403/)
	}
})

test('主记录幂等索引、修订唯一索引和客户端直连禁用', () => {
	const mainSchema = JSON.parse(fs.readFileSync(mainSchemaPath, 'utf8'))
	const revisionSchema = JSON.parse(fs.readFileSync(revisionSchemaPath, 'utf8'))
	assert.deepEqual(mainSchema.permission, {
		read: false,
		create: false,
		update: false,
		delete: false
	})
	assert.deepEqual(revisionSchema.permission, {
		read: false,
		create: false,
		update: false,
		delete: false
	})
	assert.ok(
		mainSchema.indexes.some(
			(index) => index.unique === true && index.key?.client_submission_id === 1
		)
	)
	assert.ok(
		revisionSchema.indexes.some(
			(index) => index.unique === true && index.key?.inspection_id === 1 && index.key?.version_no === 1
		)
	)
})

test('服务端同时实现幂等回查、隐藏客户校验和修改前版本保存', () => {
	const source = fs.readFileSync(backendPath, 'utf8')
	assert.match(source, /existingRes[\s\S]+client_submission_id/)
	assert.match(source, /isDuplicateKeyError/)
	assert.match(source, /visibleCustomerWhere/)
	assert.match(source, /revisions\.add/)
	assert.match(source, /editReason/)
	assert.doesNotMatch(source, /photo_file_ids[\s\S]{0,80}recordLog/)
})
