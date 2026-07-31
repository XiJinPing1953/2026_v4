import { getUser } from './auth'
import { PAGE_REGISTRY, PAGE_REGISTRY_MAP, buildRoleTemplatePermissions, normalizeRoleTemplate } from './pageAclRegistry'

const ACTIONS = ['view', 'create', 'update', 'delete']

export function normalizePagePath(value) {
	const text = String(value || '').trim()
	if (!text) return ''
	if (text.startsWith('/')) return text
	return `/${text}`
}

export function normalizePagePermissions(rawPermissions, roleTemplate) {
	const base = buildRoleTemplatePermissions(roleTemplate)
	if (normalizeRoleTemplate(roleTemplate) === 'safety_inspector') return base
	const source = rawPermissions && typeof rawPermissions === 'object' ? rawPermissions : {}
	return PAGE_REGISTRY.reduce((acc, item) => {
		const rawEntry = source[item.pagePath] && typeof source[item.pagePath] === 'object' ? source[item.pagePath] : {}
		acc[item.pagePath] = ACTIONS.reduce((entry, action) => {
			entry[action] =
				action === 'view'
					? Boolean(rawEntry[action] ?? base[item.pagePath]?.[action])
					: Boolean(item.supports[action] && (rawEntry[action] ?? base[item.pagePath]?.[action]))
			return entry
		}, {})
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
	const permissions = getResolvedPagePermissions(user)
	return Boolean(permissions[normalizedPagePath]?.[normalizedAction])
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
