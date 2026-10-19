'use strict'

const { fingerprint } = require('./fillingPayloadLocal')
const { calculateReweighWeights } = require('./reweighRules')
const { resolveMeasuredReweighContext, bottleKey } = require('./returnReweighRules')

const text = value => value == null ? '' : String(value).trim()
const bottleNo = value => text(value).toUpperCase().replace(/\s+/g, '')
const rejected = (code, msg) => ({ code, msg, data: { rejected: true } })
const hour = at => new Date(at + 8 * 3600000).toISOString().slice(0, 13).replace('T', '-')
const permanent = msg => Object.assign(new Error(msg), { permanent: true })

// All reads are keyset-paginated. Reaching a safety limit never means "no return".
async function allRows(collection, where, command) {
	const rows = []; let cursor = ''
	for (let page = 0; page < 100; page++) {
		const result = await collection.where(cursor ? command.and([where, { _id: command.gt(cursor) }]) : where)
			.orderBy('_id', 'asc').limit(200).get()
		if (!Array.isArray(result.data)) throw new Error('复秤依据读取不完整，请稍后重试')
		for (const row of result.data) {
			if (!row._id || (cursor && String(row._id) <= cursor)) throw new Error('复秤依据分页异常，请稍后重试')
			cursor = String(row._id); rows.push(row)
		}
		if (result.data.length < 200) return rows
	}
	throw new Error('该瓶历史记录超出复秤核查范围，请人工核查')
}

