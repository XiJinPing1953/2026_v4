const clone = value => JSON.parse(JSON.stringify(value))
export function readOffsetRelease(value, customerId) {
	if (!value) return null
	const row = typeof value === 'string' ? JSON.parse(value) : clone(value)
	if (row.version !== 1 || row.customer_id !== String(customerId) || !row.operation_id || !row.receipt_id || !row.expected_source_version ||
		(row.status && !['pending', 'complete', 'rejected'].includes(row.status))) throw Error('上次删除冲抵的恢复资料不完整，请核对原操作后再处理。')
	return row
}
export async function resumeOffsetRelease(value, { persist, submit, query }) {
	const operation = clone(value)
	const finish = data => {
		if (!Number.isFinite(Number(data?.released_total)) || Number(data.released_total) < 0 || data.operation_id !== operation.operation_id || data.receipt_id !== operation.receipt_id) throw Error('删除冲抵返回结果不完整，请查询原操作。')
		operation.status = 'complete'; operation.result = clone(data); persist(operation)
		return { status: 'complete', operation, data }
	}
	const lookup = async () => {
		const result = await query(operation)
		if (result?.code !== 0) throw Error(result?.msg || '暂时无法查询删除结果')
		if (result.data?.status === 'saved') return finish(result.data.result)
		if (result.data?.status !== 'not_found') throw Error('删除结果仍待确认')
		return null
	}
	if (operation.status === 'rejected') return { status: 'rejected', operation, message: operation.message }
	if (operation.result) return finish(operation.result)
	if (operation.attempted) {
		try { const found = await lookup(); if (found) return found } catch (error) { return { status: 'pending', operation, message: error.message } }
	}
	operation.attempted = true; persist(operation)
	let result
	try { result = await submit(operation) } catch (_) {
		try { const found = await lookup(); if (found) return found } catch (error) { return { status: 'pending', operation, message: error.message } }
		return { status: 'pending', operation, message: '删除结果尚未确认，已保留原操作号，请继续查询。' }
	}
	if (result?.code === 0) {
		try { return finish(result.data) } catch (error) { return { status: 'pending', operation, message: error.message } }
	}
	if (result?.code >= 400 && result?.code < 500 && !result.data?.retryable) {
		operation.status = 'rejected'; operation.message = result.msg || '本次删除未执行，请刷新后核对。'
		persist(operation)
		return { status: 'rejected', operation, message: operation.message }
	}
	try { const found = await lookup(); if (found) return found } catch (error) { return { status: 'pending', operation, message: error.message } }
	return { status: 'pending', operation, message: result?.msg || '删除结果尚未确认，请继续查询原操作。' }
}
