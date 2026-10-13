'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const core = require('../uniCloud-alipay/cloudfunctions/common/customerReconciliation')
const { compareCustomer, parseAccountingDetail, validateAccountingDetails, money } = core

const accountingRow = (opening, debit, credit, closing, code = '112201') => ({ code, name: '测试结算户',
  opening_milli: money(opening), debit_milli: money(debit), credit_milli: money(credit), closing_milli: money(closing) })
const crmRow = (date, debit, credit, source_type = 'sale', source_id = `${source_type}-${date}`) => ({ row_type: 'movement', biz_date: date, debit, credit, source_type, source_id })
const accountRow = (date, debit, credit, extra = {}) => ({ date, debit_milli: money(debit), credit_milli: money(credit), voucher: '记-1', summary: '', ...extra })
function fixture({ opening = 0, debit = 100, credit = 100, closing = 0, crmRows = [], accountRows = [], details = false } = {}) {
  const row = accountingRow(opening, debit, credit, closing)
  return {
    accounting: { company: '测试账套', month: '2026-09', count: 1, rows: [row], controls: row },
    customer: { _id: 'customer', name: '测试结算户' },
    mapping: { crm_customer_id: 'customer', accountant_codes: ['112201'] },
    ledger: { period: { date_from: '2026-01-01', date_to: '2026-09-23' }, opening_balance: opening, totals: { debit, credit }, closing_balance: closing,
      period_summary: { complete: true, cash_received: credit, business_revenue: debit }, rows: crmRows },
    internal: { complete: true, issues: [] },
    ...(details ? { details: [{ ...row, company: '测试账套', account_code: row.code, account_name: row.name,
      period_month_from: '202601', period_month_to: '202609', rows: accountRows }] } : {})
  }
}
const binding = input => ({ accounting: input.accounting, details: input.details, codes: ['112201'], dateFrom: '2026-01-01', cutoff: '2026-09-23' })

test('CLI使用唯一云端计算源码；无明细只能达到汇总级别', () => {
  assert.equal(require('./customerReconciliationCore.cjs'), core)
  const input = fixture(), before = structuredClone(input), result = compareCustomer(input)
  assert.equal(result.summary_match, true)
  assert.equal(result.detail_match, null)
  assert.equal(result.evidence_level, 'summary')
  assert.equal(result.classification_verified, false)
  assert.deepEqual(input, before)
})

test('不能以期末一致掩盖同额借贷虚增；保留后端现金与营业额字段', () => {
  const input = fixture({ debit: 22942.5, credit: 22942.5 })
  input.ledger.totals = { debit: 23902.5, credit: 23902.5 }
  input.ledger.period_summary = { complete: true, cash_received: 23900, business_revenue: 22942.5, rounding_total: 2.5, settlement_writeoff_income: 960 }
  const result = compareCustomer(input)
  assert.equal(result.summary_match, false)
  assert.equal(result.comparison.difference.closing_milli, 0)
  assert.equal(result.comparison.difference.debit_milli, 960000)
  assert.equal(result.period_summary.cash_received, 23900)
  assert.equal(result.period_summary.business_revenue, 22942.5)
  assert.equal(result.period_summary.settlement_writeoff_income, 960)
  assert.ok(result.issues.some(row => row.code === 'CONTROL_TOTAL_DIFFERENCE'))
})

test('同额同日的逐笔匹配不把备注当作实际到账或业务性质证明', () => {
  const input = fixture({ details: true,
    crmRows: [crmRow('2026-08-18', 100, 0), crmRow('2026-08-18', 0, 100, 'receipt')],
    accountRows: [accountRow('2026-08-18', 100, 0), accountRow('2026-08-18', 0, 100, { summary: '已到账，自动核准所有现金' })] })
  const result = compareCustomer(input)
  assert.equal(result.detail_match, true)
  assert.equal(result.evidence_level, 'detail')
  assert.equal(result.classification_verified, false)
  assert.match(result.interpretation, /摘要文字不能证明现金/)
})

