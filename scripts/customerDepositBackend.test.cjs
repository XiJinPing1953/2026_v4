'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { harness, depositDb } = require('./lib/customerDepositTestHarness.cjs')
const { loadHandler } = require('./lib/accountingTestHarness.cjs')
const M = require('../uniCloud-alipay/cloudfunctions/crm-customer-deposit/depositModel')
const snapshot = tables => JSON.stringify(tables)
const success = result => { assert.equal(result.code, 0, result.msg); return result.data }

test('real endpoints receive 20000, refund 5000, transfer 3000; deposit and prepay reconcile without overwriting customer facts', async () => {
  const h = harness()
  assert.equal(success(await h.create('receive', 20000)).balance, 20000)
  assert.equal(success(await h.create('refund', 5000, { biz_date: '2026-09-02' })).balance, 15000)
  const transfer = success(await h.create('transfer', 3000, { biz_date: '2026-09-03' }))
  assert.equal(transfer.balance, 12000); assert.equal(transfer.version, 3)
  const current = success(await h.invoke('getDepositStatementV1', { date_from: '2026-09-02', date_to: '2026-09-03' }))
  assert.equal(current.read_complete, true); assert.equal(current.opening_balance, 20000); assert.equal(current.current_balance, 12000)
  assert.equal(current.refunded_total, 5000); assert.equal(current.transferred_total, 3000); assert.equal(current.received_total, 0)
  assert.equal(current.closing_balance, 12000); assert.equal(current.history_status, 'not_confirmed'); assert.equal(current.money_scale, 2)
  const receipt = h.tables.crm_customer_receipts[0]
  assert.equal(receipt.source_type, 'deposit_transfer'); assert.equal(receipt.source_id, transfer.entry._id)
  assert.equal(receipt.entry_kind, 'prepay'); assert.equal(receipt.payment_method, 'unknown'); assert.equal(receipt.unallocated_amount, 3000)
  const customer = h.tables.crm_customers[0]
  assert.equal(customer.untouched, 'retain'); assert.equal(customer.receivable_balance, 9000)
  assert.equal(customer.prepay_balance, 3000); assert.equal(customer.prepay_manual_balance, 3000); assert.equal(customer.net_balance, 6000)
  assert.ok(h.tables.crm_customer_deposit_entries.every(row => Number.isInteger(row.amount_cents)))
})

test('empty account states are explicit, preview writes nothing, opening never creates cash and date boundaries stay independent', async () => {
  const h = harness(), original = snapshot(h.tables)
  const empty = success(await h.invoke('getDepositStatementV1', { date_from: '2026-01-01', date_to: '2026-12-31' }))
  assert.equal(empty.current_balance, 0); assert.equal(empty.version, 0); assert.equal(empty.account_initialized, false); assert.equal(empty.history_status, 'not_initialized')
  const input = { kind: 'opening', amount: '20000.01', biz_date: '2025-12-31', payment_method: 'unknown', note: '旧凭据已核', voucher_ref: '', operation_id: 'opening-once', expected_version: 0 }
  const preview = success(await h.invoke('previewDepositEntryV1', input))
  assert.equal(preview.after_balance, 20000.01); assert.equal(snapshot(h.tables), original)
  assert.deepEqual(JSON.parse(JSON.stringify(preview.submission)), { ...input, customer_id: 'customer-1', amount: 20000.01 })
  success(await h.invoke('createDepositEntryV1', preview.submission))
  const report = success(await h.invoke('getDepositStatementV1', { date_from: '2026-01-01', date_to: '2026-12-31' }))
  assert.equal(report.opening_balance, 20000.01); assert.equal(report.opening_transferred_total, 0); assert.equal(report.received_total, 0)
  assert.equal(report.history_status, 'opening_recorded'); assert.equal(h.tables.crm_customer_receipts.length, 0)
  assert.equal(success(await h.invoke('getDepositStatementV1')).opening_transferred_total, 20000.01)
})

