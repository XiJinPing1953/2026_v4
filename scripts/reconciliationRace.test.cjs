'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createService, digest, COL } = require('../uniCloud-alipay/cloudfunctions/crm-reconciliation/service')
const { readComplete } = require('../uniCloud-alipay/cloudfunctions/common/financialRead')
const { depositDb } = require('./lib/customerDepositTestHarness.cjs')
const CID = 'a'.repeat(24), COMPANY = '并发核查合成账套'

async function fixture() {
  let clock = 10
  const tables = { crm_customers: [{ _id: CID, name: '合成客户' }], crm_operation_logs: [] }
  const db = depositDb(tables), actor = { _id: 'synthetic-finance', role: 'finance' }
  const controls = { opening_milli: 0, debit_milli: 100000, credit_milli: 100000, closing_milli: 0 }
  const summary = { company: COMPANY, month: '2026-09', count: 2,
    rows: ['112201', '112202'].map(code => ({ code, name: '合成客户', ...controls })),
    controls: { opening_milli: 0, debit_milli: 200000, credit_milli: 200000, closing_milli: 0 } }
  const detail = day => ({ company: COMPANY, account_code: '112201', account_name: '合成客户',
    period_month_from: '202601', period_month_to: '202609', ...controls,
    rows: [{ date: day, debit_milli: 100000, credit_milli: 0 }, { date: day, debit_milli: 0, credit_milli: 100000 }] })
  const ledger = { period: { date_from: '2026-01-01', date_to: '2026-09-23' },
    opening_balance: 0, closing_balance: 0, totals: { debit: 100, credit: 100 },
    period_summary: { complete: true, date_from: '2026-01-01', date_to: '2026-09-23' },
    rows: [{ row_type: 'movement', biz_date: '2026-09-18', source_type: 'sale', source_id: 'sale', debit: 100, credit: 0 },
      { row_type: 'movement', biz_date: '2026-09-18', source_type: 'receipt', source_id: 'receipt', debit: 0, credit: 100 }] }
  const service = createService({ db, readComplete, now: () => ++clock,
    parseSource: input => ({ name: input.name, sha256: digest(input), base64: 'synthetic', bytes: 9, parsed: structuredClone(input.parsed) }),
    invoke: async (_name, action) => {
      if (action === 'inspectReconciliationCustomerV1') return { complete: true, source_hash: digest('fixed-financial-sources'), issues: [], cache: { stale: false } }
      if (action === 'exportCustomerAccountingLedgerV1') return structuredClone(ledger)
      throw Error(`Unexpected invocation: ${action}`)
    } })
  const run = (action, data) => service.run(action, data, actor)
  const imported = await run('importBatchV1', { company: COMPANY, cutoff: '2026-09-23', operation_id: 'race-import-operation', source: { name: 'summary.xlsx', parsed: summary } })
  const data = { batch_id: imported.batch._id, customer_id: CID }
  await run('saveMappingV1', { company: COMPANY, customer_id: CID, accountant_codes: ['112201'], basis: '合成原始对应', expected_version: 0 })
  const importDetail = day => run('importDetailV1', { batch_id: data.batch_id, accountant_code: '112201', source: { name: 'detail.xlsx', parsed: detail(day) } })
  await importDetail('2026-09-18')
  // Schedule a real competing service command after its caller's final outside
  // read, immediately before the requested transaction obtains its snapshot.
  function beforeTransaction(number, action) {
    const start = db.startTransaction; let seen = 0, armed = true
    db.startTransaction = async () => {
      if (armed && ++seen === number) { armed = false; await action() }
      return start()
    }
  }
  return { run, data, tables, importDetail, beforeTransaction }
}

test('late detail import advances batch version and prevents persisting an obsolete matched result', async () => {
  const f = await fixture()
  f.beforeTransaction(1, () => f.importDetail('2026-09-19'))
  await assert.rejects(f.run('checkCustomerV1', f.data), /明细资料版本已变化/)
  assert.equal(f.tables[COL.batches][0].details_revision, 2)
  assert.equal(f.tables[COL.sources].filter(row => row.kind === 'detail').length, 2)
  assert.equal((f.tables[COL.results] || []).length, 0)
  const rechecked = await f.run('checkCustomerV1', f.data)
  assert.equal(rechecked.details_revision, 2)
  assert.equal(rechecked.detail_match, false)
  assert.ok(rechecked.issues.some(row => row.type === 'date'))
})

test('mapping changed after fresh comparison blocks manual approval of the previous subject mapping', async () => {
  const f = await fixture(), checked = await f.run('checkCustomerV1', f.data)
  assert.equal(checked.detail_match, true)
  // reviewCustomer first saves requireFresh's comparison, then starts approval.
  f.beforeTransaction(2, () => f.run('saveMappingV1', { company: COMPANY, customer_id: CID,
    accountant_codes: ['112202'], basis: '另一名会计确认了新的对应关系', expected_version: 1 }))
  await assert.rejects(f.run('reviewCustomerV1', { ...f.data, kind: 'manual_approval', basis: '核准原对应',
    expected_result_hash: checked.result_hash }), /对应关系或明细版本已变化/)
  assert.equal(f.tables[COL.mappings][0].version, 2)
  assert.deepEqual(f.tables[COL.mappings][0].items[0].accountant_codes, ['112202'])
  assert.equal(f.tables[COL.results][0].review, null)
  assert.equal(f.tables[COL.logs].filter(row => row.action === 'reconciliation_review').length, 0)
})
