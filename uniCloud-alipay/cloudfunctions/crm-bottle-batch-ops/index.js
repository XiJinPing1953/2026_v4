'use strict'

const fs = require('fs')
const path = require('path')

const db = uniCloud.database()
const dbCmd = db.command
const bottles = db.collection('crm_bottles')
const backups = db.collection('crm_bottles_import_backups')
const users = db.collection('crm_users')

const BATCH_REMARK = 'import:test0314:env-00jxuffegf2n:202603141050'
const UPDATE_REMARK = `${BATCH_REMARK}:upsert`

const UPDATE_FIELDS = [
	'bottle_no',
	'filling_company',
	'registration_mark',
	'equipment_type',
	'product_no',
	'qr_code',
	'manufacturer',
	'volume_l',
	'manufacture_date',
	'bottle_check_date',
	'bottle_next_check_date',
	'bottle_check_cycle_months',
	'scrap_due_date',
	'pressure_gauge_no',
	'pressure_gauge_manufacturer',
	'pressure_gauge_range_min',
	'pressure_gauge_range_max',
	'pressure_gauge_check_date',
	'pressure_gauge_next_check_date',
	'pressure_gauge_cycle_months',
	'safety_valve_count',
	'safety_valve_check_date',
	'safety_valve_next_check_date',
	'safety_valve_cycle_months',
	'tare_weight'
]

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
}

function isSuperAdmin(user) {
	if (!user) return false
	return (
		normalizeRole(user.role) === 'superadmin' ||
		normalizeRole(user.role_template) === 'superadmin'
	)
}

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data && res.data[0]) || null
}

function normalizeBottleNo(value) {
	if (value == null) return ''
	return String(value).trim().toUpperCase().replace(/\s+/g, '')
}

function buildBottleNoSortMeta(value) {
	const text = normalizeBottleNo(value)
	const isNumeric = /^\d+$/.test(text)
	const num = isNumeric ? Number(text) : null
	const normalizedNum = Number.isFinite(num) ? num : 0
	const naturalText = (text.match(/\d+|\D+/g) || [text])
		.map((token) => {
			if (/^\d+$/.test(token)) return `#${String(Number(token)).padStart(12, '0')}`
			return `$${token}`
		})
		.join('')
	const key = isNumeric
		? `0:${String(normalizedNum).padStart(12, '0')}:${text}`
		: `1:999999999999:${naturalText}:${text}`
	return {
		bottle_no_sort_group: isNumeric ? 0 : 1,
		bottle_no_sort_num: isNumeric ? normalizedNum : null,
		bottle_no_sort_text: text,
		bottle_no_sort_key: key
	}
}

function buildBottleNoQueryTokens(value) {
	const key = normalizeBottleNo(value)
	if (!key) return []
	if (/^\d+$/.test(key)) return [key, Number(key)]
	return [key]
}

function loadPayload() {
	const p = path.join(__dirname, 'payload.json')
	const raw = fs.readFileSync(p, 'utf8')
	const data = JSON.parse(raw)
	if (!Array.isArray(data)) throw new Error('payload.json must be an array')
	return data
}

function pickPatch(item) {
	const out = {}
	for (let i = 0; i < UPDATE_FIELDS.length; i += 1) {
		const key = UPDATE_FIELDS[i]
		if (Object.prototype.hasOwnProperty.call(item, key)) out[key] = item[key]
	}
	return out
}

async function removeLegacyBatch() {
	try {
		// Keep cleanup best-effort only; never block update flow.
		const where = { remark: BATCH_REMARK }
		const before = await bottles.where(where).count()
		const removed = await bottles.where(where).remove()
		const after = await bottles.where(where).count()
		return {
			before: Number(before.total || 0),
			after: Number(after.total || 0),
			removed
		}
	} catch (err) {
		return {
			before: 0,
			after: 0,
			removed: null,
			error: err && err.message ? err.message : String(err)
		}
	}
}

async function buildBottleNoMap(payload) {
	const queryTokens = []
	const queryTokenSet = new Set()
	for (let i = 0; i < payload.length; i += 1) {
		const tokens = buildBottleNoQueryTokens(payload[i] && payload[i].bottle_no)
		for (let j = 0; j < tokens.length; j += 1) {
			const token = tokens[j]
			const mapKey = `${typeof token}:${String(token)}`
			if (!queryTokenSet.has(mapKey)) {
				queryTokenSet.add(mapKey)
				queryTokens.push(token)
			}
		}
	}
	if (!queryTokens.length) return new Map()
	const existingList = []
	const chunkSize = 80
	for (let i = 0; i < queryTokens.length; i += chunkSize) {
		const chunk = queryTokens.slice(i, i + chunkSize)
		const res = await bottles.where({ bottle_no: dbCmd.in(chunk) }).limit(500).get()
		const list = (res && res.data) || []
		for (let j = 0; j < list.length; j += 1) existingList.push(list[j])
	}
	const map = new Map()
	for (let i = 0; i < existingList.length; i += 1) {
		const row = existingList[i]
		const bottleNo = normalizeBottleNo(row && row.bottle_no)
		if (!bottleNo) continue
		if (!map.has(bottleNo)) map.set(bottleNo, [])
		map.get(bottleNo).push(row)
	}
	return map
}

