'use strict'

const {
	ACTIONS,
	PAGE_REGISTRY,
	PAGE_REGISTRY_MAP,
	normalizeRoleTemplate,
	buildRoleTemplatePermissions
} = require('./pageAclRegistryLocal')

function normalizePagePath(value) {
	const text = String(value || '').trim()
	if (!text) return ''
	if (text.startsWith('/')) return text
	return `/${text}`
}

function normalizePermissionEntry(raw = {}, supports = {}) {
	return ACTIONS.reduce((entry, action) => {
		const allowed = action === 'view' ? Boolean(raw[action]) : Boolean(raw[action]) && Boolean(supports[action])
		entry[action] = allowed
		return entry
	}, {})
}

function normalizePagePermissions(rawPermissions, roleTemplate) {
	const base = buildRoleTemplatePermissions(roleTemplate)
	const source = rawPermissions && typeof rawPermissions === 'object' ? rawPermissions : {}
	return PAGE_REGISTRY.reduce((acc, item) => {
		const pagePath = item.pagePath
		const supports = item.supports || {}
		const rawEntry = source[pagePath]
		acc[pagePath] = normalizePermissionEntry(rawEntry || base[pagePath] || {}, supports)
		return acc
	}, {})
}

function sanitizeUser(user = {}) {
	if (!user) return null
	const roleTemplate = normalizeRoleTemplate(user.role_template || user.role)
	const pagePermissions = normalizePagePermissions(user.page_permissions, roleTemplate)
	return {
		...user,
		role_template: roleTemplate,
		page_permissions: pagePermissions
	}
}

function isSuperAdmin(user) {
	return normalizeRoleTemplate(user?.role) === 'superadmin' || normalizeRoleTemplate(user?.role_template) === 'superadmin'
}

function getResolvedPagePermissions(user) {
	if (!user) return buildRoleTemplatePermissions('user')
	if (isSuperAdmin(user)) return buildRoleTemplatePermissions('superadmin')
	return normalizePagePermissions(user.page_permissions, user.role_template || user.role)
}

function hasPagePermission(user, pagePath, action = 'view') {
	if (isSuperAdmin(user)) return true
	const normalizedPagePath = normalizePagePath(pagePath)
	const normalizedAction = ACTIONS.includes(action) ? action : 'view'
	const permissions = getResolvedPagePermissions(user)
	const entry = permissions[normalizedPagePath]
	return Boolean(entry && entry[normalizedAction])
}

function hasAnyPagePermission(user, rules = []) {
	if (isSuperAdmin(user)) return true
	return (rules || []).some((rule) => hasPagePermission(user, rule.pagePath, rule.action))
}

async function ensurePagePermission(user, rules, options = {}) {
	if (hasAnyPagePermission(user, rules)) return { ok: true }
	const { recordLog, requestId = '', deniedAction = 'acl_denied', detail = {} } = options || {}
	if (typeof recordLog === 'function') {
		await recordLog(user, deniedAction, { rules, ...detail }, requestId)
	}
	return { ok: false, code: 403, msg: '无权限执行该操作' }
}

async function ensureActionAcl(user, action, actionRules = {}, superadminOnlyActions = [], options = {}) {
	const { recordLog, requestId = '', cloudFunction = '', detail = {}, superadminDeniedMsg = '仅超级管理员可操作' } = options
	if ((superadminOnlyActions || []).includes(action) && !isSuperAdmin(user)) {
		if (typeof recordLog === 'function') {
			await recordLog(user, 'acl_denied', { action, cloudFunction, reason: 'superadmin_only', ...detail }, requestId)
		}
		return { ok: false, code: 403, msg: superadminDeniedMsg }
	}
	const rules = actionRules[action]
	if (!rules || !rules.length) return { ok: true }
	return ensurePagePermission(user, rules, {
		recordLog,
		requestId,
		deniedAction: 'acl_denied',
		detail: { action, cloudFunction, ...detail }
	})
}

module.exports = {
	ACTIONS,
	PAGE_REGISTRY,
	PAGE_REGISTRY_MAP,
	normalizePagePath,
	normalizeRoleTemplate,
	buildRoleTemplatePermissions,
	normalizePagePermissions,
	sanitizeUser,
	isSuperAdmin,
	getResolvedPagePermissions,
	hasPagePermission,
	hasAnyPagePermission,
	ensurePagePermission
	,
	ensureActionAcl
}