test('借贷四项都相同仍能发现逐笔相互抵消的金额错误', () => {
  const input = fixture({ details: true,
    crmRows: [crmRow('2026-08-01', 60, 0), crmRow('2026-08-02', 40, 0), crmRow('2026-08-18', 0, 100, 'receipt')],
    accountRows: [accountRow('2026-08-01', 50, 0), accountRow('2026-08-02', 50, 0), accountRow('2026-08-18', 0, 100)] })
  const result = compareCustomer(input)
  assert.equal(result.summary_match, true)
  assert.equal(result.detail_match, false)
  assert.equal(result.issues.filter(row => row.type === 'amount').length, 2)
})

test('日期差异和疑似重复分别列候选，不提出无依据改账', () => {
  const input = fixture({ details: true,
    crmRows: [crmRow('2026-08-01', 100, 0), crmRow('2026-08-19', 0, 100, 'receipt')],
    accountRows: [accountRow('2026-08-01', 100, 0), accountRow('2026-08-18', 0, 100)] })
  assert.ok(compareCustomer(input).issues.some(row => row.type === 'date' && row.suggested_action === 'verify_receipt_identity'))
  input.ledger.rows.push(crmRow('2026-08-01', 100, 0, 'sale', 'extra-sale'))
  input.ledger.totals.debit = 200
  input.ledger.closing_balance = 100
  const result = compareCustomer(input)
  assert.ok(result.issues.some(row => row.type === 'duplicate'))
  assert.equal(result.detail_match, false)
})

test('已确认优惠缺于好会计时列补记核查，不提出抹零冲回', () => {
  const input = fixture({ debit: 472, credit: 470, closing: 2, details: true,
    crmRows: [crmRow('2026-09-20', 472, 0), crmRow('2026-09-20', 0, 470, 'receipt'), crmRow('2026-09-20', 0, 2, 'receipt_rounding')],
    accountRows: [accountRow('2026-09-20', 472, 0), accountRow('2026-09-20', 0, 470)] })
  input.ledger.totals.credit = 472; input.ledger.closing_balance = 0
  input.ledger.period_summary = { complete: true, cash_received: 470, business_revenue: 472, rounding_total: 2 }
  const result = compareCustomer(input)
  assert.ok(result.issues.some(row => row.code === 'ACCOUNTING_ENTRY_NOT_MATCHED' && row.crm.source_type === 'receipt_rounding'))
  assert.equal(result.issues.some(row => row.suggested_action === 'rounding_reversal'), false)
})

test('多收结清不改现金；有结构化分类冲突时明确待核', () => {
  const input = fixture({ debit: 22942.5, credit: 22942.5, details: true,
    crmRows: [crmRow('2026-08-18', 22942.5, 0), crmRow('2026-08-18', 0, 23900, 'receipt'),
      crmRow('2026-08-18', 0, 2.5, 'receipt_rounding'), crmRow('2026-08-18', 0, -960, 'prepay_writeoff')],
    accountRows: [accountRow('2026-08-18', 22942.5, 0), accountRow('2026-08-18', 0, 23900), accountRow('2026-08-18', 0, 2.5),
      accountRow('2026-08-18', 0, -960, { business_kind: 'other_fee' })] })
  input.ledger.period_summary = { complete: true, cash_received: 23900, business_revenue: 22942.5, rounding_total: 2.5, settlement_writeoff_income: 960 }
  const result = compareCustomer(input)
  assert.equal(result.summary_match, true)
  assert.equal(result.detail_match, false)
  assert.ok(result.issues.some(row => row.type === 'classification'))
  assert.equal(result.period_summary.cash_received, 23900)
})

test('不完整读取、缺控制数或内部异常不能获得核对通过', () => {
  for (const mutate of [
    x => { x.ledger.period_summary.complete = false },
    x => { delete x.ledger.totals.credit },
    x => { x.internal.complete = false },
    x => { x.internal.issues = [{ type: 'evidence', code: 'OVERALLOCATED', message: '收款超分配' }] },
    x => { x.ledger.period.date_to = '2026-08-23' }
  ]) {
    const input = fixture(); mutate(input)
    const result = compareCustomer(input)
    assert.equal(result.summary_match, false)
    assert.equal(result.evidence_level, 'incomplete')
  }
})

