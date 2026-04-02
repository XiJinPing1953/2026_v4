import { clearAuth } from './auth'

export function goLogin() {
	uni.reLaunch({
		url: '/pages/login/login'
	})
}

export function handle401(message) {
	uni.showModal({
		title: '提示',
		content: message || '登录已过期，请重新登录',
		showCancel: false,
		success: () => {
			clearAuth()
			goLogin()
		}
	})
}

export function handle403(message) {
	uni.showToast({
		title: message || '无权限执行该操作',
		icon: 'none'
	})
}
