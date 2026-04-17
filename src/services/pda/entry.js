import { normalizeText } from './shared'

export const PDA_HOME_PATH = '/pages/pda/home'
export const DEFAULT_HOME_PATH = '/pages/index/index'
export const LOGIN_PATH = '/pages/login/login'

export function normalizeAppPagePath(value) {
	const text = normalizeText(value)
	if (!text) return ''
	return text.startsWith('/') ? text : `/${text}`
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

export function resolveHomePath(userLike) {
	if (isPdaAppMode() && userLike) return PDA_HOME_PATH
	return isPdaOperatorRole(userLike) ? PDA_HOME_PATH : DEFAULT_HOME_PATH
}

export function shouldRedirectToPreferredHome(pagePath, userLike) {
	const currentPath = normalizeAppPagePath(pagePath)
	const targetPath = resolveHomePath(userLike)
	if (!currentPath || !targetPath || currentPath === targetPath) return false
	return currentPath === DEFAULT_HOME_PATH || currentPath === LOGIN_PATH
}
