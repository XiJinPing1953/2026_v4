'use strict'

const db = uniCloud.database()
const dbCmd = db.command
let aclHelpers = null
try {
	aclHelpers = require('../common/pageAcl')
} catch (err) {
	console.warn('[crm-user] fallback to local pageAcl helpers', err && err.message)
	aclHelpers = require('./pageAclLocal')
}
const {
	PAGE_REGISTRY,
	normalizeRoleTemplate,
	buildRoleTemplatePermissions,
	normalizePagePermissions,
	sanitizeUser,
	isSuperAdmin
} = aclHelpers

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10)
const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'superadmin'

let bcryptInstance = null

function getBcrypt() {
	if (bcryptInstance) return bcryptInstance
	try {
		bcryptInstance = require('bcryptjs')
		return bcryptInstance
	} catch (err) {
		console.error('[crm-user] bcryptjs load failed', err)
		throw new Error('用户密码依赖未安装，请重新上传 crm-user 云函数依赖')
	}
}

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data && res.data[0]) || null
}

async function recordLog(user, action, detail = {}, requestId = '') {
	try {
		await logs.add({
			user_id: user?._id || null,
			username: user?.username || '',
			role: user?.role || '',
			action,
			detail,
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-user] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripSensitive(user) {
	if (!user) return null
	const { password_hash, token, ...rest } = user
	return sanitizeUser(rest)
}

async function hashPassword(password) {
	return getBcrypt().hash(password, Number.isFinite(BCRYPT_SALT_ROUNDS) ? BCRYPT_SALT_ROUNDS : 10)
}

function ensureSuperAdminUser(user) {
	if (isSuperAdmin(user) || normalizeString(user?.username) === SUPERADMIN_USERNAME) return null
	return { code: 403, msg: '仅超级管理员可操作' }
}

function buildUserDoc({ username, passwordHash, roleTemplate }) {
	const role = normalizeRoleTemplate(roleTemplate)
	const now = Date.now()
	return {
		username,
		password_hash: passwordHash,
		role,
		role_template: role,
		page_permissions: buildRoleTemplatePermissions(role),
		created_at: now,
		updated_at: now
	}
}

async function listV1(user, data, requestId) {
	void user
	const keyword = normalizeString(data.keyword)
	const limit = Math.min(Math.max(Number(data.limit || 20), 1), 50)
	const conditions = []

	if (keyword) {
		const rx = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })
		conditions.push(dbCmd.or([{ username: rx }, { name: rx }]))
	}

	const where =
		conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)

	const res = await users.where(where).limit(limit).get()
	const list = (res.data || []).map(stripSensitive)
	await recordLog(user, 'user_list_v1', { keyword, limit }, requestId)
	return { code: 0, data: list }
}

async function listManageV1(user, requestId) {
	const denied = ensureSuperAdminUser(user)
	if (denied) return denied
	const res = await users.get()
	const list = (res.data || [])
		.slice()
		.sort((a, b) => Number(b?.created_at || 0) - Number(a?.created_at || 0))
		.map(stripSensitive)
	await recordLog(user, 'user_manage_list_v1', {}, requestId)
	return { code: 0, data: list }
}

async function createV1(user, data, requestId) {
	const denied = ensureSuperAdminUser(user)
	if (denied) return denied
	const username = normalizeString(data.username)
	const password = normalizeString(data.password)
	const roleTemplate = normalizeRoleTemplate(data.role_template || data.role || 'user')
	if (!username || !password) return { code: 400, msg: '缺少账号或密码' }
	if (username.length < 3 || password.length < 6) return { code: 400, msg: '账号至少3位，密码至少6位' }
	const exists = await users.where({ username }).limit(1).get()
	if ((exists.data || []).length) return { code: 400, msg: '账号已存在' }
	const doc = buildUserDoc({
		username,
		passwordHash: await hashPassword(password),
		roleTemplate
	})
	const res = await users.add(doc)
	await recordLog(user, 'user_manage_create_v1', { id: res.id, username, role_template: roleTemplate }, requestId)
	return { code: 0, msg: '创建成功', data: { _id: res.id } }
}

async function updateRoleV1(user, data, requestId) {
	const denied = ensureSuperAdminUser(user)
	if (denied) return denied
	const userId = normalizeString(data.userId || data._id || data.id)
	if (!userId) return { code: 400, msg: '缺少用户 ID' }
	const targetRes = await users.doc(userId).get()
	const target = (targetRes.data || [])[0]
	if (!target) return { code: 404, msg: '用户不存在' }
	if (normalizeString(target.username) === SUPERADMIN_USERNAME) {
		return { code: 400, msg: '超级管理员角色固定，不支持修改' }
	}
	const roleTemplate = normalizeRoleTemplate(data.role_template || data.role || 'user')
	await users.doc(userId).update({
		role: roleTemplate,
		role_template: roleTemplate,
		page_permissions: buildRoleTemplatePermissions(roleTemplate),
		updated_at: Date.now()
	})
	await recordLog(user, 'user_manage_update_role_v1', { target: userId, role_template: roleTemplate }, requestId)
	return { code: 0, msg: '角色已更新' }
}

