'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs'),{loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const p=require('../uniCloud-alipay/cloudfunctions/crm-k012-reconciliation/plan'),{snapshot}=require('../uniCloud-alipay/cloudfunctions/crm-k012-reconciliation/snapshot')
test('K012受保护批次：失败回滚、冲突、幂等及三账务入口',async()=>{
 const before=JSON.parse(fs.readFileSync(process.env.K012_SOURCE)).data,t=structuredClone(before.tables),cid=before.customer_id
 t.crm_users=[{_id:'testactor',username:'test',token:'test',role:'superadmin'}];t.crm_operation_logs=[]
 const db=mutableDb(t),h=loadHandler('crm-k012-reconciliation',db),s=loadHandler('crm-customer-settlement',db)
 const req={customer_id:cid,operation_id:'k012-reconciliation-20260915-v1',expected_snapshot_hash:before.snapshot_hash,evidence:{confirmed_by_user:true,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}}
 assert.equal((await h({action:'prepareV1',data:req})).code,403)
 assert.equal((await invoke(h,'prepareV1',{...req,customer_id:'a'.repeat(24)})).code,409)
 let r=await invoke(h,'prepareV1',req);assert.equal(r.code,0,r.msg);const plan=r.data,act={customer_id:cid,operation_id:req.operation_id,plan_hash:plan.plan_hash}
 t.crm_customer_receipts[0].note+='changed';assert.equal((await invoke(h,'rehearseV1',act)).code,409);t.crm_customer_receipts[0].note=before.tables.crm_customer_receipts[0].note
 r=await invoke(h,'rehearseV1',{...act,fail_after_writes:5});assert.equal(r.data.status,'interruption_rolled_back');assert.equal((await snapshot(db,cid)).snapshot_hash,before.snapshot_hash)
 r=await invoke(h,'rehearseV1',act);assert.equal(r.data.status,'rehearsed_rolled_back');r=await invoke(h,'executeV1',act);assert.equal(r.code,0,r.msg)
 assert.equal((await invoke(h,'executeV1',act)).data.idempotent,true)
 const ledger=await invoke(s,'listCustomerStatementRowsV1',{customer_id:cid,date_from:'2026-01-01',date_to:'2026-09-15',page_size:100});assert.equal(ledger.code,0,ledger.msg);const oldIds=new Set(before.tables.crm_customer_allocations.map(a=>a._id));assert.ok(!JSON.stringify(ledger.data).match(new RegExp([...oldIds].join('|'))),'作废分配不得作为普通流水返回')
 for(const old of before.tables.crm_sale_records){const current=t.crm_sale_records.find(r=>r._id===old._id);for(const k of Object.keys(old).filter(k=>!['amount_received','receipt_rounding_amount','payment_status','updated_at','accounting_reconciliation'].includes(k)))assert.deepEqual(current[k],old[k],k)}
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){r=await invoke(s,action,{customer_id:cid,date_from:'2026-01-01',date_to:'2026-09-15'});assert.equal(r.code,0,r.msg);const x=r.data.period_summary;for(const [k,v]of Object.entries({business_revenue:8369.29,cash_received:9000,refund_total:0,net_cash_received:9000,rounding_total:0,complete:true}))assert.equal(x[k],v,action+':'+k);if(r.data.summary){assert.equal(r.data.summary.receivable_balance,985.17);assert.equal(r.data.summary.prepay_balance,0)}}
})
test('K012三位金额守恒、历史隔离与相邻表数连续',()=>{
 const before=JSON.parse(fs.readFileSync(process.env.K012_SOURCE)).data,req={customer_id:before.customer_id,operation_id:'k012-reconciliation-20260915-v1',expected_snapshot_hash:before.snapshot_hash,evidence:{confirmed_by_user:true,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}}
 const plan=p.buildPlan(before,req,{_id:'test'},Date.now()),rows=structuredClone(before.tables)
 for(const w of plan.writes){if(w.before)rows[w.table][rows[w.table].findIndex(r=>r._id===w.id)]=w.after;else rows[w.table].push(w.after)}
 const flows=rows.crm_customer_flow_settlements.sort((a,b)=>a.biz_date.localeCompare(b.biz_date));for(let i=1;i<flows.length;i++)assert.equal(flows[i].flow_index_prev,flows[i-1].flow_index_curr)
 assert.equal(flows.at(-1).should_receive,864.535);assert.equal(flows.at(-2).biz_date,'2026-07-30');assert.equal(flows[5].biz_date,'2026-07-01')
 const credits=rows.crm_customer_receipts.filter(r=>r.status==='posted'),alloc=rows.crm_customer_allocations.filter(r=>r.status==='posted');for(const c of credits)assert.equal(alloc.filter(a=>a.receipt_id===c._id).reduce((n,a)=>n+Math.round(a.allocate_amount*1000),0),Math.round(c.amount*1000))
 assert.equal(credits.filter(r=>r.source_type!=='opening_prepay').reduce((n,r)=>n+r.amount,0),9000);assert.equal(rows.crm_customer_opening_debts[0].biz_date,'2025-12-31');assert.equal(rows.crm_customers[0].net_balance,985.17)
 for(const old of before.tables.crm_customer_receipts.filter(r=>r.amount===2000)){const now=rows.crm_customer_receipts.find(r=>r._id===old._id);for(const k of ['amount','biz_date','payment_method','proof_images'])assert.deepEqual(now[k],old[k])}
})
