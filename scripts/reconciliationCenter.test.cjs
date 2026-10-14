'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createService, digest, COL } = require('../uniCloud-alipay/cloudfunctions/crm-reconciliation/service')
const { readComplete } = require('../uniCloud-alipay/cloudfunctions/common/financialRead')
const { depositDb } = require('./lib/customerDepositTestHarness.cjs')
const { loadHandler, invoke: invokeHandler } = require('./lib/accountingTestHarness.cjs')

const CID = 'a'.repeat(24), OTHER = 'b'.repeat(24), RID = 'c'.repeat(24), SALE = 'd'.repeat(24)
const actor = { _id: 'actor', role: 'superadmin', token: 'test' }
const clone = value => structuredClone(value)
const source = (revision = 'one') => ({ name: 'summary.xlsx', base64: 'fixture', revision })
const row = (code, name, debit = 100, credit = 100) => ({ code, name, opening_milli: 0,
  debit_milli: debit * 1000, credit_milli: credit * 1000, closing_milli: (debit - credit) * 1000 })
const summary = () => ({ company: '测试账套', month: '2026-09', count: 2,
  rows: [row('112201', '测试客户'), row('112202', '其他客户')],
  controls: { opening_milli: 0, debit_milli: 200000, credit_milli: 200000, closing_milli: 0 } })
const detail = (code = '112201', accountName = '测试客户') => ({ company: '测试账套', account_code: code, account_name: accountName,
  period_month_from: '202601', period_month_to: '202609', opening_milli: 0, debit_milli: 100000, credit_milli: 100000, closing_milli: 0,
  rows: [{ date: '2026-09-18', debit_milli: 100000, credit_milli: 0, source_row: 6 },
    { date: '2026-09-18', debit_milli: 0, credit_milli: 100000, source_row: 7 }] })

