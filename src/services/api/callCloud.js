import { getToken } from '../auth'
import { handle401 } from '../navigation'

// 统一云函数调用入口：
// - 自动带 token（除非显式传入 token）
// - 统一处理 401
// - 返回 { code, msg, data, ... }
export async function callCloud(name, { action, data = {}, token } = {}) {
	const t = token != null ? token : getToken()
	const payload = { action, data }
	if (t) payload.token = t

	const res = await uniCloud.callFunction({
		name,
		data: payload
	})

	const result = res.result || {}
	if (result.code === 401) {
		handle401(result.msg)
	}
	return result
}
