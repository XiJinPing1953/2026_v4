'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs'),{loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const p=require('../uniCloud-alipay/cloudfunctions/crm-k014-reconciliation/plan'),{snapshot}=require('../uniCloud-alipay/cloudfunctions/crm-k014-reconciliation/snapshot')
test('K014受保护批次：失败回滚、冲突、幂等及三账务入口',async()=>{
 const before=JSON.parse(fs.readFileSync(process.env.K014_SOURCE)).data,t=structuredClone(before.tables),cid=before.customer_id
 t.crm_users=[{_id:'testactor',username:'test',token:'test',role:'superadmin'}];t.crm_operation_logs=[]
 const db=mutableDb(t),h=loadHandler('crm-k014-reconciliation',db),s=loadHandler('crm-customer-settlement',db)
 const req={customer_id:cid,operation_id:'k014-reconciliation-20260915-v1',expected_snapshot_hash:before.snapshot_hash,evidence:{confirmed_by_user:true,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}}
 assert.equal((await h({action:'prepareV1',data:req})).code,403)
 assert.equal((await invoke(h,'prepareV1',{...req,customer_id:'a'.repeat(24)})).code,409)
 let r=await invoke(h,'prepareV1',req);assert.equal(r.code,0,r.msg);const plan=r.data,act={customer_id:cid,operation_id:req.operation_id,plan_hash:plan.plan_hash}
 t.crm_customer_receipts[0].note+='changed';assert.equal((await invoke(h,'rehearseV1',act)).code,409);t.crm_customer_receipts[0].note=before.tables.crm_customer_receipts[0].note
 r=await invoke(h,'rehearseV1',{...act,fail_after_writes:5});assert.equal(r.data.status,'interruption_rolled_back');assert.equal((await snapshot(db,cid)).snapshot_hash,before.snapshot_hash)
 r=await invoke(h,'rehearseV1',act);assert.equal(r.data.status,'rehearsed_rolled_back');r=await invoke(h,'executeV1',act);assert.equal(r.code,0,r.msg)
 assert.equal((await invoke(h,'executeV1',act)).data.idempotent,true)

 for(const old of before.tables.crm_sale_records){const current=t.crm_sale_records.find(r=>r._id===old._id);for(const k of Object.keys(old).filter(k=>!['amount_received','receipt_rounding_amount','payment_status','updated_at','accounting_reconciliation'].includes(k)))assert.deepEqual(current[k],old[k],k)}
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){r=await invoke(s,action,{customer_id:cid,date_from:'2026-01-01',date_to:'2026-09-15'});assert.equal(r.code,0,r.msg);const x=r.data.period_summary;if(!x.complete)console.log(JSON.stringify(x));for(const [k,v]of Object.entries({business_revenue:7552,cash_received:7720,refund_total:176,net_cash_received:7544,rounding_total:8,complete:true}))assert.equal(x[k],v,action+':'+k);if(r.data.summary){assert.equal(r.data.summary.receivable_balance,0);assert.equal(r.data.summary.prepay_balance,0)}}
})
test('K014现金、冲抵、抹零和退款各自守恒',()=>{const b=JSON.parse(fs.readFileSync(process.env.K014_SOURCE)).data,req={customer_id:b.customer_id,operation_id:'k014-reconciliation-20260915-v1',expected_snapshot_hash:b.snapshot_hash,evidence:{confirmed_by_user:true,approval_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)}};const plan=p.buildPlan(b,req,{_id:'test'},Date.now()),tables=structuredClone(b.tables);for(const w of plan.writes){if(w.before)tables[w.table][tables[w.table].findIndex(r=>r._id===w.id)]=w.after;else tables[w.table].push(w.after)}const rs=tables.crm_customer_receipts.filter(r=>r.status==='posted');assert.equal(rs.filter(r=>r.entry_kind==='prepay').reduce((s,r)=>s+r.amount,0),7720);assert.equal(rs.filter(r=>r.entry_kind==='refund').reduce((s,r)=>s+r.amount,0),-176);assert.equal(rs.find(r=>r.amount===384).entry_kind,'offset_credit');assert.equal(tables.crm_customer_receipts.find(r=>r.amount===392).status,'void');assert.equal(tables.crm_sale_records.find(s=>s.date==='2026-01-20').receipt_rounding_amount,8);assert.equal(tables.crm_sale_records.find(s=>s.date==='2026-02-14').amount_received,0);assert.ok(tables.crm_sale_records.every(s=>s.payment_status==='paid'));assert.equal(rs.find(r=>r.amount===176).unallocated_amount,0)})