async function resetPasswordV1(user, data, requestId) {
	const denied = ensureSuperAdminUser(user)
	if (denied) return denied
	const userId = normalizeString(data.userId || data._id || data.id)
	const password = normalizeString(data.password)
	if (!userId || !password) return { code: 400, msg: '缺少用户或密码' }
	if (password.length < 6) return { code: 400, msg: '密码至少 6 位' }
	await users.doc(userId).update({
		password_hash: await hashPassword(password),
		updated_at: Date.now()
	})
	await recordLog(user, 'user_manage_reset_password_v1', { target: userId }, requestId)
	return { code: 0, msg: '密码已重置' }
}

async function removeV1(user, data, requestId) {
	const denied = ensureSuperAdminUser(user)
	if (denied) return denied
	const userId = normalizeString(data.userId || data._id || data.id)
	if (!userId) return { code: 400, msg: '缺少用户 ID' }
	if (userId === user._id) return { code: 400, msg: '不能删除当前登录用户' }
	const res = await users.doc(userId).get()
	const target = (res.data || [])[0]
	if (!target) return { code: 404, msg: '用户不存在' }
	if (normalizeRoleTemplate(target.role_template || target.role) === 'superadmin') {
		return { code: 400, msg: '不能删除超级管理员' }
	}
	await users.doc(userId).remove()
	await recordLog(user, 'user_manage_remove_v1', { target: userId, username: target.username }, requestId)
	return { code: 0, msg: '已删除用户' }
}

async function getPermissionRegistryV1(user, requestId) {
	const denied = ensureSuperAdminUser(user)
	if (denied) return denied
	await recordLog(user, 'user_manage_permission_registry_v1', {}, requestId)
	return { code: 0, data: { pages: PAGE_REGISTRY } }
}

async function savePermissionsV1(user, data, requestId) {
	const denied = ensureSuperAdminUser(user)
	if (denied) return denied
	const userId = normalizeString(data.userId || data._id || data.id)
	if (!userId) return { code: 400, msg: '缺少用户 ID' }
	const targetRes = await users.doc(userId).get()
	const target = (targetRes.data || [])[0]
	if (!target) return { code: 404, msg: '用户不存在' }
	if (normalizeString(target.username) === SUPERADMIN_USERNAME) {
		const roleTemplate = 'superadmin'
		await users.doc(userId).update({
			role: roleTemplate,
			role_template: roleTemplate,
			page_permissions: buildRoleTemplatePermissions(roleTemplate),
			updated_at: Date.now()
		})
		await recordLog(user, 'user_manage_save_permissions_v1', { target: userId, role_template: roleTemplate, locked: true }, requestId)
		return { code: 0, msg: '超级管理员固定全权，已校正权限' }
	}
	const roleTemplate = normalizeRoleTemplate(data.role_template || data.role || 'user')
	const pagePermissions = normalizePagePermissions(data.page_permissions, roleTemplate)
	await users.doc(userId).update({
		role: roleTemplate,
		role_template: roleTemplate,
		page_permissions: pagePermissions,
		updated_at: Date.now()
	})
	await recordLog(user, 'user_manage_save_permissions_v1', { target: userId, role_template: roleTemplate }, requestId)
	return { code: 0, msg: '权限已保存' }
}

async function backfillPermissionsV1(user, requestId) {
	const denied = ensureSuperAdminUser(user)
	if (denied) return denied
	const res = await users.get()
	const list = res.data || []
	let updated = 0
	for (const item of list) {
		const roleTemplate =
			normalizeString(item.username) === SUPERADMIN_USERNAME
				? 'superadmin'
				: normalizeRoleTemplate(item.role_template || item.role)
		const pagePermissions = normalizePagePermissions(item.page_permissions, roleTemplate)
		await users.doc(item._id).update({
			role: roleTemplate,
			role_template: roleTemplate,
			page_permissions: pagePermissions,
			updated_at: Date.now()
		})
		updated += 1
	}
	await recordLog(user, 'user_manage_backfill_permissions_v1', { updated }, requestId)
	return { code: 0, msg: `已回填 ${updated} 个用户`, data: { updated } }
}

exports.main = async (event, context) => {
	try {
		const { action, data = {}, token } = event || {}
		const requestId = normalizeString(event?.request_id || event?.requestId || context?.requestId || '') || ''

		const user = await getUserByToken(token)
		if (!user) return { code: 401, msg: '未登录或登录已过期' }

		if (action === 'listV1') return listV1(user, data, requestId)
		if (action === 'listManageV1') return listManageV1(user, requestId)
		if (action === 'createV1') return createV1(user, data, requestId)
		if (action === 'updateRoleV1') return updateRoleV1(user, data, requestId)
		if (action === 'resetPasswordV1') return resetPasswordV1(user, data, requestId)
		if (action === 'removeV1') return removeV1(user, data, requestId)
		if (action === 'getPermissionRegistryV1') return getPermissionRegistryV1(user, requestId)
		if (action === 'savePermissionsV1') return savePermissionsV1(user, data, requestId)
		if (action === 'backfillPermissionsV1') return backfillPermissionsV1(user, requestId)
		return { code: 400, msg: '未知 action' }
	} catch (err) {
		console.error('[crm-user] main failed', err)
		return {
			code: 500,
			msg: err?.message || '用户管理失败'
		}
	}
}