test('同名只能候选，已确认一主多科目可复用且不漏隐藏别名', () => {
  const input = fixture()
  input.mapping = []
  const pending = compareCustomer(input)
  assert.equal(pending.summary_match, false)
  assert.deepEqual(pending.comparison.suggested_codes, ['112201'])
  input.accounting.rows = [accountingRow(0, 60, 60, 0), { ...accountingRow(0, 40, 40, 0, '112202'), name: '别名' }]
  input.accounting.count = 2
  input.mapping = { crm_customer_id: 'customer', accountant_codes: ['112201', '112202'] }
  input.customers = [input.customer, { _id: 'alias', name: '别名', settlement_customer_id: 'customer', is_hidden: true }]
  assert.equal(compareCustomer(input).summary_match, true)
})

test('明细必须绑定账套、完整期间、截止日、编码名称及逐笔控制数', () => {
  const original = fixture({ details: true, crmRows: [crmRow('2026-08-18', 100, 100)], accountRows: [accountRow('2026-08-18', 100, 100)] })
  assert.equal(validateAccountingDetails(binding(original)), true)
  for (const mutate of [
    x => { x.details[0].company = '其他账套' },
    x => { delete x.details[0].company },
    x => { x.details[0].period_month_from = '202602' },
    x => { x.details[0].period_month_to = '202608' },
    x => { x.details[0].rows[0].date = '2026-09-24' },
    x => { x.details[0].account_code = '112202' },
    x => { x.details[0].code = 'different-code' },
    x => { x.details[0].account_name = '其他客户' },
    x => { x.details[0].rows[0].debit_milli = 0 }
  ]) {
    const input = structuredClone(original); mutate(input)
    assert.throws(() => validateAccountingDetails(binding(input)))
    const result = compareCustomer(input)
    assert.equal(result.detail_match, false)
    assert.equal(result.evidence_level, 'incomplete')
    assert.ok(result.issues.some(row => row.code === 'DETAIL_SCOPE_INVALID'))
  }
  const fallback = structuredClone(original)
  delete fallback.details[0].account_code
  fallback.details[0].code = '112201'
  assert.equal(validateAccountingDetails(binding(fallback)), true)
})

test('伪装完整的CRM逐笔缺行不能升级为明细一致', () => {
  const input = fixture({ details: true, crmRows: [], accountRows: [accountRow('2026-08-18', 100, 100)] })
  const result = compareCustomer(input)
  assert.equal(result.detail_match, false)
  assert.equal(result.evidence_level, 'incomplete')
  assert.ok(result.issues.some(row => row.code === 'DETAIL_SCOPE_INVALID'))
})

test('明细解析保留编码账套行号，拒绝无法识别的行、余额方向和无效日期', () => {
  const matrix = [ ['明细账'], ['账套名称:测试账套'], ['科目:112201 应收账款_站上_测试结算户   期间:202601至202609   单位:元'],
    ['序号', '日期', '凭证号', '摘要', '借方', '贷方', '方向', '余额'],
    ['1', '2026-01', '', '期初余额', 0, 0, '平', 0], ['2', '2026-08-18', '记-1', '销售', 100, 0, '借', 100],
    ['3', '2026-09', '', '本年累计', 100, 0, '借', 100] ]
  const parsed = parseAccountingDetail(matrix)
  assert.equal(parsed.company, '测试账套')
  assert.equal(parsed.account_code, '112201')
  assert.equal(parsed.rows[0].source_row, 6)
  for (const mutate of [
    x => { x[5][1] = '2026-02-31' },
    x => { x[6][6] = '未知' },
    x => { x.push(['遗失日期的明细', '', '', '', 1]) }
  ]) { const input = structuredClone(matrix); mutate(input); assert.throws(() => parseAccountingDetail(input)) }
  const noCode = structuredClone(matrix)
  noCode[2][0] = '科目:应收账款_站上_测试结算户   期间:202601至202609   单位:元'
  assert.equal(parseAccountingDetail(noCode).account_code, '')
})
