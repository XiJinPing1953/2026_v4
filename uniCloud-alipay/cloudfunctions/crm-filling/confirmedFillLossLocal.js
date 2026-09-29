'use strict'

const crypto = require('crypto')
const VERSION = 'confirmed-fill-loss/2026-09-28.1'
const MARKER = 'user-confirmed-fill-loss'
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
	? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
const hash = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const round = value => Math.round(value * 1000) / 1000
const same = (a, b) => a != null && b != null && Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) < 0.001
const fail = message => { throw Object.assign(new Error(message), { code: 409 }) }
const doc = async (db, collection, id) => {
	let result
	try { result = await db.collection(collection).doc(id).get() }
	catch (error) { throw new Error(`${collection} read: ${error.message}`) }
	if (Array.isArray(result?.data)) return result.data[0] || null
	if (result?.data && typeof result.data === 'object') return result.data
	if (result?.data === null) return null
	fail('人工确认依据读取不完整')
}
const fillFacts = row => row && ({ id: row._id, bottle: row.bottle_no, date: row.date,
	type: row.record_type, start: row.weight_start, end: row.weight_end, net: row.fill_weight })
const eventFacts = row => ({ id: row._id, date: row.date, type: row.type, source: row.source_type,
	source_id: row.source_id, net: row.net_weight, event_at: row.event_at, type_order: row.type_order })

// The approval binds a complete, exactly two-fill cycle. It is never a bottle-wide exemption.
async function evidence(db, anomaly, movementRows) {
	if (anomaly?.anomaly_type !== 'continuous_fill') fail('仅支持连续灌装事实确认')
	const no = anomaly.bottle_no
	const context = anomaly.context || {}
	const ordered = movementRows.filter(row => ['back', 'fill', 'out'].includes(row.type))
		.sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.type_order) - Number(b.type_order) || Number(a.created_at) - Number(b.created_at) || a._id.localeCompare(b._id))
	const backIndex = ordered.findIndex(row => row.type === 'back' && row.source_id === context.last_back?.source_id && row.date === context.last_back?.date)
	if (backIndex < 0) fail('找不到确认周期的回瓶依据')
	const cycle = ordered.slice(backIndex, backIndex + 4)
	if (cycle.map(row => row.type).join(',') !== 'back,fill,fill,out' ||
		cycle[1].source_id !== context.last_fill?.source_id || cycle[2].source_id !== context.next_fill?.source_id ||
		cycle.some(row => row.bottle_no !== no) || cycle[3].source_type !== 'sale') fail('周期事件已变更或存在额外流转，请重新核实')
	// uniCloud transactions use one server-side session; keep its reads ordered.
	const previous = await doc(db, 'crm_fillings', cycle[1].source_id)
	const next = await doc(db, 'crm_fillings', cycle[2].source_id)
	const backSale = await doc(db, 'crm_sale_records', cycle[0].source_id)
	const outSale = await doc(db, 'crm_sale_records', cycle[3].source_id)
	for (const [index, fill] of [[1, previous], [2, next]]) {
		if (!fill || fill.bottle_no !== no || fill.record_type !== 'normal_fill' || fill.date !== cycle[index].date ||
			!(fill.weight_start > 0 && fill.weight_end > fill.weight_start) ||
			!same(fill.weight_end - fill.weight_start, fill.fill_weight) || !same(fill.fill_weight, cycle[index].net_weight)) fail('灌装源单和流转称重不一致')
	}
	const backItems = (backSale?.back_items || []).filter(row => row.bottle_no === no)
	const outItems = (outSale?.out_items || []).filter(row => row.bottle_no === no)
	if (backItems.length !== 1 || outItems.length !== 1 || backSale.date !== cycle[0].date || outSale.date !== cycle[3].date) fail('销售回瓶/出瓶依据不唯一或日期不符')
	const back = backItems[0], out = outItems[0]
	if (!same(back.gross - back.tare, back.net) || !same(out.gross - out.tare, out.net) ||
		!same(back.net, cycle[0].net_weight) || !same(out.net, cycle[3].net_weight)) fail('销售称重与流转不一致')
	const storage = round(previous.weight_end - next.weight_start)
	const outbound = round(next.weight_end - out.gross)
	if (storage < 0 || outbound < 0) fail('本入口仅接受经确认的减重损耗，不能用于增重')
	const facts = { bottle_no: no, cycle: cycle.map(eventFacts), previous: fillFacts(previous), next: fillFacts(next),
		back: { id: backSale._id, date: backSale.date, gross: back.gross, tare: back.tare, net: back.net },
		out: { id: outSale._id, date: outSale.date, gross: out.gross, tare: out.tare, net: out.net } }
	return { hash: hash(facts), facts, storage_loss_kg: storage, outbound_loss_kg: outbound,
		previous, next, outEvent: cycle[3] }
}

async function validApproval(db, anomaly, rows) {
	const approval = anomaly?.context?.confirmed_fill_loss
	if (approval?.version !== VERSION) return null
	try {
		const current = await evidence(db, anomaly, rows)
		return current.hash === approval.evidence_hash ? current : null
	} catch (error) {
		if (error.code === 409) return null
		throw error
	}
}