function fixture(options = {}) {
  let clock = 10, inspectCount = 0, exportCount = 0
  const tables = {
    crm_customers: [{ _id: CID, name: '测试客户', default_price_unit: 'kg' }, { _id: OTHER, name: '其他客户', default_price_unit: 'kg' }],
    crm_users: [actor], crm_operation_logs: [],
    crm_sale_records: [{ _id: SALE, customer_id: CID, date: '2026-09-18', price_unit: 'kg', unit_price: 100,
      out_items: [{ net: 1 }], back_items: [], amount_received: 0, payment_status: 'unpaid' }],
    crm_customer_receipts: [{ _id: RID, customer_id: CID, status: 'posted', source_type: 'customer_statement', entry_kind: 'prepay',
      biz_date: options.receiptDate || '2026-09-18', amount: 100, allocated_amount: 0, unallocated_amount: 100, allocation_mode: 'checked' }],
    crm_customer_allocations: [], crm_customer_opening_debts: [], crm_customer_flow_settlements: [],
    crm_customer_receipt_adjustments: [], crm_customer_deposit_accounts: [], crm_customer_deposit_entries: [], crm_collection_tasks: [],
    crm_collection_followups: [], crm_vouchers: []
  }
  const state = { onInvoke: null, stale: false, refreshCount: 0, ledgerOverride: null, throwAfterCommit: false, correctionCalls: [], sourcesRevision: 0,
    onTransaction: null, failTransactionWrite: null, internalIssues: [] }
  // Match Alipay's missing transaction-document behavior and commit conflicts.
  const db = depositDb(tables, { start: current => state.onTransaction?.(current), txWrite: (_operation, name, value) => state.failTransactionWrite?.(name, value) })
  const correction = loadHandler('crm-accounting-correction', db)
  const inspect = customerId => ({ complete: state.internalComplete !== false, source_hash: digest({ receipts: tables.crm_customer_receipts.filter(r => r.customer_id === customerId), sales: tables.crm_sale_records.filter(r => r.customer_id === customerId), revision: state.sourcesRevision }),
    issues: clone(state.internalIssues), cache: { stale: state.stale, before: { receivable_balance: 2 }, expected: { receivable_balance: 0 } } })
  const ledger = customerId => ({ customer: { _id: customerId }, period: { date_from: '2026-01-01', date_to: '2026-09-23' },
    opening_balance: 0, closing_balance: 0, totals: { debit: 100, credit: 100 },
    period_summary: { complete: true, date_from: '2026-01-01', date_to: '2026-09-23', cash_received: 100, business_revenue: 100,
      read_started_at: ++clock, read_completed_at: ++clock },
    rows: [{ row_type: 'movement', biz_date: '2026-09-18', source_type: 'sale', source_id: SALE, debit: 100, credit: 0 },
      { row_type: 'movement', biz_date: tables.crm_customer_receipts[0].biz_date, source_type: 'receipt', source_id: RID, debit: 0, credit: 100 }] })
  const invoke = async (name, action, data) => {
    await state.onInvoke?.(name, action, data)
    if (name === 'crm-accounting-correction') {
      state.correctionCalls.push(action)
      const result = await invokeHandler(correction, action, data)
      if (result.code !== 0) throw Object.assign(Error(result.msg), { code: result.code })
      if (action === 'executeV1' && state.throwAfterCommit) { state.throwAfterCommit = false; throw Error('模拟请求超时，服务端已提交') }
      return result.data
    }
    if (action === 'inspectReconciliationCustomerV1') { inspectCount++; return inspect(data.customer_id) }
    if (action === 'exportCustomerAccountingLedgerV1') { exportCount++; return state.ledgerOverride ? clone(state.ledgerOverride) : ledger(data.customer_id) }
    if (action === 'refreshReconciliationCacheV1') { state.refreshCount++; state.stale = false; state.internalIssues = []; return { refreshed: true, verified: true } }
    throw Error('unexpected invocation ' + action)
  }
  const parseSource = (input, kind) => ({ name: input.name, base64: input.base64, bytes: 7, sha256: digest(input),
    parsed: clone(input.parsed || (kind === 'summary' ? summary() : detail())) })
  const service = createService({ db, readComplete, invoke, parseSource, now: () => ++clock })
  const run = (action, data, user = actor) => service.run(action, data, user)
  const importBatch = (input = {}) => run('importBatchV1', { company: '测试账套', cutoff: '2026-09-23', operation_id: 'import-one', source: source(), ...input })
  const saveMapping = (input = {}) => run('saveMappingV1', { company: '测试账套', customer_id: CID, accountant_codes: ['112201'], basis: '原客户编码已核对', expected_version: 0, ...input })
  const ready = async (withDetails = false) => {
    const { batch } = await importBatch(); await saveMapping()
    if (withDetails) await run('importDetailV1', { batch_id: batch._id, accountant_code: '112201', source: { ...source('detail'), parsed: detail() } })
    return { batch_id: batch._id, customer_id: CID }
  }
  return { tables, state, db, run, importBatch, saveMapping, ready, inspect, ledger, counts: () => ({ inspectCount, exportCount }) }
}

test('重复文件复用同批且所有操作号均绑定输入；同号换文件或期间拒绝', async () => {
  const f = fixture(), one = await f.importBatch(), again = await f.importBatch(), newOp = await f.importBatch({ operation_id: 'import-two' })
  assert.equal(one.batch._id, again.batch._id); assert.equal(one.batch._id, newOp.batch._id)
  assert.equal(f.tables[COL.batches].length, 1); assert.equal(f.tables[COL.sources].length, 1)
  assert.equal(f.tables[COL.mappings].length, 1); assert.equal(f.tables[COL.mappings][0].version, 0)
  await assert.rejects(() => f.importBatch({ operation_id: 'import-two', source: source('different') }), /操作号/)
  await assert.rejects(() => f.importBatch({ cutoff: '2026-09-24' }), /操作号/)
})

