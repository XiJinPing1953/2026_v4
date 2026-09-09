'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

test('sales list cached payload restores its own completeness warning when filters change', () => {
	const source = fs.readFileSync('src/components/domain/sale/SaleListView.vue', 'utf8')
	const code = source.slice(source.indexOf('function applyResult(payload)'), source.indexOf('\nasync function onSearch(', source.indexOf('function applyResult(payload)')))
	const context = vm.createContext({ list: { value: [] }, pager: {}, financialIssue: { value: '' }, summary: { value: {} },
		toNumber: (value, fallback) => value == null ? fallback : Number(value) })
	vm.runInContext(code, context)
	const incomplete = { items: [], summary: { accounting_complete: false, unresolved_count: 38 } }
	context.applyResult(incomplete)
	assert.match(context.financialIssue.value, /38/)
	context.applyResult({ items: [], summary: { accounting_complete: true } })
	assert.equal(context.financialIssue.value, '')
	context.applyResult(incomplete)
	assert.match(context.financialIssue.value, /38/)
})

test('sales export rejects a missing, duplicated or changing page instead of exporting a partial ledger', async () => {
	const source = fs.readFileSync('src/components/domain/sale/SaleListView.vue', 'utf8')
	const code = source.slice(source.indexOf('async function fetchAllRowsForExport()'), source.indexOf('\nfunction compareSaleRows('))
	const page = (id, total, hasMore) => ({ code: 0, data: id ? [{ _id: id }] : [], paging: { total, hasMore } })
	async function run(pages) {
		const context = vm.createContext({ listSalesV2: async () => pages.shift(), buildListParams: () => ({}) })
		vm.runInContext(code, context)
		return context.fetchAllRowsForExport()
	}
	assert.equal((await run([page('s1', 2, true), page('s2', 2, false)])).length, 2)
	await assert.rejects(run([page('s1', 2, true), page(null, 2, false)]), /未完成/)
	await assert.rejects(run([page('s1', 2, true), page('s1', 2, false)]), /重复/)
	await assert.rejects(run([page('s1', 2, true), page('s2', 3, false)]), /发生变化/)
})