function adjustmentPlan(rows, current, user, now) {
	const existing = rows.filter(row => row.source_type === 'manual_fix' && row.source_id === current.next._id && row.adjust_reason === 'filling_start_weight_loss')
	if (existing.length > 1) fail('同一灌装存在多笔上秤差值，须先核对重复记录')
	const next = current.next
	const patch = { loss_weight: current.storage_loss_kg,
		note: `人工确认灌装间损耗：上次灌完${current.previous.weight_end}kg - 本次上秤${next.weight_start}kg = ${current.storage_loss_kg}kg`,
		context: { source: 'filling_start_weight', filling_id: next._id, weight_start: next.weight_start,
			weight_end: next.weight_end, fill_weight: next.fill_weight, basis_value: current.previous.weight_end,
			basis_source: 'confirmed_previous_fill_end', basis_ref: current.previous._id, basis_date: current.previous.date }, updated_at: now }
	if (existing.length) return { collection: 'crm_bottle_movements', id: existing[0]._id, before: existing[0], patch }
	if (current.storage_loss_kg === 0) return null
	return { collection: 'crm_bottle_movements', id: `cfl_${hash(next._id).slice(0, 36)}`, before: null,
		patch: { ...patch, bottle_no: next.bottle_no, date: next.date, event_day: next.date,
			event_at: Date.parse(`${next.date}T00:00:00+08:00`), type: 'adjust', type_order: 21,
			source_type: 'manual_fix', source_id: next._id, adjust_reason: 'filling_start_weight_loss',
			net_weight: null, customer_id: null, customer_name: '', created_at: now,
			created_by: user._id, created_by_name: user.username || '' } }
}

function createConfirmation({ db, readRows, withLease }) {
	return async (user, data, requestId) => {
		if (user?.role !== 'superadmin') return { code: 403, msg: '仅超级管理员可确认灌装间损耗' }
		const id = String(data.id || '')
		const anomaly = id && await doc(db, 'crm_bottle_anomalies', id)
		if (!anomaly) return { code: 404, msg: '异常不存在' }
		return withLease(anomaly.bottle_no, null, async () => {
			let transaction
			let stage = 'start_transaction'
			try {
				transaction = data.execute ? await db.startTransaction() : null
				const source = transaction || db
				stage = 'read_anomaly'
				const currentAnomaly = await doc(source, 'crm_bottle_anomalies', id)
				stage = 'read_history'
				const rows = await readRows(source, anomaly.bottle_no)
				stage = 'read_evidence'
				const current = await evidence(source, currentAnomaly, rows)
				const previous = currentAnomaly.context?.confirmed_fill_loss
				if (previous?.version === VERSION && previous.evidence_hash === current.hash && currentAnomaly.status === 'resolved') {
					if (data.execute && (data.reason !== previous.reason || !same(data.storage_loss_kg, previous.storage_loss_kg) ||
						!same(data.outbound_loss_kg, previous.outbound_loss_kg))) fail('该异常已有不同确认内容，拒绝覆盖')
					if (transaction) await transaction.rollback()
					return { code: 0, data: { applied: false, already_applied: true, approval: previous } }
				}
				if (currentAnomaly.status !== 'open') fail('该异常当前不是待处理状态')
				const previewHash = hash({ anomaly: currentAnomaly, facts: current.facts, rows })
				const plan = adjustmentPlan(rows, current, user, Date.now())
				const result = { evidence_hash: current.hash, preview_hash: previewHash, facts: current.facts,
					storage_loss_kg: current.storage_loss_kg, outbound_loss_kg: current.outbound_loss_kg, adjustment: plan,
					outbound_accounting: 'existing_cycle_difference_no_duplicate_adjustment' }
				if (!data.execute) return { code: 0, data: result }
				if (data.confirm !== 'CONFIRM_FILL_LOSS' || data.expected_preview_hash !== previewHash ||
					!same(data.storage_loss_kg, current.storage_loss_kg) || !same(data.outbound_loss_kg, current.outbound_loss_kg) ||
					String(data.reason || '').trim().length < 8) fail('确认依据、金额或原值已变化，拒绝执行')
				const approval = { version: VERSION, evidence_hash: current.hash, facts: current.facts,
					storage_loss_kg: current.storage_loss_kg, outbound_loss_kg: current.outbound_loss_kg,
					reason: String(data.reason), approved_at: Date.now(), approved_by: user._id, request_id: requestId }
				if (plan) {
					stage = 'write_adjustment'
					const target = source.collection(plan.collection)
					if (plan.before) await target.doc(plan.id).update({ ...plan.patch, context: db.command.set(plan.patch.context) })
					else await target.add({ _id: plan.id, ...plan.patch })
				}
				stage = 'write_anomaly'
				await source.collection('crm_bottle_anomalies').doc(id).update({ status: 'resolved', updated_at: Date.now(),
					resolved_by: user._id, resolved_by_name: MARKER,
					context: db.command.set({ ...currentAnomaly.context, confirmed_fill_loss: approval }) })
				stage = 'write_audit'
				await source.collection('crm_operation_logs').add({ action: 'bottle_confirm_fill_loss', user_id: user._id,
					username: user.username || '', role: user.role, created_at: Date.now(), request_id: requestId,
					detail: { id, approval, before_anomaly: currentAnomaly, before_adjustment: plan?.before || null, adjustment_id: plan?.id || null } })
				if (data.rollback_test === true) { await transaction.rollback(); return { code: 0, data: { ...result, rolled_back: true } } }
				stage = 'commit'
				await transaction.commit()
				return { code: 0, data: { ...result, applied: true, approval } }
			} catch (error) {
				if (transaction) await transaction.rollback().catch(() => {})
				console.error('[confirmed-fill-loss]', stage, error.code || error.errCode || '', error.message)
				return { code: error.code === 409 ? 409 : 500, msg: `${stage}: ${error.message}` }
			}
		})
	}
}

module.exports = { VERSION, MARKER, hash, evidence, validApproval, adjustmentPlan, createConfirmation }
