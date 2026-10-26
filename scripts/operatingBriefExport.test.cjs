'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const exporter = {}
vm.runInNewContext(fs.readFileSync('src/components/domain/dashboard/exportDailyReportWorkbook.js', 'utf8').replace(/^export /gm, '') +
  '\nthis.build = buildDailyReportWorkbookXml;', exporter)
const sale = (id, customerId, net, extra = {}) => ({ _id: id, customer_id: customerId, customer_name: '同名客户', date: today,
  biz_mode: 'bottle', price_unit: 'kg', settlement_mode: 'sale', unit_price: 10, out_items: net >= 0 ? [{ net }] : [],
  back_items: net < 0 ? [{ net: -net }] : [], amount_received: 0, rounding_amount: 0, receipt_rounding_amount: 0,
  payment_status: 'unpaid', created_at: 1, updated_at: 1, ...extra })
function fixture() {
  return { crm_users: [{ _id: 'user-1', role: 'superadmin', token: 'test' }],
    crm_customers: [{ _id: 'a', name: '同名客户', default_price_unit: 'kg' }, { _id: 'b', name: '同名客户', default_price_unit: 'kg' }],
    crm_sale_records: [sale('tiny-1', 'a', 0.005, { unit_price: 100 }), sale('tiny-2', 'a', 0.005, { unit_price: 100 }),
      sale('rounded', 'a', 10, { rounding_amount: 5, amount_received: 40, receipt_rounding_amount: 2 }),
      sale('negative', 'b', -5, { amount_received: -10 }),
      sale('void-unclassified', 'a', 99, { status: 'void', settlement_mode: '', price_unit: 'm3' })],
    crm_customer_receipts: [{ _id: 'offset', customer_id: 'b', source_type: 'sale_offset_credit', entry_kind: 'offset_credit',
      source_id: 'negative', status: 'posted', amount: 30, allocated_amount: 20, unallocated_amount: 10, created_at: 1, updated_at: 1 }],
    crm_customer_flow_settlements: [], crm_customer_allocations: [], crm_cashier_intakes: [], crm_fillings: [] }
}
function summaryRow(row) {
  return { date: row.date, fillBottleCount: row.fill_bottle_count, fillBottleWeightKg: row.fill_bottle_weight,
    localCount: row.local_count, localWeightKg: row.local_weight, vehicleCount: row.vehicle_count, vehicleWeightKg: row.vehicle_weight,
    saleCustomerCount: row.sale_customer_count, saleBottleCount: row.sale_bottle_count, saleWeightKg: row.sale_weight,
    otherCount: row.other_count, otherWeightKg: row.other_weight }
}
async function prepared(tables = fixture()) {
  const before = structuredClone(tables), db = makeDb(tables)
  const daily = await invoke(loadHandler('crm-dashboard', db), 'summaryV1', { section: 'daily_report', date_start: today, date_end: today })
  assert.equal(daily.code, 0, daily.msg)
  const sales = await invoke(loadHandler('crm-sale', db), 'listV2', { dateStart: today, dateEnd: today, include_summary: false, page: 1, pageSize: 50 })
  assert.equal(sales.code, 0, sales.msg)
  const weights = new Map(daily.data.sale_weights.map(row => [row.source_id, row.weight_kg]))
  const ids = new Set(daily.data.sale_ids)
  const rows = sales.data.filter(row => ids.has(row._id)).map(row => ({ ...row, operating_weight_kg: weights.get(row._id) }))
  assert.deepEqual(tables, before); assert.deepEqual(db.writes, [])
  return { daily: daily.data, rawRows: sales.data, payload: { summaryRows: daily.data.daily_report.rows.map(summaryRow), salesRows: rows, periodLabel: today } }
}
const decode = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
function sheets(xml) {
  return [...xml.matchAll(/<Worksheet ss:Name="([^"]*)">([\s\S]*?)<\/Worksheet>/g)].map(([, name, body]) => ({ name: decode(name),
    rows: [...body.matchAll(/<Row>([\s\S]*?)<\/Row>/g)].map(([, row]) => [...row.matchAll(/<Cell[^>]*><Data ss:Type="(Number|String)">([\s\S]*?)<\/Data><\/Cell>/g)]
      .map(([, type, value]) => type === 'Number' ? Number(value) : decode(value))) }))
}

