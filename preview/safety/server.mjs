// Development-only, per-tab in-memory adapter. Calls the actual management service
// with an isolated database harness; it never instantiates uniCloud or an uploader.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createDatabase, acl } = require('../../scripts/safetyManagementTestHarness.cjs')
const { createService } = require('../../uniCloud-alipay/cloudfunctions/crm-safety-management/service')
const inspectionPolicy = require('../../uniCloud-alipay/cloudfunctions/crm-station-safety-inspection/inspectionPolicy')
const { createFixture } = require('./generate-fixture.cjs')
const media = Object.fromEntries(['one','two'].map((part,index)=>[`cloud://preview/evidence-${part}.jpg`,'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360"><rect width="600" height="360" fill="#dcecf3"/><text x="300" y="170" text-anchor="middle" font-size="28">LOCAL TEST EVIDENCE ${index+1}</text><text x="300" y="220" text-anchor="middle" font-size="20">No real inspection photograph</text></svg>`)]))
const clone = value => JSON.parse(JSON.stringify(value))
export function createPreviewSession(options={}) {
  const fixture=createFixture(options)
  const database=createDatabase({crm_users:fixture.users,crm_safety_management_config:[fixture.config],crm_station_safety_inspections:[fixture.inspection],crm_station_safety_hazards:[]})
  const cloud={getTempFileURL:async({fileList})=>({fileList:fileList.map(fileID=>({fileID,tempFileURL:media[fileID]||''}))})}
  const clock=()=>Math.max(Date.now(),Number(fixture.inspection.ended_at)+3600000)
  const service=createService({database,acl,cloud,clock})
  const ok=data=>({code:0,data:clone(data),msg:'仅本地内存示例'})
  async function call(name,{action,data={}}={}) {
    if(name==='crm-safety-management') {
      if(action==='exportV1'&&data.format==='xlsx')return {code:501,msg:'本地示例不上传Excel；正式导出由后端测试验证'}
      return service.main({action,data,token:'local-preview-only'})
    }
    if(name!=='crm-station-safety-inspection')return {code:501,msg:`本地示例未配置 ${name}/${action}；未发出云端请求`}
    if(action==='getTemplateV1') {
      const template=data.template_version?inspectionPolicy.getTemplate(data.template_code,Number(data.template_version)):inspectionPolicy.TEMPLATE
      if(!template)return {code:404,msg:'示例模板不存在'}
      return ok({template_code:template.code,template_version:template.version,title:template.title,station:template.station,areas:template.areas,classification_version:template.classification_version,categories:template.categories,item_count:36,is_current:template===inspectionPolicy.TEMPLATE,server_now:clock()})
    }
    if(action==='listV1') {const rows=database.rows('crm_station_safety_inspections');return {...ok(rows),paging:{total:rows.length,page:1,pageSize:20}}}
    if(action==='getV1') {const row=database.rows('crm_station_safety_inspections').find(row=>row._id===(data._id||data.id));return row?ok({...row,related_hazards:[],can_update:false}):{code:404,msg:'示例巡检不存在'}}
    if(action==='listHazardsV1') {let rows=database.rows('crm_station_safety_hazards');if(data.status==='open')rows=rows.filter(row=>['pending_rectification','pending_verification'].includes(row.status));if(data.status==='closed')rows=rows.filter(row=>row.status==='closed');return {...ok(rows),paging:{total:rows.length,page:1,pageSize:20}}}
    if(action==='getHazardV1') {const row=database.rows('crm_station_safety_hazards').find(row=>row._id===data._id);return row?ok(row):{code:404,msg:'示例隐患不存在'}}
    return {code:501,msg:`本地示例未配置 ${action}。请从已保存的示例巡检继续七类检查；不模拟真实拍照上传。`}
  }
  return {fixture,database,call}
}
export function safetyPreviewMiddleware() {
  const sessions=new Map()
  return async function(req,res,next) {
    if(req.url?.split('?')[0]!=='/__safety-preview/api')return next()
    res.setHeader('Cache-Control','no-store')
    res.setHeader('Content-Type','application/json; charset=utf-8')
    const respond=(code,result)=>{res.statusCode=code;res.end(JSON.stringify(result))}
    if(req.method!=='POST')return respond(405,{code:405,msg:'本地示例仅接受POST'})
    // Same-origin local developer page only. There is no cloud identity or network proxy.
    const origin=String(req.headers.origin||'')
    if(origin&&origin!==`http://${req.headers.host}`)return respond(403,{code:403,msg:'只接受当前本地预览页面'})
    try {
      let body=''
      for await(const chunk of req) {body+=chunk;if(body.length>2_000_000)throw Error('示例请求过大')}
      const input=JSON.parse(body)
      const key=String(input.session||'')
      if(!/^[a-zA-Z0-9_-]{8,100}$/.test(key))return respond(400,{code:400,msg:'缺少隔离示例会话'})
      const now=Date.now()
      for(const [id,session] of sessions)if(now-session.touched>2*3600000)sessions.delete(id)
      if(!sessions.has(key)) {if(sessions.size>=30)return respond(429,{code:429,msg:'本地示例会话过多，请重启预览'});sessions.set(key,{...createPreviewSession(),touched:now})}
      const session=sessions.get(key);session.touched=now
      const result=await session.call(input.name,input.request)
      if(input.missing_media&&result?.data?.media_urls)result.data.media_urls={}
      respond(200,result)
    } catch(error) {respond(500,{code:500,msg:`本地示例：${error.message}`})}
  }
}
