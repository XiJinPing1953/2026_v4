'use strict'

const crypto = require('crypto')
const { inventoryTon } = require('./gasInventoryPrecisionLocal')
const FIELDS = ['asset_delta_t', 'station_delta_t', 'in_bottle_delta_t']
const SOURCES = { filling: 'crm_fillings', sale: 'crm_sale_records' }
const VERSION = 'gas-precision-20260929-v1'
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
	? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
const hash = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const fail = message => { throw new Error(message) }
const rows = response => {
	if (!Array.isArray(response?.data)) fail('库存精度核对读取不完整')
	return response.data
}
const close = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9

async function preview(db, command, type, ids, build) {
	// Serial reads also work with Alipay's transaction session.
	let sources
	if (type === 'sale') {
		// Production-generated sale IDs resolve through doc(id), but not string _id IN.
		sources = []
		for (const id of ids) {
			const result = await db.collection(SOURCES[type]).doc(id).get()
			const doc = Array.isArray(result?.data) ? result.data[0] : result?.data
			if (doc) {
				if (doc._id !== id) fail('销售源单标识不符')
				sources.push(doc)
			}
		}
	} else {
		sources = rows(await db.collection(SOURCES[type]).where({ _id: command.in(ids) }).limit(100).get())
	}
	const movements = rows(await db.collection('crm_gas_inventory_movements')
		.where({ source_type: type, source_id: command.in(ids) }).limit(100).get())
	if (sources.length !== ids.length) fail(`源单读取不完整：${sources.length}/${ids.length}`)
	if (movements.length >= 100) fail(`库存流水读取达到上限：${movements.length}`)
	const changes = []
	for (const source of sources.sort((a, b) => a._id.localeCompare(b._id))) {
		if (String(source.date) < '2026-08-12' || String(source.date).slice(0, 10) > '2026-09-29') fail('超出本次精度修正账期')
		const expected = build(source)
		const legacy = build(source, true)
		const matches = movements.filter(row => row.source_id === source._id)
		if (!expected && !matches.length) continue
		if (!expected || !legacy || matches.length !== 1) fail('源单库存流水缺失或重复，不能作为取整误差处理')
		const before = matches[0]
		if (before.movement_kind !== expected.movement_kind || before.event_day !== expected.event_day) fail('库存流水归属与源单不符')
		if (FIELDS.every(key => close(before[key], expected[key]))) continue
		if (!FIELDS.every(key => close(before[key], legacy[key]))) fail('库存流水差异并非原取整规则，请单独核实')
		changes.push({ before, after: Object.fromEntries(FIELDS.map(key => [key, expected[key]])) })
	}
	const facts = { version: VERSION, type, ids, sources, movements: movements.sort((a, b) => a._id.localeCompare(b._id)), changes }
	return { ...facts, preview_hash: hash(facts), changed: changes.length,
		station_correction_t: inventoryTon(changes.reduce((sum, row) => sum + row.after.station_delta_t - row.before.station_delta_t, 0)) }
}

async function repair({ db, command, user, data, builders }) {
	if (user?.role !== 'superadmin') return { code: 403, msg: '仅超级管理员可修正库存精度' }
	const type = data.source_type
	const ids = [...new Set(Array.isArray(data.ids) ? data.ids : [])].sort()
	if (!SOURCES[type] || !ids.length || ids.length > 40 || ids.some(id => typeof id !== 'string' || !id)) return { code: 400, msg: '每批须提供1至40个明确源单ID' }
	if (data.execute !== true) return { code: 0, data: await preview(db, command, type, ids, builders[type]) }
	if (data.confirm !== 'REPAIR_INVENTORY_PRECISION' || !/^[a-f0-9]{64}$/.test(data.expected_preview_hash || '')) return { code: 400, msg: '缺少精度修正预览确认' }
	const auditId = 'gp_' + hash({ version: VERSION, type, ids }).slice(0, 28)
	const tx = await db.startTransaction()
	try {
		const existing = await tx.collection('crm_operation_logs').doc(auditId).get()
		const audit = Array.isArray(existing?.data) ? existing.data[0] : existing?.data
		if (audit) {
			if (audit.detail?.preview_hash !== data.expected_preview_hash) fail('批次已执行，不能绑定不同预览')
			await tx.rollback()
			return { code: 0, data: { already_applied: true, audit_id: auditId, changed: audit.detail.changed } }
		}
		const plan = await preview(tx, command, type, ids, builders[type])
		if (plan.preview_hash !== data.expected_preview_hash) fail('源单或库存原值已变化，请重新预览')
		for (const change of plan.changes) {
			await tx.collection('crm_gas_inventory_movements').doc(change.before._id).update(change.after)
		}
		// Full original documents and source versions are committed with the repair.
		await tx.collection('crm_operation_logs').add({ _id: auditId, action: VERSION, user_id: user._id,
			username: user.username, created_at: Date.now(), detail: plan })
		if (data.rollback_test === true) {
			await tx.rollback()
			return { code: 0, data: { rolled_back: true, changed: plan.changed } }
		}
		await tx.commit()
		return { code: 0, data: { applied: true, audit_id: auditId, changed: plan.changed, station_correction_t: plan.station_correction_t } }
	} catch (error) {
		await tx.rollback()
		throw error
	}
}

module.exports = { repair, preview }
