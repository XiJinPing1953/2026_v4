'use strict'

// Read-only history. Filling corrections replace the current formal filling row;
// return reweighs retain every measurement. Ownership follows the original creator.
const text = value => String(value == null ? '' : value).trim()
const OFFSET = 8 * 60 * 60 * 1000
const invalid = msg => ({ code: 400, msg })

function validDay(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const time = Date.parse(`${value}T00:00:00Z`)
	return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

function timestamp(value) {
	if (value === null || value === '' || value === undefined) return ''
	const time = Number(value)
	if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(new Date(time + OFFSET).getTime())) return ''
	return new Date(time + OFFSET).toISOString().slice(0, 19).replace('T', ' ')
}

function numberOrNull(value) {
	if (value == null || value === '') return null
	const result = Number(value)
	return Number.isFinite(result) ? result : null
}

function publicRecord(row, mode) {
	const filling = mode === 'filling'
	const weights = filling ? row.reweigh || {} : row
	const manual = filling && weights.capture_method === 'manual'
	const measured = filling ? timestamp(weights.measured_at) || (!manual && timestamp(weights.capture?.sampled_at)) : timestamp(row.capture?.sampled_at)
	const saved = timestamp(row.created_at)
	const timeSource = measured ? (manual ? 'manual' : 'measured') : (saved ? 'saved' : 'unknown')
	return {
		id: row._id, bottle_no: text(row.bottle_no), date: text(row.date).slice(0, 10),
		weighed_at: measured || saved || '—', time_source: timeSource,
		time_label: { measured: '称重时间', manual: '人工更正时间', saved: '保存时间', unknown: '时间未知' }[timeSource],
		gross_weight: numberOrNull(weights.gross_weight), tare_weight: numberOrNull(weights.tare_weight), net_weight: numberOrNull(weights.net_weight),
		...(filling ? { fill_weight: numberOrNull(row.fill_weight) } : {}),
		status: filling ? (row.consistency_status === 'complete' ? 'complete' : 'pending') : 'complete'
	}
}

function createReweighRecordsService({ db }) {
	async function list(user, data = {}, mode) {
		if (!user?._id) return { code: 401, msg: '未登录或登录已过期' }
		if (!['return', 'filling'].includes(mode)) return invalid('复秤类型无效')
		if (!data || typeof data !== 'object' || !validDay(data.date)) return invalid('请选择有效日期')
		if (data.bottle_no != null && typeof data.bottle_no !== 'string') return invalid('瓶号格式无效')
		const bottle = text(data.bottle_no).toUpperCase().replace(/\s+/g, '')
		if (bottle.length > 128) return invalid('瓶号过长')
		const size = data.page_size == null ? 30 : Number(data.page_size)
		if (!Number.isInteger(size) || size < 1 || size > 50) return invalid('每页条数须为1至50')
		const scope = { mode, date: data.date, bottle_no: bottle, owner: user._id }
		let cursor = null
		if (data.cursor != null && data.cursor !== '') {
			if (typeof data.cursor !== 'string' || data.cursor.length > 2048) return invalid('分页位置无效，请重新查询')
			try {
				cursor = JSON.parse(Buffer.from(data.cursor, 'base64').toString('utf8'))
				if (!cursor || Object.keys(scope).some(key => cursor[key] !== scope[key]) ||
					!Number.isFinite(cursor.created_at) || cursor.created_at <= 0 ||
					typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 128) throw new Error('invalid cursor')
			} catch (_) { return invalid('分页位置无效，请重新查询') }
		}
		const cmd = db.command
		// Query the stored business date. A later correction does not move an old
		// filling into today's business list; the returned timestamp identifies it.
		const conditions = [{ created_by: user._id }, mode === 'filling'
			? { entry_source: 'pda_reweigh', date: data.date }
			: { date: cmd.and([cmd.gte(`${data.date} 00:00:00`), cmd.lte(`${data.date} 23:59:59`)]) }]
		if (bottle) conditions.push({ bottle_no: bottle })
		if (cursor) conditions.push(cmd.or([
			{ created_at: cmd.lt(cursor.created_at) },
			cmd.and([{ created_at: cursor.created_at }, { _id: cmd.lt(cursor.id) }])
		]))
		const result = await db.collection(mode === 'filling' ? 'crm_fillings' : 'crm_return_reweighs')
			.where(cmd.and(conditions)).orderBy('created_at', 'desc').orderBy('_id', 'desc').limit(size + 1)
			.field({ _id: true, bottle_no: true, date: true, created_at: true, gross_weight: true, tare_weight: true,
				net_weight: true, fill_weight: true, consistency_status: true, 'capture.sampled_at': true,
				'reweigh.gross_weight': true, 'reweigh.tare_weight': true, 'reweigh.net_weight': true,
				'reweigh.capture_method': true, 'reweigh.measured_at': true, 'reweigh.capture.sampled_at': true }).get()
		if (!Array.isArray(result.data)) throw new Error('复秤记录读取未完成，请重试')
		const rows = result.data.slice(0, size), more = result.data.length > size, last = rows[rows.length - 1]
		return { code: 0, data: { rows: rows.map(row => publicRecord(row, mode)), has_more: more,
			next_cursor: more ? Buffer.from(JSON.stringify({ ...scope, created_at: last.created_at, id: last._id })).toString('base64') : '' } }
	}
	return { list }
}

module.exports = { createReweighRecordsService }
