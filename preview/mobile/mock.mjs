// Development-only display fixtures. No network; unsupported operations fail closed.
import { callCloud as statementCall } from '../statement/mock.mjs'
import inspectionTemplates from './inspection-templates.json'
import { PAGE_REGISTRY } from '../../src/services/pageAclRegistry.js'
const longName = '手机布局测试客户（长名称）新拓能源配送服务有限公司'
const stamp = Date.UTC(2026,8,28)
const base = { _id:'mobile-demo', name:longName, customer_id:'demo-kg', customer_name:longName, contact:'测试联系人', phone:'13800000000', address:'测试地址：工业园区东门第二配送站', is_active:true, created_at:stamp, updated_at:stamp, date:'2026-09-28', remark:'仅供本地布局验收，包含较长备注与编号 ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890。' }
const bottle = {...base,bottle_no:'DEMO-12345678901234567890',qr_code:'DEMO-QR-12345678901234567890',tare_weight:124,volume:150,status:'in',gas_type:'天然气'}
const sale = {...base,_id:'mobile-sale',biz_mode:'bottle',price_unit:'kg',unit_price:5,should_receive:1234567.89,amount_received:100,outstanding:1234467.89,payment_status:'unpaid',settlement_mode:'gas',settlement_owner:'sale',out_items:[{bottle_no:'DEMO-12345678901234567890',tare:124,gross:180,net:56}],back_items:[{bottle_no:'DEMO-12345678901234567890',tare:124,gross:130,net:6}],deposit_items:[],ticket_images:[]}
const rowsByName = {
 'crm-bottle':[bottle], 'crm-sale':[sale], 'crm-vehicle':[{...base,plate_no:'冀A·测试123',car_no:'冀A·测试123'}],
 'crm-delivery':[base], 'crm-user':[{...base,username:'mobile-preview-user',nickname:'布局测试用户',role:'user',role_template:'user',page_permissions:{}}],
 'crm-filling':[{...base,bottle_no:bottle.bottle_no,tare_weight:124,gross_weight:180,net_weight:56}],
 'crm-gas-in':[{...base,weight:2000,amount:1234567.89}],
 'crm-account':[{...base,code:'1122',name:'应收账款／手机显示测试科目',direction:'debit'}],
 'crm-voucher':[{...base,voucher_no:'记-20260928-000001',status:'draft',entries:[{account_code:'1122',account_name:'应收账款',summary:base.remark,debit:1234567.89,credit:0}]}],
 'crm-period':[{...base,period:'2026-09',status:'open'}],
 'crm-collection':[{...base,task_no:'DEMO-20260928-0001',status:'pending',unpaid_amount:1234567.89}]
}
const summary={total:1,active:1,inactive:0,priced:1,debit:1234567.89,credit:100,amount:1234567.89,should_receive:1234567.89,amount_received:100,outstanding:1234467.89}
const ok=(data,extra={})=>({code:0,msg:'本地手机布局示例',data,...extra})
export async function callCloud(name, options={}) {
 const {action,data={}}=options
 if(typeof window!=='undefined') {
  window.__mobilePreviewCalls ||= []
  window.__mobilePreviewCalls.push({name,action})
  const state=new URLSearchParams(window.location.search).get('fixture')
  if(state==='loading') await new Promise(resolve=>setTimeout(resolve,10000))
  if(state==='error') return {code:503,msg:'模拟读取失败，请重试'}
  if(state==='empty' && /^(list|search)/.test(action)) return ok([],{summary:{total:0,active:0,inactive:0,priced:0},paging:{page:1,pageSize:20,total:0,hasMore:false}})
 }
 if(name==='crm-customer') {
  if(action==='listV1') { const r=await statementCall(name,options); return {...r,summary:{total:r.data.length,active:r.data.length,inactive:0,priced:r.data.length}} }
  if(action==='getV1') { const r=await statementCall(name,{action:'listV1'}); return ok(r.data[0]) }
 }
 if(name==='crm-customer-settlement'||name==='crm-customer-deposit') return statementCall(name,options)
 if(name==='crm-user'&&action==='getPermissionRegistryV1') return ok({pages:PAGE_REGISTRY})
 if(['crm-station-safety-inspection','crm-home-safety-inspection'].includes(name)) {
  const station=name==='crm-station-safety-inspection'; const template=inspectionTemplates[station?'station':'home'];
  const items=station?template.areas.flatMap(area=>area.items.map(item=>({...item,area_code:area.code,area_label_snapshot:area.label}))):template.items;
  const record={...base,inspection_no:'DEMO-20260928-000000001',inspection_at:stamp,inspector_name:'模拟巡检员',station_name_snapshot:longName,customer_name_snapshot:longName,template_code:template.code,template_version:template.version,overall_result:'normal',photo_count:0,abnormal_count:0,can_update:true,items:items.map(item=>({...item,item_code:item.code,item_label_snapshot:item.label,result_code:'normal',result_label_snapshot:'正常',option_label_snapshot:'正常',photo_file_ids:[]}))};
  if(action==='getTemplateV1') return ok({...template,template_code:template.code,template_version:template.version,item_count:items.length,server_now:stamp});
  if(action==='getV1') return ok(record);
  if(action==='listCustomersV1') return ok([base],{paging:{total:1,hasMore:false}});
  if(action==='listV1') return ok([record],{paging:{total:1,hasMore:false}});
  if(action==='listHazardsV1'||action==='listRevisionsV1') return ok([],{paging:{total:0,hasMore:false}});
 }
 if(name==='crm-dashboard'&&action==='summaryV1') return ok({section:data.section,kpi:{sales_month:1234567.89,anomaly_open:3,at_customer:135,in_station:120},daily_report:{rows:[]},receivable:{rows:[],total_receivable:1234567.89,total_received:100000,gap_amount:1134567.89,collection_rate:8.1}});
 if(name==='crm-bottle-movement'&&action==='listV1') return ok([{...bottle,type:'out',source_type:'sale',net_weight:56}],{summary,paging:{total:1,page:1,hasMore:false}});
 if(name==='crm-bottle-anomaly'&&action==='typesV1') return ok([]);
 if(name==='crm-bottle-anomaly'&&action==='listV1') return ok([{...bottle,type:'consecutive_out',status:'open',reason:base.remark}],{summary,paging:{total:1,page:1,hasMore:false}});
 if(name==='crm-gas-in'&&action==='getCurrentInventoryV1') return ok({inventory:2000,current_inventory:2000,total_in:3000,total_out:1000});
 if(['crm-station-safety-export','crm-home-safety-export'].includes(name)) {
  if(action==='previewV1') return ok({record_count:1,photo_count:0,hazard_count:0,within_limit:true});
  if(action==='listMineV1') return ok([]);
 }
 if(name==='crm-pda-filling') {
  const task={...bottle,station_code:'DEMO-01',station_name:'模拟灌装工位',target_net_weight:56,weight_start:124,status:'reached'};
  const scale={weight_kg:180,is_stable:true,is_online:true,has_data:true};
  const station={station_code:'DEMO-01',station_name:'模拟灌装工位',status:'reached',task,scale};
  if(action==='getBoardV1') return ok({stations:[station],summary:{total:1,reached:1},refreshed_at:stamp});
  if(action==='getStationV1') return ok(station);
  if(action==='getTaskV1') return ok({station,task,scale});
 }
 if(name==='crm-log'&&action==='listOperationLogsV1') return ok([{...base,action:'view',module:'customer',username:'mobile-preview',detail:base.remark}],{paging:{total:1,page:1,hasMore:false}});
 if(name==='crm-collection'&&action==='listFollowupsV1') return ok([],{paging:{total:0,hasMore:false}});
 if(name==='crm-rfid'&&action==='listSessionsV1') return ok([{...base,session_no:'DEMO-RFID-20260928-00001',status:'complete',bottle_count:1}],{summary:{total:1,complete:1},paging:{total:1,page:1,hasMore:false}});
 if(name==='crm-rfid'&&action==='getSessionV1') return ok({...base,bottles:[bottle],unknown_tags:[]});
 if(name==='crm-bottle-movement'&&action==='cycleLossV1') return ok({list:[],incomplete_list:[],summary:{},paging:{total:0,page:1,hasMore:false}});
 if(name==='crm-gas-in'&&action==='getTankConfigV1') return ok({});
 const rows=rowsByName[name]
 if(rows&&['listV1','listV2','listManageV1','listTasksV1'].includes(action)) return ok(structuredClone(rows),{summary,paging:{page:1,pageSize:20,total:rows.length,hasMore:false}})
 if(rows&&['getV1','getV2','getTaskV1'].includes(action)) return ok(structuredClone(rows[0]))
 if(name==='crm-bottle'&&action==='resolveBottleNoV1') return ok(bottle)
 return {code:501,msg:`本地布局预览未配置 ${name}/${action}，没有网络请求`}
}
