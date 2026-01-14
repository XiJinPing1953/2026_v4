// 统一 Auth 存储与清理

const TOKEN_KEY = 'crm_token'
const USER_KEY = 'crm_user'

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

export function isLoggedIn() {
	return !!getToken()
}
