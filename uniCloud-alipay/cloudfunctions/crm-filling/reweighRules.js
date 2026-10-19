'use strict'

const crypto = require('crypto')
const text = value => String(value == null ? '' : value).trim()
const bottleNo = value => text(value).toUpperCase().replace(/\s+/g, '')
const number = value => value == null || text(value) === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? null : Number(value)
const round = value => Math.round((value + Number.EPSILON) * 10) / 10
const fail = (msg, code = 409) => ({ ok: false, code, msg })
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
	? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])])) : value
const hash = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')

// Source business dates, never edit/creation timestamps, determine the cycle.
// Sales normally have day precision; fillings also support yyyy-mm-dd-hh.
function businessTime(value) {
	const date = text(value)
	const match = date.match(/^(\d{4}-\d{2}-\d{2})(?:(?:-|[ T])(\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?([zZ]|[+-]\d{2}:?\d{2})?)?$/)
	if (!match) return null
	const [, day, hour, minute, second, fraction, zone] = match
	const midnight = Date.parse(`${day}T00:00:00+08:00`)
	if (!Number.isFinite(midnight) || new Date(midnight + 28800000).toISOString().slice(0, 10) !== day || Number(hour || 0) > 23 || Number(minute || 0) > 59 || Number(second || 0) > 59) return null
	const start = hour == null ? midnight : Date.parse(`${day}T${hour}:${minute || '00'}:${second || '00'}${fraction ? `.${fraction}` : ''}${zone || '+08:00'}`)
	if (!Number.isFinite(start)) return null
	const span = hour == null ? 86400000 : minute == null ? 3600000 : second == null ? 60000 : fraction == null ? 1000 : 1
	return { date, day, start, end: start + span - 1, precision: hour == null ? 'day' : minute == null ? 'hour' : second == null ? 'minute' : 'second' }
}

function returnWeight(item) {
	const gross = number(item.gross)
	if (gross != null && gross > 0) return { gross_weight: gross, weight_source: 'back_gross' }
	const tare = number(item.tare), net = number(item.net)
	return tare != null && tare >= 0 && net != null && tare + net > 0
		? { gross_weight: tare + net, weight_source: 'back_tare_plus_net' } : null
}

function resolveReweighContext({ bottle, sales, fillings, at, fillingId, manual = [] } = {}) {
	const no = bottleNo(bottle?.bottle_no), tare = number(bottle?.tare_weight), time = number(at)
	if (!bottle || !text(bottle._id) || !no) return fail('未找到有效钢瓶档案', 400)
	if (bottle.is_active !== true || ['scrapped', 'lost'].includes(text(bottle.status))) return fail('钢瓶档案未启用或已报废、遗失', 400)
	if (!(tare > 0)) return fail('钢瓶档案缺少有效皮重，请先维护档案', 400)
	if (!(time > 0) || !Array.isArray(sales) || !Array.isArray(fillings) || !Array.isArray(manual)) return fail('复秤业务时点或完整源数据无效', 400)
	const events = []
	for (const sale of sales) {
		for (const [field, kind] of [['back_items', 'back'], ['out_items', 'out'], ['agent_sale_items', 'boundary']]) {
			for (const [index, item] of (Array.isArray(sale[field]) ? sale[field] : []).entries()) {
				if (bottleNo(item?.bottle_no) !== no) continue
				const when = businessTime(sale.date)
				if (!when || !text(sale._id)) return fail('钢瓶销售源单缺少有效业务时间或编号，请先核查')
				if (when.start > time) continue
				events.push({ kind: text(sale.biz_mode) && sale.biz_mode !== 'bottle' ? 'boundary' : kind, when,
					sale, index, item, key: `${sale._id}:${field}:${index}` })
			}
		}
	}
	const backs = events.filter(row => row.kind === 'back').sort((a, b) => b.when.start - a.when.start || a.key.localeCompare(b.key))
	if (!backs.length) return fail('未找到本轮回瓶数据，请保留草稿并先补齐回瓶记录')
	const latest = backs[0]
	if (backs.slice(1).some(row => row.when.end >= latest.when.start)) return fail('最近回瓶记录重复或先后不明，请先核查')
	const basisWeight = returnWeight(latest.item)
	if (!basisWeight) return fail('最近一次回瓶缺少有效毛重，不能使用更早回瓶代替')
	const cycleEvents = events.filter(row => row.when.end >= latest.when.start)
	if (cycleEvents.some(row => row.kind === 'boundary')) return fail('本轮存在代理或非普通钢瓶作业，不能自动复秤')
	for (const row of cycleEvents.filter(event => event.kind === 'out')) {
		if (row.when.start <= latest.when.end) return fail('同日回瓶与出瓶先后不明，请先核查')
		return fail('本轮钢瓶已经出瓶，不能新建或修正灌装')
	}
	const previousBack = backs[1]
	if (previousBack && !events.some(row => row.kind === 'out' && row.when.start > previousBack.when.end && row.when.end < latest.when.start)) {
		return fail('连续回瓶之间缺少明确出瓶依据，本轮周期待核')
	}
	const basis = { sale_id: text(latest.sale._id), item_index: latest.index, date: latest.when.date, ...basisWeight,
		business_at: latest.when.precision === 'day' ? null : latest.when.start, time_precision: latest.when.precision,
		source_updated_at: number(latest.sale.updated_at), source_version: number(latest.sale.source_version) }
	const currentFillings = []
	for (const filling of fillings) {
		if (bottleNo(filling?.bottle_no) !== no) continue
		const when = businessTime(filling.filling_time || filling.date)
		if (!when || !text(filling._id)) return fail('灌装源单缺少有效业务时间或编号，请先核查')
		if (when.start > time || when.end < latest.when.start) continue
		// Explicit return reference can establish the same-day relation for this module.
		if (when.start <= latest.when.end && !(filling.entry_source === 'pda_reweigh' && filling.reweigh?.basis?.sale_id === basis.sale_id && filling.reweigh?.basis?.item_index === basis.item_index)) {
			return fail('回瓶与已有灌装先后不明，请先核查原单')
		}
		currentFillings.push(filling)
	}
	for (const row of manual) {
		if (bottleNo(row?.bottle_no) !== no) continue
		const when = businessTime(row.date || row.event_day)
		if (!when || (when.start <= time && when.end >= latest.when.start)) return fail('本轮存在人工流转或损耗处理，请先人工核查')
	}
	if (currentFillings.length > 1) return fail('本轮存在多次灌装，不能用复秤自动分配更正量')
	const filling = currentFillings[0] || null
	if (text(fillingId) && (!filling || filling._id !== text(fillingId))) return fail('指定灌装单不属于当前唯一待复秤记录，请刷新核对')
	if (filling) {
		if (filling.entry_source !== 'pda_reweigh' || (filling.record_type && filling.record_type !== 'normal_fill') || filling.raw_scale_payload?.task || text(filling.scale_source).toUpperCase().includes('C606')) {
			return fail('原灌装不是本模块的回瓶推算记录，请在原业务入口核查')
		}
		if (filling.consistency_status !== 'complete') return fail('原灌装保存及后续处理尚未完成，请先恢复原操作')
		const original = filling.reweigh?.basis
		if (!original || original.sale_id !== basis.sale_id || original.item_index !== basis.item_index || original.date !== basis.date || number(original.gross_weight) !== basis.gross_weight) {
			return fail('原灌装绑定的回瓶依据已变化，请先核查原单')
		}
		if (filling.confirmed_fill_loss || filling.context?.confirmed_fill_loss) return fail('原灌装有人工损耗确认，不能自动更正')
	}
	const publicBottle = { _id: text(bottle._id), bottle_no: no, tare_weight: tare }
	const facts = cycleEvents.map(row => ({ key: row.key, kind: row.kind, date: row.when.date,
		updated_at: number(row.sale.updated_at), source_version: number(row.sale.source_version),
		gross: number(row.item.gross), tare: number(row.item.tare), net: number(row.item.net) })).sort((a, b) => a.key.localeCompare(b.key))
	const context_hash = hash({ bottle: publicBottle, basis, facts, filling })
	return { ok: true, data: { mode: filling ? 'correct' : 'create', bottle: publicBottle, basis, filling, context_hash } }
}

function calculateReweighWeights({ gross_weight, tare_weight, basis, bottle_no } = {}) {
	const gross = number(gross_weight), tare = number(tare_weight), back = number(basis?.gross_weight)
	if (!(gross > 0) || Math.abs(gross * 10 - Math.round(gross * 10)) > 0.000001) return fail('毛重必须大于零且最多一位小数', 400)
	if (!(tare > 0) || !(back > 0)) return fail('缺少有效档案皮重或回瓶毛重', 400)
	const weights = { gross_weight: round(gross), tare_weight: round(tare), net_weight: round(gross - tare), fill_weight: round(gross - back) }
	if (!(weights.net_weight > 0)) return fail('复秤净重必须大于零', 400)
	if (!(weights.fill_weight > 0)) return fail('本次灌装量必须大于零，请核查回瓶依据和复秤读数', 400)
	const label = { company: '新拓能源', ...(text(bottle_no) ? { bottle_no: bottleNo(bottle_no) } : {}),
		tare_weight: weights.tare_weight, gross_weight: weights.gross_weight, net_weight: weights.net_weight }
	return { ok: true, data: { ...weights, label } }
}

module.exports = { resolveReweighContext, calculateReweighWeights }