test('整批导入中途失败回滚，原始文件批次及操作日志不留半条', async () => {
  const f = fixture()
  f.state.failTransactionWrite = name => { if (name === COL.batches) throw Error('事务写入失败') }
  await assert.rejects(f.importBatch, /事务写入失败/)
  for (const name of [COL.sources, COL.batches, COL.logs]) assert.equal((f.tables[name] || []).length, 0)
  f.state.failTransactionWrite = null
  await f.importBatch()
  assert.equal(f.tables[COL.batches].length, 1)
})

test('映射避免同科目跨户重复，事务复核版本防覆盖并发修改', async () => {
  const f = fixture(); await f.importBatch(); await f.saveMapping()
  await assert.rejects(() => f.saveMapping({ customer_id: OTHER, expected_version: 1 }), /多个客户/)
  await assert.rejects(() => f.saveMapping({ accountant_codes: ['missing'], expected_version: 1 }), /已导入/)
  f.state.onTransaction = tables => { tables[COL.mappings][0].version++ }
  await assert.rejects(() => f.saveMapping({ expected_version: 1 }), /其他人员/)
  assert.equal(f.tables[COL.mappings][0].version, 2)
  assert.equal(f.tables[COL.mappings][0].items.length, 1)
})

test('读取时间改变不改变业务哈希，人工核准保留；原单变化后失效', async () => {
  const f = fixture(), data = await f.ready(), one = await f.run('checkCustomerV1', data), two = await f.run('checkCustomerV1', data)
  assert.equal(one.summary_match, true)
  assert.equal(one.result_hash, two.result_hash)
  const review = await f.run('reviewCustomerV1', { ...data, expected_result_hash: two.result_hash, kind: 'manual_approval', basis: '已核实原始资料' })
  assert.equal(review.valid, true)
  assert.equal((await f.run('checkCustomerV1', data)).review.valid, true)
  f.tables.crm_customer_receipts[0].biz_date = '2026-09-19'
  const changed = await f.run('checkCustomerV1', data)
  assert.notEqual(changed.result_hash, two.result_hash)
  assert.equal(changed.review.valid, false)
  const reopened = await f.run('getBatchV1', { batch_id: data.batch_id })
  assert.equal(reopened.results[0].stale, true)
})

test('CRM双读期间原单变化返回待核且阻止核准', async () => {
  const f = fixture(), data = await f.ready()
  f.state.onInvoke = (name, action) => { if (action === 'exportCustomerAccountingLedgerV1') f.state.sourcesRevision++ }
  const result = await f.run('checkCustomerV1', data)
  assert.equal(result.evidence_level, 'incomplete')
  assert.equal(result.summary_match, false)
  assert.equal(result.internal.complete, false)
  await assert.rejects(() => f.run('reviewCustomerV1', { ...data, expected_result_hash: result.result_hash, kind: 'manual_approval', basis: '不能跳过' }))
})

test('取数期间映射或好会计明细变化拒绝保存混合版本结果', async () => {
  for (const kind of ['mapping', 'detail']) {
    const f = fixture(), data = await f.ready()
    f.state.onInvoke = (name, action) => {
      if (action !== 'exportCustomerAccountingLedgerV1') return
      if (kind === 'mapping') f.tables[COL.mappings][0].version++
      else (f.tables[COL.sources] ||= []).push({ _id: 'e'.repeat(24), batch_id: data.batch_id, kind: 'detail', accountant_code: '112201', sha256: 'changed', created_at: 100 })
    }
    await assert.rejects(() => f.run('checkCustomerV1', data), /变化/)
    assert.equal((f.tables[COL.results] || []).length, 0)
  }
})

test('好会计处理记录不会关闭差异，重复核查也不会变成人工核准', async () => {
  const f = fixture({ receiptDate: '2026-09-19' }), data = await f.ready(true)
  const result = await f.run('checkCustomerV1', data)
  assert.equal(result.detail_match, false)
  assert.ok(result.issues.some(issue => issue.type === 'date'))
  const saved = await f.run('reviewCustomerV1', { ...data, expected_result_hash: result.result_hash, kind: 'accounting_followup', basis: '已通知会计核实，待重新导出' })
  assert.equal(saved.valid, false)
  const checked = await f.run('checkCustomerV1', data)
  assert.equal(checked.review.valid, false)
  assert.equal(checked.detail_match, false)
})

