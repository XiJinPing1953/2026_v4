'use strict'

const crypto = require('crypto')
const bcrypt = require('bcryptjs')
let authAclHelpers = null
try {
	authAclHelpers = require('../common/pageAcl')
} catch (err) {
	console.warn('[crm-auth] fallback to local pageAcl helpers', err && err.message)
	authAclHelpers = require('./pageAclLocal')
}
const {
	normalizeRoleTemplate,
	buildRoleTemplatePermissions,
	normalizePagePermissions,
	sanitizeUser,
	isSuperAdmin
} = authAclHelpers
const db = uniCloud.database()
const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')

const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'superadmin'
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'y7ez5CGAbivZkeP'
const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10)
const ROLE_TEMPLATE_WHITELIST = new Set([
	'superadmin',
	'admin',
	'finance',
	'user',
	'pda_operator',
	'safety_inspector'
])

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
		console.error('[crm-auth] recordLog failed', action, err)
	}
}

function hasSuperAdminConfig() {
	return Boolean(SUPERADMIN_USERNAME && SUPERADMIN_PASSWORD)
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

async function hashPassword(password) {
	const rounds = Number.isFinite(BCRYPT_SALT_ROUNDS) ? BCRYPT_SALT_ROUNDS : 10
	return bcrypt.hash(password, rounds)
}

async function verifyPassword(password, passwordHash) {
	if (!passwordHash) return false
	return bcrypt.compare(password, passwordHash)
}

function stripSensitive(user) {
	if (!user) return null
	const { password_hash, token, ...rest } = user
	return sanitizeUser(rest)
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeNickname(value, fallback = '') {
	return normalizeString(value || fallback)
}

function normalizeRawRole(value) {
	return normalizeString(value).toLowerCase()
}

function resolveRequestedRoleTemplate(data = {}, fallback = 'user') {
	const source = data && typeof data === 'object' ? data : {}
	const hasRoleTemplate = Object.prototype.hasOwnProperty.call(source, 'role_template')
	const hasRole = Object.prototype.hasOwnProperty.call(source, 'role')
	const rawRoles = []
	if (hasRoleTemplate) rawRoles.push(source.role_template)
	if (hasRole) rawRoles.push(source.role)
	if (!rawRoles.length) rawRoles.push(fallback)

	const normalizedRoles = rawRoles.map(normalizeRawRole)
	if (normalizedRoles.some((role) => !ROLE_TEMPLATE_WHITELIST.has(role))) {
		return { ok: false, code: 400, msg: '角色类型无效' }
	}
	if (new Set(normalizedRoles).size > 1) {
		return { ok: false, code: 400, msg: 'role 与 role_template 不一致' }
	}
	return { ok: true, roleTemplate: normalizedRoles[0] }
}

function ensureSuperAdminOperator(user) {
	return isSuperAdmin(user)
		? null
		: {
				code: 403,
				msg: '仅超级管理员可操作'
			}
}

async function ensureSuperAdmin() {
	if (!hasSuperAdminConfig()) {
		console.warn('[crm-auth] SUPERADMIN env not configured')
		return null
	}

	const existing = await users.where({ username: SUPERADMIN_USERNAME }).limit(1).get()
	if (existing.data && existing.data.length) {
		const current = existing.data[0]
		const patch = {}
		const resolvedRole = normalizeRoleTemplate(current.role_template || current.role)
		const targetPermissions = buildRoleTemplatePermissions('superadmin')
		const currentPermissions = normalizePagePermissions(current.page_permissions, 'superadmin')
		if (resolvedRole !== 'superadmin') {
			patch.role = 'superadmin'
			patch.role_template = 'superadmin'
		}
		if (JSON.stringify(currentPermissions) !== JSON.stringify(targetPermissions)) {
			patch.page_permissions = targetPermissions
		}
		if (!current.password_hash) {
			patch.password_hash = await hashPassword(SUPERADMIN_PASSWORD)
		}
		if (Object.keys(patch).length) {
			patch.updated_at = Date.now()
			await users.doc(current._id).update(patch)
			return { ...current, ...patch }
		}
		return current
	}

	const doc = {
		username: SUPERADMIN_USERNAME,
		nickname: normalizeNickname(SUPERADMIN_USERNAME),
		password_hash: await hashPassword(SUPERADMIN_PASSWORD),
		role: 'superadmin',
		role_template: 'superadmin',
		page_permissions: buildRoleTemplatePermissions('superadmin'),
		created_at: Date.now(),
		updated_at: Date.now()
	}
	const res = await users.add(doc)
	return { _id: res.id, ...doc }
}

function buildUserDoc({ username, nickname, passwordHash, roleTemplate }) {
	const role = normalizeRoleTemplate(roleTemplate)
	const now = Date.now()
	const resolvedNickname = normalizeNickname(nickname, username)
	return {
		username,
		nickname: resolvedNickname,
		password_hash: passwordHash,
		role,
		role_template: role,
		page_permissions: buildRoleTemplatePermissions(role),
		created_at: now,
		updated_at: now
	}
}

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return res.data[0] || null
}

async function issueToken(userId) {
	const token = crypto.randomBytes(16).toString('hex')
	await users.doc(userId).update({ token, token_updated_at: Date.now() })
	return token
}

exports.main = async (event, context) => {
	const { action, data = {}, token } = event
	const requestId =
		String(event.request_id || event.requestId || context?.requestId || context?.request_id || '') ||
		generateRequestId()

	try {
		await ensureSuperAdmin()
	} catch (err) {
		console.error('[crm-auth] ensureSuperAdmin failed', err)
	}

	if (action === 'registerAdmin') {
		const countRes = await users.where({ username: db.command.neq(SUPERADMIN_USERNAME) }).count()
		if (countRes.total > 0) {
			return { code: 400, msg: '已存在用户，不能重复初始化' }
		}
		const username = normalizeString(data.username)
		const password = normalizeString(data.password)
		const nickname = normalizeNickname(data.nickname, username)
		if (!username || !password) return { code: 400, msg: '缺少账号或密码' }
		if (!nickname) return { code: 400, msg: '昵称必填' }
		if (nickname.length > 20) return { code: 400, msg: '昵称最多20个字' }

		const doc = {
			...buildUserDoc({
				username,
				nickname,
				passwordHash: await hashPassword(password),
				roleTemplate: 'admin'
			})
		}
		const insertRes = await users.add(doc)
		await recordLog({ _id: insertRes.id, username, role: 'admin' }, 'register_admin', {}, requestId)

		return { code: 0, msg: '管理员创建成功', data: { _id: insertRes.id } }
	}

	if (action === 'login') {
		const { username, password } = data
		if (!username || !password) return { code: 400, msg: '缺少账号或密码' }

		const res = await users.where({ username }).get()
		const user = res.data[0]
		if (!user) return { code: 400, msg: '账号或密码错误' }

		const matched = await verifyPassword(password, user.password_hash)
		if (!matched) return { code: 400, msg: '账号或密码错误' }

		const newToken = await issueToken(user._id)
		await recordLog(user, 'login', {}, requestId)

		const safeUser = stripSensitive(user)
		return { code: 0, token: newToken, user: { ...safeUser, token: newToken } }
	}

	if (action === 'check') {
		const user = await getUserByToken(token)
		if (!user) return { code: 401, msg: '未登录或登录已过期' }
		return { code: 0, user: stripSensitive(user) }
	}

	if (action === 'refresh') {
		const user = await getUserByToken(token)
		if (!user) return { code: 401, msg: '未登录或登录已过期' }
		const newToken = await issueToken(user._id)
		await recordLog(user, 'refresh_token', {}, requestId)
		return { code: 0, token: newToken, user: { ...stripSensitive(user), token: newToken } }
	}

	if (action === 'listUsers') {
		const user = await getUserByToken(token)
		if (!user) return { code: 401, msg: '未登录或登录已过期' }
		const denied = ensureSuperAdminOperator(user)
		if (denied) return denied

		const res = await users.get()
		const dataList = (res.data || []).map(stripSensitive)
		await recordLog(user, 'list_users', {}, requestId)

		return { code: 0, data: dataList }
	}

	if (action === 'createUser') {
		const user = await getUserByToken(token)
		if (!user) return { code: 401, msg: '未登录或登录已过期' }
		const denied = ensureSuperAdminOperator(user)
		if (denied) return denied

		const username = normalizeString(data.username)
		const password = normalizeString(data.password)
		const nickname = normalizeNickname(data.nickname, username)
		const roleResolution = resolveRequestedRoleTemplate(data)
		if (!roleResolution.ok) return roleResolution
		if (!username || !password) return { code: 400, msg: '缺少账号或密码' }
		if (!nickname) return { code: 400, msg: '昵称必填' }
		if (nickname.length > 20) return { code: 400, msg: '昵称最多20个字' }
		if (username.length < 3 || password.length < 6) {
			return { code: 400, msg: '账号至少3位，密码至少6位' }
		}
		const resolvedRole = roleResolution.roleTemplate
		if (username === SUPERADMIN_USERNAME) {
			return { code: 400, msg: '无法新增同名账号' }
		}

		const exists = await users.where({ username }).limit(1).get()
		if (exists.data && exists.data.length) {
			return { code: 400, msg: '账号已存在' }
		}

		const doc = buildUserDoc({
			username,
			nickname,
			passwordHash: await hashPassword(password),
			roleTemplate: resolvedRole
		})

		const res = await users.add(doc)
		await recordLog(user, 'create_user', { id: res.id, username, role: resolvedRole }, requestId)

		return { code: 0, msg: '创建成功', data: { _id: res.id } }
	}

	if (action === 'removeUser') {
		const user = await getUserByToken(token)
		if (!user) return { code: 401, msg: '未登录或登录已过期' }
		const denied = ensureSuperAdminOperator(user)
		if (denied) return denied

		const { userId } = data || {}
		if (!userId) return { code: 400, msg: '缺少用户 ID' }

		const target = await users.doc(userId).get()
		const targetDoc = (target && target.data && target.data[0]) || null
		if (!targetDoc) return { code: 404, msg: '用户不存在' }
		if (targetDoc.username === SUPERADMIN_USERNAME) {
			return { code: 400, msg: '不能删除超级管理员' }
		}

		await users.doc(userId).remove()
		await recordLog(user, 'remove_user', { id: userId, username: targetDoc.username })

		return { code: 0, msg: '已删除用户' }
	}

	if (action === 'updateRole') {
		const user = await getUserByToken(token)
		if (!user) return { code: 401, msg: '未登录或登录已过期' }
		const denied = ensureSuperAdminOperator(user)
		if (denied) return denied

		const { userId } = data
		if (!userId) return { code: 400, msg: '缺少用户 ID' }
		const roleResolution = resolveRequestedRoleTemplate(data)
		if (!roleResolution.ok) return roleResolution
		const resolvedRole = roleResolution.roleTemplate
		await users.doc(userId).update({
			role: resolvedRole,
			role_template: resolvedRole,
			page_permissions: buildRoleTemplatePermissions(resolvedRole),
			updated_at: Date.now()
		})

		await recordLog(user, 'update_role', { target: userId, role: resolvedRole })
		return { code: 0, msg: '角色已更新' }
	}

	return { code: 400, msg: '未知 action' }
}
