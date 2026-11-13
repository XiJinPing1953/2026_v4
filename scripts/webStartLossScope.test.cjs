'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { webStartLossDateFrom } = require('../uniCloud-alipay/cloudfunctions/crm-sale/webStartLossScope')
const { normalizeStartLossDateFrom, isInStartLossScope } = require('../uniCloud-alipay/cloudfunctions/crm-filling/startLossScope')

const backs = (doc) => (doc.back_items || []).map((item) => item.bottle_no)
const fillDate = (value, createdAt) => {
	const text = value == null ? '' : String(value).trim()
	if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
	const m = text.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
	if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
	return createdAt ? new Date(createdAt).toISOString().slice(0, 10) : ''
}

test('新建网页销售以本单日期为补算下界', () => {
	assert.equal(webStartLossDateFrom([null, { date: '2026-11-09', back_items: [{ bottle_no: '25' }] }], backs), '2026-11-09')
})

test('修改销售取新旧版本中较早的回瓶日期，旧版无回瓶不影响下界', () => {
	const after = { date: '2026-11-09', back_items: [{ bottle_no: '25' }] }
	assert.equal(webStartLossDateFrom([{ date: '2026-10-20', back_items: [{ bottle_no: '25' }] }, after], backs), '2026-10-20')
	assert.equal(webStartLossDateFrom([{ date: '2026-10-20', back_items: [] }, after], backs), '2026-11-09')
	// 改单移除回瓶：旧版本仍带回瓶，必须以旧日期为界
	assert.equal(webStartLossDateFrom([{ date: '2026-11-01', back_items: [{ bottle_no: '25' }] }, { date: '2026-11-09', back_items: [] }], backs), '2026-11-01')
})

test('日期缺失或格式不明时不设下界，退回原完整补算', () => {
	assert.equal(webStartLossDateFrom([null, { date: '2026/11/09', back_items: [{ bottle_no: '25' }] }], backs), '')
	assert.equal(webStartLossDateFrom([{ back_items: [{ bottle_no: '25' }] }, { date: '2026-11-09', back_items: [{ bottle_no: '25' }] }], backs), '')
	assert.equal(webStartLossDateFrom([null, { date: '2026-11-09', back_items: [] }], backs), '')
})

test('灌装端只接受 YYYY-MM-DD 下界', () => {
	assert.equal(normalizeStartLossDateFrom(' 2026-11-09 '), '2026-11-09')
	for (const bad of ['', null, undefined, '2026/11/09', '20261109', 1793590218813, '2026-11-09 10:00']) {
		assert.equal(normalizeStartLossDateFrom(bad), '')
	}
})

test('同日及之后的灌装在范围内，更早的灌装不重算；日期不明的保留', () => {
	const dateFrom = '2026-11-09'
	const rows = [
		{ _id: 'a', date: '2026-11-08' },
		{ _id: 'b', date: '2026-11-09' },
		{ _id: 'c', date: '2026-11-12' },
		{ _id: 'd', date: '2026/11/10' },
		{ _id: 'e', date: '', created_at: Date.parse('2026-08-01T00:00:00Z') },
		{ _id: 'f', date: '', created_at: Date.parse('2026-11-10T00:00:00Z') },
		{ _id: 'g' }
	]
	const kept = rows.filter((row) => isInStartLossScope(row, dateFrom, fillDate)).map((row) => row._id)
	assert.deepEqual(kept, ['b', 'c', 'd', 'f', 'g'])
	assert.equal(rows.every((row) => isInStartLossScope(row, '', fillDate)), true)
})

test('下界与上秤差依据规则一致：早于销售日的灌装不会以该销售为依据', () => {
	// 依据 = 同瓶、日期 <= 灌装日 的最近回瓶。销售日 D 的回瓶只能成为 >= D 灌装的依据。
	const returns = [{ id: 'old', date: '2026-10-01' }, { id: 'new', date: '2026-11-09' }]
	const basisFor = (fillDay, list) => list.filter((r) => r.date <= fillDay).sort((x, y) => (x.date < y.date ? 1 : -1))[0]?.id
	for (const fillDay of ['2026-10-15', '2026-11-08', '2026-11-09', '2026-11-20']) {
		const changed = basisFor(fillDay, returns) !== basisFor(fillDay, returns.filter((r) => r.id !== 'new'))
		assert.equal(changed, isInStartLossScope({ date: fillDay }, '2026-11-09', fillDate))
	}
})
