const { test } = require('node:test')
const assert = require('node:assert/strict')
const { plan, replaceRefs, PAIRS, expected } = require('../uniCloud-alipay/cloudfunctions/crm-bottle/aliasRepair')
const helpers = { mergeFields: ['qr_code'], merge: (a, b) => ({ qr_code: a.qr_code || b[0].qr_code }), sort: no => ({ bottle_no_sort_text: no }), state: () => ({ status: 'at_customer', current_customer_id: 'customer', current_customer_name: 'name' }) }
function fixture() {
 const tables = { crm_bottles: [], crm_bottle_movements: [], crm_sale_records: [], crm_fillings: [], crm_reg_outbox: [], crm_reg_bottle_current: [] }
 for (const [a, b] of PAIRS) {
  tables.crm_bottles.push({ _id: a, bottle_no: a, qr_code: '' }, { _id: b, bottle_no: b, qr_code: b + '-qr' })
  tables.crm_bottle_movements.push({ _id: a + '-move', bottle_no: a, net_weight: 100, source_id: 'sale', type: 'out' }, { _id: b + '-move', bottle_no: b, net_weight: 101, source_id: 'sale2', type: 'out' })
 }
 tables.crm_sale_records.push({ _id: 'sale', amount: 200, out_items: [{ bottle_no: 'X46', bottle_id: 'X46', net_weight: 100 }], back_items: [{ bottle_no: 'X046', bottle_id: 'X046', net_weight: 50 }] })
 return { tables, absent: [], hash: 'before' }
}
test('preserves both histories and money while keeping padded master ID and registered QR', () => {
 const before = fixture(), p = plan(before, helpers)
 assert.equal(p.conflicts.length, 0); assert.equal(p.writes.filter(x => !x.after).length, 8)
 const master = p.writes.find(x => x.id === 'X046').after
 assert.equal(master.bottle_no, 'X046'); assert.equal(master.qr_code, 'X046-qr'); assert.equal(master._id, 'X046')
 const sale = p.writes.find(x => x.table === 'crm_sale_records').after
 assert.equal(sale.amount, 200); assert.equal(sale.out_items[0].net_weight, 100); assert.equal(sale.back_items[0].net_weight, 50)
 assert.equal(sale.out_items[0].bottle_id, 'X046'); assert.equal(sale.out_items[0].bottle_no, 'X046'); assert.equal(sale.back_items[0].bottle_id, 'X046')
 assert.equal(p.summaries[0].movement_count, 2); assert.equal(before.tables.crm_bottles.length, 16); assert.equal(typeof expected(before, p), 'string')
})
test('conflicting physical identifiers block preparation and missing master blocks plan', () => {
 const before = fixture(); before.tables.crm_bottles[0].qr_code = 'different'; assert.equal(plan(before, helpers).conflicts.length, 1)
 before.tables.crm_bottles.pop(); assert.throws(() => plan(before, helpers), /档案数不符/)
})
test('rewrites only structured identity fields, leaving amounts, notes, and audit text intact', () => {
 const row = { bottle_nos: ['X46', 'X037'], note: 'X46', amount: 10, _id: 'X046', detail: { bottle_id: 'X046' } }
 assert.deepEqual(replaceRefs(row, { X46: 'X046' }, { X046: 'X46' }), { bottle_nos: ['X046', 'X037'], note: 'X46', amount: 10, _id: 'X046', detail: { bottle_id: 'X46' } })
})