test('over-refund, backdated negative balance and a void that breaks historical availability all fail with no write', async () => {
  const h = harness()
  const received = success(await h.create('receive', 20000, { biz_date: '2026-09-03' }))
  const before = snapshot(h.tables)
  for (const data of [{ amount: 20000.01 }, { amount: 1, biz_date: '2026-09-02' }]) {
    const result = await h.create('refund', data.amount, data)
    assert.equal(result.code, 409); assert.match(result.msg, /负/); assert.equal(snapshot(h.tables), before)
  }
  success(await h.create('refund', 5000, { biz_date: '2026-09-04' }))
  const later = snapshot(h.tables)
  const result = await h.invoke('voidDepositEntryV1', { entry_id: received.entry._id, reason: '错误收款', operation_id: 'void-negative', expected_version: 2 })
  assert.equal(result.code, 409); assert.match(result.msg, /负/); assert.equal(snapshot(h.tables), later)
})

test('idempotent operation returns original outcome despite stale expected version; different content with same key is rejected', async () => {
  const h = harness(), extra = { operation_id: 'repeat-operation', expected_version: 0 }
  const first = success(await h.create('receive', 20, extra)), count = h.db.writes.length
  const repeat = success(await h.create('receive', 20, { ...extra, expected_version: 98 }))
  assert.equal(repeat.idempotent, true); assert.equal(repeat.version, 1); assert.equal(repeat.entry._id, first.entry._id); assert.equal(h.db.writes.length, count)
  assert.equal((await h.create('receive', 21, extra)).code, 409)
  assert.equal((await h.create('receive', 20, { ...extra, note: 'different' })).code, 409)
  assert.equal(success(await h.invoke('getDepositOperationV1', { operation_id: extra.operation_id })).found, true)
  assert.equal(success(await h.invoke('getDepositOperationV1', { operation_id: 'never-posted' })).found, false)
  assert.equal((await h.create('receive', 1, { expected_version: 0 })).code, 409)
})

test('permissions and customer isolation cover view, write, opening, hidden and delivery-site accounts', async () => {
  const h = harness()
  const receipt = success(await h.create('receive', 10))
  const before = snapshot(h.tables)
  assert.equal((await h.invoke('getDepositStatementV1', {}, '')).code, 401)
  assert.equal((await h.invoke('voidDepositEntryV1', { customer_id: 'customer-2', entry_id: receipt.entry._id, reason: 'wrong customer', operation_id: 'foreign-void', expected_version: 0 })).code, 403)
  assert.equal(snapshot(h.tables), before)
  h.tables.crm_users.push({ _id: 'restricted', token: 'readonly', role: 'user', page_permissions: { '/pages/customer/statement': { view: true, update: false } } })
  assert.equal((await h.invoke('getDepositStatementV1', {}, 'readonly')).code, 0)
  const basic = { kind: 'receive', amount: 1, biz_date: '2026-09-12', payment_method: 'cash', operation_id: 'denied-write', expected_version: 1 }
  assert.equal((await h.invoke('createDepositEntryV1', basic, 'readonly')).code, 403)
  h.tables.crm_users[1].page_permissions['/pages/customer/statement'].update = true
  assert.equal((await h.invoke('createDepositEntryV1', { ...basic, kind: 'opening', payment_method: 'unknown', note: 'opening evidence' }, 'readonly')).code, 403)
  assert.equal((await h.invoke('createDepositEntryV1', { ...basic, rehearse: true }, 'readonly')).code, 403)
  h.tables.crm_customers[1].is_hidden = true
  assert.equal((await h.invoke('getDepositStatementV1', { customer_id: 'customer-2' })).code, 403)
  h.tables.crm_customers[1].is_hidden = false; h.tables.crm_customers[1].settlement_customer_id = 'customer-1'
  assert.equal((await h.invoke('getDepositStatementV1', { customer_id: 'customer-2' })).code, 400)
})

test('real calendar days and cent precision are enforced without silent rounding or permissive defaults', async () => {
  const h = harness()
  for (const amount of [0, -1, 0.001, '1e3', '2.123', true, null, NaN, Infinity, '01', 1e14]) assert.equal((await h.create('receive', amount)).code, 400)
  for (const biz_date of ['2026-02-29', '2026-02-30', '2026-9-01', '2026-13-01', '2026-00-01', '2026-01-00', '']) assert.equal((await h.create('receive', 1, { biz_date })).code, 400)
  assert.equal((await h.create('receive', 1, { payment_method: '现金' })).code, 400)
  assert.equal((await h.create('opening', 1, { note: '', voucher_ref: '' })).code, 400)
  assert.equal((await h.create('transfer', 1, { note: '' })).code, 400)
  assert.equal(h.db.writes.length, 0)
  assert.equal((await h.create('receive', '0.01', { biz_date: '2024-02-29' })).code, 0)
})

