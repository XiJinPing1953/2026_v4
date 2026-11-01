'use strict'
const {createTransport}=require('./protocol')
const {createService}=require('./worker')
const {day}=require('./plan')
const {hasPagePermission}=require('./pageAclLocal')
const crypto=require('crypto')
const db=uniCloud.database()
const runtimeCollection=db.collection('crm_hebei_bridge_state')
async function runtimeConfig(){return (await runtimeCollection.doc('runtime').get()).data?.[0]||{index:{records:[]}}}
function makeService(runtime){return createService({db,index:runtime.index,transport:createTransport({request:(url,options)=>uniCloud.httpclient.request(url,options),config:runtime})})}
async function configureRuntime(value,user){
 if((await runtimeCollection.doc('runtime').get()).data?.length)return {configured:true,existing:true}
 const rows=value?.index?.records
 if(!Array.isArray(rows)||rows.length!==853||!value.username||!value.password)throw new Error('企业配置或853条核实映射缺失')
 for(const field of ['crm_id','bottle_no','tag','product_no'])if(new Set(rows.map(r=>r[field])).size!==853)throw new Error('映射存在重复身份')
 for(let i=0;i<rows.length;i+=100){
  const part=rows.slice(i,i+100),stored=(await db.collection('crm_bottles').where({_id:db.command.in(part.map(r=>r.crm_id))}).limit(100).get()).data||[]
  for(const r of part){const b=stored.find(b=>b._id===r.crm_id);if(!b||b.bottle_no!==r.bottle_no||b.product_no!==r.product_no||b.qr_code!==r.tag||!/^\d{11}$/.test(r.tag))throw new Error('核实映射与CRM当前档案不符')}
 }
 const service=makeService(value);await service.health()
 const compact={username:value.username,password:value.password,assignment:value.assignment,index:{source_sha256:value.index.source_sha256,records:rows.map(r=>Object.fromEntries(['crm_id','bottle_no','product_no','regulator_inner_no','tag','medium','next_inspection','status','verified_at'].map(k=>[k,r[k]])))}}
 await runtimeCollection.add({_id:'runtime',...compact,configured_at:Date.now(),configured_by:user._id,index_sha256:crypto.createHash('sha256').update(JSON.stringify(compact.index)).digest('hex')})
 return {configured:true,mappings:853}
}
exports.main=async(event={},context={})=>{
 try{
  if(context.SOURCE==='timing')return {code:0,data:await makeService(await runtimeConfig()).run()}
  if(typeof event.token!=='string'||!event.token)return {code:401,msg:'请先登录'}
  const user=(await db.collection('crm_users').where({token:event.token}).limit(1).get()).data?.[0]
  if(!user)return {code:401,msg:'登录已失效'}
  const admin=['admin','superadmin'].includes(user.role)
  const action=event.action,data=event.data||{}
  if(action==='configureRuntimeV1'){
   if(!admin)return {code:403,msg:'需要管理员权限'}
   return {code:0,data:await configureRuntime(data.runtime,user)}
  }
  const runtime=await runtimeConfig(),service=makeService(runtime)
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
