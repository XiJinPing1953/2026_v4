export function saleSaveWarning(result) {
	if (result?.code !== 0) return ''
	const warning = String(result.data?.warning || '').trim()
	if (warning) return warning
	const use = result.data?.offset_use
	if (use?.status === 'pending') return String(use.warning || use.msg || '使用冲抵尚未确认，请查询并继续原操作。')
	const sync = result.data?.offset_sync
	if (sync && !['completed', 'synced', 'unchanged', 'not_required', 'skipped'].includes(sync.status) && (sync.code !== 0 || sync.status === 'pending')) {
		return String(sync.warning || sync.msg || '冲抵入池尚未完成，请核对后续处理结果。')
	}
	// Older deployed responses may carry the warning only in their success message.
	const message = String(result.msg || '').trim()
	return /失败|待核|未同步|未完成|未消化|待处理/.test(message) ? message : ''
}

export function pendingSaleOffsetActions(doc) {
	const data = {}
	for (const [field, label] of [['offset_sync', '冲抵入池'], ['offset_use', '使用冲抵']]) {
		if (doc?.[`${field}_revision`] && doc[`${field}_status`] === 'pending') data[field] = {
			status: 'pending', sale_id: doc._id, operation_id: doc[`${field}_revision`],
			warning: doc[`${field}_error`] || `${label}结果待核，请查询原操作；不要再次保存来重试。`
		}
	}
	data.warning = Object.values(data).map(row => row.warning).join('\n')
	return { code: 0, data }
}
