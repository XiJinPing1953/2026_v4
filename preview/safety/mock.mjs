// Development-only fixtures: all writes are in browser memory. Production build rejects preview mode.
import fixture from './fixture.json'
const clone = value => JSON.parse(JSON.stringify(value))
const state = clone(fixture)
const records = {weekly:null,monthly:null}
if (typeof window !== 'undefined') window.__crmSafetyPreview = true
const permissions = fixture.permissions
const media_urls=Object.fromEntries(['one','two'].map((part,index)=>[`cloud://preview/evidence-${part}.jpg`,'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360"><rect width="600" height="360" fill="#dcecf3"/><text x="300" y="170" text-anchor="middle" font-size="28">LOCAL TEST EVIDENCE ${index+1}</text><text x="300" y="220" text-anchor="middle" font-size="20">No real inspection photograph</text></svg>`)]))
const today = '2026-10-15'
function recompute() {
 const s=state.daily.snapshot, items=state.daily.supplement.items
 s.missing=items.filter(row=>!row.result_code || row.result_code.startsWith('not_')&&!row.reason || row.result_code==='abnormal'&&!row.hazard_ids.length).map(row=>`${row.code} 待完成`)
 s.complete=!s.missing.length;s.summary.zero_report_allowed=s.complete&&!s.issues.length;s.source_fingerprint=`preview-${state.daily.supplement.revision}`
 s.categories.forEach(category=>{category.issues=s.issues.filter(issue=>String(issue.category_code)===String(category.id));category.checks.forEach(check=>{if(check.source_type==='supplement'){const item=items.find(row=>row.code===check.item_code);Object.assign(check,{result_code:item.result_code,note:item.note||item.reason,evidence:item.evidence,hazard_ids:item.hazard_ids})}})})
 state.daily.stale=!!state.daily.record && state.daily.record.source_fingerprint!==s.source_fingerprint
}
function report(kind,data){
 const month=data.month||today.slice(0,7), date=data.date||today
 const period=kind==='monthly'?{start_date:`${month}-01`,end_date:`${month}-31`}:{start_date:'2026-10-12',end_date:'2026-10-18'}
 return {record:records[kind],period,source_fingerprint:`preview-period-${kind}`,permissions,stale:false,previous:null,statistics:{period,expected_days:1,inspected_days:1,checked_days:state.daily.record?1:0,missing_days:[],incomplete_days:state.daily.record?[]:[date],daily:[{date,status:state.daily.record?'pending_signature':'incomplete',inspection_count:1,issue_count:state.daily.snapshot.issues.length}],new_hazard_count:state.daily.snapshot.issues.length,verified_closed_count:0,rectification_rate:null,rectification_rate_label:'无此类隐患',new_hazards:state.daily.snapshot.issues,reobservations:[],recurrence:[],historical_pending:[]}}
}
export async function callCloud(name,{action,data={}}={}) {
 window.__safetyPreviewCalls ||= [];window.__safetyPreviewCalls.push({name,action})
 const ok=data=>({code:0,data:clone(data),msg:'仅本地模拟'})
 if(name==='crm-station-safety-inspection'&&action==='listHazardsV1')return {...ok([{_id:'preview-closed-hazard',hazard_no:'LOCAL-CLOSED-001',issue_note:'本地示例：已复查销号的阀门异常',status:'closed',responsible_name:'模拟责任人',inspection_date:'2026-10-01'}]),paging:{total:1,page:1,pageSize:20}}
 if(name!=='crm-safety-management') return {code:501,msg:`本地预览未配置 ${name}/${action}，未发出网络请求`}
 if(action==='getConfigV1') return ok(state)
 if(action==='saveConfigV1'){state.config={...data.config,revision:state.config.revision+1};return ok(state.config)}
 if(action==='listDailyV1'){const days=[];for(let at=Date.parse(`${data.start_date}T00:00:00Z`);at<=Date.parse(`${data.end_date}T00:00:00Z`);at+=86400000){const date=new Date(at).toISOString().slice(0,10);days.push({date,status:date<today?'not_enabled':date===today?(state.daily.record?'pending_signature':'incomplete'):'not_enabled',inspection_count:date===today?1:0,issue_count:0,signature_status:'pending_signature',revision:state.daily.record?.revision||0})}return ok({days,enabled_from:today})}
 if(action==='getDailyV1'){recompute();return ok({...state.daily,permissions})}
 if(action==='saveSupplementV1'){if(data.expected_revision!==state.daily.supplement.revision)return {code:409,msg:'模拟修订冲突'};state.daily.supplement.items=data.items;state.daily.supplement.revision++;recompute();return ok(state.daily.supplement)}
 if(action==='confirmDailyV1'){recompute();if(!state.daily.snapshot.complete)return {code:400,msg:'补充检查尚未完成'};if(data.zero_report&&state.daily.snapshot.issues.length)return {code:400,msg:'发现问题不能确认零报告'};state.daily.record={revision:(state.daily.record?.revision||0)+1,snapshot:clone(state.daily.snapshot),source_fingerprint:state.daily.snapshot.source_fingerprint,content_status:'checked',signature_status:'pending_signature',zero_report:data.zero_report,checked_at:Date.now(),checked_by:'preview-user',revision_reason:data.revision_reason};return ok(state.daily.record)}
 if(action==='registerIssueV1'){const hazard={_id:`preview-hazard-${data.client_submission_id}`,hazard_no:'LOCAL-YH-001',...data,category_code:String(data.management_category||data.category_code),status:'pending_rectification',inspection_date:data.date};state.daily.snapshot.issues.push(hazard);state.daily.snapshot.summary.issue_count=state.daily.snapshot.issues.length;return ok({hazard_id:hazard._id,observation_id:'preview-observation',duplicate:false})}
 for(const kind of ['weekly','monthly']){
  const label=kind==='weekly'?'Weekly':'Monthly'
  if(action===`get${label}V1`)return ok(report(kind,data))
  if(action===`save${label}V1`){records[kind]={content:data.content,revision:(records[kind]?.revision||0)+1,content_status:'draft',signature_status:'pending_signature',statistics:report(kind,data).statistics,revision_reason:data.revision_reason};return ok(records[kind])}
 }
 if(action==='exportV1'){if(data.format==='xlsx')return {code:501,msg:'本地预览不模拟真实Excel下载，请用后端测试检验工作簿'};recompute();return ok({media_urls:window.__safetyMissingMedia?{}:media_urls,kind:data.kind,document:data.kind==='daily'?{...state.daily,permissions}:report(data.kind,data),status:{content_status:state.daily.record?'checked':'draft',signature_status:'pending_signature'},generated_at:Date.now()})}
 return {code:501,msg:`本地预览未配置 ${action}，未发出网络请求`}
}
if (typeof window !== 'undefined') window.__safetyPreviewCall = callCloud
