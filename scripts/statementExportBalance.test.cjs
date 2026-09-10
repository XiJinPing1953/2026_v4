'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { makeDb, loadHandler, saleDoc, tablesFor, invoke } = require('./lib/accountingTestHarness.cjs')
const base = { customer_id: 'customer-1', status: 'posted', created_at: 1 }
const sale = (id, date, amount, extra = {}) => saleDoc({ _id: id, date, settlement_mode: 'sale', unit_price: 1, flow_volume_m3: amount, ...extra })
const allocation = (id, target, receipt, amount, extra = {}) => ({ ...base, _id: id, target_type: 'sale', target_id: target, receipt_id: receipt, allocate_kind: 'receipt', allocate_amount: amount, ...extra })
const receipt = (id, date, amount, extra = {}) => ({ ...base, _id: id, biz_date: date, amount, ...extra })
function harness(sales = []) {
 const tables = tablesFor(sales[0]); tables.crm_sale_records = sales
 const db = makeDb(tables), main = loadHandler('crm-customer-settlement', db)
 return { tables, db, main }
}
async function exportsFor(h, from, to) {
 const period = { customer_id: 'customer-1', date_from: from, date_to: to }
 const daily = await invoke(h.main, 'exportCustomerStatementV1', period)
 const ledger = await invoke(h.main, 'exportCustomerAccountingLedgerV1', period)
 assert.equal(daily.code, 0); assert.equal(ledger.code, 0)
 assert.equal(h.db.writes.length, 0, 'both export entry points must stay read-only')
 return { daily: daily.data, ledger: ledger.data }
}
function assertDailyBalances(daily, ledger) {
 assert.equal(daily.opening_balance, ledger.opening_balance)
 let expected = ledger.opening_balance
 for (const day of daily.rows) {
  for (const event of ledger.rows.filter(row => row.biz_date === day.biz_date)) expected = event.balance
  assert.equal(day.balance, expected, day.biz_date)
 }
 assert.equal(daily.closing_balance, expected)
}

test('daily export follows ledger for undated embedded receipts, sale rounding and negative-sale offsets at every cutoff', async () => {
 const h = harness([sale('legacy','2026-01-03',1000,{amount_received:970,rounding_amount:30}),sale('return','2026-01-04',-10),sale('unpaid','2026-02-03',200)])
 h.tables.crm_customer_receipts = [receipt('offset','2026-01-04',10,{source_type:'sale_offset_credit'})]
 h.tables.crm_customer_allocations = [allocation('offset-allocation','legacy','offset',10,{biz_date:'2026-01-04'})]
 for (const [from,to,opening,closing] of [['2026-01-01','2026-02-28',0,200],['2026-02-01','2026-02-28',0,200],['2026-01-04','2026-01-04',10,0]]) {
  const {daily,ledger}=await exportsFor(h,from,to)
  assert.equal(ledger.closing_balance,closing)
  assert.equal(daily.closing_balance,closing)
  assert.equal(daily.opening_balance,opening)
  assertDailyBalances(daily,ledger)
  assert.equal(daily.totals.receipt,0)
  assert.equal(daily.totals.refund,0)
  assert.equal(daily.period_summary.rule_version,'customer-period-summary/2026-09-08.2')
  assert.equal(daily.period_summary.cash_received,null)
  assert.equal(daily.period_summary.known_cash.cash_received,0)
  if(from==='2026-01-01') {
   assert.equal(daily.totals.legacy_received,960)
   assert.equal(daily.totals.rounding,30)
   assert.equal(daily.totals.offset_credit,10)
   assert.match(daily.rows.find(r=>r.biz_date==='2026-01-03').note,/到账日期待核.*非独立收款凭证/)
  }
 }
})

