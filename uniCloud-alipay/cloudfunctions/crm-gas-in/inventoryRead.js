'use strict'

// Bound result size by bottle count, not by the length of each bottle's history.
async function readLatestMovements(collection, command, bottleNos, cutoffAt) {
	const bottles = [...new Set(bottleNos.map((value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '')).filter(Boolean))]
	const rows = []
	for (let offset = 0; offset < bottles.length; offset += 300) {
		const chunk = bottles.slice(offset, offset + 300)
		const match = { bottle_no: command.in(chunk), type: command.in(['back', 'fill', 'out']) }
		if (cutoffAt != null && Number.isFinite(Number(cutoffAt))) match.event_at = command.gte(Number(cutoffAt))
		const res = await collection.aggregate()
			.match(match)
			.sort({ event_at: -1, type_order: -1, created_at: -1, _id: -1 })
			.group({
				_id: '$bottle_no',
				movement_id: command.aggregate.first('$_id'),
				type: command.aggregate.first('$type'),
				event_at: command.aggregate.first('$event_at'),
				type_order: command.aggregate.first('$type_order'),
				created_at: command.aggregate.first('$created_at'),
				source_type: command.aggregate.first('$source_type'),
				source_id: command.aggregate.first('$source_id')
			})
			.limit(300)
			.end()
		if (!Array.isArray(res.data)) throw new Error('瓶子流转查询未返回完整结果')
		rows.push(...res.data.map(({ _id, movement_id, ...row }) => ({ ...row, bottle_no: _id, _id: movement_id })))
	}
	return rows
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
