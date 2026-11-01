'use strict'
const {createTransport}=require('./protocol')
const {createService}=require('./worker')
const {day}=require('./plan')
const {hasPagePermission}=require('./pageAclLocal')
let runtime={index:{records:[]}}
try{runtime=require('./runtime.private.json')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}
const db=uniCloud.database()
const service=createService({db,index:runtime.index,transport:createTransport({request:(url,options)=>uniCloud.httpclient.request(url,options),config:runtime})})
exports.main=async(event={},context={})=>{
 try{
  if(context.SOURCE==='timing')return {code:0,data:await service.run()}
  if(typeof event.token!=='string'||!event.token)return {code:401,msg:'请先登录'}
  const user=(await db.collection('crm_users').where({token:event.token}).limit(1).get()).data?.[0]
  if(!user)return {code:401,msg:'登录已失效'}
  const admin=['admin','superadmin'].includes(user.role)
  const action=event.action,data=event.data||{}
  if(['getDailyTemperatureV1','setDailyTemperatureV1','getFillingStatusV1'].includes(action)){
   if(!hasPagePermission(user,'/pages/pda/reweigh',action==='setDailyTemperatureV1'?'create':'view'))return {code:403,msg:'没有罐装复秤权限'}
   if(action==='setDailyTemperatureV1')return {code:0,data:await service.setTemperature(data,user)}
   const config=await service.getConfig()
   if(action==='getFillingStatusV1'){
    if(typeof data.filling_id!=='string'||!data.filling_id||data.filling_id.length>160)return {code:400,msg:'缺少灌装记录编号'}
    const status=await service.status({filling_id:data.filling_id})
    if(status.jobs.length)return {code:0,data:status.jobs[0]}
    const row=(await db.collection('crm_fillings').doc(data.filling_id).get()).data?.[0]
    return {code:0,data:{state:config.mode!=='enabled'?'disabled':row?.entry_source==='pda_reweigh'&&row.created_at>=config.activation_at?'pending':'outside_scope'}}
   }
   return {code:0,data:{date:day(Date.now()),mode:config.mode,temperature:await service.temperature()}}
  }
  if(!admin)return {code:403,msg:'需要管理员权限'}
  if(action==='capabilitiesV1')return {code:0,data:{version:1,mappings:runtime.index.records.length,temperature_mode:'manual_daily',automatic_retry_after_attempt:false,config:await service.getConfig()}}
  if(action==='healthV1')return {code:0,data:await service.health()}
  if(action==='statusV1')return {code:0,data:await service.status(data)}
  if(action==='setModeV1'){
   if(data.mode==='enabled'){
    if(data.confirm!=='仅自动提交启用后新保存的正式复秤记录')return {code:400,msg:'缺少启用范围确认'}
    if(runtime.index.records.length!==853)return {code:409,msg:'核实映射数量不符'}
    await service.health()
   }
   return {code:0,data:await service.setMode(data.mode,user)}
  }
  if(action==='runV1')return {code:0,data:await service.run()}
  return {code:400,msg:'未知操作'}
 }catch(e){return {code:409,msg:e.message||'河北后台处理未完成'}}
}
