'use strict'
const assert=require('node:assert/strict')
const fs=require('node:fs')
const p=require('../uniCloud-alipay/cloudfunctions/crm-k005-reconciliation/plan')
const file='outputs/trust-audit/2026-09-13/k005/raw-before.json'
assert.ok(fs.existsSync(file),'K005账务测试需要已取证原始备份')
const before=JSON.parse(fs.readFileSync(file,'utf8'))
const evidence={confirmed_by_user:true,customer_id:p.CUSTOMER_ID,source_snapshot_hash:before.snapshot_hash,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}
const now=Date.now()-1000
const plan=p.buildPlan(before,evidence,{_id:'test-actor'},now)
assert.equal(plan.summary.cash_received,47535)
assert.equal(plan.summary.receivable_balance,0)
assert.equal(plan.summary.allocations_created,21)
assert.deepEqual(plan,p.buildPlan(before,evidence,{_id:'test-actor'},now))
const tables=structuredClone(before.tables)
for(const w of plan.writes){const i=tables[w.table].findIndex(r=>r._id===w.id);if(i<0)tables[w.table].push(w.after);else tables[w.table][i]=w.after}
assert.equal(p.expectedAfter(before,plan),p.snapshotHash(tables))
const permitted=new Set(['updated_at','accounting_reconciliation'])
for(const name of p.TABLES)for(const old of before.tables[name]){
 const after=tables[name].find(r=>r._id===old._id)
 for(const key of new Set([...Object.keys(old),...Object.keys(after)])){
  const dateChanged=(name==='crm_customer_receipts'&&old._id===p.SPEC.date_correction.receipt_id||name==='crm_customer_allocations'&&old.receipt_id===p.SPEC.date_correction.receipt_id)&&['biz_date','receipt_biz_date'].includes(key)
  if(!permitted.has(key)&&!dateChanged)assert.deepEqual(after[key],old[key],`原事实变更 ${name}/${old._id}/${key}`)
 }
}
const additions=plan.writes.filter(w=>!w.before&&w.table==='crm_customer_receipts').map(w=>w.after)
assert.equal(additions.length,21)
assert.deepEqual(additions.filter(r=>['2026-03-30','2026-03-31'].includes(r.biz_date)).map(r=>r.amount),[20,1400])
assert.equal(additions.find(r=>r.biz_date==='2026-04-10').amount,2050)
assert.equal(additions.find(r=>r.biz_date==='2026-04-12').amount,1350)
assert.equal(additions.find(r=>r.biz_date==='2026-01-29').amount,450)
assert.equal(tables.crm_customer_receipts.find(r=>r._id===p.SPEC.date_correction.receipt_id).biz_date,'2026-04-26')
assert.deepEqual(tables.crm_customer_opening_debts,before.tables.crm_customer_opening_debts)
for(const mutate of [s=>s.tables.crm_sale_records[0].amount_received++,s=>s.tables.crm_customer_allocations.pop(),s=>s.tables.crm_sale_records[0].customer_id='other',s=>s.tables.crm_customer_receipts.push({...s.tables.crm_customer_receipts[0],_id:'new'})]){
 const s=structuredClone(before);mutate(s);s.snapshot_hash=p.snapshotHash(s.tables)
 assert.throws(()=>p.buildPlan(s,{...evidence,source_snapshot_hash:s.snapshot_hash},{_id:'actor'},1),/哈希/)
}
assert.throws(()=>p.buildPlan(before,{...evidence,confirmed_by_user:false},{_id:'actor'},1),/确认/)
assert.throws(()=>p.buildPlan(before,{...evidence,source_commit:''},{_id:'actor'},1),/版本/)
assert.throws(()=>p.expectedAfter({tables},plan),/原值|已存在/)
const {mutableDb}=require('./lib/mutableAccountingDb.cjs')
const {loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
;(async()=>{
 const liveTables={...structuredClone(tables),crm_users:[{_id:'sa',token:'test',role:'superadmin',username:'sa'}],crm_operation_logs:[]}
 const handler=loadHandler('crm-customer-settlement',mutableDb(liveTables))
 for(const date_to of ['2026-09-13'])for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
 const r=await invoke(handler,action,{customer_id:p.CUSTOMER_ID,date_from:'2026-01-01',date_to});assert.equal(r.code,0,JSON.stringify(r))
 const period=r.data.period_summary, balance=0, revenue=46415.5
 assert.equal(period.complete,true);assert.equal(period.cash_complete,true);assert.equal(period.unresolved_count,0)
 assert.equal(period.cash_received,47535);assert.equal(period.net_cash_received,47535);assert.equal(period.refund_total,0)
 assert.equal(period.business_revenue,revenue);assert.equal(period.rounding_total,196.5);assert.equal(period.noncash_balance_adjustment,0)
 assert.equal(period.opening_prepay_transferred,0)
 if(action==='getCustomerStatementV1'){assert.equal(r.data.summary.prepay_balance,0);assert.equal(r.data.summary.receivable_balance,0);assert.equal(r.data.summary.amount_received_total,47140);assert.equal(tables.crm_customers[0].amount_received_total,r.data.summary.amount_received_total)}
 if(action==='exportCustomerStatementV1')assert.equal(r.data.closing_balance,balance)
 if(action==='exportCustomerAccountingLedgerV1')assert.equal(r.data.closing.balance,balance)
 console.log(`${date_to} ${action}: cash ${period.cash_received}, revenue ${revenue}, rounding 196.5, adjustment 0, unresolved 0`)
 }
 for(const [date,cash] of [['2026-03-30',20],['2026-03-31',1400],['2026-04-10',2050],['2026-04-12',1350],['2026-04-25',0],['2026-04-26',850]])for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
  const r=await invoke(handler,action,{customer_id:p.CUSTOMER_ID,date_from:date,date_to:date})
  assert.equal(r.code,0,JSON.stringify(r));assert.equal(r.data.period_summary.cash_received,cash,`${action}/${date}`);assert.equal(r.data.period_summary.unresolved_count,0)
 }
 const changed=Object.keys(liveTables.crm_customers[0]).filter(k=>JSON.stringify(liveTables.crm_customers[0][k])!==JSON.stringify(tables.crm_customers[0][k]))
 console.log('Customer refresh changed fields:',changed.join(', '))
 assert.deepEqual(changed,[])
 assert.equal(p.snapshotHash(liveTables),p.expectedAfter(before,plan),'业务查询不得改变本批原始回读哈希')
})().catch(e=>{console.error(e);process.exitCode=1})
