'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	fetchRowsByKeysPaginated
} = require('../uniCloud-alipay/cloudfunctions/crm-filling/flowWarningPaging')
const {
	inspectOperatorRepairRows
} = require('../uniCloud-alipay/cloudfunctions/crm-filling/operatorRepairSupport')

function makeRows(key, total, options = {}) {
	return Array.from({ length: total }, (_, index) => ({
		_id: `${key}-${index + 1}`,
		bottle_no: key,
		type: options.lastType && index === total - 1 ? options.lastType : 'fill',
		source_type: options.excludeIndex === index ? 'filling' : 'sale',
		source_id: options.excludeIndex === index ? options.excludeId : `${key}-source-${index + 1}`,
		created_at: index + 1
	}))
}

test('分页读取完整保留 53 瓶共 5189 条历史和最后回瓶事件', async () => {
	const keys = Array.from({ length: 53 }, (_, index) => String(index + 1))
	const source = new Map()
	let remaining = 5189
	for (let index = 0; index < keys.length; index += 1) {
		const leftKeys = keys.length - index
		const count = index === keys.length - 1 ? remaining : Math.floor(remaining / leftKeys)
		remaining -= count
		source.set(keys[index], makeRows(keys[index], count, { lastType: 'back' }))
	}

	let active = 0
	let maxActive = 0
	const rows = await fetchRowsByKeysPaginated({
		keys,
		pageSize: 500,
		concurrency: 10,
		fetchPage: async ({ key, skip, limit }) => {
			active += 1
			maxActive = Math.max(maxActive, active)
			await Promise.resolve()
			const page = source.get(key).slice(skip, skip + limit)
			active -= 1
			return page
		}
	})

	assert.equal(rows.length, 5189)
	assert.ok(maxActive <= 10)
	for (const key of keys) {
		const bottleRows = rows.filter((row) => row.bottle_no === key)
		assert.equal(bottleRows.at(-1).type, 'back')
	}
})

test('分页边界覆盖 500 和 5000 条且不会静默截断', async () => {
	for (const total of [500, 5000]) {
		const source = makeRows('192', total, { lastType: 'back' })
		let calls = 0
		const rows = await fetchRowsByKeysPaginated({
			keys: ['192'],
			pageSize: 500,
			fetchPage: async ({ skip, limit }) => {
				calls += 1
				return source.slice(skip, skip + limit)
			}
		})
		assert.equal(rows.length, total)
		assert.equal(rows.at(-1).type, 'back')
		assert.equal(calls, total / 500 + 1)
	}
})

test('分页读取保留真实最后出瓶并支持排除当前灌装记录', async () => {
	const source = [
		...makeRows('9', 501, { lastType: 'out' }),
		{
			_id: 'current-fill-row',
			bottle_no: '9',
			type: 'fill',
			source_type: 'filling',
			source_id: 'fill-to-exclude',
			created_at: 9999
		}
	]
	const rows = await fetchRowsByKeysPaginated({
		keys: ['9'],
		pageSize: 500,
		fetchPage: async ({ skip, limit }) => source.slice(skip, skip + limit),
		includeRow: (row) => row.source_id !== 'fill-to-exclude'
	})
	assert.equal(rows.length, 501)
	assert.equal(rows.at(-1).type, 'out')
})

test('任一分页失败时返回明确的不完整历史错误', async () => {
	await assert.rejects(
		fetchRowsByKeysPaginated({
			keys: ['59'],
			pageSize: 500,
			fetchPage: async () => {
				throw new Error('database timeout')
			}
		}),
		(err) => err && err.code === 'BOTTLE_FLOW_HISTORY_INCOMPLETE' && /59/.test(err.message)
	)
})

function buildOperatorRows(count = 53) {
	return Array.from({ length: count }, (_, index) => ({
		_id: `fill-${index + 1}`,
		bottle_no: String(index + 1),
		date: '2026-08-31',
		operator: '齐根恒',
		operator_id: 'old-operator-id',
		fill_weight: 60 + index,
		weight_start: 100 + index,
		weight_end: 160 + index,
		actual_net_weight: 60,
		remark: `remark-${index + 1}`,
		created_by: 'superadmin-id',
		created_by_name: 'superadmin',
		created_at: 1000 + index,
		updated_at: 2000 + index
	}))
}

function buildOperatorPayload(rows) {
	return {
		ids: rows.map((row) => row._id),
		expected_date: '2026-08-31',
		expected_operator: '齐根恒',
		operator: '郭增杰',
		operator_id: '695b0d374b92471a5092a49c'
	}
}

test('录入员修正预检严格命中 53 条并保留审计字段快照', () => {
	const rows = buildOperatorRows()
	const result = inspectOperatorRepairRows(rows, buildOperatorPayload(rows))
	assert.equal(result.ready, true)
	assert.equal(result.target_total, 53)
	assert.equal(result.matched_total, 53)
	assert.equal(result.mismatch_total, 0)
	assert.equal(result.items[0].created_by_name, 'superadmin')
	assert.equal(result.items[0].remark, 'remark-1')
})

test('录入员修正遇到缺失、日期变化、原录入员变化或重复执行时拒绝', () => {
	const baseRows = buildOperatorRows(4)
	const payload = buildOperatorPayload(baseRows)
	const changedRows = baseRows.slice(0, 3).map((row) => ({ ...row }))
	changedRows[0].date = '2026-09-01'
	changedRows[1].operator = '其他录入员'
	changedRows[2].operator = '郭增杰'
	changedRows[2].operator_id = payload.operator_id
	const result = inspectOperatorRepairRows(changedRows, payload)
	assert.equal(result.ready, false)
	assert.equal(result.mismatch_total, 4)
	assert.match(result.mismatch_items[0].error, /日期/)
	assert.match(result.mismatch_items[1].error, /录入员/)
	assert.match(result.mismatch_items[2].error, /录入员/)
	assert.equal(result.mismatch_items[3].error, '记录不存在')
})
