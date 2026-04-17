'use strict'

const fs = require('fs')
const path = require('path')

const db = uniCloud.database()
const dbCmd = db.command
const vehicles = db.collection('crm_vehicles')

const TARGET_PLATE = '冀A406RB'
const TARGET_ID = '69bdedb57ae708ce6d86e636'

function s(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizePlate(value) {
	return s(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeId(raw) {
	if (raw == null) return ''
	if (typeof raw === 'string') return s(raw)
	if (typeof raw === 'object') {
		if (raw.$oid) return s(raw.$oid)
		if (raw.oid) return s(raw.oid)
		if (raw.id) return s(raw.id)
		if (raw._id) return s(raw._id)
	}
	return s(raw)
}

function normalizeStatusToActive(status) {
	const text = s(status)
	if (!text) return true
	if (text === '在用' || text.toLowerCase() === 'active') return true
	if (text === '停用' || text.toLowerCase() === 'inactive') return false
	return true
}

function uniqKeyByPlate(plate) {
	return normalizePlate(plate)
}

function readPayloadRows() {
	const p = path.join(__dirname, 'payload.ndjson')
	const raw = fs.readFileSync(p, 'utf8')
	const lines = raw.split(/\r?\n/)
	const rows = []
	for (let i = 0; i < lines.length; i += 1) {
		const line = s(lines[i])
		if (!line) continue
		rows.push(JSON.parse(line))
	}
	return rows
}

async function getById(id) {
	if (!id) return null
	const res = await vehicles.doc(id).get()
	return (res.data && res.data[0]) || null
}

async function getByPlate(plate) {
	if (!plate) return []
	const res = await vehicles.where({ plate_no: plate }).limit(10).get()
	return Array.isArray(res.data) ? res.data : []
}

async function upsertRow(row) {
	const legacyId = normalizeId(row && row._id)
	const plateNo = normalizePlate(row && row.plate_no)
	if (!legacyId || !plateNo) {
		return {
			ok: false,
			status: 'invalid',
			legacy_id: legacyId,
			plate_no: plateNo,
			msg: 'missing legacy _id or plate_no'
		}
	}

	const now = Date.now()
	const doc = {
		_id: legacyId,
		uniq_key: uniqKeyByPlate(plateNo),
		plate_no: plateNo,
		remark: s(row && row.remark),
		is_active: normalizeStatusToActive(row && row.status),
		created_at: Number(row && row.created_at) || now,
		updated_at: Number(row && row.updated_at) || now
	}

	const byId = await getById(legacyId)
	if (byId) {
		await vehicles.doc(legacyId).update({
			uniq_key: doc.uniq_key,
			plate_no: doc.plate_no,
			remark: doc.remark,
			is_active: doc.is_active,
			updated_at: doc.updated_at
		})
		return {
			ok: true,
			status: 'updated',
			legacy_id: legacyId,
			plate_no: plateNo
		}
	}

	const samePlateRows = await getByPlate(plateNo)
	const diffIdRows = samePlateRows.filter((item) => normalizeId(item && item._id) !== legacyId)
	if (diffIdRows.length) {
		return {
			ok: false,
			status: 'plate_conflict',
			legacy_id: legacyId,
			plate_no: plateNo,
			conflict_ids: diffIdRows.map((item) => normalizeId(item && item._id)).filter(Boolean)
		}
	}

	await vehicles.add(doc)
	return {
		ok: true,
		status: 'created',
		legacy_id: legacyId,
		plate_no: plateNo
	}
}

exports.main = async () => {
	const startedAt = Date.now()
	const payloadRows = readPayloadRows()
	const report = {
		code: 0,
		msg: 'ok',
		started_at: new Date(startedAt).toISOString(),
		payload_total: payloadRows.length,
		created: 0,
		updated: 0,
		invalid: 0,
		plate_conflict: 0,
		failed: 0,
		details: []
	}

	for (let i = 0; i < payloadRows.length; i += 1) {
		const row = payloadRows[i]
		try {
			const item = await upsertRow(row)
			report.details.push(item)
			if (item.status === 'created') report.created += 1
			else if (item.status === 'updated') report.updated += 1
			else if (item.status === 'invalid') report.invalid += 1
			else if (item.status === 'plate_conflict') report.plate_conflict += 1
			else if (!item.ok) report.failed += 1
		} catch (err) {
			report.failed += 1
			report.details.push({
				ok: false,
				status: 'error',
				legacy_id: normalizeId(row && row._id),
				plate_no: normalizePlate(row && row.plate_no),
				msg: err && err.message ? err.message : String(err)
			})
		}
	}

	let targetRow = null
	try {
		const target = await vehicles.doc(TARGET_ID).get()
		targetRow = (target.data && target.data[0]) || null
	} catch (_) {
		targetRow = null
	}

	report.target_check = {
		target_plate: TARGET_PLATE,
		target_id: TARGET_ID,
		found: Boolean(targetRow),
		plate_no: targetRow ? normalizePlate(targetRow.plate_no) : '',
		is_active: targetRow ? Boolean(targetRow.is_active) : null
	}

	report.finished_at = new Date().toISOString()
	report.duration_ms = Date.now() - startedAt
	report.details_preview = report.details.slice(0, 40)
	delete report.details
	return report
}
