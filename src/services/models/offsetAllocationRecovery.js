// A saved request is the unit of recovery. Never rebuild its amount or targets after a timeout.
const clone = value => JSON.parse(JSON.stringify(value))
const money = (value, scale) => Number(Number(value).toFixed(scale))

export function createOffsetAllocationBatch({ customerId, sources, amount, allocation, scale = 2, makeId }) {
	const rows = sources.map(source => ({
		receipt_id: String(source._id || ''),
		available: Number(source.unallocated_amount),
		source_version: String(source.source_version || ''),
		operation_id: makeId(), payload: null, attempted: false, result: null
	}))
	if (!customerId || !rows.length || rows.some(row => !row.receipt_id || !row.source_version || !(row.available > 0))) {
		throw new Error('冲抵来源缺少最新校验信息，请刷新冲抵后重试；若仍提示，请更新页面。')
	}
	if (new Set(rows.map(row => row.receipt_id)).size !== rows.length || new Set(rows.map(row => row.operation_id)).size !== rows.length) throw new Error('冲抵来源或操作号重复，请重新选择。')
	if (!Number.isFinite(amount) || amount <= 0) throw new Error('请输入有效冲抵金额。')
	return { version: 1, customer_id: String(customerId), scale: scale === 3 ? 3 : 2,
		amount, allocation: clone(allocation), rows, status: 'pending', created_at: Date.now() }
}

export function readOffsetAllocationBatch(value, customerId) {
	if (!value) return null
	const batch = typeof value === 'string' ? JSON.parse(value) : clone(value)
	if (batch.version !== 1 || batch.customer_id !== String(customerId) || !Array.isArray(batch.rows) || !batch.rows.length ||
		!['pending', 'complete', 'rejected'].includes(batch.status) || !(Number(batch.amount) > 0) ||
		batch.rows.some(row => !row.receipt_id || !row.operation_id || !row.source_version || (row.attempted && !row.payload))) {
		throw new Error('上次冲抵的恢复资料不完整，请核对原操作结果后再处理，不能另建重复冲抵。')
	}
	return batch
}

export function offsetAllocationProgress(batch) {
	const completed = batch.rows.filter(row => row.result)
	return { allocated_total: money(completed.reduce((sum, row) => sum + Number(row.result.allocated_total || 0), 0), batch.scale),
		applied_source_count: completed.filter(row => Number(row.result.allocated_total) > 0).length }
}

export async function resumeOffsetAllocationBatch(input, { persist, allocate, query }) {
	const batch = clone(input)
	const save = () => persist(clone(batch)) // Persistence must succeed before any request can write funds.
	const outcome = (status, message = '') => ({ status, message, batch, ...offsetAllocationProgress(batch) })
	const accept = (row, result) => {
		const amount = Number(result?.allocated_total)
		if (!Number.isFinite(amount) || amount < 0 || amount > row.payload.amount ||
			(result.operation_id && result.operation_id !== row.operation_id) ||
			(result.receipt_id && result.receipt_id !== row.receipt_id) ||
			(result.customer_id && result.customer_id !== batch.customer_id)) throw new Error('返回的冲抵结果不完整，请查询原操作结果。')
		row.result = clone(result)
		save()
	}
	const lookup = async row => {
		const response = await query({ customerId: batch.customer_id, operationId: row.operation_id })
		if (response?.code !== 0) throw new Error(response?.msg || '暂时无法查询冲抵结果')
		if (response.data?.status === 'saved') { accept(row, response.data.result); return true }
		if (response.data?.status !== 'not_found') throw new Error('冲抵结果仍在确认，请稍后使用原操作查询。')
		return false
	}
	if (batch.status !== 'pending') return outcome(batch.status, batch.message)
	for (const row of batch.rows) {
		if (row.result) continue
		const remaining = money(batch.amount - offsetAllocationProgress(batch).allocated_total, batch.scale)
		if (!(remaining > 0)) break
		if (row.attempted) {
			try { if (await lookup(row)) continue } catch (error) { return outcome('pending', error.message) }
		}
		if (!row.payload) row.payload = {
			customerId: batch.customer_id, receiptId: row.receipt_id, operationId: row.operation_id,
			expectedSourceVersion: row.source_version, amount: money(Math.min(remaining, row.available), batch.scale), ...batch.allocation
		}
		row.attempted = true
		save()
		let response
		try { response = await allocate(clone(row.payload)) } catch (_) {
			try { if (await lookup(row)) continue } catch (error) { return outcome('pending', error.message) }
			return outcome('pending', '提交结果尚未确认，已保留原操作号；请继续查询，勿另建冲抵。')
		}
		if (response?.code === 0) {
			try { accept(row, response.data) } catch (error) { return outcome('pending', error.message) }
			continue
		}
		// A transport/server failure may follow a commit. Query before deciding whether a retry is safe.
		if (!(response?.code >= 400 && response?.code < 500) || response?.data?.retryable) {
			try { if (await lookup(row)) continue } catch (error) { return outcome('pending', error.message) }
			return outcome('pending', response?.msg || '冲抵结果尚未确认，请继续查询原操作。')
		}
		batch.status = 'rejected'
		batch.message = response.msg || '本次冲抵未执行，请刷新余额并重新选择。'
		save()
		return outcome('rejected', batch.message)
	}
	batch.status = 'complete'
	save()
	const warning = batch.rows.some(row => row.result?.balance_refresh_pending) ? '分配已保存，客户汇总刷新待完成，请刷新核对。' : ''
	return outcome('complete', warning)
}
