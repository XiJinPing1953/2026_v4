import { normalizeText } from './shared'

export const PDA_HOME_PATH = '/pages/pda/home'
export const HOME_SAFETY_INSPECTION_HOME_PATH = '/pages/home-safety-inspection/home'
export const SAFETY_INSPECTION_HOME_PATH = '/pages/safety-inspection/home'
export const STATION_SAFETY_INSPECTION_HOME_PATH = '/pages/station-safety-inspection/home'
export const DEFAULT_HOME_PATH = '/pages/index/index'
export const LOGIN_PATH = '/pages/login/login'

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
		normalized.startsWith('/pages/station-safety-inspection/')
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
	if (isSafetyInspectorRole(userLike)) {
		return isSafetyInspectionPagePath(normalizedUrl) ? normalizedUrl : ''
	}
	if (isPdaPagePath(normalizedUrl) && !isPdaAppMode() && !isPdaOperatorRole(userLike)) return ''
	return normalizedUrl
}

export function shouldRedirectToPreferredHome(pagePath, userLike) {
	const currentPath = normalizeAppPagePath(pagePath)
	const targetPath = resolveHomePath(userLike)
	if (!currentPath || !targetPath || currentPath === targetPath) return false
	if (isSafetyInspectorRole(userLike)) {
		return currentPath !== LOGIN_PATH && !isSafetyInspectionPagePath(currentPath)
	}
	return currentPath === DEFAULT_HOME_PATH || currentPath === LOGIN_PATH
}
