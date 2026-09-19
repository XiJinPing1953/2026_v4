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
async function invokeCloud(name, { action, data = {}, token, timeout } = {}) {
	const t = token != null ? token : getToken()
	const payload = { action, data }
	if (t) payload.token = t
	const requestId = generateRequestId()
	payload.request_id = requestId

	const invokeOptions = {
		name,
		data: payload
	}
	if (Number.isFinite(Number(timeout)) && Number(timeout) > 0) {
		invokeOptions.timeout = Number(timeout)
	}

	const started = Date.now()
	let res
	try {
		res = await uniCloud.callFunction(invokeOptions)
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err || 'Cloud function request failed'))
		error.cloudFunction = name
		error.action = action
		error.request_id = requestId
		error.requestId = requestId
		error.timeout = invokeOptions.timeout
		error.invokeOptions = {
			name,
			action,
			request_id: requestId,
			timeout: invokeOptions.timeout
		}
		throw error
	}

	const result = res.result || {}
	console.info('[crm-query]', { name, action, request_id: requestId, elapsed_ms: Date.now() - started, code: result.code, server: result.query_performance, response_chars: JSON.stringify(result).length })
	if (result.code === 401) {
		handle401(result.msg)
	}
	if (result.code === 403) {
		handle403(result.msg)
	}
	return result
}

// In-flight sharing only. Never cache authoritative balances across requests.
const pendingReads = new Map()
let readEpoch = 0
const READ_ACTIONS = new Set(['getCustomerStatementV1', 'listCustomerStatementRowsV1',
 'getCustomerStatementAnalysisV1', 'previewAllocationV1', 'listOffsetCreditPoolV1',
 'listReceiptIntakeV1', 'listReceiptAllocationTargetsV1', 'listV1', 'listV2', 'searchV1',
 'summaryV1', 'quickStatusV1'])
function stableKey(value) {
 if (Array.isArray(value)) return value.map(stableKey)
 if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableKey(value[key])]))
 return value
}
export function callCloud(name, options = {}) {
 const token = options.token != null ? options.token : getToken()
 if (!READ_ACTIONS.has(options.action)) {
  readEpoch += 1
  return invokeCloud(name, { ...options, token })
 }
 const key = JSON.stringify([readEpoch, token, name, options.action, options.timeout, stableKey(options.data || {})])
 if (pendingReads.has(key)) return pendingReads.get(key)
 const pending = invokeCloud(name, { ...options, token }).finally(() => {
  if (pendingReads.get(key) === pending) pendingReads.delete(key)
 })
 pendingReads.set(key, pending)
 return pending
}

export const getQueryEpoch = () => readEpoch
