'use strict'
// Local examples only. No cloud connection or file upload is performed here.
const fs = require('node:fs')
const P = require('../../uniCloud-alipay/cloudfunctions/crm-safety-management/policy')
const inspection = require('../../uniCloud-alipay/cloudfunctions/crm-station-safety-inspection/inspectionPolicy')
function createFixture({ date = P.shanghaiDate(), templateVersion, enableExampleRoles = false } = {}) {
  const template = templateVersion ? inspection.getTemplate(inspection.TEMPLATE.code, templateVersion) : inspection.TEMPLATE
  const at = P.atDate(date) + 9 * 3600000
  const record = { _id:'preview-inspection', inspection_no:`LOCAL-${date.replaceAll('-','')}-0001`, station_id:P.STATION.id, station_name_snapshot:P.STATION.name, template_code:template.code, template_version:template.version, revision:1, inspection_date:date, inspection_at:at+1800000, started_at:at, ended_at:at+1800000, submitted_at:at+1801000, created_at:at+1801000, created_by:'preview-user', inspector_id:'preview-user', inspector_name:'模拟巡检员（本地示例）', weather:'晴（本地示例）', overall_result:'normal', abnormal_count:0, item_count:36, items:template.areas.flatMap(area=>area.items.map(item=>({ area_code:area.code,area_label_snapshot:area.label,item_code:item.code,item_label_snapshot:item.label,category_code:item.category_code || P.ITEM_CATEGORY[item.code],result_code:'normal',is_abnormal:false,photo_file_ids:[],photo_urls:[],issue_note:'' }))) }
  // Only two marked illustrative images; this fixture is not evidence of a real inspection.
  record.items[0].photo_file_ids=['cloud://preview/evidence-one.jpg','cloud://preview/evidence-two.jpg']
  const roles={safety_officer:[],safety_director:[],principal:[]}
  if (enableExampleRoles) for (const role of Object.keys(roles)) roles[role]=['preview-user']
  const config={_id:P.identity('config',P.STATION.id,''),station_id:P.STATION.id,station_name:P.STATION.name,enabled_from:enableExampleRoles?date:'',roles,special_equipment:[],revision:0}
  const user={_id:'preview-user',name:'本地模拟用户',nickname:'本地模拟用户',username:'local-only',token:'local-preview-only',role:'superadmin',role_template:'superadmin',status:'active'}
  const items=P.SUPPLEMENT_DEFINITIONS.map(def=>({code:def.code,category_code:def.category_code,label:def.label,standard:def.standard,result_code:'',note:'',reason:'',evidence:[],hazard_ids:[],details:{}}))
  const supplement={_id:P.identity('supplement',P.STATION.id,date),station_id:P.STATION.id,date,revision:0,items,workflow_observations:[]}
  const snapshot=P.buildDailySnapshot({station_id:P.STATION.id,date,config,inspections:[record],supplement,hazards:[]})
  return {date,config,categories:P.CATEGORIES,supplement_definitions:P.SUPPLEMENT_DEFINITIONS,permissions:{view:true,configure:true,daily:enableExampleRoles,weekly:enableExampleRoles,monthly:enableExampleRoles,export:true},users:[user],inspection:record,daily:{record:null,supplement,snapshot,stale:false}}
}
if(require.main===module)fs.writeFileSync(__dirname+'/fixture.json',JSON.stringify(createFixture(),null,2)+'\n')
module.exports={createFixture}
