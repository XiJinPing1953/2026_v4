import { getUser } from './auth'
import { PAGE_REGISTRY, PAGE_REGISTRY_MAP, buildRoleTemplatePermissions, normalizeRoleTemplate } from './pageAclRegistry'

const ACTIONS = ['view', 'create', 'update', 'delete']
const SAFETY_EXPORT_PATHS = new Set([
	'/pages/home-safety-inspection/export',
	'/pages/station-safety-inspection/export'
])

export function normalizePagePath(value) {
	const text = String(value || '').trim()
	if (!text) return ''
	const path = text.startsWith('/') ? text : `/${text}`
	// 地秤复秤复用罐装复秤权限及其云端写入权限，不创建更宽的权限入口。
	return ['/pages/pda/floor-reweigh', '/pages/pda/floor-calibration'].includes(path) ? '/pages/pda/reweigh' : path
}

// Role defaults are static. User-specific overrides are always read on each check.
const roleDefaults = new Map()
function defaultsFor(role) {
	if (!roleDefaults.has(role)) roleDefaults.set(role, buildRoleTemplatePermissions(role))
	return roleDefaults.get(role)
}
function resolvedEntry(item, defaults, source, role) {
	const base = defaults[item.pagePath]
	if (role === 'safety_inspector' && !SAFETY_EXPORT_PATHS.has(item.pagePath)) return { ...base }
	const raw = source?.[item.pagePath]
	return ACTIONS.reduce((entry, action) => {
		const value = (raw && typeof raw === 'object' ? raw[action] : undefined) ?? base?.[action]
		entry[action] = Boolean((action === 'view' || item.supports[action]) && value)
		return entry
	}, {})
}
export function normalizePagePermissions(rawPermissions, roleTemplate) {
	const role = normalizeRoleTemplate(roleTemplate)
	const defaults = defaultsFor(role)
	return PAGE_REGISTRY.reduce((acc, item) => {
		acc[item.pagePath] = resolvedEntry(item, defaults, rawPermissions, role)
		return acc
	}, {})
}

export function getResolvedPagePermissions(user = getUser()) {
	if (!user) return buildRoleTemplatePermissions('user')
	const roleTemplate = normalizeRoleTemplate(user.role_template || user.role)
	if (roleTemplate === 'superadmin') return buildRoleTemplatePermissions('superadmin')
	return normalizePagePermissions(user.page_permissions, roleTemplate)
}

export function canPageAction(pagePath, action = 'view', user = getUser()) {
	const normalizedPagePath = normalizePagePath(pagePath)
	const normalizedAction = ACTIONS.includes(action) ? action : 'view'
	const item = PAGE_REGISTRY_MAP[normalizedPagePath]
	if (!item || !item.supports) return false
	const role = normalizeRoleTemplate(user?.role_template || user?.role || 'user')
	const defaults = defaultsFor(role)
	if (!user || role === 'superadmin') return Boolean(defaults[normalizedPagePath]?.[normalizedAction])
	return Boolean(resolvedEntry(item, defaults, user.page_permissions, role)[normalizedAction])
}

export function canViewPage(pagePath, user = getUser()) {
	return canPageAction(pagePath, 'view', user)
}

export function getPagePermissionEntry(pagePath, user = getUser()) {
	const normalizedPagePath = normalizePagePath(pagePath)
	const permissions = getResolvedPagePermissions(user)
	return permissions[normalizedPagePath] || { view: false, create: false, update: false, delete: false }
}

export function getAllowedPages(user = getUser()) {
	return PAGE_REGISTRY.filter((item) => canViewPage(item.pagePath, user))
}

export function isPageRegistered(pagePath) {
	return Boolean(PAGE_REGISTRY_MAP[normalizePagePath(pagePath)])
}
