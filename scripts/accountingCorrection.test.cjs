'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs')
const p = require('../uniCloud-alipay/cloudfunctions/crm-accounting-correction/plan')
const { snapshot } = require('../uniCloud-alipay/cloudfunctions/crm-accounting-correction/snapshot')
const { mutableDb } = require('./lib/mutableAccountingDb.cjs')
const { loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
const cid = 'a'.repeat(24), sid = 'b'.repeat(24), rid = 'c'.repeat(24), oid = 'd'.repeat(24)
function fixture() {
  const tables = { crm_customers: [{ _id: cid, name: '样例客户', default_price_unit: 'kg' }],
    crm_sale_records: [{ _id: sid, customer_id: cid, date: '2026-01-03', price_unit: 'kg', unit_price: 7,
      out_items: [{ net: 3 }], back_items: [], amount_received: 20, rounding_amount: 1, payment_status: 'paid' }],
    crm_customer_receipts: [{ _id: rid, customer_id: cid, status: 'posted', source_type: 'customer_statement', entry_kind: 'prepay',
      biz_date: '2026-01-05', amount: 80, allocated_amount: 80, unallocated_amount: 0, allocation_mode: 'checked' }],
    crm_customer_allocations: [{ _id: 'e'.repeat(24), customer_id: cid, receipt_id: rid, target_type: 'opening_debt', target_id: oid,
      sale_id: oid, sale_date: '2026-01-01', biz_date: '2026-01-05', allocate_amount: 80 }],
    crm_customer_opening_debts: [{ _id: oid, customer_id: cid, amount: 80, amount_received: 80, biz_date: '2026-01-01' }] }
  for (const k of ['crm_customer_flow_settlements', 'crm_customer_receipt_adjustments', 'crm_customer_deposit_accounts', 'crm_customer_deposit_entries', 'crm_collection_tasks', 'crm_collection_followups', 'crm_vouchers']) tables[k] = []
  const before = { customer_id: cid, complete: true, tables, snapshot_hash: p.snapshotHash(tables) }
  const request = { customer_id: cid, operation_id: 'sample-receipt-v1', expected_snapshot_hash: before.snapshot_hash,
    evidence: { confirmed_by_user: true, approval_sha256: '1'.repeat(64), source_commit: '2'.repeat(40) },
    corrections: [{ type: 'complete_receipt_backing', receipt_id: rid, biz_date: '2026-01-05', confirmed_total_amount: 100,
      targets: [{ sale_id: sid, cash_amount: 20, move_sale_rounding: 1 }] }] }
  return { before, request }
}
const actor = { _id: 'actor', username: 'review' }
test('补齐同笔收款、迁移抹零，保留原销售实收及确定编号', () => {
  const { before, request } = fixture(), plan = p.buildPlan(before, request, actor, 1000)
  assert.deepEqual(plan, p.buildPlan(before, request, actor, 1000))
  assert.equal(plan.summary.new_receipts, 0)
  assert.equal(plan.summary.cash_backing_completed, 20)
  const sale = plan.writes.find(w => w.table === 'crm_sale_records').after
  assert.equal(sale.amount_received, 20); assert.equal(sale.rounding_amount, 0); assert.equal(sale.receipt_rounding_amount, 1)
  assert.equal(plan.writes.find(w => w.table === 'crm_customer_receipts').after.amount, 100)
  for (const mutate of [r => r.corrections[0].targets[0].cash_amount++, r => r.corrections[0].targets[0].sale_id = 'other',
    r => r.corrections[0].targets[0].move_sale_rounding = 2, r => r.corrections[0].confirmed_total_amount++,
    r => r.corrections.push(r.corrections[0]), r => r.evidence.confirmed_by_user = false,
    r => r.corrections[0].biz_date = '2026-02-31', r => r.expected_snapshot_hash = 'wrong']) {
    const r = structuredClone(request); mutate(r); assert.throws(() => p.buildPlan(before, r, actor, 1000))
  }
})
test('非现金来源、跨客户原值及未完成取数拒绝执行', () => {
  for (const mutate of [s => s.tables.crm_customer_receipts[0].source_type = 'opening_prepay',
    s => s.tables.crm_sale_records[0].customer_id = 'other', s => s.complete = false]) {
    const { before, request } = fixture(); mutate(before); before.snapshot_hash = p.snapshotHash(before.tables); request.expected_snapshot_hash = before.snapshot_hash
    assert.throws(() => p.buildPlan(before, request, actor, 1000))
  }
})
test('改期保留分配金额，独立分配日期及错误类型拒绝自动改期', () => {
  const { before, request } = fixture()
  request.corrections = [{ type: 'correct_receipt_date', receipt_id: rid, biz_date: '2026-01-04' }]
  let plan = p.buildPlan(before, request, actor, 1000)
  const allocation = plan.writes.find(w => w.table === 'crm_customer_allocations')
  assert.equal(allocation.after.biz_date, '2026-01-04'); assert.equal(allocation.after.allocate_amount, allocation.before.allocate_amount)
  before.tables.crm_customer_allocations[0].biz_date = '2026-02-01'
  before.snapshot_hash = p.snapshotHash(before.tables); request.expected_snapshot_hash = before.snapshot_hash
  assert.throws(() => p.buildPlan(before, request, actor, 1000), /独立业务日期/)
  request.corrections[0].type = 'arbitrary_patch'
  assert.throws(() => p.buildPlan(before, request, actor, 1000), /类型/)
})
test('真实修正入口权限、源冲突、回滚、提交及重复调用', async () => {
  const { before, request } = fixture(), tables = structuredClone(before.tables)
  tables.crm_users = [{ ...actor, token: 'test', role: 'superadmin' }]; tables.crm_operation_logs = []
  const db = mutableDb(tables), handler = loadHandler('crm-accounting-correction', db)
  assert.equal((await handler({ action: 'inspectV1', data: request })).code, 403)
  tables.crm_users[0].role = 'cashier'
  assert.equal((await invoke(handler, 'inspectV1', request)).code, 403)
  tables.crm_users[0].role = 'superadmin'
  tables.crm_customers.push({ _id: 'f'.repeat(24), name: '其他客户', amount_received_total: 777 })
  const otherBefore = structuredClone(tables.crm_customers[1])
  const initial = await snapshot(db, cid); assert.equal(initial.snapshot_hash, before.snapshot_hash)
  let r = await invoke(handler, 'prepareV1', request); assert.equal(r.code, 0, r.msg)
  const data = { customer_id: cid, operation_id: request.operation_id, plan_hash: r.data.plan_hash }
  assert.equal((await invoke(handler, 'executeV1', data)).code, 409)
  tables.crm_sale_records[0].remark = 'concurrent'
  assert.equal((await invoke(handler, 'rehearseV1', data)).code, 409)
  delete tables.crm_sale_records[0].remark
  r = await invoke(handler, 'rehearseV1', { ...data, fail_after_writes: 2 }); assert.equal(r.data.status, 'interruption_rolled_back')
  assert.equal((await snapshot(db, cid)).snapshot_hash, initial.snapshot_hash)
  r = await invoke(handler, 'rehearseV1', data); assert.equal(r.data.status, 'rehearsed_rolled_back')
  r = await invoke(handler, 'executeV1', data); assert.equal(r.code, 0, r.msg); assert.equal(r.data.status, 'committed')
  const after = await snapshot(db, cid)
  r = await invoke(handler, 'executeV1', data); assert.equal(r.data.idempotent, true)
  assert.equal((await snapshot(db, cid)).snapshot_hash, after.snapshot_hash)
  assert.deepEqual(tables.crm_customers.find(r => r._id === otherBefore._id), otherBefore)
  assert.equal((await invoke(handler, 'prepareV1', { ...request, evidence: { ...request.evidence, approval_sha256: '3'.repeat(64) } })).code, 409)
})
test('K006原始资料经三个真实账务入口核验全部控制数及日期边界', { skip: !process.env.ACCOUNTING_CORRECTION_EVIDENCE }, async () => {
  const dir = process.env.ACCOUNTING_CORRECTION_EVIDENCE
  const before = JSON.parse(fs.readFileSync(dir + '/raw-before.json')), request = JSON.parse(fs.readFileSync(dir + '/request.json'))
  const plan = p.buildPlan(before, request, actor, Date.now()), tables = structuredClone(before.tables)
  for (const w of plan.writes) { const i = tables[w.table].findIndex(r => r._id === w.id); if (i < 0) tables[w.table].push(w.after); else tables[w.table][i] = w.after }
  tables.crm_users = [{ ...actor, token: 'test', role: 'superadmin' }]; tables.crm_operation_logs = []
  const handler = loadHandler('crm-customer-settlement', mutableDb(tables))
  const cases = [['2026-01-01', '2026-09-13', 197980, 351.5], ['2026-01-01', '2026-01-01', 0, 0],
    ['2026-01-03', '2026-01-03', 0, 0], ['2026-01-05', '2026-01-05', 48000, 139],
    ['2026-04-22', '2026-04-22', 76100, 39], ['2026-04-23', '2026-04-23', 0, 0]]
  const results = []
  for (const [from, to, cash, rounding] of cases) for (const action of ['getCustomerStatementV1', 'exportCustomerStatementV1', 'exportCustomerAccountingLedgerV1']) {
    const r = await invoke(handler, action, { customer_id: before.customer_id, date_from: from, date_to: to })
    assert.equal(r.code, 0, r.msg); const summary = r.data.period_summary
    assert.equal(summary.complete, true, JSON.stringify(summary.pending)); assert.equal(summary.cash_received, cash, action + '/' + from)
    assert.equal(summary.rounding_total, rounding, action + '/' + from)
    if (to === '2026-09-13') {
      assert.equal(summary.business_revenue, 159663.5); assert.equal(summary.refund_total, 0); assert.equal(summary.historical_debt_collected, 38668)
      if (action === 'getCustomerStatementV1') { assert.equal(r.data.summary.receivable_balance, 0); assert.equal(r.data.summary.prepay_balance, 0) }
      if (action === 'exportCustomerStatementV1') assert.equal(r.data.closing_balance, 0)
      if (action === 'exportCustomerAccountingLedgerV1') assert.equal(r.data.closing.balance, 0)
    }
    results.push({ action, from, to, cash: summary.cash_received, rounding: summary.rounding_total })
  }
  for (const old of before.tables.crm_sale_records) {
    const row = tables.crm_sale_records.find(s => s._id === old._id)
    for (const key of Object.keys(old)) if (!['updated_at', 'accounting_reconciliation', 'rounding_amount', 'receipt_rounding_amount'].includes(key)) assert.deepEqual(row[key], old[key], key)
  }
  assert.equal(p.snapshotHash(Object.fromEntries(Object.keys(before.tables).map(k => [k, tables[k]]))), p.expectedAfter(before, plan), '查询不能额外修改账务')
  fs.writeFileSync(dir + '/local-business-acceptance.json', JSON.stringify(results, null, 2))
})
