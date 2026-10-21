export function createReweighId() {
	const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
	return `reweigh-${random}`
}

export const cloneReweigh = (value) => JSON.parse(JSON.stringify(value))

const HISTORY_KEEP_FROM = '2026-10-21'
const BUSINESS_OFFSET_MS = 8 * 60 * 60 * 1000

export function reweighHistoryTime(entry) {
	for (const value of [entry?.frozen?.payload?.capture?.sampled_at, entry?.capture?.sampled_at]) {
		const timestamp = Number(value)
		const date = new Date(timestamp + BUSINESS_OFFSET_MS)
		if (Number.isFinite(timestamp) && timestamp > 0 && Number.isFinite(date.getTime())) return date.toISOString().slice(0, 19).replace('T', ' ')
	}
	const value = String(entry?.frozen?.payload?.date || entry?.date || '')
	if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
		const date = new Date(value.replace(' ', 'T') + '+08:00')
		if (Number.isFinite(date.getTime()) && new Date(date.getTime() + BUSINESS_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ') === value) return value
	}
	return '—'
}

export function pruneReweighHistory(history) {
	// 固定清理用户指定日期之前的已完成历史，不按“今天”滚动删记录。
	// 未确认/待处理操作和无法确定日期的旧数据保留恢复入口。
	return history.filter(entry => {
		if (entry.receipt?.complete !== true) return true
		const time = reweighHistoryTime(entry)
		const value = time === '—' ? String(entry.frozen?.payload?.date || entry.date || '') : time
		const day = value.slice(0, 10)
		const date = new Date(day + 'T00:00:00+08:00')
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || new Date(date.getTime() + BUSINESS_OFFSET_MS).toISOString().slice(0, 10) !== day) return true
		return day >= HISTORY_KEEP_FROM
	})
}

export function createReweighDraftStore(ownerId, storage, currentOwner = () => ownerId, mode = 'filling') {
	const key = `${mode === 'return' ? 'crm_pda_return_reweigh_v1' : 'crm_pda_reweigh_v1'}:${ownerId}`
	const backupKey = `${key}:history-backup-before-20261021`
	let expected = null
	const token = (raw) => raw ? (typeof raw === 'string' ? raw : JSON.stringify(raw)) : null
	function assertWritable() {
		if (!ownerId || currentOwner() !== ownerId) throw new Error('登录账号已变化，请使用原账号恢复复秤草稿')
		if (token(storage.getStorageSync(key)) !== expected) throw new Error('复秤草稿已在另一页面更新，请重新进入并恢复最新内容')
	}
	function write(data) {
		assertWritable()
		const history = pruneReweighHistory(data.history)
		if (history.length !== data.history.length && !storage.getStorageSync(backupKey)) {
			// 先备份并回读，再替换本账号/本模块的历史；不触碰登录、采样或其他存储键。
			const backup = JSON.stringify(data)
			storage.setStorageSync(backupKey, backup)
			if (storage.getStorageSync(backupKey) !== backup) throw new Error('复秤历史备份失败，原数据已保留')
		}
		assertWritable()
		const value = JSON.stringify({ ...data, history })
		storage.setStorageSync(key, value)
		expected = value
		if (token(storage.getStorageSync(key)) !== value) throw new Error('复秤草稿写入核对失败')
		return { ...data, history }
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
			return cloneReweigh(pruneReweighHistory(data.history).length !== data.history.length ? write(data) : data)
		},
		save(current, history, metadata = null) {
			return write({ version: 1, ownerId, savedAt: Date.now(), current, history, metadata }).history
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
