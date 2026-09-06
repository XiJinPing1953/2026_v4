'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { collect } = require('./collectLegacyM3Evidence.cjs')

function client({ changed = false, broken = false } = {}) {
	let details = 0
	const sale = { _id: 's1', price_unit: 'm3', customer_id: 'c1', date: '2026-08-01', flow_volume_m3: 100, unit_price: 10 }
	return { async callFunction(name, { action }) {
		if (name === 'crm-sale' && action === 'listV2') return { code: 0, data: broken ? [] : [sale], total: 1 }
		if (name === 'crm-sale' && action === 'getV2') return { code: 0, data: { ...sale, should_receive: 0, updated_at: changed ? ++details : 1 } }
		if (name === 'crm-customer-settlement' && action === 'listCustomerStatementRowsV1') return { code: 0, data: [{ row_type: 'flow_settlement', row_id: 'f1', biz_date: '2026-08-01', amount: 1000 }], total: 1 }
		throw new Error('Forbidden action ' + name + '.' + action)
	} }
}
const options = { token: 'test', spaceId: 'test', dateFrom: '2026-01-01', dateTo: '2026-09-05', legacyProjection: true }
test('collector excludes calculated sale amounts and does not assert raw-flow or snapshot evidence', async () => {
	const result = await collect({ ...options, client: client() })
	assert.equal(result.sales.length, 1)
	assert.equal(result.sales[0].should_receive, undefined)
	assert.equal(result.evidence.complete, false)
	assert.equal(result.evidence.sales_changed_during_read, false)
	assert.equal(result.evidence.atomic_snapshot, false)
	assert.equal(result.evidence.business_writes, 0)
})
test('collector flags modifications and rejects missing pages instead of making zero totals', async () => {
	assert.equal((await collect({ ...options, client: client({ changed: true }) })).evidence.sales_changed_during_read, true)
	await assert.rejects(collect({ ...options, client: client({ broken: true }) }), /返回条数与总数不一致/)
})

test('raw collector preserves stored amounts and links, double reads and never falls back silently', async () => {
	let rawReads = 0
	const sale = { _id: 's1', customer_id: 'c1', price_unit: 'm3', should_receive: 1000 }
	const rawClient = { async callFunction(name, { action }) {
		if (action === 'listV2') return { code: 0, data: [sale], total: 1 }
		if (action === 'getLegacyM3EvidenceV1') {
			rawReads++
			return { code: 0, data: { source_projection: 'raw_documents', sales: [sale],
				flow_settlements: [{ _id: 'f1', sale_ids: ['s1'], status: 'posted' }] }, financial_evidence: { read_complete: true } }
		}
		throw new Error('Unexpected ' + action)
	} }
	const result = await collect({ ...options, legacyProjection: false, client: rawClient })
	assert.equal(rawReads, 2)
	assert.equal(result.sales[0].should_receive, 1000)
	assert.deepEqual(result.flow_settlements[0].sale_ids, ['s1'])
	assert.equal(result.evidence.complete, false)
	assert.equal(result.evidence.source_changed_between_reads, false)
	await assert.rejects(collect({ ...options, legacyProjection: false, client: client() }), /Forbidden action/)
})
