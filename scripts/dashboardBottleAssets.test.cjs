const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')

function setup() {
	const rows = []
	for (const status of ['at_customer', 'in_station']) {
		for (const bottle_no of ['1', 'X41', 'X047', 'Y001', 'TRUCK-9335Z', 'truck-lower', '000', '0', '00', 'PDA-SCALE-B001', 'pda-scale-b004']) {
			rows.push({ _id: `${status}-${bottle_no}`, bottle_no, status, is_active: true })
		}
		rows.push({ _id: `${status}-inactive`, bottle_no: 'X47', status, is_active: false })
		rows.push({ _id: `${status}-test-type`, bottle_no: '900', status, is_active: true, equipment_type: '测试气瓶' })
		rows.push({ _id: `${status}-missing-active`, bottle_no: '901', status })
	}
	rows.push({ _id: 'unknown', bottle_no: 'X001', status: 'unknown', is_active: true })
	rows.push({ _id: 'hidden', bottle_no: '99', status: 'at_customer', is_active: true, current_customer_id: 'hidden' })
	const tables = {
		crm_users: [{ _id: 'admin', role: 'superadmin', token: 'test' }],
		crm_customers: [{ _id: 'hidden', name: '隐藏客户', is_hidden: true }],
		crm_bottles: rows
	}
	const db = makeDb(tables)
	return { tables, db, main: loadHandler('crm-dashboard', db) }
}

for (const section of ['quick', 'full']) {
	test(`${section}: actual active assets only, preserves real letter numbers and customer visibility`, async () => {
		const { main, db } = setup()
		const r = await invoke(main, 'summaryV1', section === 'quick' ? { section } : { days: 3 })
		assert.equal(r.code, 0, r.msg)
		assert.equal(r.data.kpi.at_customer, 4)
		assert.equal(r.data.kpi.in_station, 4)
		assert.equal(db.writes.filter(w => w.name !== 'crm_operation_logs').length, 0)
	})
}

test('counts follow activation and movement instead of a fixed total', async () => {
	const { main, tables } = setup()
	const bottle = tables.crm_bottles.find(b => b._id === 'at_customer-1')
	bottle.status = 'in_station'
	let r = await invoke(main, 'summaryV1', { section: 'quick' })
	assert.equal(r.data.kpi.at_customer, 3)
	assert.equal(r.data.kpi.in_station, 5)
	bottle.is_active = false
	r = await invoke(main, 'summaryV1', { section: 'quick' })
	assert.equal(r.data.kpi.in_station, 4)
	bottle.is_active = true
	r = await invoke(main, 'summaryV1', { section: 'quick' })
	assert.equal(r.data.kpi.in_station, 5)
})