test('voids preserve source facts, reasons and exact retry outcome, with no cash side effects', async () => {
  const h = harness()
  success(await h.create('receive', 20000))
  const refunded = success(await h.create('refund', 5000))
  const data = { entry_id: refunded.entry._id, reason: '登记重复，原付款未发生', operation_id: 'void-refund-1', expected_version: 2 }
  const result = success(await h.invoke('voidDepositEntryV1', data))
  assert.equal(result.balance, 20000); assert.equal(result.entry.kind, 'void'); assert.equal(result.entry.amount, 5000)
  const old = h.tables.crm_customer_deposit_entries.find(row => row._id === refunded.entry._id)
  assert.equal(old.status, 'void'); assert.equal(old.amount_cents, 500000); assert.equal(old.void_reason, data.reason)
  const report = success(await h.invoke('getDepositStatementV1'))
  assert.equal(report.refunded_total, 0); assert.equal(report.entries.length, 3)
  assert.equal(success(await h.invoke('voidDepositEntryV1', data)).idempotent, true)
  assert.equal((await h.invoke('voidDepositEntryV1', { ...data, operation_id: 'void-again-2', expected_version: 3 })).code, 409)
})

test('unallocated transfers may be voided atomically, while allocations, foreign links, adjustment or original value changes block', async () => {
  for (const mutation of [null, 'allocation', 'foreign', 'adjustment', 'amount', 'note', 'rounding']) {
    const h = harness(); success(await h.create('opening', 20000))
    const transfer = success(await h.create('transfer', 3000)), receipt = h.tables.crm_customer_receipts[0]
    if (mutation === 'allocation') { receipt.allocated_amount = 100; receipt.unallocated_amount = 2900; h.tables.crm_customer_allocations.push({ _id: 'link-1', receipt_id: receipt._id, customer_id: 'customer-1', allocate_amount: 100 }) }
    if (mutation === 'foreign') h.tables.crm_customer_allocations.push({ _id: 'foreign-link', receipt_id: receipt._id, customer_id: 'customer-2', allocate_amount: 1 })
    if (mutation === 'adjustment') h.tables.crm_customer_receipt_adjustments.push({ _id: 'adjustment', receipt_id: receipt._id, customer_id: 'customer-2' })
    if (mutation === 'amount') receipt.amount += 1
    if (mutation === 'note') receipt.note = 'changed original'
    if (mutation === 'rounding') receipt.rounding_amount = 1
    const before = snapshot(h.tables)
    const result = await h.invoke('voidDepositEntryV1', { entry_id: transfer.entry._id, reason: '取消未分配转款', operation_id: 'void-transfer', expected_version: 2 })
    if (mutation) { assert.equal(result.code, 409, mutation + ': ' + result.msg); assert.equal(snapshot(h.tables), before) }
    else {
      assert.equal(success(result).balance, 20000); assert.equal(h.tables.crm_customer_receipts[0].status, 'void')
      assert.equal(h.tables.crm_customers[0].prepay_balance, 0); assert.equal(h.tables.crm_customers[0].net_balance, 9000)
      assert.equal(success(await h.invoke('getDepositStatementV1')).transferred_total, 0)
    }
  }
})

test('transfer rebuilds full prepay categories preserving old 3-decimal balances; absent receivable cache fails', async () => {
  const h = harness({ crm_customer_receipts: [
    { _id: 'cash', customer_id: 'customer-1', source_type: 'manual', status: 'posted', unallocated_amount: 4.123 },
    { _id: 'opening', customer_id: 'customer-1', source_type: 'opening_prepay', status: 'posted', unallocated_amount: 10 },
    { _id: 'offset', customer_id: 'customer-1', source_type: 'sale_offset_credit', status: 'posted', unallocated_amount: 5.005 }
  ] })
  success(await h.create('receive', 20)); success(await h.create('transfer', 10))
  assert.equal(h.tables.crm_customers[0].prepay_balance, 29.128); assert.equal(h.tables.crm_customers[0].prepay_manual_balance, 20)
  assert.equal(h.tables.crm_customers[0].receipt_unallocated_balance, 4.123); assert.equal(h.tables.crm_customers[0].offset_credit_balance, 5.005)
  assert.equal(h.tables.crm_customers[0].net_balance, 8970.872)
  delete h.tables.crm_customers[0].receivable_balance
  const before = snapshot(h.tables)
  assert.equal((await h.create('transfer', 1)).code, 409); assert.equal(snapshot(h.tables), before)
})