test('actual daily and sale handlers provide matching effective sources and canonical per-sale net weights', async () => {
  const { daily, rawRows, payload } = await prepared()
  assert.deepEqual([...daily.sale_ids].sort(), ['negative', 'rounded', 'tiny-1', 'tiny-2'])
  assert.deepEqual(daily.sale_weights.map(row => row.source_id).sort(), [...daily.sale_ids].sort())
  assert.equal(daily.export_evidence.complete, true)
  assert.equal(rawRows.find(row => row._id === 'tiny-1').total_net_weight, 0.005)
  assert.equal(daily.daily_report.rows[0].sale_weight, 5.02)
  const xml = exporter.build(payload), dailySheet = sheets(xml).find(sheet => sheet.name === '按日分项')
  const source = id => dailySheet.rows.find(row => row[11] === id)
  assert.equal(source('tiny-1')[2], 0.01); assert.equal(source('tiny-2')[2], 0.01)
  assert.equal(dailySheet.rows.find(row => row[0] === '当日汇总')[2], 5.02)
  assert.ok(!xml.includes('void-unclassified'))
})
test('workbook consumes authoritative rounding and negative offset balances without relabeling allocated money as cash', async () => {
  const { payload } = await prepared(), xml = exporter.build(payload), dailySheet = sheets(xml).find(sheet => sheet.name === '按日分项')
  const row = dailySheet.rows.find(row => row[11] === 'rounded')
  assert.deepEqual(row.slice(5, 11), [100, '未付款', 40, 5, 2, 53])
  const negative = dailySheet.rows.find(row => row[11] === 'negative')
  assert.equal(negative[5], -50); assert.equal(negative[7], -10); assert.equal(negative[10], -10)
  assert.match(xml, /含非现金抵款/); assert.match(xml, /不代表期间现金收入/)
  assert.match(xml, /负数表示待退或待抵余额/)
  assert.doesNotMatch(xml, /<Data ss:Type="String">(?:实收|已付|未付|未收)<\/Data>/)
  assert.match(xml, /<NumberFormat ss:Format="0\.000"\/>/)
  assert.match(xml, /<Cell ss:StyleID="Decimal3"><Data ss:Type="Number">0<\/Data><\/Cell>/)
  assert.doesNotMatch(xml, /<Data ss:Type="Number"><\/Data>/)
})
test('same-name customers remain separate worksheets keyed by the existing customer ID', async () => {
  const { payload } = await prepared(), parsed = sheets(exporter.build(payload))
  const a = parsed.find(sheet => sheet.name === '同名客户 a'), b = parsed.find(sheet => sheet.name === '同名客户 b')
  assert.ok(a); assert.ok(b)
  assert.match(a.rows[1][0], /客户ID：a/); assert.match(b.rows[1][0], /客户ID：b/)
  assert.equal(a.rows.filter(row => ['tiny-1', 'tiny-2', 'rounded'].includes(row[10])).length, 3)
  assert.equal(b.rows.filter(row => row[10] === 'negative').length, 1)
  assert.ok(!a.rows.some(row => row[10] === 'negative'))
})
test('missing authoritative weight or outstanding never exports an invented zero, while real zero is retained', async () => {
  const { payload } = await prepared()
  for (const key of ['operating_weight_kg', 'net_outstanding_effective']) for (const value of [undefined, null, '', NaN]) {
    const invalid = structuredClone(payload); invalid.salesRows[0][key] = value
    assert.throws(() => exporter.build(invalid), /尚未取得权威数值/)
  }
  const mismatch = structuredClone(payload); mismatch.salesRows[0].operating_weight_kg += 1
  assert.throws(() => exporter.build(mismatch), /净气量不一致/)
  const duplicate = structuredClone(payload); duplicate.salesRows.push(duplicate.salesRows[0])
  assert.throws(() => exporter.build(duplicate), /销售来源/)
})
test('physical daily report remains readable with absent pricing but cannot certify a financial export', async () => {
  const tables = fixture(); tables.crm_sale_records.find(row => row._id === 'rounded').unit_price = null
  const { daily } = await prepared(tables)
  assert.equal(daily.complete, true); assert.equal(daily.daily_report.rows[0].sale_weight, 5.02)
  assert.equal(daily.export_evidence.complete, false)
  assert.ok(daily.export_evidence.issues.some(row => row.field === 'unit_price'))
})
test('customer-flow delivery with absent unit price retains physical weight and does not become sale revenue', async () => {
  const tables = fixture(); tables.crm_sale_records = [sale('flow-delivery', 'a', 3.125, { settlement_mode: 'customer_flow', price_unit: 'm3', unit_price: null })]
  const { daily, payload } = await prepared(tables)
  assert.equal(daily.export_evidence.complete, true)
  const dailySheet = sheets(exporter.build(payload)).find(sheet => sheet.name === '按日分项'), row = dailySheet.rows.find(row => row[11] === 'flow-delivery')
  assert.equal(row[2], 3.13); assert.equal(row[4], '-'); assert.equal(row[5], 0)
})
