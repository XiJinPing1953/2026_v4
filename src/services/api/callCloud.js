import { getToken } from '../auth'
import { handle401, handle403 } from '../navigation'

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
}

// 统一云函数调用入口：
// - 自动带 token（除非显式传入 token）
// - 统一处理 401
// - 返回 { code, msg, data, ... }
export async function callCloud(name, { action, data = {}, token, timeout } = {}) {
	const t = token != null ? token : getToken()
	const payload = { action, data }
	if (t) payload.token = t
	payload.request_id = generateRequestId()

	const invokeOptions = {
		name,
		data: payload
	}
	if (Number.isFinite(Number(timeout)) && Number(timeout) > 0) {
		invokeOptions.timeout = Number(timeout)
	}

	const res = await uniCloud.callFunction(invokeOptions)

	const result = res.result || {}
	if (result.code === 401) {
		handle401(result.msg)
	}
	if (result.code === 403) {
		handle403(result.msg)
	}
	return result
}
