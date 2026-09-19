'use strict'

// Remove resolved bottles from every following query. A missing bottle must not
// force us to page through the complete history of already-resolved bottles.
// Uses basic queries supported by the older Alipay database (sort/group/first is not).
async function readLatestMovements(collection, command, bottleNos, cutoffAt) {
	const bottles = [...new Set(bottleNos.map((value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '')).filter(Boolean))]
	const result = []
	const pageSize = 1000
	for (let offset = 0; offset < bottles.length; offset += 300) {
		const unresolved = new Set(bottles.slice(offset, offset + 300))
		while (unresolved.size) {
			const match = { bottle_no: command.in([...unresolved]), type: command.in(['back', 'fill', 'out']) }
			if (cutoffAt != null && Number.isFinite(Number(cutoffAt))) match.event_at = command.gte(Number(cutoffAt))
			const res = await collection.where(match)
				.field({ _id: true, bottle_no: true, type: true, event_at: true, type_order: true, created_at: true, source_type: true, source_id: true })
				.orderBy('event_at', 'desc').orderBy('type_order', 'desc').orderBy('created_at', 'desc').orderBy('_id', 'desc')
				.limit(pageSize).get()
			if (!Array.isArray(res.data)) throw new Error('瓶子流转查询未返回完整结果')
			const before = unresolved.size
			for (const row of res.data) {
				if (!unresolved.delete(row.bottle_no)) continue
				result.push(row)
			}
			if (res.data.length < pageSize) break
			if (unresolved.size === before) throw new Error('瓶子流转查询未取得进展')
		}
	}
	return result
}

async function readLedgerDelta(collection, command, cutoffAt) {
	const res = await collection.aggregate()
		.match({ event_at: command.gte(cutoffAt) })
		.group({ _id: null, station_delta_t: command.aggregate.sum('$station_delta_t') })
		.end()
	if (!Array.isArray(res.data)) throw new Error('账面库存查询未返回完整结果')
	const value = res.data.length ? Number(res.data[0].station_delta_t) : 0
	if (!Number.isFinite(value)) throw new Error('账面库存合计无效')
	return value
}

module.exports = { readLatestMovements, readLedgerDelta }
