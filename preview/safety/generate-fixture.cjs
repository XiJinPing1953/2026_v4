'use strict'
const fs = require('fs')
const p = require('../../uniCloud-alipay/cloudfunctions/crm-safety-management/policy')
const inspection = require('../../uniCloud-alipay/cloudfunctions/crm-station-safety-inspection/inspectionPolicy')
const date = '2026-10-15', at = p.atDate(date) + 9 * 3600000
const record = { _id:'preview-inspection', inspection_no:'LOCAL-20261015-0001', station_id:p.STATION.id, station_name_snapshot:p.STATION.name, template_code:inspection.TEMPLATE.code, template_version:inspection.TEMPLATE.version, revision:1, inspection_date:date, inspection_at:at+1800000, started_at:at, ended_at:at+1800000, submitted_at:at+1801000, weather:'晴（本地示例）', inspector_name:'模拟安全员', items:inspection.TEMPLATE.areas.flatMap(area=>area.items.map(item=>({ area_code:area.code,area_label_snapshot:area.label,item_code:item.code,item_label_snapshot:item.label,category_code:item.category_code,result_code:'normal',is_abnormal:false,photo_file_ids:[],photo_urls:[] }))) }
record.items[0].photo_file_ids=['cloud://preview/evidence-one.jpg','cloud://preview/evidence-two.jpg']
const config = {station_id:p.STATION.id,station_name:p.STATION.name,enabled_from:date,roles:{safety_officer:['preview-user'],safety_director:['preview-user'],principal:['preview-user']},special_equipment:[],revision:1}
const items = p.SUPPLEMENT_DEFINITIONS.map(def=>({code:def.code,category_code:def.category_code,label:def.label,standard:def.standard,result_code:'',note:'',reason:'',evidence:[],hazard_ids:[],details:{}}))
const supplement={_id:'preview-supplement',revision:0,items}
const snapshot=p.buildDailySnapshot({station_id:p.STATION.id,date,config,inspections:[record],supplement,hazards:[]})
fs.writeFileSync(__dirname+'/fixture.json',JSON.stringify({config,categories:p.CATEGORIES,supplement_definitions:p.SUPPLEMENT_DEFINITIONS,permissions:{view:true,configure:true,daily:true,weekly:true,monthly:true,export:true},users:[{_id:'preview-user',name:'模拟安全员',username:'local-only'}],daily:{record:null,supplement,snapshot,stale:false}},null,2)+'\n')
