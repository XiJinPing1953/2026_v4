'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
function internals() {
  const filename = path.resolve(__dirname, '../uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js')
  const context = { exports: {}, require: createRequire(filename), uniCloud: { database: () => ({ collection: () => ({}), command: {} }) }, console, Date, Set, Map, Buffer, process }
  const names = ['sumMoneyByScale', 'sumAccountingMovements', 'buildAccountingAllocationBackedMap', 'pushAccountingTargetReceivedFallback', 'buildAccountingDisplayRows', 'normalizePaymentMethod']
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + `\nexports.test = { ${names.join(',')} };`, context, { filename })
  return context.exports.test
}
const ledger = internals()
test('split allocation cannot create an extra cash receipt', () => {
  const rows = [0.018, 0.002].map(amount => ({ target_type: 'other_fee', target_id: 'tail', allocate_kind: 'receipt', allocate_amount: amount }))
  const backed = ledger.buildAccountingAllocationBackedMap(rows, 3)
  assert.equal(backed.get('other_fee:tail').receipt, 0.02)
  const movements = []
  ledger.pushAccountingTargetReceivedFallback(movements, { target_type: 'other_fee', target_id: 'tail', amount_received: 0.02, biz_date: '2026-01-01' }, backed, 3)
  assert.equal(movements.length, 0)
})
test('running balance, month and year totals close with exact decimal arithmetic', () => {
  const rows = [{ biz_date: '2026-01-01', debit: 14042.28, credit: 0 }, { biz_date: '2026-02-01', debit: 0, credit: 14042.65 }]
  const result = ledger.buildAccountingDisplayRows(rows, 0.37, 3)
  assert.equal(result.rows.at(-1).balance, 0)
  assert.equal(result.display_rows.at(-1).credit, 14042.65)
  assert.equal(ledger.sumMoneyByScale([0.018, 0.002, -0.02], 3), 0)
  assert.equal(ledger.sumMoneyByScale([0.1, 0.2], 2), 0.3)
})
test('actual payment totals stay exact; no bank method is invented for unknown channels', () => {
  const rows = [85971.5, 64517.95, 14042.65].map(credit => ({ debit: 0, credit }))
  assert.equal(ledger.sumAccountingMovements(rows, 3).credit, 164532.1)
  assert.equal(ledger.normalizePaymentMethod('unknown', 'paid'), 'unknown')
  assert.equal(ledger.normalizePaymentMethod('银行转账', 'paid'), 'bank')
})
