'use strict'

const { FinancialReadError } = require('./financialReadLocal')

const CHANNELS = [
	{ key: 'bottle', label: '钢瓶充装', count_unit: '瓶次' },
	{ key: 'local', label: '地方车', count_unit: '次' },
	{ key: 'vehicle', label: '车辆燃气加注', count_unit: '次' },
	{ key: 'other', label: '整车补气及其他', count_unit: '次' }
]

function classifyGasOutflow(row = {}) {
	const type = typeof row.record_type === 'string' ? row.record_type.trim().toLowerCase() : ''
	const bottle = typeof row.bottle_no === 'string' ? row.bottle_no.toUpperCase().replace(/[\s\u3000]+/g, '') : ''
	// Vehicle fuel has an explicit purpose even when its identifier is 000/TRUCK.
	if (type === 'truck_out_no_sale') return 'vehicle'
	if (bottle === '000') return 'local'
	// Legacy records omit record_type. Agent-sale fillings with an ordinary bottle
	// identifier are still cylinder fillings; TRUCK and unknown identities are not.
	if (bottle && !/^TRUCK/.test(bottle) &&
		(row.record_type == null || typeof row.record_type === 'string' &&
			['', 'normal_fill', 'truck_out_agent_sale'].includes(type))) return 'bottle'
	return 'other'
}

// resolveTime is the same business-time filter used for the tank balance. Summing
// the included rows once keeps channel weights and the loss formula on one basis.
function summarizeGasOutflow(rows, { resolveTime }) {
	const channels = CHANNELS.map(row => ({ ...row, weight_kg: 0, count: 0, complete: true, mills: 0 }))
	const byKey = new Map(channels.map(row => [row.key, row]))
	const issues = []
	function invalidate(channel, row, code, message) {
		channel.complete = false
		issues.push({ code, message: `出罐记录 ${row._id}：${message}`, source_id: row._id, channel_key: channel.key })
	}
	for (const row of rows) {
		const channel = byKey.get(classifyGasOutflow(row))
		const time = resolveTime(row)
		if (time.issue) { invalidate(channel, row, 'filling_time_unknown', time.issue); continue }
		if (!time.include) continue
		const raw = row.fill_weight
		const weight = ['number', 'string'].includes(typeof raw) && String(raw).trim() !== '' ? Number(raw) : NaN
		if (!Number.isFinite(weight) || weight < 0 || !Number.isSafeInteger(Math.round(weight * 1000))) {
			invalidate(channel, row, 'filling_weight_invalid', '重量缺失或无效'); continue
		}
		channel.mills += Math.round(weight * 1000)
		if (!Number.isSafeInteger(channel.mills)) throw new FinancialReadError('quantity_overflow', { source: 'filling' })
		if (weight > 0) channel.count++
	}
	const complete = channels.every(row => row.complete)
	const total = channels.reduce((mills, row) => mills + row.mills, 0)
	if (!Number.isSafeInteger(total)) throw new FinancialReadError('quantity_overflow', { source: 'filling' })
	return { weight_kg: complete ? total / 1000 : null, complete,
		channels: channels.map(({ mills, ...row }) => ({ ...row,
			weight_kg: row.complete ? mills / 1000 : null, count: row.complete ? row.count : null })), issues }
}

module.exports = { classifyGasOutflow, summarizeGasOutflow }
