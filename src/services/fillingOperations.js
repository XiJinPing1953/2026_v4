import { callCloud } from '@/services/api'
import { getUser } from '@/services/auth'

const storageKey = () => `crm:filling:submissions:${getUser()?._id || 'anonymous'}`
const entries = () => {
	const value = uni.getStorageSync(storageKey())
	return Array.isArray(value) ? value : []
}
const signatureOf = (data) => {
	const { operation_id, preview, ignore_bottle_flow_warning, ignoreBottleFlowWarning, ...input } = data || {}
	const text = JSON.stringify(Object.keys(input).sort().map((key) => [key, input[key]]))
	// Compact lookup only; server SHA-256 validates the full frozen input independently.
	let left = 2166136261; let right = 2246822519
	for (let i = 0; i < text.length; i += 1) {
		left = Math.imul(left ^ text.charCodeAt(i), 16777619)
		right = Math.imul(right ^ text.charCodeAt(i), 3266489917)
	}
	return `${text.length}:${(left >>> 0).toString(16)}:${(right >>> 0).toString(16)}`
}
export function rememberBatchFillingOperation(data) {
	const signature = signatureOf(data)
	const saved = entries()
	const previous = saved.find((entry) => entry.signature === signature)
	if (previous) return previous.operation_id
	const operation_id = data.operation_id || `fill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 13)}_${Math.random().toString(36).slice(2, 10)}`
	// Persist before dispatch; a timeout or page reload must keep the same operation ID.
	if (saved.length >= 100) throw new Error('待确认的提交过多，请先处理灌装状态后再新建')
	uni.setStorageSync(storageKey(), [...saved, { signature, operation_id, created_at: Date.now() }])
	return operation_id
}
export async function getRememberedBatchFillingOperation(data) {
	const saved = entries().find((entry) => entry.signature === signatureOf({ ...data, submission_action: data.submission_action || 'batchCreateV1' }))
	if (!saved) return null
	const result = await getFillingOperationV1(saved.operation_id)
	if (result?.data?.complete) clearCompletedBatchFillingDraft({ ...data, submission_action: data.submission_action || 'batchCreateV1' })
	return result
}
export function clearCompletedBatchFillingDraft(data) {
	const signature = signatureOf(data)
	uni.setStorageSync(storageKey(), entries().filter((entry) => entry.signature !== signature))
}
export function getFillingOperationV1(operation_id) {
	return callCloud('crm-filling', { action: 'getOperationV1', data: { operation_id } })
}
export function listFillingOperationsV1() {
	return callCloud('crm-filling', { action: 'listOperationsV1' })
}
export function retryFillingOperationV1(operation_id) {
	return callCloud('crm-filling', { action: 'retryOperationV1', data: { operation_id } })
}
export async function submitBatchFillingOperation(data, action = 'batchCreateV1') {
	const capabilities = await callCloud('crm-filling', { action: 'capabilitiesV1' })
	if (capabilities?.code !== 0 || capabilities?.data?.durable_operations !== true) {
		throw new Error('灌装后台尚未完成升级，请待后台就绪后提交')
	}
	const draft = { ...data, submission_action: action }
	const operation_id = rememberBatchFillingOperation(draft)
	try {
		const result = await callCloud('crm-filling', { action, data: { ...data, operation_id } })
		if (result?.code === 0 && (result?.data?.operation_id !== operation_id || result?.data?.rule_version !== capabilities.data.rule_version)) {
			throw new Error('后台未返回可信的灌装操作凭据')
		}
		if (result?.data?.complete) clearCompletedBatchFillingDraft(draft)
		return result
	} catch (error) {
		try {
			const status = await getFillingOperationV1(operation_id)
			if (status.code === 0 && status.data?.operation_id === operation_id && status.data?.rule_version === capabilities.data.rule_version) {
				if (status.data.complete) clearCompletedBatchFillingDraft(draft)
				return status
			}
		} catch (_) { /* Unknown acknowledgement, keep the original ID. */ }
		const unknown = new Error('提交状态待确认，请刷新处理状态或使用原内容重试；系统会沿用原提交编号')
		unknown.operation_id = operation_id
		unknown.cause = error
		throw unknown
	}
}
