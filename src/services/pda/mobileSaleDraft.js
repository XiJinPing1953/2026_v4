// A browser-local draft is not a saved sale. Keep an uncertain submission frozen.
export const MOBILE_SALE_DRAFT_VERSION = 1

export function createMobileSaleId(prefix = 'sale') {
	const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
	return `${prefix}-${random}`
}

export function cloneMobileSale(value) {
	return JSON.parse(JSON.stringify(value))
}

export function createMobileSaleDraftStore(ownerId, storage, currentOwner = () => ownerId) {
	const key = `crm_mobile_sale_draft_v${MOBILE_SALE_DRAFT_VERSION}:${ownerId}`
	let expected = null
	const token = (raw) => raw ? (typeof raw === 'string' ? raw : JSON.stringify(raw)) : null
	function assertOwner() {
		if (!ownerId || currentOwner() !== ownerId) throw new Error('登录账号已变化，请使用原账号恢复草稿')
	}
	function assertCurrent() {
		if (token(storage.getStorageSync(key)) !== expected) throw new Error('此草稿已在另一页面更新，请刷新并恢复最新草稿')
	}
	return {
		load() {
			assertOwner()
			const raw = storage.getStorageSync(key)
			expected = token(raw)
			if (!raw) return null
			const value = typeof raw === 'string' ? JSON.parse(raw) : raw
			if (value.version !== MOBILE_SALE_DRAFT_VERSION || value.ownerId !== ownerId || !value.form) {
				throw new Error('草稿版本或账号不匹配，原草稿已保留')
			}
			return cloneMobileSale(value)
		},
		save(draft) {
			assertOwner()
			assertCurrent()
			const value = { ...cloneMobileSale(draft), version: MOBILE_SALE_DRAFT_VERSION, ownerId, savedAt: Date.now() }
			const serialized = JSON.stringify(value)
			storage.setStorageSync(key, serialized)
			expected = serialized
			if (storage.getStorageSync(key) !== serialized) throw new Error('草稿写入后核对失败')
			return value
		},
		remove() {
			assertOwner()
			assertCurrent()
			storage.removeStorageSync(key)
			expected = null
		}
	}
}

export function mobileSaleReceipt(response, operationId) {
	const data = response?.data || {}
	const saved = data.source_saved === true
	const state = data.processing_state || (saved ? 'pending_review' : 'unknown')
	const completed = saved && state === 'completed' && !(data.warnings || []).length
	return {
		status: saved ? (completed ? 'saved' : 'pending') : response?.code === 409 ? 'conflict' : data.source_saved === false ? 'failed' : 'unknown',
		message: response?.msg || (saved ? '销售单已保存，请核对处理结果' : '提交结果尚未确认，请查询原操作'),
		saleId: data.sale_id || data._id || '',
		operationId: data.operation_id || operationId,
		warnings: Array.isArray(data.warnings) ? data.warnings : [],
		sourceSaved: saved ? true : data.source_saved === false ? false : null,
		processingState: state,
		sourceExists: data.source_exists !== false
	}
}

// Only an explicit pre-write rejection from CREATE can release a frozen attempt.
// A read returning 404 may race an in-flight create and must never unlock it.
export function canReleaseMobileSubmission(response, fromQuery = false) {
	return !fromQuery && response?.data?.source_saved === false
		&& response?.error_code !== 'MOBILE_SALE_OPERATION_CONFLICT'
		&& response?.error_code !== 'MOBILE_SALE_RESULT_UNKNOWN'
}
