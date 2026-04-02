// 统一 Auth 存储与清理

const TOKEN_KEY = 'crm_token'
const USER_KEY = 'crm_user'
let syncPromise = null
let lastSyncAt = 0

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

export function getToken() {
	return uni.getStorageSync(TOKEN_KEY) || ''
}

export function setToken(token) {
	uni.setStorageSync(TOKEN_KEY, token || '')
}

export function clearAuth() {
	uni.removeStorageSync(TOKEN_KEY)
	uni.removeStorageSync(USER_KEY)
}

export function getUser() {
	return uni.getStorageSync(USER_KEY) || null
}

export function setUser(user) {
	uni.setStorageSync(USER_KEY, user || null)
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
	if (!force && syncPromise) return syncPromise
	if (!force && now - lastSyncAt < 5000) {
		return { code: 0, user: getUser() || null, cached: true }
	}

	syncPromise = uniCloud
		.callFunction({
			name: 'crm-auth',
			data: {
				action: 'check',
				token,
				request_id: generateRequestId()
			},
			timeout: 15000
		})
		.then((res) => {
			const result = res?.result || {}
			if (result.code === 0) {
				setUser(result.user || null)
				lastSyncAt = Date.now()
			} else if (result.code === 401) {
				clearAuth()
			}
			return result
		})
		.catch((err) => ({ code: -1, msg: err?.message || '登录态同步失败' }))
		.finally(() => {
			syncPromise = null
		})

	return syncPromise
}