test('transaction rehearsal seeds an empty account only temporarily and all injected write failures roll back', async () => {
  for (const kind of ['receive', 'refund', 'transfer']) for (const fail_after_writes of [0, 1, 2, 3, 4]) {
    const h = harness(), before = snapshot(h.tables)
    const result = success(await h.create(kind, 3000, { rehearse: true, rehearsal_seed_amount: 20000, fail_after_writes }))
    assert.equal(result.committed, false); assert.equal(result.snapshot_verified, true)
    assert.equal(result.after_balance, kind === 'receive' ? 23000 : 17000)
    assert.equal(result.status, fail_after_writes ? 'interruption_rolled_back' : 'rehearsed_rolled_back')
    assert.equal(snapshot(h.tables), before)
  }
  const h = harness()
  assert.equal((await h.create('transfer', 1, { rehearsal_seed_amount: 10 })).code, 403)
  const failed = harness({}, { txWrite: (_, table) => { if (table === 'crm_customer_deposit_entries') throw Error('injected database write failure') } }), before = snapshot(failed.tables)
  assert.equal((await failed.create('receive', 10)).code, 409); assert.equal(snapshot(failed.tables), before)
})

test('source account version races and duplicate absent-account creation contend instead of overwriting', async () => {
  let armed = false
  const h = harness({}, { start: tables => { if (armed) tables.crm_customer_deposit_accounts[0].updated_at++ } })
  success(await h.create('receive', 10)); armed = true
  const result = await h.create('receive', 1)
  assert.equal(result.code, 409); assert.match(result.msg, /版本/); assert.equal(h.tables.crm_customer_deposit_entries.length, 1)
  const raced = harness({}, { beforeCommit: tables => {
    tables.crm_customer_deposit_accounts.push({ _id: M.accountId('customer-1'), customer_id: 'customer-1', version: 99 })
  } })
  const failed = await raced.create('receive', 1)
  assert.equal(failed.code, 409); assert.equal(failed.data.commit_status_unknown, true); assert.equal(raced.tables.crm_customer_deposit_entries.length, 0)
})

test('lost commit response and post-commit read errors remain queryable with the same operation key', async () => {
  let once = true
  const h = harness({}, { afterCommit: () => { if (once) { once = false; throw Error('commit response lost') } } })
  const extra = { operation_id: 'uncertain-commit', expected_version: 0 }
  const lost = await h.create('receive', 10, extra)
  assert.equal(lost.code, 409); assert.equal(lost.data.commit_status_unknown, true)
  assert.equal(success(await h.invoke('getDepositOperationV1', { operation_id: extra.operation_id })).found, true)
  assert.equal(success(await h.create('receive', 10, extra)).idempotent, true)
  assert.equal(h.tables.crm_customer_deposit_entries.length, 1)
  let committed = false
  const failRead = harness({}, { afterCommit: () => { committed = true }, count: (table, total) => {
    if (committed && table === 'crm_customer_deposit_accounts') throw Error('read response lost')
    return { total }
  } })
  const result = await failRead.create('receive', 10)
  assert.equal(result.code, 409); assert.equal(result.data.commit_status_unknown, true); assert.equal(failRead.tables.crm_customer_deposit_entries.length, 1)
})

test('incomplete reads, missing account, ledger mismatch and changed transfer source never produce trusted zero', async () => {
  const h = harness(); success(await h.create('receive', 100))
  const original = structuredClone(h.tables)
  for (const mutate of [tables => tables.crm_customer_deposit_accounts.splice(0), tables => tables.crm_customer_deposit_accounts[0].balance_cents++,
    tables => tables.crm_customer_deposit_entries[0].amount_cents++, tables => tables.crm_customer_deposit_entries[0].fingerprint = 'invalid',
    tables => tables.crm_customer_deposit_entries[0].operation_result.balance_cents++, tables => tables.crm_customer_deposit_accounts[0].last_entry_id = 'wrong-last-entry']) {
    const tables = structuredClone(original); mutate(tables)
    const main = loadHandler('crm-customer-deposit', depositDb(tables)), result = await main({ token: 'test', action: 'getDepositStatementV1', data: { customer_id: 'customer-1' } })
    assert.equal(result.code, 409); assert.equal(result.data.read_complete, false); assert.equal(result.data.current_balance, undefined)
  }
  const missingCount = harness({}, { count: (table, total) => table === M.TABLES.entries ? {} : { total } })
  assert.equal((await missingCount.invoke('getDepositStatementV1')).code, 409)
  const truncated = harness(original, { get: (table, rows) => ({ data: table === M.TABLES.entries ? [] : rows }) })
  assert.equal((await truncated.invoke('getDepositStatementV1')).code, 409)
  success(await h.create('transfer', 10)); h.tables.crm_customer_receipts[0].customer_id = 'customer-2'
  assert.equal((await h.invoke('getDepositStatementV1')).code, 409)
})

