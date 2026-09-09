'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')

test('period summaries use each requested customer across billing modes and all three interfaces', async () => {
	const cases = [
		{ id: 'weight-customer', unit: 'kg', revenue: 90, sale: { unit_price: 5, out_items: [{ net: 20 }], back_items: [{ net: 2 }] } },
		{ id: 'bottle-customer', unit: 'bottle', revenue: 93, sale: { unit_price: 31, out_items: [{}, {}, {}] } },
		{ id: 'truck-customer', unit: 'kg', revenue: 80, sale: { biz_mode: 'truck', truck_sale_net: 40, unit_price: 2 } },
		{ id: 'agent-customer', unit: 'kg', revenue: 28, sale: { biz_mode: 'agent_sale', agent_sale_items: [{ fill_weight: 4 }], unit_price: 7 } },
		{ id: 'meter-sale-customer', unit: 'm3', revenue: 7.5, sale: { unit_price: 3, flow_volume_m3: 2.5 } },
		{ id: 'flow-customer', unit: 'm3', revenue: 123.456, sale: { settlement_mode: 'customer_flow', unit_price: 5, flow_volume_m3: 500 }, flow: 123.456 }
	]
	const tables = { crm_users: [{ _id: 'user-1', token: 'test', role: 'superadmin' }], crm_customers: [],
		crm_sale_records: [], crm_customer_flow_settlements: [], crm_customer_opening_debts: [], crm_customer_receipts: [], crm_customer_allocations: [] }
	for (const [i, c] of cases.entries()) {
		const base = { customer_id: c.id, status: 'posted', created_at: 1, updated_at: 1 }
		c.scale = c.unit === 'm3' ? 3 : 2
		c.historical = c.scale === 3 ? 10.234 : 10.23
		c.cash = 35 + i
		tables.crm_customers.push({ _id: c.id, name: c.id, default_price_unit: c.unit })
		tables.crm_sale_records.push({ ...base, _id: c.id + '-sale', date: '2026-02-01', biz_mode: 'bottle',
			price_unit: c.unit, settlement_mode: 'sale', amount_received: 0, ...c.sale })
		if (c.flow) tables.crm_customer_flow_settlements.push({ ...base, _id: c.id + '-flow', biz_date: '2026-02-01', should_receive: c.flow, amount_received: 0 })
		tables.crm_customer_opening_debts.push({ ...base, _id: c.id + '-debt', source_type: 'opening', biz_date: '2025-12-31',
			amount: c.historical, amount_received: c.historical, money_scale: c.scale })
		for (let part = 0; part < 2; part++) {
			const allocated = part === 0 ? 5 : Number((c.historical - 5).toFixed(c.scale))
			const amount = part === 0 ? 5 : c.cash - 5
			tables.crm_customer_receipts.push({ ...base, _id: c.id + '-receipt-' + part, biz_date: '2026-01-10',
				amount, allocated_amount: allocated, unallocated_amount: Number((amount - allocated).toFixed(c.scale)) })
			tables.crm_customer_allocations.push({ ...base, _id: c.id + '-allocation-' + part, receipt_id: c.id + '-receipt-' + part,
				target_type: 'opening_debt', target_id: c.id + '-debt', allocate_kind: 'receipt', allocate_amount: allocated, biz_date: '2026-08-01' })
		}
	}
	tables.crm_customers.push({ _id: 'empty-customer', name: 'empty-customer', default_price_unit: 'kg' })
	cases.push({ id: 'empty-customer', scale: 2, revenue: 0, historical: 0, cash: 0 })
	const before = structuredClone(tables), db = makeDb(tables), handler = loadHandler('crm-customer-settlement', db)
	for (const c of cases) {
		for (const from of ['2026-01-01', '2025-12-01']) {
			for (const action of ['getCustomerStatementV1', 'exportCustomerStatementV1', 'exportCustomerAccountingLedgerV1']) {
				const r = await invoke(handler, action, { customer_id: c.id, date_from: from, date_to: '2026-09-08', summary_only: true })
				assert.equal(r.code, 0, c.id + ': ' + r.msg)
				const p = r.data.period_summary
				assert.equal(p.complete, true, c.id + ': ' + JSON.stringify(p.unresolved_sources))
				assert.equal(p.money_scale, c.scale)
				assert.equal(p.business_revenue, c.revenue, c.id)
				const history = from === '2025-12-01' ? c.historical : 0
				assert.equal(p.historical_receivable, history, c.id)
				assert.equal(p.receivable_total, Number((c.revenue + history).toFixed(c.scale)), c.id)
				assert.equal(p.cash_received, c.cash, c.id)
				assert.equal(p.historical_debt_collected, c.historical, c.id)
				assert.equal(p.refund_total, 0); assert.equal(p.net_cash_received, c.cash)
			}
		}
	}
	assert.equal(db.writes.length, 0)
	assert.deepEqual(tables, before)
})
