'use strict'
const crypto=require('crypto')
const {prepare,day}=require('./plan')
const {buildPayload,matchReceipt}=require('./protocol')
const STATES='crm_hebei_bridge_state',JOBS='crm_hebei_fill_jobs'
const first=r=>(Array.isArray(r?.data)?r.data[0]:r?.data)||null
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
const sourceHash=r=>hash(r?{_id:r._id,operation_id:r.operation_id,source_version:r.source_version,updated_at:r.updated_at,bottle_no:r.bottle_no,date:r.date,created_at:r.created_at,status:r.status,entry_source:r.entry_source,fill_weight:r.fill_weight,reweigh:r.reweigh}:null)
const key=id=>'hb_'+hash(id).slice(0,40)
const POLICY={quantity_basis:'incremental_fill',inspections_performed_by_staff:true,duration_minutes:10,duration_source:'reporting_template',weather_reference_allowed:true,site_id:'XTNY-001'}
function createService({db,transport,index,now=()=>Date.now()}) {
 const states=db.collection(STATES),jobs=db.collection(JOBS),fillings=db.collection('crm_fillings'),bottles=db.collection('crm_bottles'),cmd=db.command
 const getConfig=async()=>first(await states.doc('config').get())||{mode:'disabled'}
 async function temperature(){return first(await states.doc('temperature_'+day(now())).get())}
 async function setTemperature(data,user) {
  const time=now(),date=day(time)
  if(data.date!==date)throw new Error('日期已变化，请刷新后填写当天温度')
  const v=data.temperature_c
  if(v===null||v===undefined||typeof v==='boolean'||String(v).trim()===''||!Number.isFinite(Number(v))||Number(v)<-60||Number(v)>60)throw new Error('请填写-60至60℃的有效温度')
  const value={_id:'temperature_'+date,site_id:'XTNY-001',reference_date:date,temperature_c:Number(v),unit:'°C',source:'人工查看天气后录入',observed_at:time,fetched_at:time,entered_by:user._id,entered_by_name:user.nickname||user.username||''}
  try{await states.add(value)}catch(e){const existing=await temperature();if(!existing)throw e;if(existing.temperature_c!==value.temperature_c)throw new Error('当天温度已由其他人员填写，请刷新查看；已提交记录不自动改写');return existing}
  return value
 }
 async function setMode(mode,user) {
  if(!['enabled','disabled','preview'].includes(mode))throw new Error('模式无效')
  const c=await getConfig()
  const next={_id:'config',mode,activation_at:c.activation_at||(mode==='enabled'?now():null),updated_at:now(),updated_by:user._id}
  // Preserve the original activation boundary. Re-enabling may resume existing waiting jobs,
  // but never re-send attempting/unknown/confirmed jobs or import older filling records.
  await states.doc('config').set(next)
  return next
 }
 async function health(){
  if(!index.records.length)throw new Error('缺少核实映射')
  await transport.authenticate();const personnel=await transport.personnel(),m=index.records[0]
  const target=await transport.lookup(m.tag)
  if(target.enterprise_id!=='6739'||target.tag!==m.tag||target.product_no!==m.product_no||target.inner_no!==m.regulator_inner_no)throw new Error('河北只读身份检查未通过')
  return {enterprise_id:'6739',mapping_count:index.records.length,personnel,lookup:{tag:target.tag,product_no:target.product_no,enterprise_id:target.enterprise_id},temperature:await temperature(),config:await getConfig()}
 }
 async function discover(config,deadline) {
  // Persist only successfully reconciled rows. An interrupted pass resumes its original
  // day window (also across midnight); a complete pass starts over to catch corrections.
  const saved=first(await states.doc('discovery').get())
  const resume=saved?.activation_at===config.activation_at&&saved.date&&(saved.complete===false||saved.cursor)
  let cursor=resume?saved.cursor:'',scanned=0,complete=false
  const date=resume?saved.date:day(now()),midnight=Date.parse(date+'T00:00:00+08:00')
  try{
   while(now()<deadline-3000&&scanned<500){
    const where=cmd.and({entry_source:'pda_reweigh',created_at:cmd.gte(config.activation_at),...(cursor?{_id:cmd.gt(cursor)}:{})},cmd.or({created_at:cmd.gte(midnight)},{updated_at:cmd.gte(midnight)}))
    const rows=(await fillings.where(where).orderBy('_id','asc').limit(100).get()).data||[]
    if(!rows.length){complete=true;break}
    if(now()>=deadline-3000)break
    const previous=(await jobs.where({filling_id:cmd.in(rows.map(r=>r._id))}).limit(100).get()).data||[]
    const byId=new Map(previous.map(j=>[j.filling_id,j]))
    for(const r of rows){
     if(now()>=deadline-3000)return {scanned,complete:false}
     const id=key(r._id),prev=byId.get(r._id),fingerprint=sourceHash(r)
     if(!prev){try{await jobs.add({_id:id,filling_id:r._id,bottle_no:r.bottle_no,source_hash:fingerprint,source_version:r.source_version,state:'pending',next_at:0,created_at:now(),updated_at:now()})}catch(e){if(!first(await jobs.doc(id).get()))throw e}}
     else if(prev.source_hash!==fingerprint&&prev.state!=='requires_review')await jobs.doc(id).update({state:'requires_review',previous_state:prev.state,reason:'CRM原记录已更正或改变，需核对已报内容',updated_at:now()})
     cursor=r._id;scanned++
    }
    if(rows.length<100){complete=true;break}
   }
   return {scanned,complete}
  }finally{
   await states.doc('discovery').set({_id:'discovery',activation_at:config.activation_at,date,complete,cursor:complete?'':cursor,updated_at:now()})
  }
 }
 async function acquire() {
  const lease=crypto.randomBytes(16).toString('hex'),time=now(),tx=await db.startTransaction()
  try{const old=first(await tx.collection(STATES).doc('worker').get());if(old?.until>time){await tx.rollback();return null}
   await tx.collection(STATES).doc('worker').set({_id:'worker',lease,until:time+90000});await tx.commit();return lease
  }catch(e){await tx.rollback().catch(()=>{});throw e}
 }
 async function own(lease){const l=first(await states.doc('worker').get());if(l?.lease!==lease||l.until<=now())throw new Error('后台处理锁已失效');return true}
 async function checkSource(job){const r=first(await fillings.doc(job.filling_id).get());if(sourceHash(r)!==job.source_hash)throw new Error('CRM原记录已变化');return r}
 async function verify(job,deadline) {
  const receipt=matchReceipt(job,await transport.records(day(JSON.parse(job.payload.czStr).cztime),{deadline}))
  if(!receipt)return false
  await checkSource(job)
  await jobs.where({_id:job._id,state:cmd.in(['attempting','unknown','accepted_pending_verify'])}).update({state:'confirmed',receipt,confirmed_at:now(),updated_at:now(),reason:''})
  return true
 }
 async function run() {
  const deadline=now()+45000
  const config=await getConfig()
  if(config.mode!=='enabled')return {mode:config.mode,processed:0}
  const lease=await acquire();if(!lease)return {busy:true}
  const summary={processed:0,confirmed:0,waiting:0,blocked:0}
  try{
   // Discovery gets a small independent slice; an incomplete scan never starves jobs.
   try{summary.discovery=await discover(config,Math.min(deadline-20000,now()+8000))}
   catch(_){summary.discovery={complete:false,error:'发现任务暂未完成，下轮续查'}}
   if(now()>deadline-12000)return summary
   const candidates=(await jobs.where({state:cmd.in(['pending','waiting','preparing','attempting','unknown','accepted_pending_verify']),next_at:cmd.lte(now())}).orderBy('next_at','asc').orderBy('created_at','asc').limit(10).get()).data||[]
   if(!candidates.length)return summary
   await transport.authenticate({deadline})
   let people=null
   for(const job of candidates){
    if(now()>deadline-12000)break
    await own(lease)
    if((await getConfig()).mode!=='enabled')break
    try{
     const record=await checkSource(job)
     if(['attempting','unknown','accepted_pending_verify'].includes(job.state)){
      const ok=await verify(job,deadline);if(ok)summary.confirmed++;else await jobs.doc(job._id).update({next_at:now()+300000,reason:'尚未找到唯一对应回执，只核验、不重发'})
      summary.processed++;continue
     }
     if(record.consistency_status!=='complete') {await jobs.doc(job._id).update({state:'waiting',next_at:now()+60000,reason:'等待CRM后台处理完成'});summary.waiting++;continue}
     const temp=await temperature()
     if(!temp){await jobs.doc(job._id).update({state:'waiting',next_at:now()+60000,reason:'等待填写当日温度'});summary.waiting++;continue}
     const found=(await bottles.where({bottle_no:record.bottle_no}).limit(2).get()).data||[]
     if(found.length!==1)throw new Error('CRM瓶档不唯一')
     const plan=prepare({record,bottle:found[0],index,weather:temp,policy:POLICY,now:now()})
     if(!people)people=await transport.personnel({deadline})
     const target=await transport.lookup(plan.content.expected_bottle.tag,{deadline})
     const baseline=await transport.records(day(now()),{deadline})
     if(now()>deadline-12000)break
     const at=now(),payload=buildPayload(plan,target,people,at)
     if(day(at)!==temp.reference_date)throw new Error('日期已变化，等待填写当天温度')
     await checkSource(job);await own(lease)
     if((await getConfig()).mode!=='enabled')break
     const attempted={state:'attempting',plan,personnel:people,payload,baseline_ids:baseline.map(r=>String(r.id)),attempted_at:at,next_at:now()+60000,updated_at:now()}
     // Once this write commits, this job can only be verified, never automatically submitted again.
     const changed=await jobs.where({_id:job._id,source_hash:job.source_hash,state:cmd.in(['pending','waiting','preparing'])}).update(attempted)
     if(changed.updated!==1)continue
     Object.assign(job,attempted)
     let response
     try{response=await transport.submit(payload,{deadline})}catch(_){await jobs.doc(job._id).update({state:'unknown',reason:'请求结果未知，需核验河北回执'});summary.processed++;continue}
     const accepted=String(response?.code)==='0'
     // A server error is not proof of no commit. Preserve its digest; do not auto-retry.
     await jobs.doc(job._id).update({state:accepted?'accepted_pending_verify':'unknown',response_hash:hash(response),response_code:response?.code??null,reason:accepted?'等待河北记录回读':'河北未返回明确成功，需核验回执'})
     job.state=accepted?'accepted_pending_verify':'unknown'
     if(now()<deadline-4000&&await verify(job,deadline))summary.confirmed++
     summary.processed++
    }catch(error){
     const current=first(await jobs.doc(job._id).get())
     if(!current)throw error
     if(sourceHash(first(await fillings.doc(job.filling_id).get()))!==job.source_hash){await jobs.doc(job._id).update({state:'requires_review',previous_state:current.state,reason:'CRM原记录已变化，需核对河北结果'});summary.blocked++}
     else if(['attempting','unknown','accepted_pending_verify'].includes(current.state))await jobs.doc(job._id).update({next_at:now()+300000,reason:'回执核验暂未完成，只核验、不重发'})
     else if(error.code==='HEBEI_BUDGET'||/网络|查询失败|登录失败|分页|响应|HTTP/.test(error.message))await jobs.doc(job._id).update({state:'waiting',next_at:now()+60000,reason:error.message})
     else{await jobs.doc(job._id).update({state:'blocked',reason:error.message,updated_at:now()});summary.blocked++}
    }
   }
   return summary
  }finally{await states.where({_id:'worker',lease}).update({until:0,last_run_at:now(),last_summary:summary})}
 }
 async function status(data={}){
  const c=await getConfig(),temp=await temperature()
  const filter=data.filling_id?{filling_id:String(data.filling_id)}:{}
  const rows=(await jobs.where(filter).orderBy('created_at','desc').limit(50).get()).data||[]
  return {date:day(now()),config:c,temperature:temp,jobs:rows.map(j=>({filling_id:j.filling_id,bottle_no:j.bottle_no,state:j.state,reason:j.reason||'',receipt_id:j.receipt?.id||null,updated_at:j.updated_at})),worker:first(await states.doc('worker').get())}
 }
 return {getConfig,setMode,temperature,setTemperature,health,run,status,discover}
}
module.exports={createService,sourceHash,key,STATES,JOBS,POLICY}
