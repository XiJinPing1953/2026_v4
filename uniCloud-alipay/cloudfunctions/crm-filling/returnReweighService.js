'use strict'

const { fingerprint } = require('./fillingPayloadLocal')
const { bottleKey, outgoingFacts, manualFacts, returnWeights, canRecordReturn } = require('./returnReweighRules')
const text = value => String(value == null ? '' : value).trim()
const normalize = value => text(value).toUpperCase().replace(/\s+/g, '')
const validId = value => /^[A-Za-z0-9_-]{12,128}$/.test(text(value))
const recordKey = id => `return_${fingerprint(id)}`
const ownerKey = id => `owner_${fingerprint(id)}`
const one = result => Array.isArray(result.data) ? result.data[0] : result.data
const rejected = (msg, code = 409) => ({ code, msg, data: { rejected: true } })
const publicRound = row => row ? { _id: row._id, created_at: row.created_at, bottle_count: (row.bottle_ids || []).length } : null
const publicRecord = row => ({ _id: row._id, bottle_no: row.bottle_no, date: row.date, gross_weight: row.gross_weight,
	tare_weight: row.tare_weight, net_weight: row.net_weight, created_at: row.created_at })

function createReturnReweighService({ db, readInputs, now = Date.now }) {
	async function currentRound(user, database = db) {
		const state = one(await database.collection('crm_return_reweigh_state').doc(ownerKey(user._id)).get())
		return state?.round_id ? one(await database.collection('crm_return_reweigh_rounds').doc(state.round_id).get()) || null : null
	}
	async function roundStatus(user) { return { code: 0, data: { round: publicRound(await currentRound(user)) } } }
	async function startRound(user, data) {
		if (!validId(data.round_id)) return rejected('缺少有效轮次编号', 400)
		const tx = await db.startTransaction(); let committing = false
		try {
			const rounds = tx.collection('crm_return_reweigh_rounds'), states = tx.collection('crm_return_reweigh_state')
			const old = one(await rounds.doc(data.round_id).get())
			if (old) {
				await tx.rollback()
				if (old.created_by !== user._id) return rejected('无权访问该轮次', 403)
				return { code: 0, data: { round: publicRound(old) } }
			}
			const owner = one(await states.doc(ownerKey(user._id)).get())
			if (text(owner?.round_id) !== text(data.expected_round_id)) { await tx.rollback(); return rejected('当前轮次已变化，请刷新本轮统计后重试') }
			const row = { _id: data.round_id, created_by: user._id, created_at: now(), updated_at: now(), bottle_ids: [] }
			await rounds.add(row)
			if (owner) await states.doc(owner._id).update({ round_id: row._id, updated_at: now() })
			else await states.add({ _id: ownerKey(user._id), kind: 'owner', owner_id: user._id, round_id: row._id, updated_at: now() })
			committing = true; await tx.commit()
			return { code: 0, data: { round: publicRound(row) } }
		} catch (error) {
			await tx.rollback().catch(() => {})
			console.warn('[return-reweigh] start round transaction:', error.message)
			// A lost commit acknowledgement remains retryable with the same round ID.
			return { code: 503, msg: committing ? '轮次创建结果待确认，请用原编号重试' : '轮次暂未完成，请重试原编号' }
		}
	}
	async function context(user, data, database = db) {
		const round = await currentRound(user, database)
		if (!round || round._id !== data.round_id || round.created_by !== user._id) return rejected('当前轮次已变化，请刷新本轮统计')
		const no = normalize(data.bottle_no)
		if (!no) return rejected('请选择钢瓶', 400)
		const inputs = await readInputs(no, database)
		const allowed = canRecordReturn(inputs)
		if (!allowed.ok) return rejected(allowed.msg)
		const bottle = { _id: inputs.bottle._id, bottle_no: no, tare_weight: Number(inputs.bottle.tare_weight) }
		let weights = { gross_weight: null, net_weight: null }
		if (data.gross_weight != null && data.gross_weight !== '') {
			const result = returnWeights(data.gross_weight, bottle.tare_weight)
			if (!result.ok) return rejected(result.msg, 400)
			weights = result.data
		}
		return { code: 0, inputs, round, data: { mode: 'create', bottle, round: publicRound(round),
			date: new Date(now() + 28800000).toISOString().slice(0, 19).replace('T', ' '), ...weights,
			previous: inputs.returnRecord ? publicRecord(inputs.returnRecord) : null,
			context_hash: fingerprint({ bottle: inputs.bottle, head: inputs.returnHead,
				outgoing: outgoingFacts(inputs), manual: manualFacts(inputs), fillings: inputs.fillings, round_id: round._id }) } }
	}
	async function preview(user, data) {
		try { const result = await context(user, data); delete result.inputs; delete result.round; return result }
		catch (error) { return rejected(error.message || '回瓶复秤预览失败') }
	}
	async function receipt(record) {
		const round = one(await db.collection('crm_return_reweigh_rounds').doc(record.round_id).get())
		return { code: 0, msg: '回瓶复秤已保存', data: { ...publicRecord(record), operation_id: record.operation_id,
			saved_total: 1, complete: true, status: 'complete', round: publicRound(round) } }
	}
	async function existing(user, data, database = db) {
		const record = one(await database.collection('crm_return_reweighs').doc(recordKey(data.operation_id)).get())
		if (!record) return null
		if (record.created_by !== user._id) return rejected('无权访问该回瓶复秤操作', 403)
		if (record.input_hash !== fingerprint(data)) return rejected('同一操作编号不能用于不同内容')
		return { record }
	}
	async function status(user, data) {
		if (!validId(data.operation_id)) return { code: 400, msg: '操作编号无效' }
		const record = one(await db.collection('crm_return_reweighs').doc(recordKey(data.operation_id)).get())
		if (!record) return { code: 404, msg: '未找到结果，请用原操作编号重试保存' }
		if (record.created_by !== user._id) return { code: 403, msg: '无权访问该回瓶复秤操作' }
		return receipt(record)
	}
	async function save(user, data) {
		if (!validId(data.operation_id)) return rejected('操作编号无效', 400)
		const previous = await existing(user, data)
		if (previous) return previous.record ? receipt(previous.record) : previous
		const capture = data.capture
		if (data.capture_method !== 'ble' || !capture || capture.stable !== true || !(Number(capture.sampled_at) > 0) ||
			Number(capture.sampled_at) > now() + 60000 || !text(capture.measurement_id) || !(Number(capture.stable_seq) > 0)) return rejected('请使用本瓶蓝牙吊秤稳定读数', 400)
		const tx = await db.startTransaction(); let committing = false
		const started = now()
		try {
			const duplicate = await existing(user, data, tx)
			if (duplicate) { await tx.rollback(); return duplicate.record ? receipt(duplicate.record) : duplicate }
			const result = await context(user, data, tx)
			if (result.code !== 0) { await tx.rollback(); return result }
			if (!data.context_hash || data.context_hash !== result.data.context_hash) { await tx.rollback(); return rejected('瓶档或本轮记录已变化，请重新预览确认') }
			if (!(result.data.gross_weight > 0)) { await tx.rollback(); return rejected('请先完成稳定称重', 400) }
			const { inputs, round } = result, time = now(), no = result.data.bottle.bottle_no
			const ids = [...(round.bottle_ids || [])]
			if (!ids.includes(inputs.bottle._id)) ids.push(inputs.bottle._id)
			if (ids.length > 1000) { await tx.rollback(); return rejected('本轮已达1000瓶，请开始新一轮') }
			const row = { _id: recordKey(data.operation_id), operation_id: data.operation_id, input_hash: fingerprint(data),
				round_id: round._id, bottle_id: inputs.bottle._id, bottle_no: no,
				date: result.data.date, gross_weight: result.data.gross_weight, tare_weight: result.data.tare_weight, net_weight: result.data.net_weight,
				created_at: time, created_by: user._id, created_by_name: user.username || '',
				previous_record_id: inputs.returnRecord?._id || '', remark: text(data.remark).slice(0, 1000),
				capture: { gross_weight: result.data.gross_weight, stable: true, sampled_at: Number(capture.sampled_at),
					stable_seq: Number(capture.stable_seq), measurement_id: text(capture.measurement_id).slice(0, 160),
					device_id: text(capture.device_id).slice(0, 160), raw: text(capture.raw).slice(0, 2000) },
				outgoing_facts: outgoingFacts(inputs), manual_facts: manualFacts(inputs), baseline_filling_ids: inputs.fillings.map(row => row._id) }
			await tx.collection('crm_return_reweighs').add(row)
			const state = { kind: 'bottle', bottle_no: no, record_id: row._id, consumed_filling_id: '', updated_at: time }
			if (inputs.returnHead) await tx.collection('crm_return_reweigh_state').doc(inputs.returnHead._id).update(state)
			else await tx.collection('crm_return_reweigh_state').add({ _id: bottleKey(no), ...state })
			await tx.collection('crm_return_reweigh_rounds').doc(round._id).update({ bottle_ids: db.command.set(ids), updated_at: time })
			// Serialize with starting a new round; no late save can enter a closed round.
			await tx.collection('crm_return_reweigh_state').doc(ownerKey(user._id)).update({ updated_at: time })
			if (now() - started >= 8000) throw new Error('回瓶复秤事务接近时限，已停止提交')
			committing = true; await tx.commit()
			return receipt(row)
		} catch (error) {
			await tx.rollback().catch(() => {})
			console.warn('[return-reweigh] save transaction:', error.message)
			// Conflicts, timeouts and commit uncertainty retain the immutable request.
			return { code: 503, msg: committing ? '回瓶复秤保存结果待确认，请查询原操作' : '回瓶复秤暂未完成，请用原操作重试' }
		}
	}
	return { preview, save, status, roundStatus, startRound }
}

module.exports = { createReturnReweighService, recordKey, ownerKey }
