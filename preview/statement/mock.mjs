// Synthetic UI fixture only. Not an accounting implementation or production oracle.
const db = new Map()
const cashierOperations = new Map()
const demoCustomerIds = ['demo-kg','demo-bottle','demo-m3']
let cashierRevision = 1
export const cashierPreviewControls = { failNextUpload:false, timeoutNextSave:false }
const sum=(rows,key)=>rows.reduce((n,r)=>n+Number(r[key]||0),0)
const ok=(data,extra={})=>({code:0,msg:'本地模拟完成（未写入云端）',data:structuredClone(data),...extra})
const fail=msg=>({code:400,msg:`本地模拟：${msg}`})
const date=i=>`2026-09-${String(i%19+1).padStart(2,'0')}`
export function resetFixtures(){db.clear();cashierOperations.clear();cashierRevision=1;cashierPreviewControls.failNextUpload=false;cashierPreviewControls.timeoutNextSave=false}
export function armCashierUploadFailure(){cashierPreviewControls.failNextUpload=true}
export function armCashierSaveTimeout(){cashierPreviewControls.timeoutNextSave=true}
export function consumeCashierUploadFailure(){const armed=cashierPreviewControls.failNextUpload;cashierPreviewControls.failNextUpload=false;return armed}
function cashierRows(id,name,unit){
 const scale=unit==='m3'?3:2,zeroGas=scale===3?'0.000':'0.00'
 return Array.from({length:24},(_,i)=>{
  const kind=['gas','deposit','mixed'][i%3],gas=kind==='deposit'?zeroGas:(scale===3?`${100+i}.125`:`${100+i}.25`),deposit=kind==='gas'?'0.00':`${20+i}.00`
  const amount=kind==='gas'?gas:(kind==='deposit'?deposit:(scale===3?`${120+i*2}.125`:`${120+i*2}.25`))
  const intakeId=`${id}-intake-${String(i+1).padStart(2,'0')}`,allocated=i%4===0?zeroGas:gas
  const allocationTargets=kind!=='deposit'&&i%4!==0?[{_id:`${intakeId}-allocation`,target_type:'sale',target_id:`${id}-sale-${i%23+1}`,target_date:date(i),target_name:'模拟销售',amount:gas}]:[]
  const depositId=kind==='gas'?'':`${intakeId}-deposit`
  return {_id:intakeId,intake_id:intakeId,customer_id:id,customer_name:name,biz_date:date(40-i),amount,gas_amount:gas,deposit_amount:deposit,money_scale:scale,kind,purpose:kind==='deposit'?'unspecified':(['unspecified','prepay','settlement'][Math.floor(i/3)%3]),payment_method:['cash','bank','wechat'][i%3],note:i===0?'可用于模拟编辑与保存超时':'纯模拟出纳登记',status:i%13===12?'void':'posted',version:1,receipt_id:kind==='deposit'?'':`${intakeId}-receipt`,deposit_entry_id:depositId,allocated_amount:allocationTargets.length?allocated:zeroGas,rounding_allocated_amount:zeroGas,unallocated_amount:allocationTargets.length?zeroGas:gas,allocation_status:allocationTargets.length?'allocated':'unallocated',allocation_status_text:allocationTargets.length?'已分配':'未分配',proof_images_count:1,created_by_name:'本地模拟用户',source:'cashier_intake',editable:false,removable:false,restriction_reason:allocationTargets.length?'已有气款分配，需先解除':'列表权限待详情核对',legacy:false,proof_images:[`cloud://demo-space/cashier/${intakeId}.jpg`],allocation_targets:allocationTargets,deposit_entries:depositId?[{_id:depositId,biz_date:date(40-i),kind:'receipt',kind_text:'收取押金',amount:deposit},{_id:`${id}-unrelated-deposit`,biz_date:'2026-09-01',kind:'receipt',kind_text:'其他押金',amount:'9.00'}]:[]}
 })
}
function fixture(id){
 if(!demoCustomerIds.includes(id))throw Error('只允许本地示例客户')
 if(db.has(id))return db.get(id)
 const unit=id.slice(5),sales=Array.from({length:23},(_,i)=>({_id:`${id}-sale-${i+1}`,date:date(i),sale_date:date(i),biz_date:date(i),biz_mode:'bottle',payment_status:'unpaid',price_unit:unit,unit_price:unit==='kg'?5:unit==='bottle'?120:3,qty:10+i,bottle_count:10+i,net_weight:240+i*10,actual_weight_kg:240+i*10,should_receive:1200+i*50,amount_received:i<10?1000:0,allocated_received:0,rounding_amount:0,outstanding:1200+i*50-(i<10?1000:0),status:'posted',note:'纯模拟销售记录'}))
 const receipts=Array.from({length:13},(_,i)=>({_id:`${id}-receipt-${i+1}`,biz_date:date(i),amount:1000,allocated_amount:i<10?1000:0,unallocated_amount:i<10?0:1000,rounding_amount:0,payment_method:i%2?'bank':'cash',status:'posted',source_type:'customer_statement',note:'纯模拟收款记录'}))
 const flows=unit==='m3'?Array.from({length:7},(_,i)=>({_id:`${id}-flow-${i+1}`,biz_date:date(i+2),flow_index_prev:1000+i*100,flow_index_curr:1100+i*100,flow_volume_m3:100,flow_theory_ratio:1.429,unit_price:3,should_receive:300,amount_received:0,outstanding:300,status:'posted',actual_weight_kg:145,note:'模拟流量结算'})):[]
 const pools=[{_id:`${id}-offset-1`,biz_date:'2026-09-01',amount:800,unallocated_amount:800,allocated_amount:0,status:'posted',source_type:'offset_credit',note:'模拟冲抵来源'}]
 for(let i=0;i<10;i++){receipts[i].allocations=[{target_type:'sale',target_id:sales[i]._id,allocate_amount:1000,received_field:'amount_received'}];receipts[i].allocation_mode='checked';receipts[i].allocation_targets=[{target_type:'sale',target_id:sales[i]._id}]}
 const customer={_id:id,name:`模拟客户 · ${unit==='bottle'?'按瓶':unit}`,contact:'示例联系人',phone:'—',default_price_unit:unit,effective_default_price_unit:unit,settlement_default_price_unit:unit,money_scale:unit==='m3'?3:2,default_unit_price:unit==='kg'?5:unit==='bottle'?120:3,flow_index_last:1700,matched_delivery_sites:[{_id:`${id}-site`,name:`${unit} 模拟送达点`}]}
 const state={adjustment:null,customer,sales,receipts,flows,pools,cashierIntakes:cashierRows(id,customer.name,unit)};db.set(id,state);return state
}
const targets=s=>[...s.sales.map(r=>({...r,type:'sale',date:r.sale_date})),...s.flows.map(r=>({...r,type:'flow_settlement',date:r.biz_date}))]
function candidates(s,d){return targets(s).filter(r=>r.outstanding>0&&(d.allocation_mode==='checked'?(d.allocation_targets||[]).some(t=>(t.target_id||t.sale_id)===r._id):(!d.allocation_start_date||r.date>=d.allocation_start_date)&&(!d.allocation_end_date||r.date<=d.allocation_end_date))).sort((a,b)=>a.date.localeCompare(b.date))}
function plan(s,d){let remaining=Number(d.amount||0);const allocations=[];for(const r of candidates(s,d)){const amount=Math.min(remaining,r.outstanding);if(amount>0)allocations.push({target_type:r.type,target_id:r._id,sale_id:r._id,target_date:r.date,sale_date:r.date,target_title:`模拟${r.type==='sale'?'销售':'流量'} ${r._id.split('-').at(-1)}`,outstanding_before:r.outstanding,allocate_amount:amount});remaining-=amount}return {amount:Number(d.amount||0),rounding_amount:Number(d.rounding_amount||0),total_outstanding_before:sum(candidates(s,d),'outstanding'),target_count:candidates(s,d).length,target_date_start:candidates(s,d)[0]?.date||'',target_date_end:candidates(s,d).at(-1)?.date||'',allocated_total:sum(allocations,'allocate_amount'),receipt_allocated_total:sum(allocations,'allocate_amount'),rounding_allocated_total:0,allocated_amount:sum(allocations,'allocate_amount'),allocate_total:sum(allocations,'allocate_amount'),prepay_amount:remaining,allocations,period_outstanding_total:sum(candidates(s,d),'outstanding'),period_receivable_total:sum(candidates(s,d),'should_receive'),allocation_mode:d.allocation_mode,allocation_start_date:d.allocation_start_date,allocation_end_date:d.allocation_end_date}}
function apply(s,p){for(const a of p.allocations){const r=[...s.sales,...s.flows].find(r=>r._id===a.target_id);if(r){r.outstanding-=a.allocate_amount;r.allocated_received=(r.allocated_received||0)+a.allocate_amount}}}
function page(rows,d){const n=Number(d.page)||1,size=Number(d.pageSize)||50;return {data:rows.slice((n-1)*size,n*size),paging:{page:n,pageSize:size,total:rows.length,hasMore:n*size<rows.length}}}
function cashierPublicRow(row){const {proof_images,allocation_targets,deposit_entries,...publicRow}=row;return publicRow}
function allCashierRows(){return demoCustomerIds.flatMap(id=>fixture(id).cashierIntakes)}
function findCashierRow(intakeId){for(const id of demoCustomerIds){const state=fixture(id),row=state.cashierIntakes.find(item=>item.intake_id===intakeId);if(row)return {state,row}}return null}
function cashierList(d){
 let rows=allCashierRows().filter(row=>(!d.customer_id||row.customer_id===d.customer_id)&&(!d.date_from||row.biz_date>=d.date_from)&&(!d.date_to||row.biz_date<=d.date_to)&&(!d.kind||row.kind===d.kind)&&(!d.purpose||row.purpose===d.purpose)&&(d.include_void||row.status!=='void'))
 rows=rows.sort((a,b)=>b.biz_date.localeCompare(a.biz_date)||b.intake_id.localeCompare(a.intake_id))
 const size=Math.max(1,Math.min(Number(d.page_size)||20,100)),match=String(d.cursor||'').match(/^cashier:(\d+):r\d+$/),offset=match?Number(match[1]):0,batch=rows.slice(offset,offset+size),next=offset+batch.length
 return ok(batch.map(cashierPublicRow),{paging:{total:rows.length,pageSize:size,hasMore:next<rows.length,next_cursor:next<rows.length?`cashier:${next}:r${cashierRevision}`:null,snapshot:`cashier-r${cashierRevision}`,create_enabled:true}})
}
function cashierSummary(row){if(!row)return null;return {intake_id:row.intake_id,customer_id:row.customer_id,customer_name:row.customer_name,biz_date:row.biz_date,kind:row.kind,amount:row.amount,gas_amount:row.gas_amount,deposit_amount:row.deposit_amount,money_scale:row.money_scale,status:row.status}}
function cashierPreview(d){
 const previous=cashierOperations.get(d.operation_id)
 if(previous?.result)return ok({committed:true,result:{...previous.result,idempotent:true}})
 if(!d.operation_id||!demoCustomerIds.includes(d.customer_id))return fail('操作号或客户无效')
 if(!['create','update','void'].includes(d.command))return fail('出纳命令无效')
 if(!Array.isArray(d.proof_images)||!d.proof_images.length||d.proof_images.some(id=>!String(id).startsWith('cloud://')))return fail('凭证必须是 cloud:// 永久文件标识')
 const found=d.command==='create'?null:findCashierRow(d.intake_id)
 if(d.command!=='create'&&!found)return fail('登记不存在')
 if(found&&Number(found.row.version)!==Number(d.expected_version))return {code:409,msg:'本地模拟：版本已变化'}
 const scale=fixture(d.customer_id).customer.money_scale,submission={command:d.command,customer_id:d.customer_id,intake_id:d.intake_id||'',operation_id:d.operation_id,expected_version:Number(d.expected_version)||0,expected_snapshot:{revision:cashierRevision,intake_id:d.intake_id||'',version:Number(d.expected_version)||0},kind:d.kind,amount:Number(d.amount),gas_amount:Number(d.gas_amount),deposit_amount:Number(d.deposit_amount),purpose:d.purpose,biz_date:d.biz_date,payment_method:d.payment_method,proof_images:[...d.proof_images],note:d.note||'',reason:d.reason||''}
 const after=d.command==='void'?{...cashierSummary(found.row),status:'void'}:{...submission,customer_name:fixture(d.customer_id).customer.name,money_scale:scale,status:'posted'}
 cashierOperations.set(d.operation_id,{submission:structuredClone(submission),result:null})
 return ok({submission,before:cashierSummary(found?.row),after,operation_id:d.operation_id})
}
function commitCashier(d,command){
 const operation=cashierOperations.get(d.operation_id)
 if(operation?.result)return ok({...operation.result,idempotent:true})
 if(!operation||JSON.stringify(operation.submission)!==JSON.stringify(d))return fail('必须原样提交服务器预览内容')
 let state,row
 if(command==='create'){
  state=fixture(d.customer_id);const intakeId=`${d.customer_id}-intake-local-${Date.now()}`
  const receiptId=d.kind==='deposit'?'':`${intakeId}-receipt`,depositId=d.kind==='gas'?'':`${intakeId}-deposit`
  row={_id:intakeId,intake_id:intakeId,customer_id:d.customer_id,customer_name:state.customer.name,biz_date:d.biz_date,amount:String(d.amount),gas_amount:String(d.gas_amount),deposit_amount:String(d.deposit_amount),money_scale:state.customer.money_scale,kind:d.kind,purpose:d.purpose,payment_method:d.payment_method,note:d.note,status:'posted',version:1,receipt_id:receiptId,deposit_entry_id:depositId,allocated_amount:state.customer.money_scale===3?'0.000':'0.00',rounding_allocated_amount:state.customer.money_scale===3?'0.000':'0.00',unallocated_amount:String(d.gas_amount),allocation_status:'unallocated',allocation_status_text:'未分配',proof_images_count:d.proof_images.length,created_by_name:'本地模拟用户',source:'cashier_intake',editable:false,removable:false,restriction_reason:'列表权限待详情核对',legacy:false,proof_images:[...d.proof_images],allocation_targets:[],deposit_entries:depositId?[{_id:depositId,biz_date:d.biz_date,kind:'receipt',kind_text:'收取押金',amount:String(d.deposit_amount)}]:[]};state.cashierIntakes.unshift(row)
 }else{
  const found=findCashierRow(d.intake_id);if(!found)return fail('登记不存在');({state,row}=found)
  if(command==='void'){row.status='void';row.note=d.note;row.version+=1}
  else Object.assign(row,{biz_date:d.biz_date,amount:String(d.amount),gas_amount:String(d.gas_amount),deposit_amount:String(d.deposit_amount),kind:d.kind,purpose:d.purpose,payment_method:d.payment_method,note:d.note,proof_images:[...d.proof_images],proof_images_count:d.proof_images.length,version:row.version+1})
 }
 cashierRevision+=1
 const result={intake_id:row.intake_id,operation_id:d.operation_id,status:'committed',idempotent:false,version:row.version,receipt_id:row.receipt_id||'',deposit_entry_id:row.deposit_entry_id||''}
 cashierOperations.set(d.operation_id,{...operation,result})
 if(cashierPreviewControls.timeoutNextSave){cashierPreviewControls.timeoutNextSave=false;throw new Error('request timeout（本地模拟：已提交但回执丢失）')}
 return ok(result)
}
function cashierAction(action,d){
 if(action==='listReceiptIntakeV2')return cashierList(d)
 if(action==='getReceiptIntakeDetailV2'){const found=findCashierRow(d.intake_id);if(!found)return fail('登记不存在');const actual={...cashierPublicRow(found.row),editable:found.row.status==='posted'&&!found.row.allocation_targets.length,removable:found.row.status==='posted'&&!found.row.allocation_targets.length,restriction_reason:found.row.allocation_targets.length?'已有气款分配，需先解除':''};return ok({row:actual,receipt:found.row.receipt_id?{_id:found.row.receipt_id,amount:found.row.gas_amount}:null,proof_images:found.row.proof_images,allocation_targets:found.row.allocation_targets,deposit_entries:found.row.deposit_entries})}
 if(action==='previewReceiptIntakeV2')return cashierPreview(d)
 if(action==='saveReceiptIntakeV2')return commitCashier(d,d.command==='update'?'update':'create')
 if(action==='voidReceiptIntakeV2')return commitCashier(d,'void')
 if(action==='getReceiptIntakeOperationV2'){const operation=cashierOperations.get(d.operation_id);return ok(operation?.result?{found:true,result:operation.result}:{found:false})}
 return null
}
export async function callCloud(name,{action,data:d={}}={}){
 console.info('[statement-preview]',name,action)
 if(name==='crm-customer'&&action==='listV1'){
  const keyword=String(d.keyword||'').trim().toLowerCase(),customers=demoCustomerIds.map(id=>fixture(id).customer).filter(customer=>!keyword||[customer.name,customer.phone,...customer.matched_delivery_sites.map(site=>site.name)].some(value=>String(value||'').toLowerCase().includes(keyword)))
  return ok(customers,{paging:{page:1,pageSize:Number(d.pageSize)||20,total:customers.length,hasMore:false}})
 }
 if(name==='crm-customer-settlement'){
  const cashier=cashierAction(action,d)
  if(cashier)return cashier
 }
 let s;try{s=fixture(d.customer_id)}catch{return fail('未知客户或操作已拒绝；没有网络请求')}
 if(!['crm-customer-settlement','crm-customer-deposit'].includes(name))return fail(`未支持 ${name}/${action}，已拒绝`)
 if(action==='beginReceiptAdjustmentV1'){
 const r=s.receipts.find(r=>r._id===d.receipt_id);if(!r)return fail('模拟收款单不存在')
 if(s.adjustment){if(s.adjustment.receipt._id!==r._id)return fail('请先保存或取消当前模拟调整');return ok({rollback_strategy:'deferred',released_targets:s.adjustment.released})}
 const original=structuredClone(r),originalTargets=[];const released=[]
 for(const a of r.allocations||[]){const t=[...s.sales,...s.flows].find(t=>t._id===a.target_id);if(!t)continue;originalTargets.push(structuredClone(t));released.push({target_type:a.target_type,target_id:t._id,target_date:t.date||t.biz_date,target_title:'模拟已释放目标',outstanding:a.allocate_amount,amount:a.allocate_amount})}
 s.adjustment={receipt:original,targets:originalTargets,released};return ok({rollback_strategy:'deferred',released_targets:released})
 }
 if(action==='cancelReceiptAdjustmentV1'){
 if(!s.adjustment)return ok({cancelled:true})
 if(s.adjustment.receipt._id!==d.receipt_id)return fail('模拟调整收款单不匹配')
 const saved=s.adjustment;s.receipts.splice(s.receipts.findIndex(r=>r._id===d.receipt_id),1,saved.receipt)
 for(const original of saved.targets){const t=[...s.sales,...s.flows].find(t=>t._id===original._id);Object.keys(t).forEach(k=>delete t[k]);Object.assign(t,original)}
 s.adjustment=null;return ok({cancelled:true})
 }
 if(action==='updateReceiptV1'){
 if(!s.adjustment||s.adjustment.receipt._id!==d.receipt_id)return fail('请先进入模拟整单调整')
 if(!(Number(d.amount)>0)||Number(d.rounding_amount)>0)return fail('模拟调整仅支持正数金额且不含抹零')
 for(const a of s.adjustment.receipt.allocations||[]){const target=[...s.sales,...s.flows].find(t=>t._id===a.target_id);if(target){target.outstanding+=a.allocate_amount;const field=a.received_field||'allocated_received';target[field]=(target[field]||0)-a.allocate_amount}}
 const p=plan(s,d);apply(s,p);const r=s.receipts.find(r=>r._id===d.receipt_id)
 Object.assign(r,{amount:Number(d.amount),biz_date:d.biz_date||r.biz_date,note:d.note||'',payment_method:d.payment_method||r.payment_method,allocation_mode:d.allocation_mode,allocation_targets:d.allocation_targets||[],allocation_start_date:d.allocation_start_date,allocation_end_date:d.allocation_end_date,allocated_amount:p.allocated_amount,unallocated_amount:p.prepay_amount,allocations:structuredClone(p.allocations)})
 s.adjustment=null;return ok(r)
 }
 if(s.adjustment&&!['getCustomerStatementV1','listCustomerStatementRowsV1','getCustomerStatementAnalysisV1','listOffsetCreditPoolV1','previewAllocationV1','getDepositStatementV1','listCustomerRefundsV1'].includes(action))return fail('整单调整进行中，请先保存或取消；其他模拟写入已拒绝')
 if(action==='getCustomerStatementV1'){
 const debt=sum(targets(s),'outstanding'),offset=sum(s.pools,'unallocated_amount'),prepay=sum(s.receipts,'unallocated_amount'),revenue=sum(targets(s),'should_receive'),cash=sum(s.receipts,'amount')
 const rows=[...s.sales.map(r=>({...r,row_type:'sale',row_id:r._id,amount:r.should_receive})),...s.receipts.map(r=>({...r,row_type:'receipt',row_id:r._id})),...s.flows.map(r=>({...r,row_type:'flow_settlement',row_id:r._id,amount:r.should_receive}))].sort((a,b)=>b.biz_date.localeCompare(a.biz_date));const p=page(rows,d)
 return ok({customer:s.customer,summary:{receivable_balance:debt,prepay_balance:prepay+offset,prepay_manual_balance:0,receipt_unallocated_balance:prepay,offset_credit_balance:offset,net_balance:debt-prepay-offset,should_receive_total:revenue,amount_received_total:cash,last_receipt_at:Date.parse('2026-09-19')},period_summary:{rule_version:'customer-period-summary/2026-09-12.3',read_complete:true,money_scale:2,date_from:d.summary_date_from,date_to:d.summary_date_to,business_revenue:revenue,historical_receivable:0,receivable_total:revenue,cash_received:cash,historical_debt_collected:0,refund_total:0,net_cash_received:cash,rounding_total:0,unresolved_sources:[]},recent_sales:s.sales,net_debt_source_sales:s.sales,recent_receipts:s.receipts,recent_flow_settlements:s.flows,net_debt_source_flow_settlements:s.flows,recent_opening_debts:[],recent_other_fees:[],statement_rows:p.data,rows_paging:p.paging})
 }
 if(action==='listCustomerStatementRowsV1'){const base=await callCloud(name,{action:'getCustomerStatementV1',data:d});return ok(base.data.statement_rows,{paging:base.data.rows_paging})}
 if(action==='getCustomerStatementAnalysisV1')return ok({customer_price_unit:s.customer.default_price_unit,kg_loss_weight:36.8,bottle_reference_weight:4200,bottle_reference_amount:21000,bottle_reference_gap:1800,bottle_should_receive_total:22800})
 if(action==='listOffsetCreditPoolV1'){const p=page(s.pools.filter(r=>!d.only_unallocated||r.unallocated_amount>0),d);return ok(p.data,{paging:p.paging})}
 if(action==='previewAllocationV1')return ok(plan(s,d))
 if(['confirmAllocationV1','createReceiptV1'].includes(action)){
 if(Number(d.rounding_amount)>0)return fail('当前模拟仅支持无抹零收款；抹零写入未支持')
 const p=plan(s,d);if(d.preview)return ok(p)
 if(d.allocations?.length){p.allocations=d.allocations;p.allocated_amount=sum(p.allocations,'allocate_amount');p.prepay_amount=Number(d.amount)-p.allocated_amount;if(p.prepay_amount<0||p.allocations.some(a=>!(Number(a.allocate_amount)>0)||!candidates(s,d).some(t=>t._id===a.target_id&&t.outstanding>=a.allocate_amount)))return fail('模拟分配金额无效')}
 if(!(Number(d.amount)>0))return fail('模拟金额必须大于零')
 apply(s,p);s.receipts.unshift({_id:`${d.customer_id}-mock-${Date.now()}`,biz_date:d.biz_date||'2026-09-20',amount:Number(d.amount),allocated_amount:p.allocated_amount,unallocated_amount:p.prepay_amount,rounding_amount:0,allocations:structuredClone(p.allocations),allocation_mode:d.allocation_mode,allocation_targets:d.allocation_targets||[],allocation_start_date:d.allocation_start_date,allocation_end_date:d.allocation_end_date,status:'posted',source_type:'customer_statement',payment_method:d.payment_method,note:'本地模拟新增'});return ok(p)
 }
 if(action==='createPrepayEntryV1'){
 if(!(Number(d.amount)>0))return fail('模拟金额必须大于零')
 const r={_id:`${d.customer_id}-mock-${Date.now()}`,biz_date:d.biz_date,amount:Number(d.amount),allocated_amount:0,unallocated_amount:Number(d.amount),status:'posted',source_type:d.entry_kind==='offset_credit'?'offset_credit':'customer_prepay_manual',note:'本地模拟新增'};(d.entry_kind==='offset_credit'?s.pools:s.receipts).unshift(r);return ok(r)
 }
 if(action==='allocateOffsetCreditV1'){
 const r=s.pools.find(r=>r._id===d.receipt_id);if(!r||!(Number(d.amount)>0)||Number(d.amount)>r.unallocated_amount)return fail('模拟冲抵余额不足')
 const p=plan(s,d);apply(s,p);r.allocated_amount+=p.allocated_amount;r.unallocated_amount-=p.allocated_amount;r.allocations=[...(r.allocations||[]),...p.allocations];return ok(p)
 }
 if(action==='removeOffsetCreditAllocationV1'){
 const r=s.pools.find(r=>r._id===d.receipt_id);if(!r)return fail('模拟冲抵来源不存在');for(const a of r.allocations||[]){const t=[...s.sales,...s.flows].find(t=>t._id===a.target_id);if(t){t.outstanding+=a.allocate_amount;t.allocated_received-=a.allocate_amount}}r.unallocated_amount=r.amount;r.allocated_amount=0;r.allocations=[];return ok(r)
 }
 if(action==='getDepositStatementV1')return ok({rule_version:'customer-deposit/2026-09-12.1',read_complete:true,customer_id:d.customer_id,date_from:d.date_from,date_to:d.date_to,account_initialized:true,history_status:'opening_recorded',money_scale:2,version:1,current_balance:0,opening_balance:0,received_total:0,refunded_total:0,transferred_total:0,opening_transferred_total:0,closing_balance:0,entries:[]})
 if(['listCustomerRefundsV1','listRefundsV1','getRefundSourcesV1','listRefundSourcesV1'].includes(action))return ok({rows:[],sources:[],refunds:[],complete:true,money_scale:2})
 return fail(`未支持 ${action}，已拒绝；所有数据仅在浏览器内存`)
}