test('dated refunds retain their business date and exclude void, offset and opening-prepay negatives from cash', async () => {
 const h=harness([sale('paid','2026-03-01',100,{amount_received:100})])
 h.tables.crm_customer_receipts=[receipt('cash','2026-03-02',100),receipt('refund','2026-03-03',-20),receipt('void','2026-03-03',-99,{status:'void'}),receipt('offset','2026-03-03',-7,{source_type:'sale_offset_credit'}),receipt('opening-invalid','2026-03-03',-8,{source_type:'opening_prepay'})]
 h.tables.crm_customer_allocations=[allocation('paid-allocation','paid','cash',100)]
 const {daily,ledger}=await exportsFor(h,'2026-03-01','2026-03-31')
 assert.equal(ledger.rows.find(r=>r.source_id==='refund')?.debit,20)
 assert.equal(daily.totals.refund,20)
 assert.equal(daily.totals.receipt,80,'legacy receipt field retains signed net cash')
 assert.equal(daily.totals.cash_received,100)
 assert.equal(daily.rows.find(r=>r.biz_date==='2026-03-03').refund,20)
 assert.equal(daily.period_summary.known_cash.refund_total,20)
 assert.equal(daily.period_summary.complete,false,'invalid opening source remains pending')
 assertDailyBalances(daily,ledger)
 for (const [from,opening,closing] of [['2026-03-03',0,20],['2026-03-04',20,20]]) {
  const period=await exportsFor(h,from,'2026-03-31')
  assert.equal(period.daily.opening_balance,opening);assert.equal(period.daily.closing_balance,closing)
  assertDailyBalances(period.daily,period.ledger)
 }
})

test('one receipt allocated across sales is counted once, while later allocations suppress embedded fallbacks without moving cash dates', async () => {
 const h=harness([sale('a','2026-01-01',60,{amount_received:60}),sale('b','2026-01-02',40,{amount_received:40,receipt_rounding_amount:2})])
 h.tables.crm_customer_receipts=[receipt('cash','2026-02-01',100,{rounding_allocated_amount:2})]
 h.tables.crm_customer_allocations=[allocation('a1','a','cash',60,{biz_date:'2026-03-01'}),allocation('a2','b','cash',40,{biz_date:'2026-03-01'}),allocation('rounding','b','cash',2,{allocate_kind:'rounding',biz_date:'2026-03-01'})]
 for(const [from,to,opening,closing,cash,rounding] of [['2026-01-01','2026-01-31',0,100,0,0],['2026-02-01','2026-02-28',100,-2,100,2],['2026-03-01','2026-03-01',-2,-2,0,0]]) {
  const {daily,ledger}=await exportsFor(h,from,to)
  assert.equal(daily.opening_balance,opening);assert.equal(daily.closing_balance,closing)
  assert.equal(daily.totals.cash_received,cash);assert.equal(daily.totals.receipt,cash)
  assert.equal(daily.totals.rounding,rounding);assert.equal(daily.totals.legacy_received,0)
  assert.equal(daily.period_summary.cash_received,cash)
  assertDailyBalances(daily,ledger)
 }
})

test('opening debt, prior undated settlement and prepaid credit keep separate meanings at cutoffs', async () => {
 const h=harness([sale('new','2026-01-03',20),sale('old-refund','2026-01-04',0,{amount_received:-7})])
 h.tables.crm_customer_opening_debts=[{...base,_id:'opening',biz_date:'2025-12-31',source_type:'opening',amount:100,amount_received:95,receipt_rounding_amount:5}]
 h.tables.crm_customer_receipts=[receipt('prepay','2026-01-01',50,{source_type:'opening_prepay'})]
 for(const [from,to,opening,closing] of [['2025-12-31','2026-01-31',0,-23],['2026-01-01','2026-01-31',0,-23],['2026-01-02','2026-01-31',-50,-23]]) {
  const {daily,ledger}=await exportsFor(h,from,to)
  assert.equal(daily.opening_balance,opening);assert.equal(daily.closing_balance,closing)
  assert.equal(daily.totals.cash_received,0);assert.equal(daily.totals.refund,0)
  assert.equal(daily.totals.legacy_refund,7)
  assert.equal(daily.totals.opening_prepay,from==='2026-01-02'?0:50)
  assert.equal(daily.totals.opening_debt,from==='2025-12-31'?100:0)
  assert.equal(daily.totals.legacy_received,from==='2025-12-31'?95:0)
  assert.equal(daily.period_summary.cash_received,null)
  assertDailyBalances(daily,ledger)
 }
})

