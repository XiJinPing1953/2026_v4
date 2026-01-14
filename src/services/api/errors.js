import { handle401 } from '../navigation'

export function toastError(message) {
	uni.showToast({ title: message || '操作失败', icon: 'none' })
}

export function handleApiResult(result, { silent401 = false } = {}) {
	if (!result || typeof result !== 'object') {
		toastError('请求失败')
		return false
	}
	if (result.code === 401) {
		if (!silent401) handle401(result.msg)
		return false
	}
	if (result.code && result.code !== 0) {
		toastError(result.msg || '请求失败')
		return false
	}
	return true
}