function createReweighService({ db, operations, submitCreate, stableId, now = Date.now }) {
	const command = db.command
	async function readInputs(no, database = db) {
		const values = [no]
		if (/^\d+$/.test(no)) values.push(Number(no))
		const saleWhere = command.or(values.flatMap(value => ['back_items', 'out_items', 'agent_sale_items'].map(field => ({ [`${field}.bottle_no`]: value }))))
		const reads = [
			() => allRows(database.collection('crm_bottles'), { bottle_no: command.in(values) }, command),
			() => allRows(database.collection('crm_sale_records'), saleWhere, command),
			() => allRows(database.collection('crm_fillings'), { bottle_no: command.in(values) }, command),
			() => allRows(database.collection('crm_bottle_movements'), { bottle_no: command.in(values), source_type: command.in(['manual', 'manual_fix']) }, command)
		]
		// Alipay transactions reject concurrent queries; ordinary preview reads can parallelize.
		const results = []
		if (database === db) results.push(...await Promise.all(reads.map(read => read())))
		else for (const read of reads) results.push(await read())
		const [bottles, sales, fillings, manual] = results
		if (bottles.length !== 1) throw permanent(bottles.length ? '瓶号对应多个档案，请先核查' : '钢瓶档案不存在')
		const one = result => Array.isArray(result.data) ? result.data[0] : result.data
		const returnHead = one(await database.collection('crm_return_reweigh_state').doc(bottleKey(no)).get()) || null
		const returnRecord = returnHead?.record_id ? one(await database.collection('crm_return_reweighs').doc(returnHead.record_id).get()) || null : null
		return { bottle: bottles[0], sales, fillings, manual, returnHead, returnRecord }
	}
	function sourceGuard(inputs, excludeId = '') {
		const b = inputs.bottle
		return fingerprint({
			return_record: inputs.returnRecord,
			return_head: inputs.returnHead ? { record_id: inputs.returnHead.record_id } : null,
			bottle: { _id: b._id, bottle_no: b.bottle_no, tare_weight: b.tare_weight, is_active: b.is_active,
				unavailable: ['scrapped', 'lost'].includes(b.status) },
			sales: inputs.sales.map(sale => ({ _id: sale._id, date: sale.date, biz_mode: sale.biz_mode,
				...Object.fromEntries(['back_items', 'out_items', 'agent_sale_items'].map(field => [field,
					(sale[field] || []).flatMap((item, index) => bottleNo(item.bottle_no) === bottleNo(b.bottle_no)
						? [{ index, bottle_no: item.bottle_no, gross: item.gross, tare: item.tare, net: item.net }] : [])])) })),
			fillings: inputs.fillings.filter(row => row._id !== excludeId).map(row => ({ _id: row._id,
				bottle_no: row.bottle_no, date: row.date, filling_time: row.filling_time, record_type: row.record_type,
				entry_source: row.entry_source })),
			manual: inputs.manual.map(row => ({ _id: row._id, date: row.date, event_day: row.event_day, source_type: row.source_type }))
		})
	}
	async function context(data, database = db) {
		let no = bottleNo(data.bottle_no)
		if (!no && data.filling_id) {
			const res = await database.collection('crm_fillings').doc(text(data.filling_id)).get()
			const doc = Array.isArray(res.data) ? res.data[0] : res.data
			no = bottleNo(doc?.bottle_no)
		}
		if (!no) return rejected(400, '请选择钢瓶')
		const inputs = await readInputs(no, database)
		const resolved = resolveMeasuredReweighContext({ ...inputs, at: now(), fillingId: text(data.filling_id) })
		if (!resolved.ok) return rejected(resolved.code || 409, resolved.msg)
		const result = resolved.data
		const date = result.filling?.filling_time || result.filling?.date || text(data.date) || hour(now())
		const dayAt = Date.parse(date.slice(0, 10) + 'T00:00:00+08:00')
		if (!/^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/.test(date) || !Number.isFinite(dayAt) ||
			new Date(dayAt + 28800000).toISOString().slice(0, 10) !== date.slice(0, 10) || (date.length === 13 && Number(date.slice(11)) > 23)) return rejected(400, '灌装业务时间无效')
		if (!result.filling && (date > hour(now()) || date.slice(0, 10) < result.basis.date.slice(0, 10))) return rejected(400, '复秤业务时间必须在本轮回瓶之后且不能晚于当前时间')
		let weights = { gross_weight: null, net_weight: null, fill_weight: null, label: null }
		if (data.gross_weight !== '' && data.gross_weight != null) {
			const calculated = calculateReweighWeights({ gross_weight: data.gross_weight, tare_weight: result.bottle.tare_weight, basis: result.basis, bottle_no: no })
			if (!calculated.ok) return rejected(calculated.code || 400, calculated.msg)
			weights = calculated.data
		}
		return { code: 0, data: { ...result, date, ...weights }, inputs }
	}
	async function preview(data) {
		try { const result = await context(data); delete result.inputs; return result }
		catch (error) { return rejected(409, error.message || '复秤依据读取失败') }
	}
	async function submit(user, data, kind) {
		const previous = await operations.existing(user, data)
		if (previous) return previous
		let result
		try { result = await context(data) } catch (error) { return rejected(409, error.message) }
		if (result.code !== 0) return result
		const c = result.data
		if (c.mode !== kind) return rejected(409, kind === 'create' ? '本周期已有灌装单，请核对后使用更正' : '当前没有可更正的复秤单')
		if (!data.context_hash || data.context_hash !== c.context_hash) return rejected(409, '瓶档或回瓶依据已变化，请重新预览并确认')
		if (!(c.fill_weight > 0)) return rejected(400, '请先采集有效灌后毛重')
		if (kind === 'correct' && (!data.filling_id || c.filling?._id !== data.filling_id ||
			Number(data.expected_source_version) !== Number(c.filling.source_version))) return rejected(409, '原灌装记录已变化，请重新核对')
		const method = data.capture_method
		if (!['ble', 'manual'].includes(method) || (kind === 'create' && method !== 'ble')) return rejected(400, '新建复秤单必须使用蓝牙吊秤')
		const reason = text(data.reason)
		if (kind === 'correct' && !reason) return rejected(400, '请填写更正原因')
		const capture = data.capture && typeof data.capture === 'object' ? data.capture : null
		if (method === 'ble') {
			if (Math.abs(Number(c.gross_weight) * 2 - Math.round(Number(c.gross_weight) * 2)) > 0.000001) return rejected(400, '吊秤毛重须按0.5 kg分度采集')
			if (!capture || capture.stable !== true || !(Number(capture.sampled_at) > 0) || Number(capture.sampled_at) > now() + 60000 ||
				!text(capture.measurement_id) || !(Number(capture.stable_seq) > 0)) return rejected(400, '缺少本瓶稳定称重证据，请重新称重')
		}
		const old = c.filling
		if (old?.operation_id) {
			const original = await operations.get(old.operation_id)
			if (!original || original.status !== 'complete') return rejected(409, '原灌装操作尚未完成，请先查询并恢复原操作')
		}
		const id = old?._id || stableId(data.operation_id, 0)
		const time = now()
		const originalBle = old?.reweigh?.original_ble_capture || (old?.reweigh?.capture_method === 'ble' ? old.reweigh.capture : null)
		const storedCapture = method === 'ble' ? {
			gross_weight: c.gross_weight, sampled_at: Number(capture.sampled_at), stable: true,
			stable_seq: Number(capture.stable_seq), measurement_id: text(capture.measurement_id).slice(0, 160),
			device_id: text(capture.device_id).slice(0, 160), raw: text(capture.raw).slice(0, 2000)
		} : null
		const reweigh = {
			tare_weight: c.bottle.tare_weight, gross_weight: c.gross_weight, net_weight: c.net_weight,
			basis: c.basis, label: c.label, capture_method: method,
			capture: storedCapture,
			original_ble_capture: originalBle || storedCapture,
			measured_at: method === 'ble' ? Number(capture.sampled_at) : time,
			reason, corrected_by: kind === 'correct' ? user._id : null,
			corrected_by_name: kind === 'correct' ? user.username || '' : '', corrected_at: kind === 'correct' ? time : null
		}
		const row = {
			...(old || {}), _id: id, date: c.date.slice(0, 10), filling_time: c.date.length === 13 ? c.date : '',
			bottle_no: c.bottle.bottle_no, record_type: 'normal_fill', entry_source: 'pda_reweigh', reweigh,
			fill_weight: c.fill_weight, actual_net_weight: c.fill_weight, weight_start: null, weight_end: c.gross_weight,
			scale_source: method === 'ble' ? 'NVK' : 'manual', scale_read_mode: method,
			operator: old?.operator || user.nickname || user.username || '', operator_id: old?.operator_id || user._id,
			status: 'completed', alarm_state: false, ended_at: reweigh.measured_at,
			remark: old ? old.remark : text(data.remark),
			created_at: old?.created_at || time, created_by: old?.created_by || user._id, created_by_name: old?.created_by_name || user.username || '',
			updated_at: time, source_version: Number(old?.source_version || 0) + 1,
			operation_id: data.operation_id, consistency_status: 'pending',
			_reweigh_before: old || null, _reweigh_guard: sourceGuard(result.inputs, id)
		}
		if (kind === 'create') return submitCreate(user, data, [row], { date: row.date, regulatory_enqueue: true, regulatory_source_type: 'filling', operation_kind: 'reweigh_create' })
		return operations.submit(user, data, [row], [{ kind: 'bottle', bottle_no: row.bottle_no }], {
			date: row.date, regulatory_enqueue: true, regulatory_source_type: 'filling', operation_kind: 'reweigh_correct'
		})
	}
	async function validateSources(row, database = db) {
		const inputs = await readInputs(row.bottle_no, database)
		if (sourceGuard(inputs, row._id) !== row._reweigh_guard) throw permanent('回瓶、瓶档或本周期记录已变化，复秤操作停止，请重新核查')
		const head = inputs.returnHead
		if (!head || head.record_id !== row.reweigh?.basis?.return_reweigh_id || (head.consumed_filling_id && head.consumed_filling_id !== row._id)) throw permanent('本轮回瓶依据已变化或被其他灌装使用，请重新核查')
		// A shared per-bottle transaction write serializes return replacement and filling.
		// A stale return preview cannot replace a basis after its filling commits.
		await database.collection('crm_return_reweigh_state').doc(head._id).update({ consumed_filling_id: row._id })
	}
	return { preview, submit, validateSources, readInputs }
}

module.exports = { createReweighService, allRows }
