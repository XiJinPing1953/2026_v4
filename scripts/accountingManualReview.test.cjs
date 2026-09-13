'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs')
const review=require('../uniCloud-alipay/cloudfunctions/common/accountingReview')
const {mutableDb}=require('./lib/mutableAccountingDb.cjs')
const {loadHandler,invoke}=require('./lib/accountingTestHarness.cjs')
const {snapshot}=require('../uniCloud-alipay/cloudfunctions/crm-accounting-correction/snapshot')
test('核准只影响待办显示，金额、完整性保持；变更或其他客户不能沿用',()=>{
 const input={sales:[{_id:'s',amount_received:20}],receipts:[],allocations:[],flows:[],debts:[]}
 const issue={source_id:'s',source_type:'sale',reason:'receipt_date_missing',amount:20}
 const summary={cash_received:null,cash_complete:false,complete:false,unresolved_count:1,unresolved_sources:[issue]}
 const row={customer_id:'c',action:review.ACTION,status:'posted',detail:{version:review.VERSION,fingerprint:review.fingerprint(input),items:[{...issue,biz_date:'2026-01-15'}]}}
 const result=review.applyReview(summary,input,[row],'c');assert.equal(result.manual_review.status,'approved');assert.equal(result.cash_received,null);assert.equal(result.complete,false);assert.equal(result.unresolved_count,1)
 assert.equal(review.applyReview(summary,input,[row],'other').manual_review,undefined)
 assert.equal(review.applyReview(summary,{...input,sales:[{_id:'s',amount_received:21}]},[row],'c').manual_review,undefined)
 const partial=review.applyReview({...summary,unresolved_sources:[issue,{...issue,source_id:'new'}]},input,[row],'c');assert.equal(partial.manual_review.status,'partial');assert.equal(partial.manual_review.outstanding_count,1)
})
test('K007真实入口：仅保存核准审计，三种查询保留原账；重试、权限及原值保护', {skip:!process.env.K007_EVIDENCE},async()=>{
 const dir=process.env.K007_EVIDENCE,before=JSON.parse(fs.readFileSync(dir+'/raw-response-2.json')).response.data
 const tables=structuredClone(before.tables);tables.crm_operation_logs=[];tables.crm_users=[{_id:'actor',username:'test',role:'superadmin',token:'test'}]
 const db=mutableDb(tables),h=loadHandler('crm-accounting-correction',db),s=loadHandler('crm-customer-settlement',db)
 const items=JSON.parse(fs.readFileSync(dir+'/reconciliation.json')).pending.map(x=>({source_id:x.sale_id,source_type:'sale',reason:'receipt_date_missing',amount:x.cash_amount,biz_date:x.accounting_date,voucher:x.voucher}))
 const req={customer_id:before.customer_id,operation_id:'k007-manual-review-test',expected_snapshot_hash:before.snapshot_hash,approval_sha256:'a'.repeat(64),items}
 assert.equal((await h({action:'approveManualReviewV1',token:'invalid',data:req})).code,403)
 assert.equal((await invoke(h,'approveManualReviewV1',{...req,expected_snapshot_hash:'b'.repeat(64)})).code,409)
 const result=await invoke(h,'approveManualReviewV1',req);assert.equal(result.code,0,result.msg);assert.equal(result.data.financial_writes,0)
 assert.equal((await invoke(h,'approveManualReviewV1',req)).data.idempotent,true)
 assert.equal((await invoke(h,'approveManualReviewV1',{...req,approval_sha256:'b'.repeat(64)})).code,409)
 for(const action of ['getCustomerStatementV1','exportCustomerStatementV1','exportCustomerAccountingLedgerV1']){
 const r=await invoke(s,action,{customer_id:before.customer_id,date_from:'2026-01-01',date_to:'2026-09-13'});assert.equal(r.code,0,r.msg);const p=r.data.period_summary;assert.equal(p.manual_review.status,'approved');assert.equal(p.manual_review.reviewed_count,4);assert.equal(p.manual_review.outstanding_count,0);assert.equal(p.business_revenue,2871);assert.equal(p.cash_received,null);assert.equal(p.known_cash.cash_received,2537)
 }
 assert.equal((await snapshot(db,before.customer_id)).snapshot_hash,before.snapshot_hash)
 tables.crm_sale_records[0].amount_received+=1
 const changed=await invoke(s,'getCustomerStatementV1',{customer_id:before.customer_id,date_from:'2026-01-01',date_to:'2026-09-13'});assert.equal(changed.data.period_summary.manual_review,undefined)
})
test('页面和两种导出使用人工核准标签，不把空金额改成零或隐藏新问题',()=>{
 const vm=require('vm'),c={};vm.createContext(c)
 for(const file of ['src/services/mappers/customerPeriodSummary.js','src/services/mappers/customerDeposit.js','src/components/domain/customer/statement/exportWorkbook.js'])vm.runInContext(fs.readFileSync(file,'utf8').replace(/^import .*\n/gm,'').replace(/export /g,''),c)
 vm.runInContext('globalThis.helpers={outstandingPeriodIssues,periodReviewLabel,buildPeriodSummarySheetRows}',c)
 const p={rule_version:'customer-period-summary/2026-09-12.3',read_complete:true,money_scale:2,complete:false,cash_complete:false,business_revenue:2871,historical_receivable:1547,receivable_total:4418,cash_received:null,historical_debt_collected:null,refund_total:null,net_cash_received:null,rounding_total:0,unresolved_count:4,unresolved_sources:[{source_id:'s',reason:'receipt_date_missing'}],manual_review:{version:review.VERSION,status:'approved',outstanding_sources:[],note:'已人工核准，原账务保持'}}
 assert.equal(c.helpers.periodReviewLabel(p),'已人工核准');assert.equal(c.helpers.outstandingPeriodIssues(p).length,0)
 const rows=c.helpers.buildPeriodSummarySheetRows({period_summary:p});assert.equal(rows.find(r=>r[0]?.value==='期间实际收款')[1].value,'已人工核准');assert.equal(p.cash_received,null)
 assert.equal(c.helpers.periodReviewLabel({...p,manual_review:{...p.manual_review,status:'partial'}}),'')
})