test('上传科目与原文件编码冲突、账套或期间不符均拒绝', async () => {
  const f = fixture(), data = await f.ready()
  for (const modify of [d => { d.account_code = '112202' }, d => { d.company = '其他账套' }, d => { d.period_month_from = '202602' }]) {
    const parsed = detail(); modify(parsed)
    await assert.rejects(() => f.run('importDetailV1', { batch_id: data.batch_id, accountant_code: '112201', source: { ...source('bad-detail'), parsed } }))
  }
  assert.equal(f.tables[COL.sources].length, 1)
  const parsed = detail(); parsed.account_code = ''
  const first = await f.run('importDetailV1', { batch_id: data.batch_id, accountant_code: '112201', source: { ...source('fallback'), parsed } })
  const again = await f.run('importDetailV1', { batch_id: data.batch_id, accountant_code: '112201', source: { ...source('fallback'), parsed } })
  assert.equal(first.source_id, again.source_id)
})

test('逐笔互抵即使汇总对平也阻止人工核准', async () => {
  const f = fixture(), data = await f.ready(true), ledger = f.ledger(CID)
  ledger.rows[0].debit = 60; ledger.rows.push({ ...ledger.rows[0], biz_date: '2026-09-17', debit: 40, source_id: 'other-sale' })
  f.state.ledgerOverride = ledger
  const result = await f.run('checkCustomerV1', data)
  assert.equal(result.summary_match, true); assert.equal(result.detail_match, false)
  await assert.rejects(() => f.run('reviewCustomerV1', { ...data, expected_result_hash: result.result_hash, kind: 'manual_approval', basis: '仅余额相同不足以核准' }), /待核差异/)
})

test('仅缓存过期可自动刷新；非缓存账务问题阻止自动处理', async () => {
  const f = fixture(), data = await f.ready()
  f.state.stale = true
  f.state.internalIssues = [{ type: 'evidence', code: 'cache_stale', message: '汇总缓存过期', blocking: false }]
  const result = await f.run('checkCustomerV1', { ...data, auto_refresh: true })
  assert.equal(f.state.refreshCount, 1); assert.equal(result.summary_match, true)
  f.state.stale = true
  f.state.internalIssues = [{ type: 'evidence', code: 'allocation_invalid', message: '可分配余额不一致', blocking: true }]
  const blocked = await f.run('checkCustomerV1', { ...data, auto_refresh: true })
  assert.equal(f.state.refreshCount, 1); assert.equal(blocked.summary_match, false)
})

test('通用修正连到真实受保护入口，提交后超时可按同号恢复且不重复写', async () => {
  const f = fixture({ receiptDate: '2026-09-19' }), data = await f.ready(true), checked = await f.run('checkCustomerV1', data)
  const request = { ...data, operation_id: 'fix-date-one', expected_result_hash: checked.result_hash, basis: '银行回单日期确认',
    correction: { type: 'correct_receipt_date', receipt_id: RID, biz_date: '2026-09-18' } }
  const prepared = await f.run('prepareRepairV1', request)
  assert.equal(prepared.status, 'prepared'); assert.ok(prepared.plan_hash)
  await assert.rejects(() => f.run('prepareRepairV1', { ...request, basis: '不同依据' }), /操作号/)
  f.state.throwAfterCommit = true
  await assert.rejects(() => f.run('executeRepairV1', { ...data, operation_id: request.operation_id, plan_hash: prepared.plan_hash }), /超时/)
  assert.equal(f.tables.crm_customer_receipts[0].biz_date, '2026-09-18')
  assert.equal((await f.run('repairStatusV1', request)).status, 'committed')
  const resumed = await f.run('executeRepairV1', { ...data, operation_id: request.operation_id, plan_hash: prepared.plan_hash })
  assert.equal(resumed.status, 'committed'); assert.equal(resumed.verification.detail_match, true)
  assert.equal(f.state.correctionCalls.filter(action => action === 'executeV1').length, 1)
  assert.equal(f.tables.crm_customer_receipts.length, 1)
  assert.equal(f.tables.crm_customer_receipts[0].amount, 100)
})