function loadWorkbooks() {
 const read=file=>fs.readFileSync(path.resolve(__dirname,'../src',file),'utf8').replace(/^import .*\n/gm,'').replace(/export /g,'')
 const single={};vm.createContext(single)
 vm.runInContext(read('services/mappers/customerPeriodSummary.js'),single)
 vm.runInContext(read('components/domain/customer/statement/exportWorkbook.js')+'\nthis.dailyRows=buildStatementSheetRows;this.single=buildCustomerStatementWorkbookXml',single)
 const batch={buildStatementSheetRows:single.dailyRows};vm.createContext(batch)
 vm.runInContext(read('components/domain/customer/exportCustomerListWorkbook.js')+'\nthis.batch=buildCustomerListWorkbookXml',batch)
 return {rows:single.dailyRows,single:single.single,batch:batch.batch}
}

test('single and batch render the same source columns, three-decimal signed balance and pending cash notice', async () => {
 const h=harness([])
 h.tables.crm_customer_opening_debts=[{...base,_id:'tiny-debt',biz_date:'2025-12-31',source_type:'opening',amount:.018,amount_received:0,money_scale:3}]
 h.tables.crm_customer_receipts=[receipt('tiny-prepay','2026-01-01',.02,{source_type:'opening_prepay'})]
 const {daily}=await exportsFor(h,'2026-01-01','2026-01-02')
 assert.equal(daily.money_scale,3);assert.equal(daily.closing_balance,-.002)
 const wb=loadWorkbooks(),single=wb.single(daily),batch=wb.batch({statementSheets:[daily]})
 const sheet=single.match(/<Worksheet ss:Name="客户对账单"><Table>(.*?)<\/Table>/s)[1]
 assert.ok(batch.includes('<Table>'+sheet+'</Table>'),'batch must use the identical daily row builder')
 for(const xml of [single,batch]) {
  assert.match(xml,/正欠款\/负预付款/);assert.match(xml,/历史已收差额/)
  assert.match(xml,/<NumberFormat ss:Format="0.000"/);assert.match(xml,/ss:StyleID="sMoney3"><Data ss:Type="Number">-0.002</)
 }
 const missing=structuredClone(daily);delete missing.rows[0].legacy_received;delete missing.totals.refund
 const rendered=wb.rows(missing)
 assert.equal(rendered[6][6].value,'待核');assert.equal(rendered.at(-1)[5].value,'待核')
 const legacy=structuredClone(daily);delete legacy.statement_balance_version
 const legacyRows=wb.rows(legacy)
 assert.match(legacyRows[3][0].value,/旧版导出.*重新导出/)
 assert.equal(legacyRows[5][10].value,'待核');assert.equal(legacyRows.at(-1)[10].value,'待核')
 const pending=structuredClone(daily);pending.period_summary.complete=false;pending.period_summary.unresolved_count=2;pending.period_summary.cash_received=null
 assert.match(wb.rows(pending)[3][0].value,/现金完整性待核（2项）/)
})

test('void positive allocations cannot suppress historical receipt fallback or change source records', async () => {
 const h=harness([sale('legacy-paid','2026-01-01',100,{amount_received:100})])
 h.tables.crm_customer_receipts=[receipt('void-cash','2026-01-02',100,{status:'void'})]
 h.tables.crm_customer_allocations=[allocation('void-allocation','legacy-paid','void-cash',100,{status:'void',biz_date:'2026-01-02'})]
 const before=structuredClone(h.tables)
 const {daily,ledger}=await exportsFor(h,'2026-01-01','2026-01-31')
 assert.equal(daily.totals.legacy_received,100)
 assert.equal(daily.closing_balance,0);assert.equal(ledger.closing_balance,0)
 assert.equal(ledger.rows.find(r=>r.source_type==='sale_received_fallback')?.credit,100)
 assert.equal(daily.totals.cash_received,0)
 assert.equal(daily.period_summary.cash_received,null)
 assertDailyBalances(daily,ledger)
 assert.deepEqual(h.tables,before)
 assert.equal(h.db.writes.length,0)
})
