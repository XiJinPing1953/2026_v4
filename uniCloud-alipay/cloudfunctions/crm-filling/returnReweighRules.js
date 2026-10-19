'use strict'

const { fingerprint } = require('./fillingPayloadLocal')
const text = value => String(value == null ? '' : value).trim()
const no = value => text(value).toUpperCase().replace(/\s+/g, '')
const number = value => value == null || text(value) === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? null : Number(value)
const round = value => Math.round((value + Number.EPSILON) * 10) / 10
const reject = msg => ({ ok: false, code: 409, msg })
const bottleKey = value => `bottle_${fingerprint(no(value))}`

// The physical return observation establishes a new baseline. Snapshot the known
// outgoing facts, not sales amounts or updated_at (payment edits are irrelevant).
function outgoingFacts(inputs) {
	const result = []
	for (const sale of inputs.sales) for (const field of ['out_items', 'agent_sale_items']) {
		for (const item of (sale[field] || [])) if (no(item.bottle_no) === no(inputs.bottle.bottle_no)) {
			result.push({ key: `${sale._id}:bottle:${no(inputs.bottle.bottle_no)}`, date: sale.date, biz_mode: sale.biz_mode || 'bottle',
				gross: number(item.gross), tare: number(item.tare), net: number(item.net) })
		}
	}
	return canonicalOutgoingFacts(result, inputs.bottle.bottle_no)
}
// Old snapshots used array indices. Normalize them when reading, without
// rewriting immutable measurements or mistaking a shifted row for a departure.
function canonicalOutgoingFacts(facts, bottleNo) {
	return (facts || []).map(row => ({ ...row, key: text(row.key).replace(/^(.*):(out_items|agent_sale_items):[^:]+$/, (_, id) => `${id}:bottle:${no(bottleNo)}`) }))
		.sort((a, b) => a.key.localeCompare(b.key) || fingerprint(a).localeCompare(fingerprint(b)))
}
const manualFacts = inputs => inputs.manual.map(row => ({ _id: row._id, date: row.date || row.event_day,
	type: row.type, net_weight: row.net_weight, loss_weight: row.loss_weight })).sort((a, b) => a._id.localeCompare(b._id))
function validBottle(bottle) {
	if (!bottle?._id || !no(bottle.bottle_no)) return reject('未找到有效钢瓶档案')
	if (bottle.is_active !== true || ['scrapped', 'lost'].includes(bottle.status)) return reject('钢瓶档案未启用或已报废、遗失')
	if (!(number(bottle.tare_weight) > 0)) return reject('钢瓶档案缺少有效皮重，请先维护档案')
	return { ok: true }
}
function returnWeights(gross, tare) {
	gross = number(gross); tare = number(tare)
	if (!(gross > 0) || Math.abs(gross * 2 - Math.round(gross * 2)) > 0.000001) return reject('回瓶毛重须大于零并按0.5 kg分度采集')
	if (!(tare > 0)) return reject('钢瓶档案缺少有效皮重')
	return { ok: true, data: { gross_weight: gross, tare_weight: round(tare), net_weight: round(gross - tare) } }
}
function returnBasis(record) {
	return { source_type: 'pda_return_reweigh', return_reweigh_id: record._id, round_id: record.round_id,
		date: record.date, business_at: record.created_at, time_precision: 'millisecond',
		gross_weight: record.gross_weight, weight_source: 'return_reweigh_gross', source_version: 1 }
}
function canRecordReturn(inputs) {
	const valid = validBottle(inputs.bottle); if (!valid.ok) return valid
	const prior = inputs.returnRecord, head = inputs.returnHead
	if (head && !prior) return reject('上一条回瓶复秤依据缺失，请先核查')
	if (!prior) return { ok: true }
	const newFillings = inputs.fillings.filter(row => !(prior.baseline_filling_ids || []).includes(row._id))
	if (head.consumed_filling_id || newFillings.length) {
		const previousKeys = new Set(canonicalOutgoingFacts(prior.outgoing_facts, inputs.bottle.bottle_no).map(row => row.key))
		// Only a newly recorded departure can close a consumed return cycle. Editing
		// an old departure's weight is not evidence of another physical cycle.
		const departed = outgoingFacts(inputs).some(row => !previousKeys.has(row.key) && text(row.date).slice(0, 10) >= prior.date.slice(0, 10))
		if (!departed) return reject('本轮回瓶已用于灌装，不能改写依据；请完成出瓶后再登记下一轮回瓶')
	}
	return { ok: true }
}
function resolveMeasuredReweighContext(inputs) {
	const valid = validBottle(inputs.bottle); if (!valid.ok) return valid
	const { returnRecord: record, returnHead: head, fillingId } = inputs
	if (!record || !head || head.record_id !== record._id) return reject('未找到本轮回瓶复秤数据，请先在 PDA“回瓶复秤”称重保存')
	if (!(number(record.gross_weight) > 0)) return reject('本轮回瓶复秤毛重无效，请先核查')
	if (fingerprint(outgoingFacts(inputs)) !== fingerprint(canonicalOutgoingFacts(record.outgoing_facts, inputs.bottle.bottle_no))) return reject('回瓶复秤后出瓶记录已变化，请先完成新一轮回瓶复秤或核查原单')
	if (fingerprint(manualFacts(inputs)) !== fingerprint(record.manual_facts)) return reject('回瓶复秤后存在人工流转或损耗变更，请先核查')
	const current = inputs.fillings.filter(row => !(record.baseline_filling_ids || []).includes(row._id))
	if (current.length > 1) return reject('本轮存在多次灌装，不能用复秤自动分配更正量')
	const filling = current[0] || null
	if (head.consumed_filling_id && filling?._id !== head.consumed_filling_id) return reject('本轮回瓶依据已被使用，原灌装记录缺失或变化，请先核查')
	if (fillingId && filling?._id !== fillingId) return reject('指定灌装单不属于当前唯一待复秤记录，请刷新核对')
	const basis = returnBasis(record)
	if (filling) {
		if (filling.entry_source !== 'pda_reweigh' || (filling.record_type && filling.record_type !== 'normal_fill') || filling.raw_scale_payload?.task || text(filling.scale_source).toUpperCase().includes('C606')) return reject('原灌装不是本模块的回瓶推算记录，请在原业务入口核查')
		if (filling.consistency_status !== 'complete') return reject('原灌装保存及后续处理尚未完成，请先恢复原操作')
		if (fingerprint(filling.reweigh?.basis) !== fingerprint(basis)) return reject('原灌装绑定的回瓶依据已变化，请先核查原单')
		if (filling.confirmed_fill_loss || filling.context?.confirmed_fill_loss) return reject('原灌装有人工损耗确认，不能自动更正')
	}
	const bottle = { _id: inputs.bottle._id, bottle_no: no(inputs.bottle.bottle_no), tare_weight: Number(inputs.bottle.tare_weight) }
	return { ok: true, data: { mode: filling ? 'correct' : 'create', bottle, basis, filling,
		context_hash: fingerprint({ bottle, basis, filling }) } }
}

module.exports = { bottleKey, outgoingFacts, manualFacts, validBottle, returnWeights, returnBasis, canRecordReturn, resolveMeasuredReweighContext }