test('修复逐户独立成功或失败；失败方案不影响已成功客户', async () => {
  const f = fixture({ receiptDate: '2026-09-19' }), data = await f.ready(), checked = await f.run('checkCustomerV1', data)
  const request = { ...data, operation_id: 'fix-date-batch', expected_result_hash: checked.result_hash, basis: '回单日期',
    correction: { type: 'correct_receipt_date', receipt_id: RID, biz_date: '2026-09-18' } }
  const prepared = await f.run('prepareRepairV1', request)
  await f.run('executeRepairV1', { ...data, operation_id: request.operation_id, plan_hash: prepared.plan_hash })
  await f.saveMapping({ customer_id: OTHER, accountant_codes: ['112202'], expected_version: 1 })
  const other = { batch_id: data.batch_id, customer_id: OTHER }, otherCheck = await f.run('checkCustomerV1', other)
  await assert.rejects(() => f.run('prepareRepairV1', { ...request, ...other, expected_result_hash: otherCheck.result_hash,
    correction: { type: 'correct_receipt_date', receipt_id: RID, biz_date: '2026-09-17' } }), /收款|客户|不存在/)
  assert.equal(f.tables.crm_customer_receipts[0].biz_date, '2026-09-18')
  assert.equal((await f.run('repairStatusV1', request)).status, 'committed')
})

test('修复预览后原值变化拒绝执行，普通财务不能提升为超级管理员修账', async () => {
  const f = fixture({ receiptDate: '2026-09-19' }), data = await f.ready(), checked = await f.run('checkCustomerV1', data)
  const request = { ...data, operation_id: 'fix-stale-one', expected_result_hash: checked.result_hash, basis: '回单依据',
    correction: { type: 'correct_receipt_date', receipt_id: RID, biz_date: '2026-09-18' } }
  await assert.rejects(() => f.run('prepareRepairV1', request, { ...actor, role: 'finance' }), /超级管理员/)
  const plan = await f.run('prepareRepairV1', request)
  f.tables.crm_customer_receipts[0].amount = 101
  await assert.rejects(() => f.run('executeRepairV1', { ...data, operation_id: request.operation_id, plan_hash: plan.plan_hash }), /变化/)
  assert.equal(f.tables.crm_customer_receipts[0].amount, 101)
  assert.equal(f.tables.crm_customer_receipts[0].biz_date, '2026-09-19')
  assert.equal(f.state.correctionCalls.includes('executeV1'), false)
})

test('本笔修复验证与整户待核分开；可继续下一笔且后续业务不撤销旧验证', async () => {
  const f = fixture({ receiptDate: '2026-09-19' }), data = await f.ready()
  const secondReceiptId = 'f'.repeat(24)
  f.tables.crm_customer_receipts.push({ ...f.tables.crm_customer_receipts[0], _id: secondReceiptId, amount: 20, unallocated_amount: 20 })
  f.state.internalComplete = false
  f.state.internalIssues = [{ type: 'evidence', code: 'second_receipt_date_pending', message: '第二笔仍待核', blocking: true }]
  const checked = await f.run('checkCustomerV1', data)
  const request = { ...data, operation_id: 'fix-first-of-two', expected_result_hash: checked.result_hash, basis: '第一笔银行回单',
    correction: { type: 'correct_receipt_date', receipt_id: RID, biz_date: '2026-09-18' } }
  const plan = await f.run('prepareRepairV1', request)
  const executeData = { ...data, operation_id: request.operation_id, plan_hash: plan.plan_hash }
  const first = await f.run('executeRepairV1', executeData)
  assert.equal(first.status, 'committed')
  assert.equal(first.verification.complete, true)
  assert.equal(first.verification.customer_complete, false)
  assert.equal(first.result.internal.complete, false)
  assert.equal((await f.run('repairStatusV1', request)).verification.complete, true)
  const next = await f.run('prepareRepairV1', { ...request, operation_id: 'fix-second-of-two', expected_result_hash: first.result.result_hash,
    basis: '第二笔回单', correction: { type: 'correct_receipt_date', receipt_id: secondReceiptId, biz_date: '2026-09-17' } })
  assert.equal(next.status, 'prepared')
  // A later ordinary transaction changes the current customer snapshot but must
  // not rewrite the proof that this earlier operation was verified at the time.
  f.tables.crm_customer_receipts.push({ ...f.tables.crm_customer_receipts[0], _id: 'e'.repeat(24), amount: 30, unallocated_amount: 30, biz_date: '2026-09-22' })
  const replay = await f.run('executeRepairV1', executeData)
  assert.equal(replay.status, 'committed')
  assert.deepEqual(replay.verification, first.verification)
  assert.equal(f.state.correctionCalls.filter(action => action === 'executeV1').length, 1)
})

