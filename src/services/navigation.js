import { clearAuth } from './auth'

const LOGIN_PATH = '/pages/login/login'
const PENDING_LOGIN_REDIRECT_KEY = 'crm_pending_login_redirect'

function normalizeText(value) {
	return value == null ? '' : String(value).trim()
}

function normalizePageUrl(value) {
	const text = normalizeText(value)
	if (!text) return ''
	return text.startsWith('/') ? text : `/${text}`
}

export function buildPageUrl(route = '', options = {}) {
	const path = normalizePageUrl(route)
	if (!path) return ''
	const source = options && typeof options === 'object' ? options : {}
	const parts = Object.keys(source)
		.filter((key) => normalizeText(source[key]) !== '')
		.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(source[key]))}`)
	return parts.length ? `${path}?${parts.join('&')}` : path
}

export function getCurrentPageUrl() {
	try {
		const pages = getCurrentPages()
		const current = pages[pages.length - 1]
		const route = current?.route || current?.$page?.route || ''
		const options = current?.options || current?.$page?.options || {}
		return buildPageUrl(route, options)
	} catch (error) {
		return ''
	}
}

export function setPendingLoginRedirect(url = '') {
	const normalized = normalizePageUrl(normalizeText(url))
	if (!normalized || normalized.split(/[?#]/)[0] === LOGIN_PATH) {
		uni.removeStorageSync(PENDING_LOGIN_REDIRECT_KEY)
		return ''
	}
	uni.setStorageSync(PENDING_LOGIN_REDIRECT_KEY, normalized)
	return normalized
}

export function getPendingLoginRedirect() {
	return normalizeText(uni.getStorageSync(PENDING_LOGIN_REDIRECT_KEY))
}

export function consumePendingLoginRedirect() {
	const redirect = getPendingLoginRedirect()
	uni.removeStorageSync(PENDING_LOGIN_REDIRECT_KEY)
	return redirect
}

let relaunchPending = null

// App 启动、默认首页和登录页可能同时请求同一路由；共用完成回执。
export function reLaunchOnce(url) {
	const target = normalizePageUrl(url)
	if (relaunchPending) {
		if (relaunchPending.url === target) return relaunchPending.promise
		return relaunchPending.promise.then(() => reLaunchOnce(target), () => reLaunchOnce(target))
	}
	if (getCurrentPageUrl() === target) return Promise.resolve()
	const state = { url: target }
	state.promise = Promise.resolve().then(() => uni.reLaunch({ url: target })).finally(() => {
		if (relaunchPending === state) relaunchPending = null
	})
	relaunchPending = state
	return state.promise
}

export function goLogin(options = {}) {
	const explicitRedirect = normalizeText(options.redirectUrl)
	const currentUrl = getCurrentPageUrl()
	const currentPath = currentUrl.split(/[?#]/)[0]
	if (explicitRedirect) setPendingLoginRedirect(explicitRedirect)
	else if (options.captureCurrent === false) setPendingLoginRedirect('')
	else if (currentUrl && currentPath !== LOGIN_PATH) setPendingLoginRedirect(currentUrl)
	// App startup and a page guard can both arrive here. A late call from the
	// login page (or an empty page stack) must retain the original destination.
	if (currentPath === LOGIN_PATH) return
	return reLaunchOnce(LOGIN_PATH)
}

export function handle401(message) {
	uni.showModal({
		title: '提示',
		content: message || '登录已过期，请重新登录',
		showCancel: false,
		success: () => {
			clearAuth()
			goLogin({ captureCurrent: true })
		}
	})
}

export function handle403(message) {
	uni.showToast({
		title: message || '无权限执行该操作',
		icon: 'none'
	})
}
