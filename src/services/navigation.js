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
	const normalized = normalizePageUrl(url.split('?')[0]) ? normalizeText(url) : ''
	if (!normalized || normalized === LOGIN_PATH) {
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

export function goLogin(options = {}) {
	const explicitRedirect = normalizeText(options.redirectUrl)
	const fallbackRedirect = options.captureCurrent !== false ? getCurrentPageUrl() : ''
	const redirectUrl = explicitRedirect || fallbackRedirect
	setPendingLoginRedirect(redirectUrl)
	uni.reLaunch({
		url: LOGIN_PATH
	})
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
