'use strict'

const { fingerprint } = require('./fillingPayloadLocal')
const { businessTime } = require('./reweighRules')
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
// Older deployments could snapshot no sales because an array query returned empty.
// Ignore only newly visible facts proven to predate that snapshot and unchanged
// since it; retain every previously captured fact and every uncertain/change case.
function comparableOutgoingFacts(inputs, record) {
 if (record.sales_snapshot_version === 2) return outgoingFacts(inputs)
 const priorKeys = new Set(canonicalOutgoingFacts(record.outgoing_facts, inputs.bottle.bottle_no).map(row => row.key))
 const at = number(record.created_at), day = businessTime(record.date)
 // Sale source mutations touch this bottle inside their source transaction;
 // accounting-only updates do not. The return save touches it before created_at.
 // Missing/newer bottle timestamps cannot certify a legacy omitted sale.
 const sourceAt = number(inputs.bottle.updated_at)
 const sourcesUnchanged = sourceAt > 0 && at > 0 && sourceAt <= at
 const oldKeys = new Set(inputs.sales.filter(sale => {
  const created = number(sale.created_at), updated = number(sale.updated_at), when = businessTime(sale.date)
  return at > 0 && created > 0 && created <= at && updated >= created && (updated <= at || sourcesUnchanged) && when && day && when.day <= day.day
 }).map(sale => `${sale._id}:bottle:${no(inputs.bottle.bottle_no)}`))
 return outgoingFacts(inputs).filter(row => priorKeys.has(row.key) || !oldKeys.has(row.key))
}
const manualFacts = inputs => inputs.manual.map(row => ({ _id: row._id, date: row.date || row.event_day,
	type: row.type, net_weight: row.net_weight, loss_weight: row.loss_weight })).sort((a, b) => a._id.localeCompare(b._id))
// Rebuilt movement rows get new IDs. Compare the full multiset of business
// facts; keep duplicates, signed weights and the original snapshot unchanged.
const manualSignatures = facts => facts.map(({ date, type, net_weight, loss_weight }) =>
	fingerprint({ date, type, net_weight, loss_weight })).sort()
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
	if (gross < tare * 0.5) return reject('回瓶毛重不得低于档案皮重的50%，请确认钢瓶已完整上秤')
	return { ok: true, data: { gross_weight: gross, tare_weight: round(tare), net_weight: round(gross - tare) } }
}
function returnBasis(record) {
	return { source_type: 'pda_return_reweigh', return_reweigh_id: record._id, round_id: record.round_id,
		date: record.date, business_at: record.created_at, time_precision: 'millisecond',
		gross_weight: record.gross_weight, weight_source: 'return_reweigh_gross', source_version: 1 }
}
// A late historical entry is not a new physical filling in this return cycle.
// Exclude only ordinary, unbound records on an unambiguously earlier business
// day. Same-day/invalid dates, measured records and loss confirmations stay in
// the existing checks; never rewrite the immutable return baseline.
function cycleFillings(inputs, record) {
	const returnTime = businessTime(record.date)
	const returnDay = returnTime && businessTime(returnTime.day)
	return inputs.fillings.filter(row => {
		if ((record.baseline_filling_ids || []).includes(row._id)) return false
		if (inputs.returnHead?.consumed_filling_id === row._id || row.reweigh || row.entry_source ||
			(row.record_type && row.record_type !== 'normal_fill') || row.raw_scale_payload?.task ||
			text(row.scale_source).toUpperCase().includes('C606') || row.confirmed_fill_loss || row.context?.confirmed_fill_loss) return true
		const when = businessTime(row.date)
		return !returnDay || !when || when.end >= returnDay.start
	})
}
function canRecordReturn(inputs) {
	const valid = validBottle(inputs.bottle); if (!valid.ok) return valid
	const prior = inputs.returnRecord, head = inputs.returnHead
	if (head && !prior) return reject('上一条回瓶复秤依据缺失，请先核查')
	if (!prior) return { ok: true }
	const newFillings = cycleFillings(inputs, prior)
	if (head.consumed_filling_id || newFillings.length) {
		const previousKeys = new Set(canonicalOutgoingFacts(prior.outgoing_facts, inputs.bottle.bottle_no).map(row => row.key))
		// Only a newly recorded departure can close a consumed return cycle. Editing
		// an old departure's weight is not evidence of another physical cycle.
		const departed = comparableOutgoingFacts(inputs, prior).some(row => {
			const sale = inputs.sales.find(sale => `${sale._id}:bottle:${no(inputs.bottle.bottle_no)}` === row.key)
			// Updating a previously missed old sale is not a new departure.
			return !previousKeys.has(row.key) && (prior.sales_snapshot_version === 2 || number(sale?.created_at) > number(prior.created_at)) && text(row.date).slice(0, 10) >= prior.date.slice(0, 10)
		})
		if (!departed) return reject('本轮回瓶已用于灌装，不能改写依据；请完成出瓶后再登记下一轮回瓶')
	}
	return { ok: true }
}
function resolveMeasuredReweighContext(inputs) {
	const valid = validBottle(inputs.bottle); if (!valid.ok) return valid
	const { returnRecord: record, returnHead: head, fillingId } = inputs
	if (!record || !head || head.record_id !== record._id) return reject('未找到本轮回瓶复秤数据，请先在 PDA“回瓶复秤”称重保存')
	if (!(number(record.gross_weight) > 0)) return reject('本轮回瓶复秤毛重无效，请先核查')
	// Once a legacy basis has been safely consumed, the filling's full snapshot
	// survives its own bottle timestamp updates. Never borrow another cycle's proof.
	const bound = inputs.fillings.find(row => row._id === head.consumed_filling_id && row.entry_source === 'pda_reweigh'
		&& fingerprint(row.reweigh?.basis) === fingerprint(returnBasis(record)))
	const recovered = record.sales_snapshot_version !== 2 && bound?.reweigh?.sales_snapshot_version === 2 && Array.isArray(bound.reweigh.outgoing_facts)
	const actualOutgoing = recovered ? outgoingFacts(inputs) : comparableOutgoingFacts(inputs, record)
	const expectedOutgoing = recovered ? bound.reweigh.outgoing_facts : record.outgoing_facts
	if (fingerprint(actualOutgoing) !== fingerprint(canonicalOutgoingFacts(expectedOutgoing, inputs.bottle.bottle_no))) return reject('回瓶复秤后出瓶记录已变化，请先完成新一轮回瓶复秤或核查原单')
	if (!Array.isArray(record.manual_facts) || fingerprint(manualSignatures(manualFacts(inputs))) !== fingerprint(manualSignatures(record.manual_facts))) return reject('回瓶复秤后存在人工流转或损耗变更，请先核查')
	const current = cycleFillings(inputs, record)
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
