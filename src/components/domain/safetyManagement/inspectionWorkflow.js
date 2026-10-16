export const specialWorkTypes=[{code:'hot_work',label:'动火作业'},{code:'confined_space',label:'有限空间作业'},{code:'height',label:'高处作业'},{code:'lifting',label:'吊装作业'},{code:'temporary_power',label:'临时用电作业'},{code:'other',label:'其他特殊作业'}]
export const facilityTypes=[{code:'expansion',label:'膨胀补偿设施'},{code:'rupture_disc',label:'爆破片'},{code:'flame_arrester',label:'阻火器'},{code:'nonmetal_lining',label:'非金属衬里'},{code:'other',label:'其他专用设施（按实际情况）'}]
export const categories=[{id:1,name:'高风险作业'},{id:2,name:'设备设施'},{id:3,name:'作业行为'},{id:4,name:'作业环境'},{id:5,name:'消防设施'},{id:6,name:'安全标志'},{id:7,name:'其他'}]
export const checkFields={
 S02:[{key:'scope',label:'振动、异响、摩擦及支座、基础、支吊架检查',multiline:true}],
 S04:[{key:'personnel',label:'本班实际人员及岗位'},{key:'qualification',label:'资格及任岗依据',placeholder:'关联人员档案并填写本班核对情况'},{key:'briefing',label:'班前教育、岗位交底',placeholder:'填写实际交底记录编号及核对情况'}],
 S05:[{key:'scope',label:'劳保用品正确使用及现场作业纪律检查',multiline:true}],
 S06:[{key:'before',label:'充装前检查',choice:true},{key:'during',label:'充装中检查',choice:true},{key:'after',label:'充装后检查',choice:true},{key:'measurement',label:'适用计量及复检',choice:true},{key:'scope_trace',label:'充装范围和追溯记录',choice:true}],
 S07:[{key:'scope',label:'普通照明、通风、物料堆放及适用环境检查',multiline:true}],
 S08:[{key:'scope',label:'消防栓、配套器材现场状态及取用条件检查',multiline:true}],
 S09:[{key:'labels',label:'产品合格标签、气瓶警示标签核对',choice:true}],
 S10:[{key:'scope',label:'应急物资外观、配套及适用有效状态检查',multiline:true}],
 S11:[{key:'source',label:'报告 / 投诉来源'},{key:'received_at',label:'收到时间',placeholder:'YYYY-MM-DD HH:mm（北京时间）'},{key:'content',label:'反映的安全问题',multiline:true}],
 S13a:[{key:'hose',label:'装卸软管状态',choice:true},{key:'connections',label:'连接状态',choice:true}],
 S13b:[{key:'personnel',label:'装卸人员及岗位',choice:true},{key:'before_after',label:'作业前后检查',choice:true},{key:'process',label:'过程控制',choice:true}],
 S13c:[{key:'weather',label:'本次装卸天气'},{key:'conditions',label:'环境及工况是否满足本次作业要求',choice:true}]
}
export const coverageCodes=['S02','S05','S07','S08','S10']
export function emptyCheck(code=''){return{code,result_code:'',note:'',reason:'',evidence:[],hazard_ids:[],details:{}}}
export function hydrateWorkflow(data={}){
 const source=JSON.parse(JSON.stringify(data.workflow || {})); const definitions=data.definitions?.supplement_definitions || []
 if(!data.observation){
  if(!source.certificate_checks?.length)source.certificate_checks=(data.reference_suggestions?.certificate_checks || []).map(row=>({...JSON.parse(JSON.stringify(row)),verification:'',result_code:'',note:'',hazard_ids:[]}))
  const suggestions=data.reference_suggestions?.facilities || []
  source.facilities=facilityTypes.map(type=>{const current=source.facilities?.find(row=>row.code===type.code);if(current?.present)return current;const known=suggestions.find(row=>row.code===type.code && ['yes','no'].includes(row.present));return known?{code:type.code,name:known.name || type.label,present:known.present,result_code:'',note:'',evidence:[],hazard_ids:[],source_inspection_id:known.source_inspection_id,verified_by:known.verified_by,verified_at:known.verified_at}:current || {code:type.code,present:''}})
 }
 const checks=definitions.length?definitions.map(def=>def.code).filter(code=>Object.hasOwn(checkFields,code)):Object.keys(checkFields)
 return {...source,version:1,observed_at:source.observed_at || data.inspection?.ended_at || data.inspection?.inspection_at || '',
 special_work:specialWorkTypes.map(type=>{const old=(source.special_work || []).find(item=>item.type===type.code)||{};return{type:type.code,conducted:'',events:[],...old,events:(old.events || []).map(event=>({...emptyCheck(),...event,details:{}}))}}),
 activities:{filling:'',unloading:'',receiving:'',reports:'',...(source.activities || {})},certificate_scope_confirmed:source.certificate_scope_confirmed===true,
 checks:checks.map(code=>{const old=(source.checks || []).find(item=>item.code===code)||{};return{...emptyCheck(code),...old,details:{...(old.details || {})}}}),
 certificate_checks:(source.certificate_checks || []).map(item=>({...emptyCheck(),id:newRowId(),equipment:'',reference_no:'',valid_until:'',verification:'',...item})),
 controls:(data.open_hazards || []).map(hazard=>({hazard_id:hazard._id,implemented:'',changed:'',note:'',evidence:[],...(source.controls || []).find(item=>item.hazard_id===hazard._id)})),
 facilities:facilityTypes.map(type=>{const old=(source.facilities || []).find(item=>item.code===type.code)||{};return {...emptyCheck(),code:type.code,present:'',...old,name:old.name || type.label}})}
}
export function newRowId(){return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}
export function newSpecialEvent(){return{...emptyCheck(),id:newRowId(),name:'',location:'',started_at:'',ended_at:'',approval:'',monitor:'',measures:''}}

export function confirmUnchangedCertificates(rows,date){
 let count=0
 for(const row of rows){
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(row.valid_until || '') && !Number.isNaN(Date.parse(`${row.valid_until}T00:00:00Z`)) && new Date(`${row.valid_until}T00:00:00Z`).toISOString().slice(0,10)===row.valid_until
  if(['changed','missing'].includes(row.verification)||row.result_code==='abnormal'||!row.equipment||!row.reference_no||!validDate||row.valid_until<date||!row.evidence?.length)continue
  row.verification='unchanged';row.result_code='normal';count++
 }
 return count
}