test('storage inspection remains read-only and reports unavailable metadata explicitly', async () => {
  const h = harness(), before = snapshot(h.tables)
  const result = success(await h.invoke('inspectDepositStorageV1'))
  assert.equal(result.collections.length, 2)
  for (const row of result.collections) { assert.equal(row.count, 0); assert.equal(row.exists, null); assert.equal(row.index_query_available, false) }
  assert.equal(snapshot(h.tables), before)
})

test('complete deposit reads cross page boundaries and never accept a short page as the complete ledger', async () => {
  const initial = harness(); success(await initial.create('receive', 1))
  const tables = structuredClone(initial.tables), template = tables.crm_customer_deposit_entries[0]
  tables.crm_customer_deposit_entries = Array.from({ length: 240 }, (_, index) => ({ ...structuredClone(template),
    _id: M.entryId('customer-1', `paged-operation-${index}`), operation_id: `paged-operation-${index}`, account_version: index + 1,
    operation_result: { ...template.operation_result, version: index + 1, balance_cents: (index + 1) * 100 } }))
  Object.assign(tables.crm_customer_deposit_accounts[0], { version: 240, balance_cents: 24000,
    last_entry_id: tables.crm_customer_deposit_entries[239]._id })
  const h = harness(tables), result = success(await h.invoke('getDepositStatementV1'))
  assert.equal(result.entries.length, 240); assert.equal(result.current_balance, 240); assert.equal(result.received_total, 240)
  const truncated = harness(structuredClone(tables), { get: (table, rows) => ({ data: structuredClone(table === M.TABLES.entries ? rows.slice(0, 150) : rows) }) })
  const bad = await truncated.invoke('getDepositStatementV1')
  assert.equal(bad.code, 409); assert.equal(bad.data.current_balance, undefined)
})

test('account mutations during the read and original customer changes inside transaction reject without accepting stale results', async () => {
  const initial = harness(); success(await initial.create('receive', 20))
  const tables = structuredClone(initial.tables)
  let changed = false
  const raced = harness(tables, { get: (table, rows) => {
    const result = { data: structuredClone(rows) }
    if (!changed && table === M.TABLES.entries && rows.length) {
      changed = true; tables.crm_customer_deposit_accounts[0].updated_at++
    }
    return result
  } })
  const result = await raced.invoke('getDepositStatementV1')
  assert.equal(result.code, 409); assert.equal(result.data.current_balance, undefined)
  const moved = harness({}, { start: current => { current.crm_customers[0].settlement_customer_id = 'customer-2' } })
  const denied = await moved.create('receive', 1)
  assert.equal(denied.code, 409); assert.match(denied.msg, /客户原值/)
  assert.equal(moved.tables.crm_customer_deposit_entries.length, 0)
})

test('third-decimal gas allocation leaves cent deposit intact and blocks transfer void with complete source agreement', async () => {
  const h = harness(); success(await h.create('receive', 3))
  const transfer = success(await h.create('transfer', 3)), receipt = h.tables.crm_customer_receipts[0]
  receipt.allocated_amount = 1.234; receipt.unallocated_amount = 1.766
  h.tables.crm_customer_allocations.push({ _id: 'm3-allocation', customer_id: 'customer-1', receipt_id: receipt._id, allocate_amount: 1.234 })
  const report = success(await h.invoke('getDepositStatementV1'))
  assert.equal(report.current_balance, 0); assert.equal(report.transferred_total, 3)
  const result = await h.invoke('voidDepositEntryV1', { entry_id: transfer.entry._id, operation_id: 'void-m3-source', expected_version: 2, reason: 'test' })
  assert.equal(result.code, 409); assert.equal(h.tables.crm_customer_receipts[0].status, 'posted')
})
