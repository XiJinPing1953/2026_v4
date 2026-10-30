'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')

const sale = (id, net, received = 0, extra = {}) => ({
	_id: id, customer_id: 'c1', customer_name: '测试客户', date: '2026-10-30', created_at: 1, updated_at: 1,
	biz_mode: 'bottle', price_unit: 'kg', settlement_mode: 'sale', unit_price: 8,
	out_items: net > 0 ? [{ net }] : [], back_items: net < 0 ? [{ net: -net }] : [],
	amount_received: received, rounding_amount: 0, payment_status: 'paid', ...extra
})
function fixture() {
	return {
		crm_users: [{ _id: 'user-1', token: 'test', role: 'superadmin' }],
		crm_customers: [{ _id: 'c1', name: '测试客户', default_price_unit: 'kg' }],
		crm_sale_records: [sale('pending', -3), sale('partial', -3, -10), sale('refund', -3, -24),
			sale('offset', -3), sale('mixed', -3, -10), sale('over', -3, -25),
			sale('cent', -3, -23.99), sale('positive', 3, 24)],
		crm_customer_receipts: [
			{ _id: 'offset1', status: 'posted', source_type: 'sale_offset_credit', source_id: 'offset', amount: 24, allocated_amount: 0 },
			{ _id: 'offset2', status: 'posted', source_type: 'sale_offset_credit', source_id: 'mixed', amount: 14, allocated_amount: 14 }
		]
	}
}
const ids = result => Array.from(result.data, row => row._id).sort()

test('negative sale status, filters, summary and pagination use refunds and offset transfers without writes', async () => {
	const tables = fixture(), before = structuredClone(tables), db = makeDb(tables)
	const handler = loadHandler('crm-sale', db)
	const list = async params => {
		const result = await invoke(handler, 'listV2', { page: 1, pageSize: 50, ...params })
		assert.equal(result.code, 0, result.msg)
		return result
	}
	const all = await list({})
	const rows = Object.fromEntries(Array.from(all.data, row => [row._id, row]))
	for (const [id, status, balance] of [
		['pending', 'unpaid', -24], ['partial', 'partial', -14], ['refund', 'paid', 0],
		['offset', 'paid', 0], ['mixed', 'paid', 0], ['over', 'partial', 1], ['cent', 'partial', -0.01]
	]) {
		assert.equal(rows[id].list_negative_sale, true, id)
		assert.equal(rows[id].list_payment_status, status, id)
		assert.equal(rows[id].net_outstanding_effective, balance, id)
		assert.equal(rows[id].payment_status, 'paid', 'original stored status preserved')
	}
	assert.equal(rows.positive.list_payment_status, 'paid')
	assert.equal(all.summary.paid, 4)
	assert.equal(all.summary.refund_outstanding_count, 3)
	assert.equal(all.summary.refund_outstanding_total, 38.01)
	assert.deepEqual(ids(await list({ paymentStatus: 'paid' })), ['mixed', 'offset', 'positive', 'refund'])
	assert.deepEqual(ids(await list({ paymentStatus: 'unpaid' })), ['pending'])
	assert.deepEqual(ids(await list({ paymentStatus: 'partial' })), ['cent', 'over', 'partial'])
	assert.deepEqual(ids(await list({ paymentStatus: 'unsettled' })), ['cent', 'over', 'partial', 'pending'])
	assert.deepEqual(ids(await list({ settlementScope: 'refund_outstanding' })), ['cent', 'partial', 'pending'])
	const page1 = await list({ paymentStatus: 'paid', pageSize: 2, include_summary: false })
	const page2 = await list({ paymentStatus: 'paid', pageSize: 2, page: 2, include_summary: false })
	assert.equal(page1.total, 4); assert.equal(page1.paging.hasMore, true); assert.equal(page2.paging.hasMore, false)
	assert.deepEqual([...ids(page1), ...ids(page2)].sort(), ['mixed', 'offset', 'positive', 'refund'])
	const summary = await list({ paymentStatus: 'paid', summary_only: true })
	assert.equal(summary.total, 4); assert.equal(summary.summary.paid, 4)
	assert.deepEqual(tables, before); assert.deepEqual(db.writes, [])
})

test('incomplete credit reads and unresolved sale ownership never certify a filtered status', async () => {
	const tables = fixture()
	const db = makeDb(tables, { count(name, total) {
		return { total: name === 'crm_customer_receipts' ? total + 1 : total }
	} })
	const result = await invoke(loadHandler('crm-sale', db), 'listV2', { paymentStatus: 'paid', include_summary: false })
	assert.equal(result.code, 409)
	assert.equal(result.error_code, 'FINANCIAL_READ_INCOMPLETE')
	assert.deepEqual(db.writes, [])

	const unknown = fixture()
	unknown.crm_sale_records.push(sale('unknown', 1, 0, { price_unit: 'm3', settlement_mode: '' }))
	const unknownDb = makeDb(unknown)
	const handler = loadHandler('crm-sale', unknownDb)
	const filtered = await invoke(handler, 'listV2', { paymentStatus: 'paid', include_summary: false })
	assert.equal(filtered.code, 409)
	const summary = await invoke(handler, 'listV2', { paymentStatus: 'paid', summary_only: true })
	assert.equal(summary.code, 0)
	assert.equal(summary.summary.accounting_complete, false)
	assert.equal(summary.summary.paid, null)
	assert.deepEqual(unknownDb.writes, [])
})