function precheckPayload(payload, map) {
	const seenBottleNos = new Set()
	const duplicatedInPayload = []
	const missing = []
	const duplicatedInDb = []
	const invalidBottleNo = []

	for (let i = 0; i < payload.length; i += 1) {
		const row = payload[i] || {}
		const bottleNo = normalizeBottleNo(row.bottle_no)
		if (!bottleNo) {
			invalidBottleNo.push({ index: i + 1, error: 'missing bottle_no' })
			continue
		}

		if (seenBottleNos.has(bottleNo)) {
			duplicatedInPayload.push({ bottle_no: bottleNo, index: i + 1 })
		} else {
			seenBottleNos.add(bottleNo)
		}

		const hits = map.get(bottleNo) || []
		if (hits.length === 0) {
			missing.push(bottleNo)
			continue
		}
		if (hits.length > 1) {
			duplicatedInDb.push({
				bottle_no: bottleNo,
				ids: hits.map((it) => it._id).slice(0, 10)
			})
		}
	}

	return {
		ok: invalidBottleNo.length === 0 && duplicatedInPayload.length === 0 && missing.length === 0 && duplicatedInDb.length === 0,
		invalidBottleNo: invalidBottleNo.slice(0, 30),
		duplicatedInPayload: duplicatedInPayload.slice(0, 30),
		missing: missing.slice(0, 30),
		duplicatedInDb: duplicatedInDb.slice(0, 30)
	}
}

async function upsertByBottleNo(payload) {
	const summary = {
		total: payload.length,
		matched: 0,
		updated: 0,
		missing: [],
		duplicated_bottle_no: [],
		duplicated_in_payload: [],
		aborted: false,
		abort_reason: '',
		backed_up: 0,
		backup_failed: [],
		failed: []
	}

	const map = await buildBottleNoMap(payload)
	const precheck = precheckPayload(payload, map)
	if (!precheck.ok) {
		summary.aborted = true
		summary.abort_reason = 'precheck failed: strict update-only mode, nothing written'
		summary.missing = precheck.missing
		summary.duplicated_bottle_no = precheck.duplicatedInDb
		summary.duplicated_in_payload = precheck.duplicatedInPayload
		summary.failed = precheck.invalidBottleNo
		return summary
	}

	for (let i = 0; i < payload.length; i += 1) {
		const row = payload[i] || {}
		const bottleNo = normalizeBottleNo(row.bottle_no)
		const hits = map.get(bottleNo) || []
		const existing = hits[0]
		summary.matched += 1

		try {
			await backups.add({
				batch_remark: UPDATE_REMARK,
				bottle_no: bottleNo,
				source_collection: 'crm_bottles',
				source_id: existing._id,
				backup_doc: existing,
				backed_up_at: Date.now()
			})
			summary.backed_up += 1
		} catch (err) {
			summary.backup_failed.push({
				bottle_no: bottleNo,
				error: err && err.message ? err.message : String(err)
			})
		}

			const patch = pickPatch(row)
			const sortMeta = buildBottleNoSortMeta(patch.bottle_no || existing.bottle_no)
			Object.assign(patch, sortMeta)
			patch.bottle_check_fee = dbCmd.remove()
			patch.pressure_gauge_check_fee = dbCmd.remove()
			patch.safety_valve_check_fee = dbCmd.remove()
		patch.updated_at = Date.now()
		patch.remark = UPDATE_REMARK

		try {
			await bottles.doc(existing._id).update(patch)
			summary.updated += 1
		} catch (err) {
			summary.failed.push({
				bottle_no: bottleNo,
				_id: existing._id,
				error: err && err.message ? err.message : String(err)
			})
		}
	}

	summary.missing = summary.missing.slice(0, 30)
	summary.duplicated_bottle_no = summary.duplicated_bottle_no.slice(0, 30)
	summary.duplicated_in_payload = summary.duplicated_in_payload.slice(0, 30)
	summary.backup_failed = summary.backup_failed.slice(0, 30)
	summary.failed = summary.failed.slice(0, 30)

	return summary
}

exports.main = async (event = {}) => {
	const startedAt = new Date().toISOString()
	try {
		const user = await getUserByToken(event && event.token)
		if (!user) return { code: 401, msg: '未登录或登录已过期' }
		if (!isSuperAdmin(user)) return { code: 403, msg: '仅超级管理员可执行批量瓶档写入' }
		const payload = loadPayload()
		const rollback = await removeLegacyBatch()
		const upsert = await upsertByBottleNo(payload)
		return {
			code: 0,
			msg: 'ok',
			started_at: startedAt,
			finished_at: new Date().toISOString(),
			payload_total: payload.length,
			rollback,
			upsert
		}
	} catch (err) {
		return {
			code: 500,
			msg: 'crm-bottle-batch-ops failed',
			started_at: startedAt,
			finished_at: new Date().toISOString(),
			error: err && err.message ? err.message : String(err),
			stack: err && err.stack ? String(err.stack).split('\n').slice(0, 8) : []
		}
	}
}
