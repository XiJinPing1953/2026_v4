export function createReweighId() {
	const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
	return `reweigh-${random}`
}

export const cloneReweigh = (value) => JSON.parse(JSON.stringify(value))

export function createReweighDraftStore(ownerId, storage, currentOwner = () => ownerId, mode = 'filling') {
	const key = `${mode === 'return' ? 'crm_pda_return_reweigh_v1' : 'crm_pda_reweigh_v1'}:${ownerId}`
	let expected = null
	const token = (raw) => raw ? (typeof raw === 'string' ? raw : JSON.stringify(raw)) : null
	function assertWritable() {
		if (!ownerId || currentOwner() !== ownerId) throw new Error('登录账号已变化，请使用原账号恢复复秤草稿')
		if (token(storage.getStorageSync(key)) !== expected) throw new Error('复秤草稿已在另一页面更新，请重新进入并恢复最新内容')
	}
	return {
		load() {
			if (!ownerId || currentOwner() !== ownerId) throw new Error('请先登录')
			const raw = storage.getStorageSync(key)
			expected = token(raw)
			if (!raw) return null
			const data = typeof raw === 'string' ? JSON.parse(raw) : raw
			const valid = (entry) => entry && typeof entry.operationId === 'string' && entry.operationId && typeof entry.bottleNo === 'string'
				&& (!entry.frozen || (['create', 'correct'].includes(entry.frozen.mode) && entry.frozen.payload?.operation_id === entry.operationId && entry.frozen.payload?.bottle_no === entry.bottleNo))
			if (data.version !== 1 || data.ownerId !== ownerId || !valid(data.current) || !Array.isArray(data.history) || !data.history.every(valid)) throw new Error('复秤草稿无法识别，原数据已保留')
			return cloneReweigh(data)
		},
		save(current, history, metadata = null) {
			assertWritable()
			const value = JSON.stringify({ version: 1, ownerId, savedAt: Date.now(), current, history, metadata })
			storage.setStorageSync(key, value)
			expected = value
			if (token(storage.getStorageSync(key)) !== value) throw new Error('复秤草稿写入核对失败')
		}
	}
}

export function reweighReceipt(response, operationId, previous = null) {
	const data = response?.data || {}
	const matched = !data.operation_id || data.operation_id === operationId
	const savedSource = (data.source_records || []).find((row) => row.saved === true)
	const saved = matched && (data.complete === true || Number(data.saved_total) > 0 || Boolean(savedSource))
	if (!saved && previous?.saved) return { ...previous, message: response?.msg || '状态暂未更新，已确认的保存结果保留' }
	return {
		operationId,
		saved,
		complete: saved && data.complete === true,
		status: saved ? (data.complete ? 'complete' : 'pending') : 'unknown',
		fillingId: saved ? (savedSource?._id || data._id || previous?.fillingId || '') : '',
		message: response?.msg || data.last_error || (saved ? (data.complete ? '灌装记录已保存，后续处理已完成' : '灌装记录已保存，后续处理待完成') : '保存结果待确认，请查询或重试原操作')
	}
}
