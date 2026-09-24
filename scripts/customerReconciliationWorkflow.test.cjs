'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseAccountingSummary, parseAccountingDetail, compareDetail, compare, validatePeriod } = require('./customerReconciliationCore.cjs')

const fixture = () => [
  ['应收统计表'],['编制单位：演示账套',null,null,'2026年09月'],
  ['客户编码','客户','期初余额',null,'本期发生',null,'本期收回',null,'余额','本年累计'],
  [null,null,null,null,null,null,null,null,null,'发生','收回'],
  ['A','主户',0,null,0,null,0,null,0,16131,16131],
  ['B','子户',0,null,0,null,0,null,0,9127,9127],
  ['C','期初清账户',0,null,1200,null,1200,null,0,13964,13956],
  ['D','三位金额户',0,null,0,null,0,null,0,86708.803,164532.1],
  ['E','待核户',100,null,30,null,10,null,120,160,40],
  [null,'合计',100,null,1230,null,1210,null,120,16131+9127+13964+86708.803+160,16131+9127+13956+164532.1+40]
]
const ledger = (opening,debit,credit,closing,complete=true) => ({ opening_balance:opening, totals:{debit,credit}, closing_balance:closing, period_summary:{complete} })
const customers = [
  {_id:'main',name:'主户',is_active:true},
  {_id:'child',name:'子户',settlement_customer_id:'main',is_active:false},
  {_id:'writeoff',name:'期初清账户',is_active:true},
  {_id:'fraction',name:'三位金额户',is_active:true},
  {_id:'review',name:'待核户',is_hidden:true,is_active:false}
]
const mappings = [
  {crm_customer_id:'main',accountant_codes:['A','B']},
  {crm_customer_id:'writeoff',accountant_codes:['C']},
  {crm_customer_id:'fraction',accountant_codes:['D']},
  {crm_customer_id:'review',accountant_codes:['E']}
]
const ledgers = {
  main:ledger(0,25258,25258,0),
  writeoff:{...ledger(-8,13964,13956,0),period_summary:{complete:true,cash_received:13963}},
  fraction:ledger(77823.297,86708.803,164532.1,0),
  review:ledger(100,160,39,221)
}

test('整批表先验证月份、逐户月度借贷和合计，再推回年初余额', () => {
  const a = parseAccountingSummary(fixture())
  assert.equal(a.count,5)
  assert.equal(a.rows.find(r=>r.code==='C').opening_milli,-8000)
  assert.equal(a.rows.find(r=>r.code==='D').debit_milli,86708803)
  assert.equal(a.controls.closing_milli,120000)
  const duplicate = fixture();duplicate[6][0]='A';assert.throws(()=>parseAccountingSummary(duplicate),/重复/)
  const missing = fixture();missing.splice(5,1);assert.throws(()=>parseAccountingSummary(missing),/合计行/)
  const broken = fixture();broken[9][9]=0;assert.throws(()=>parseAccountingSummary(broken),/合计行/)
})

test('多会计科目合并、旧预付清账和三位金额均按会计借贷比较，待核户不自动通过', () => {
  const result=compare({accounting:parseAccountingSummary(fixture()),customers,expectedCustomerCount:5,ledgers,mapping:mappings})
  assert.equal(result.settlement_customer_count,4)
  assert.equal(result.matched_count,3)
  assert.equal(result.exception_count,1)
  assert.equal(result.customers.find(r=>r.customer_id==='writeoff').difference.credit_milli,0)
  assert.equal(result.customers.find(r=>r.customer_id==='review').status,'异常待核')
  assert.equal(result.customers.find(r=>r.customer_id==='review').is_hidden,true)
})

test('未确认映射仅给同名候选，缺页、重复客户及重复科目立即拒绝', () => {
  const input={accounting:parseAccountingSummary(fixture()),customers,expectedCustomerCount:5,ledgers,mapping:mappings.slice(0,2)}
  const result=compare(input)
  assert.equal(result.unmapped_count,2)
  assert.deepEqual(result.customers.find(r=>r.customer_id==='fraction').suggested_codes,['D'])
  assert.throws(()=>compare({...input,expectedCustomerCount:6}),/不完整/)
  assert.throws(()=>compare({...input,customers:[...customers,customers[0]],expectedCustomerCount:6}),/重复/)
  assert.throws(()=>compare({...input,mapping:[...mappings.slice(0,2),{crm_customer_id:'review',accountant_codes:['A']}]}),/重复分配/)
})

test('会计月份、跨年起点及无效截止日期均明确拒绝', () => {
  assert.doesNotThrow(()=>validatePeriod('2026-01-01','2026-09-23','2026-09'))
  assert.throws(()=>validatePeriod('2026-05-01','2026-09-23','2026-09'),/01-01/)
  assert.throws(()=>validatePeriod('2026-01-01','2026-09-23','2026-08'),/月份/)
  assert.throws(()=>validatePeriod('2026-01-01','2026-09-31','2026-09'),/截止日/)
})

test('会计逐笔与CRM按日期和借贷精确对照，日期变化只列候选，不推定现金性质', () => {
  const detail=[['明细账'],['账套名称:演示账套'],['科目:112202150216 应收账款_站上_示例   期间:202601至202609   单位:元'],
    ['序号','日期','凭证号','摘要','借方','贷方','方向','余额'],
    ['1','2026-01','','期初余额',0,0,'贷',8],
    ['2','2026-01-12','记-1','销售',10,0,'借',2],
    ['3','2026-01-13','记-2','收款',0,10,'贷',8],
    ['4','2026-06-12','记-3','清账',0,-7,'贷',1],
    ['5','2026-09','','本年累计',10,3,'贷',1]]
  const a=parseAccountingDetail(detail)
  assert.equal(a.opening_milli,-8000)
  assert.equal(a.credit_milli,3000)
  const matched=compareDetail([a],{rows:[
    {row_type:'movement',biz_date:'2026-01-12',debit:10,credit:0},
    {row_type:'movement',biz_date:'2026-01-13',debit:0,credit:10},
    {row_type:'movement',biz_date:'2026-06-12',debit:0,credit:-7}
  ]})
  assert.equal(matched.fully_matched,true)
  const changed=compareDetail([a],{rows:[{row_type:'movement',biz_date:'2026-01-14',debit:0,credit:10}]})
  assert.equal(changed.possible_date_differences.length,1)
  const bad=structuredClone(detail);bad[8][5]=4;assert.throws(()=>parseAccountingDetail(bad),/不一致/)
})
