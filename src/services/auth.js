// 统一 Auth 存储与清理
import { startCloudTrace, finishCloudTrace } from './performanceTrace'

const TOKEN_KEY = 'crm_token'
const USER_KEY = 'crm_user'
let syncPending = null
let sessionVersion = 0
// APP-PLUS has one service context and all auth writes pass through this module.
// Keep H5 reads live so other tabs' login/logout remains immediately visible.
let nativeSnapshot = false
// #ifdef APP-PLUS
nativeSnapshot = true
// #endif
const cache = new Map()
function readAuth(key, fallback) {
	if (nativeSnapshot && cache.has(key)) return cache.get(key)
	const value = uni.getStorageSync(key) || fallback
	if (nativeSnapshot) cache.set(key, key === USER_KEY ? immutableUser(value) : value)
	return nativeSnapshot ? cache.get(key) : value
}
function immutableUser(value) {
	if (!value) return null
	const snapshot = JSON.parse(JSON.stringify(value))
	function freeze(node) {
		if (!node || typeof node !== 'object') return node
		Object.values(node).forEach(freeze)
		return Object.freeze(node)
	}
	return freeze(snapshot)
}
function invalidateSession() {
	sessionVersion++
	syncPending = null
	lastSyncAt = 0
}
let lastSyncAt = 0

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

export function getToken() {
	return readAuth(TOKEN_KEY, '')
}

export function setToken(token) {
	uni.setStorageSync(TOKEN_KEY, token || '')
	cache.set(TOKEN_KEY, token || '')
	cache.delete(USER_KEY)
	invalidateSession()
}

export function clearAuth() {
	cache.clear()
	invalidateSession()
	try { uni.removeStorageSync(TOKEN_KEY) } finally { uni.removeStorageSync(USER_KEY) }
}

export function getUser() {
	return readAuth(USER_KEY, null)
}

export function setUser(user) {
	uni.setStorageSync(USER_KEY, user || null)
	if (nativeSnapshot) cache.set(USER_KEY, immutableUser(user))
}

export function getRoleTemplate() {
	const user = getUser()
	return String(user?.role_template || user?.role || '').trim().toLowerCase()
}

export function isLoggedIn() {
	return !!getToken()
}

export async function syncCurrentUser(options = {}) {
	const token = getToken()
	if (!token) return { code: 401, msg: '未登录' }
	const force = Boolean(options.force)
	const now = Date.now()
	if (syncPending?.version === sessionVersion && syncPending.token === token) return syncPending.promise
	if (!force && now - lastSyncAt < 5000) {
		return { code: 0, user: getUser() || null, cached: true }
	}

	const request = { version: sessionVersion, token }
	const requestId = generateRequestId()
	const timing = startCloudTrace('crm-auth', 'check', requestId)
	const isCurrent = () => request.version === sessionVersion && token === getToken()
	request.promise = uniCloud
		.callFunction({
			name: 'crm-auth',
			data: {
				action: 'check',
				token,
				request_id: requestId,
				...(timing ? { _performance_trace: timing.id } : {})
			},
			timeout: 15000
		})
		.then((res) => {
			finishCloudTrace(timing, res?.result)
			if (!isCurrent()) return { code: -1, stale: true, msg: '登录账号已变化，请重新进入' }
			const result = res?.result || {}
			if (result.code === 0) {
				setUser(result.user || null)
				lastSyncAt = Date.now()
			} else if (result.code === 401) {
				clearAuth()
			}
			return result
		})
		.catch((err) => { finishCloudTrace(timing, null, true); return { code: -1, msg: err?.message || '登录态同步失败' } })
		.finally(() => {
			if (syncPending === request) syncPending = null
		})

	syncPending = request
	return request.promise
}
