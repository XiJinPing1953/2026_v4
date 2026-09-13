'use strict'
const assert=require('node:assert/strict')
const fs=require('node:fs')
const p=require('../uniCloud-alipay/cloudfunctions/crm-k004-reconciliation/plan')
const file='outputs/trust-audit/2026-09-13/k004/raw-before.json'
assert.ok(fs.existsSync(file),'K004账务测试需要已取证原始备份')
const before=JSON.parse(fs.readFileSync(file,'utf8'))
const evidence={confirmed_by_user:true,customer_id:p.CUSTOMER_ID,source_snapshot_hash:before.snapshot_hash,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}
const plan=p.buildPlan(before,evidence,{_id:'test-actor'},1789280000000)
assert.equal(plan.summary.cash_received,168903)
assert.equal(plan.summary.receivable_balance,7455)
assert.equal(plan.summary.cutoff_balance,2760)
assert.equal(plan.summary.allocations_created,46)
assert.deepEqual(plan,p.buildPlan(before,evidence,{_id:'test-actor'},1789280000000))
const tables=structuredClone(before.tables)
for(const w of plan.writes){const i=tables[w.table].findIndex(r=>r._id===w.id);if(i<0)tables[w.table].push(w.after);else tables[w.table][i]=w.after}
assert.equal(p.expectedAfter(before,plan),p.snapshotHash(tables))
const permitted=new Set(['amount_received','receipt_allocated_amount','receipt_rounding_amount','updated_at','accounting_reconciliation'])
for(const old of before.tables.crm_sale_records){const after=tables.crm_sale_records.find(s=>s._id===old._id);for(const key of new Set([...Object.keys(old),...Object.keys(after)]))if(!permitted.has(key))assert.deepEqual(after[key],old[key],`销售事实变更 ${old._id}/${key}`);assert.equal(after.payment_status,old.payment_status)}
const isActive=r=>!r.status||r.status==='posted'
const active=tables.crm_customer_receipts.filter(isActive)
assert.equal(active.filter(r=>r.entry_kind==='offset_credit').reduce((n,r)=>n+r.amount,0),1344)
assert.equal(active.filter(r=>r.amount<0).length,0)
assert.equal(tables.crm_customer_allocations.filter(a=>a.receipt_id===p.SPEC.aggregate_id&&isActive(a)).length,0)
for(const old of before.tables.crm_customer_receipts.filter(r=>r.status==='void'))assert.deepEqual(tables.crm_customer_receipts.find(r=>r._id===old._id),old)
assert.equal(tables.crm_customer_opening_debts[0].source_type,'balance_adjustment')
assert.equal(tables.crm_customer_opening_debts[0].amount_received,21)
const adjustmentAlloc=tables.crm_customer_allocations.find(a=>a.target_type==='balance_adjustment')
assert.equal(adjustmentAlloc.allocate_amount,21)
assert.equal(adjustmentAlloc.receipt_biz_date,'2026-04-05')
assert.equal(adjustmentAlloc.biz_date,'2026-05-12')
for(const mutate of [s=>s.tables.crm_sale_records[0].amount_received++,s=>s.tables.crm_customer_allocations.pop(),s=>s.tables.crm_sale_records[0].customer_id='other',s=>s.tables.crm_customer_receipts.push({...s.tables.crm_customer_receipts[0],_id:'new'})]){
 const s=structuredClone(before);mutate(s);s.snapshot_hash=p.snapshotHash(s.tables)
 assert.throws(()=>p.buildPlan(s,{...evidence,source_snapshot_hash:s.snapshot_hash},{_id:'actor'},1),/哈希/)
}
assert.throws(()=>p.buildPlan(before,{...evidence,confirmed_by_user:false},{_id:'actor'},1),/确认/)
assert.throws(()=>p.buildPlan(before,{...evidence,source_commit:''},{_id:'actor'},1),/版本/)
assert.throws(()=>p.expectedAfter({tables},plan),/原值|已存在/)
console.log('K004 verified: protected sales, exact source and target conservation, 39 cash receipts, no refund, opening and adjustment, cutoff and final balance, fail-closed drift and replay')
const schema=require('../uniCloud-alipay/database/schema/crm_customer_opening_debts.schema.json')
for(const row of tables.crm_customer_opening_debts){for(const k of schema.required)assert.ok(k in row,`schema required ${k}`);for(const k of Object.keys(row))assert.ok(k in schema.properties,`schema unknown ${k}`)}
const {mutableDb}=require('./lib/mutableAccountingDb.cjs')
const {loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
;(async()=>{
 const liveTables={...structuredClone(tables),crm_users:[{_id:'sa',token:'test',role:'superadmin',username:'sa'}],crm_operation_logs:[]}
 const handler=loadHandler('crm-customer-settlement',mutableDb(liveTables))
 for(const date_to of ['2026-09-06','2026-09-13'])for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
 const r=await invoke(handler,action,{customer_id:p.CUSTOMER_ID,date_from:'2026-01-01',date_to});assert.equal(r.code,0,JSON.stringify(r))
 const period=r.data.period_summary, balance=date_to==='2026-09-06'?2760:7455, revenue=date_to==='2026-09-06'?172776.25:177471.25
 assert.equal(period.complete,true);assert.equal(period.cash_complete,true);assert.equal(period.unresolved_count,0)
 assert.equal(period.cash_received,168903);assert.equal(period.net_cash_received,168903);assert.equal(period.refund_total,0)
 assert.equal(period.business_revenue,revenue);assert.equal(period.rounding_total,63.25);assert.equal(period.noncash_balance_adjustment,21)
 assert.equal(period.opening_prepay_transferred,1071)
 if(action==='getCustomerStatementV1'){assert.equal(r.data.summary.prepay_balance,0);assert.equal(r.data.summary.receivable_balance,7455);assert.equal(r.data.summary.amount_received_total,168903);assert.equal(tables.crm_customers[0].amount_received_total,r.data.summary.amount_received_total)}
 if(action==='exportCustomerStatementV1')assert.equal(r.data.closing_balance,balance)
 if(action==='exportCustomerAccountingLedgerV1')assert.equal(r.data.closing.balance,balance)
 console.log(`${date_to} ${action}: cash ${period.cash_received}, revenue ${revenue}, rounding 63.25, adjustment 21, unresolved 0`)
 }
 const changed=Object.keys(liveTables.crm_customers[0]).filter(k=>JSON.stringify(liveTables.crm_customers[0][k])!==JSON.stringify(tables.crm_customers[0][k]))
 console.log('Customer refresh changed fields:',changed.join(', '))
 assert.deepEqual(changed,[])
 assert.equal(p.snapshotHash(liveTables),p.expectedAfter(before,plan),'业务查询不得改变本批原始回读哈希')
})().catch(e=>{console.error(e);process.exitCode=1})