test('提交超时后的恢复须核对实际写后快照，不能把已变化源单冒充验证通过', async () => {
  const f = fixture({ receiptDate: '2026-09-19' }), data = await f.ready(), checked = await f.run('checkCustomerV1', data)
  const request = { ...data, operation_id: 'fix-unverified-one', expected_result_hash: checked.result_hash, basis: '银行回单',
    correction: { type: 'correct_receipt_date', receipt_id: RID, biz_date: '2026-09-18' } }
  const plan = await f.run('prepareRepairV1', request)
  const executeData = { ...data, operation_id: request.operation_id, plan_hash: plan.plan_hash }
  f.state.throwAfterCommit = true
  await assert.rejects(() => f.run('executeRepairV1', executeData), /超时/)
  assert.equal((await f.run('repairStatusV1', request)).status, 'committed')
  f.tables.crm_customer_receipts[0].amount = 101
  f.tables.crm_customer_receipts[0].unallocated_amount = 101
  const resumed = await f.run('executeRepairV1', executeData)
  assert.equal(resumed.status, 'committed')
  assert.equal(resumed.verification.complete, false)
  assert.equal(resumed.verification.scope, 'repair_operation')
  assert.ok(resumed.verification.reason)
  const status = await f.run('repairStatusV1', request)
  assert.equal(status.status, 'committed')
  assert.notEqual(status.verification?.complete, true)
  assert.equal(f.state.correctionCalls.filter(action => action === 'executeV1').length, 1)
  assert.equal(f.tables.crm_customer_receipts[0].amount, 101)
})

test('支付宝缺失事务ID会抛错时首次批次、未映射核查、映射、明细及修复日志均可建立', async () => {
  const f = fixture({ receiptDate: '2026-09-19' }), tx = await f.db.startTransaction()
  await assert.rejects(() => tx.collection(COL.logs).doc('not-created').get(), /Alipay missing transaction document/)
  await tx.rollback()
  const { batch } = await f.importBatch(), data = { batch_id: batch._id, customer_id: CID }
  const unmapped = await f.run('checkCustomerV1', data)
  assert.equal(unmapped.summary_match, false)
  assert.ok(unmapped.issues.some(issue => issue.type === 'mapping'))
  assert.equal(f.tables[COL.results].length, 1)
  await f.saveMapping()
  await f.run('importDetailV1', { ...data, accountant_code: '112201', source: { ...source('first-detail'), parsed: detail() } })
  const checked = await f.run('checkCustomerV1', data)
  const prepared = await f.run('prepareRepairV1', { ...data, operation_id: 'first-alipay-repair', expected_result_hash: checked.result_hash,
    basis: '首笔回单日期', correction: { type: 'correct_receipt_date', receipt_id: RID, biz_date: '2026-09-18' } })
  assert.equal(prepared.status, 'prepared')
  const result = await f.run('executeRepairV1', { ...data, operation_id: prepared.operation_id, plan_hash: prepared.plan_hash })
  assert.equal(result.verification.complete, true)
  assert.equal(result.result.detail_match, true)
})

