import { normalizeText } from './shared'
import { canViewPage } from '../pageAcl'

export const PDA_HOME_PATH = '/pages/pda/home'
export const HOME_SAFETY_INSPECTION_HOME_PATH = '/pages/home-safety-inspection/home'
export const SAFETY_INSPECTION_HOME_PATH = '/pages/safety-inspection/home'
export const STATION_SAFETY_INSPECTION_HOME_PATH = '/pages/station-safety-inspection/home'
export const DEFAULT_HOME_PATH = '/pages/index/index'
export const LOGIN_PATH = '/pages/login/login'

// Kept in sync with the APP-PLUS routes by pdaLightPackage.test.cjs.
const NATIVE_PAGE_PATHS = new Set([
	'/pages/index/index',
	'/pages/public/filling-label',
	'/pages/login/login',
	'/pages/safety-management/home',
	'/pages/safety-management/daily',
	'/pages/safety-management/weekly',
	'/pages/safety-management/monthly',
	'/pages/safety-management/settings',
	'/pages/safety-management/print',
	'/pages/safety-inspection/home',
	'/pages/station-safety-inspection/home',
	'/pages/station-safety-inspection/form',
	'/pages/station-safety-inspection/history',
	'/pages/station-safety-inspection/detail',
	'/pages/station-safety-inspection/hazards',
	'/pages/station-safety-inspection/export',
	'/pages/home-safety-inspection/home',
	'/pages/home-safety-inspection/form',
	'/pages/home-safety-inspection/history',
	'/pages/home-safety-inspection/detail',
	'/pages/home-safety-inspection/export',
	'/pages/pda/home',
	'/pages/pda/bottle-query',
	'/pages/pda/movement-query',
	'/pages/pda/customer-query',
	'/pages/pda/return-reweigh',
	'/pages/pda/reweigh',
	'/pages/pda/floor-reweigh',
	'/pages/pda/sale-create',
	'/pages/bottle/timeline'
])

export function isNativeAppPagePath(value) {
	return NATIVE_PAGE_PATHS.has(normalizeAppPagePath(value))
}

const SAFETY_MANAGEMENT_PAGE_PATHS = new Set([
	'/pages/safety-management/home',
	'/pages/safety-management/daily',
	'/pages/safety-management/weekly',
	'/pages/safety-management/monthly',
	'/pages/safety-management/settings',
	'/pages/safety-management/print'
])

export function normalizeAppPagePath(value) {
	const text = normalizeText(value)
	if (!text) return ''
	const queryIndex = text.search(/[?#]/)
	const path = queryIndex >= 0 ? text.slice(0, queryIndex) : text
	return path.startsWith('/') ? path : `/${path}`
}

export function normalizeAppPageUrl(value) {
	const text = normalizeText(value)
	if (!text) return ''
	const queryIndex = text.search(/[?#]/)
	const suffix = queryIndex >= 0 ? text.slice(queryIndex) : ''
	const path = normalizeAppPagePath(queryIndex >= 0 ? text.slice(0, queryIndex) : text)
	return path ? `${path}${suffix}` : ''
}

export function isPdaAppMode() {
	// #ifdef APP-PLUS
	return true
	// #endif
	return false
}

export function isPdaOperatorRole(value) {
	const rawRole = typeof value === 'object' ? value?.role_template || value?.role : value
	return normalizeText(rawRole).toLowerCase() === 'pda_operator'
}

export function isSafetyInspectorRole(value) {
	const rawRole = typeof value === 'object' ? value?.role_template || value?.role : value
	return normalizeText(rawRole).toLowerCase() === 'safety_inspector'
}

export function isPdaPagePath(pagePath) {
	const normalized = normalizeAppPagePath(pagePath)
	return normalized === PDA_HOME_PATH || normalized.startsWith('/pages/pda/')
}

export function isHomeSafetyInspectionPagePath(pagePath) {
	const normalized = normalizeAppPagePath(pagePath)
	return normalized === HOME_SAFETY_INSPECTION_HOME_PATH || normalized.startsWith('/pages/home-safety-inspection/')
}

export function isSafetyInspectionPagePath(pagePath) {
	const normalized = normalizeAppPagePath(pagePath)
	return (
		normalized === SAFETY_INSPECTION_HOME_PATH ||
		isHomeSafetyInspectionPagePath(normalized) ||
		normalized === STATION_SAFETY_INSPECTION_HOME_PATH ||
		normalized.startsWith('/pages/station-safety-inspection/') ||
		SAFETY_MANAGEMENT_PAGE_PATHS.has(normalized)
	)
}

export function resolveHomePath(userLike) {
	if (isSafetyInspectorRole(userLike)) return SAFETY_INSPECTION_HOME_PATH
	if (isPdaAppMode() && userLike) return PDA_HOME_PATH
	return isPdaOperatorRole(userLike) ? PDA_HOME_PATH : DEFAULT_HOME_PATH
}

export function resolveLoginRedirectForRuntime(redirectUrl, userLike) {
	const normalizedUrl = normalizeAppPageUrl(redirectUrl)
	if (!normalizedUrl) return ''
	if (isPdaAppMode() && !isNativeAppPagePath(normalizedUrl)) return ''
	if (isSafetyInspectorRole(userLike)) {
		return isSafetyInspectionPagePath(normalizedUrl) ? normalizedUrl : ''
	}
	// The browser's regular accounts return to the web desk, even if login
	// captured the PDA home. Keep permitted mobile-sales deep links intact.
	if (!isPdaAppMode() && !isPdaOperatorRole(userLike) && normalizeAppPagePath(normalizedUrl) === PDA_HOME_PATH) return ''
	if (isPdaPagePath(normalizedUrl) && !canViewPage(normalizeAppPagePath(normalizedUrl), userLike)) return ''
	return normalizedUrl
}

export function shouldRedirectToPreferredHome(pagePath, userLike) {
	const currentPath = normalizeAppPagePath(pagePath)
	const targetPath = resolveHomePath(userLike)
	if (!currentPath || !targetPath || currentPath === targetPath) return false
	if (isPdaAppMode() && !isNativeAppPagePath(currentPath)) return true
	if (isSafetyInspectorRole(userLike)) {
		return currentPath !== LOGIN_PATH && !isSafetyInspectionPagePath(currentPath)
	}
	if (!isPdaAppMode() && !isPdaOperatorRole(userLike) && currentPath === PDA_HOME_PATH) return true
	return currentPath === DEFAULT_HOME_PATH || currentPath === LOGIN_PATH
}