test('首次并发导入和同一明细重试复用唯一记录，不重复推进明细版本', async () => {
  const f = fixture()
  const imported = await Promise.all([f.importBatch(), f.importBatch()])
  assert.equal(imported[0].batch._id, imported[1].batch._id)
  assert.equal(f.tables[COL.batches].length, 1)
  assert.equal(f.tables[COL.sources].length, 1)
  assert.equal(f.tables[COL.mappings].length, 1)
  assert.equal(f.tables[COL.logs].filter(row => row.action === 'reconciliation_import').length, 1)
  const data = { batch_id: imported[0].batch._id, accountant_code: '112201', source: { ...source('same-detail'), parsed: detail() } }
  const details = await Promise.all([f.run('importDetailV1', data), f.run('importDetailV1', data)])
  assert.equal(details[0].source_id, details[1].source_id)
  assert.equal(f.tables[COL.batches][0].details_revision, 1)
  assert.equal(f.tables[COL.sources].filter(row => row.kind === 'detail').length, 1)
})

test('首次结果并发创建只提交一条，失败方重查复用结果和审计', async () => {
  const f = fixture(), data = await f.ready()
  const results = await Promise.allSettled([f.run('checkCustomerV1', data), f.run('checkCustomerV1', data)])
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  assert.equal(results.filter(row => row.status === 'rejected').length, 1)
  assert.equal(f.tables[COL.results].length, 1)
  assert.equal(f.tables[COL.logs].filter(row => row.action === 'reconciliation_check').length, 1)
  await f.run('checkCustomerV1', data)
  assert.equal(f.tables[COL.logs].filter(row => row.action === 'reconciliation_check').length, 1)
})

for (const failedStage of ['inspect_before', 'ledger', 'inspect_after']) test(`读取阶段${failedStage}超时不冒充完成，保留重试且同批恢复`, async () => {
  const f = fixture(), data = await f.ready(true)
  const financialBefore = digest(Object.fromEntries(Object.entries(f.tables).filter(([key]) => !Object.values(COL).includes(key))))
  const approved = await f.run('checkCustomerV1', { ...data, auto_refresh: false })
  await f.run('reviewCustomerV1', { ...data, kind: 'manual_approval', basis: '测试凭据完整', expected_result_hash: approved.result_hash })
  let inspectCount = 0
  f.state.onInvoke = async (_name, action) => {
    if (action === 'inspectReconciliationCustomerV1') inspectCount++
    if ((failedStage === 'inspect_before' && inspectCount === 1) ||
        (failedStage === 'ledger' && action === 'exportCustomerAccountingLedgerV1') ||
        (failedStage === 'inspect_after' && inspectCount === 2)) throw Error('HttpClientRequestTimeoutError: Request timeout for 60000 ms')
  }
  const failed = await f.run('checkCustomerV1', { ...data, auto_refresh: false })
  assert.equal(failed.check_status, 'read_failed')
  assert.equal(failed.read_complete, false)
  assert.equal(failed.retryable, true)
  assert.equal(failed.stale, true)
  assert.equal(failed.read_failure.stage, failedStage)
  assert.equal(failed.internal.read_complete, false)
  assert.equal(failed.summary_match, false)
  assert.equal(failed.detail_match, null)
  assert.equal(failed.comparison.crm, null)
  assert.equal(failed.review.valid, false)
  assert.equal(failed.issues.some(row => ['PERIOD_INVALID', 'DETAIL_SCOPE_INVALID'].includes(row.code)), false)
  assert.equal(f.state.refreshCount, 0)
  f.state.onInvoke = null
  const recovered = await f.run('checkCustomerV1', { ...data, auto_refresh: false })
  assert.equal(recovered._id, failed._id)
  assert.equal(recovered.read_complete, true)
  assert.equal(recovered.check_status, 'completed')
  assert.equal(recovered.stale, false)
  assert.equal(recovered.detail_match, true)
  assert.equal(f.tables[COL.results].length, 1)
  assert.equal(digest(Object.fromEntries(Object.entries(f.tables).filter(([key]) => !Object.values(COL).includes(key)))), financialBefore)
})

test('完整读取但业务待核不是可重试读取失败', async () => {
  const f = fixture(), data = await f.ready(true)
  f.state.internalComplete = false
  f.state.internalIssues = [{ code: 'embedded_receipt_without_backing', type: 'evidence_missing', blocking: true, message: '同笔依据待核' }]
  const result = await f.run('checkCustomerV1', { ...data, auto_refresh: false })
  assert.equal(result.internal.complete, false)
  assert.equal(result.read_complete, true)
  assert.equal(result.check_status, 'completed')
  assert.equal(result.retryable, false)
  assert.equal(result.stale, false)
})

test('嵌套调用显式超时共享请求总预算，预算不足不再发下游请求', async () => {
  const { createInvoker } = require('../uniCloud-alipay/cloudfunctions/crm-reconciliation/index')
  let clock = 0
  const calls = []
  const invoke = createInvoker({ token: 'test', request_id: 'request' }, async options => {
    calls.push(options); return { result: { code: 0, data: { complete: true } } }
  }, 0, () => clock)
  await invoke('crm-customer-settlement', 'inspectReconciliationCustomerV1', { customer_id: CID })
  assert.equal(calls[0].timeout, 60000)
  clock = 150000
  await invoke('crm-accounting-correction', 'inspectV1', { customer_id: CID })
  assert.equal(calls[1].timeout, 20000)
  clock = 169100
  await assert.rejects(() => invoke('crm-accounting-correction', 'executeV1', {}), /时间不足/)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].data.token, 'test')
})

test('下游超时即使包装409也保持同号待确认，不伪装业务拒绝', async () => {
  const { createInvoker } = require('../uniCloud-alipay/cloudfunctions/crm-reconciliation/index')
  const transport = createInvoker({}, async () => ({ result: { code: 409, msg: 'Request timeout for 60000 ms' } }), Date.now())
  const f = fixture(), data = await f.ready(), result = await f.run('checkCustomerV1', data)
  const request = { ...data, operation_id: 'prepare-timeout-409', expected_result_hash: result.result_hash,
    basis: '测试回单日期', correction: { type: 'correct_receipt_date', receipt_id: RID, biz_date: '2026-09-19' } }
  f.state.onInvoke = async (name, action) => { if (action === 'prepareV1') await transport(name, action, {}) }
  await assert.rejects(() => f.run('prepareRepairV1', request), /timeout/)
  assert.equal((await f.run('repairStatusV1', request)).status, 'not_prepared')
  f.state.onInvoke = null
  assert.equal((await f.run('prepareRepairV1', request)).status, 'prepared')
})

test('支付宝服务端把超时设置在当前空间实例上，不依赖被SDK丢弃的调用参数', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { createRequire } = require('node:module')
  const filename = path.resolve('uniCloud-alipay/cloudfunctions/crm-reconciliation/index.js'), localRequire = createRequire(filename)
  const f = fixture(), instances = [], calls = []
  const cloud = {
    database: () => f.db,
    callFunction: () => { throw Error('未设置实例超时的旧路径不应调用') },
    init(options) {
      instances.push(options)
      return { async callFunction({ name, data }) { calls.push({ name, data }); return { result: { code: 0, data: { received: true } } } } }
    }
  }
  const scope = { exports: {}, Date, uniCloud: cloud,
    require: name => name === './service' ? { createService: ({ invoke }) => ({ run: () => invoke('crm-customer-settlement','inspectReconciliationCustomerV1',{customer_id:CID}) }) } : localRequire(name) }
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),scope,{filename})
  const response = await scope.exports.main({action:'checkCustomerV1',token:'test',data:{}})
  assert.equal(response.code,0); assert.equal(response.data.received,true)
  assert.equal(instances.length,1); assert.equal(instances[0].provider,'alipay'); assert.equal(instances[0].timeout,60000)
  assert.equal(instances[0].spaceId,undefined)
  assert.equal(calls[0].data.token,'test')
})
