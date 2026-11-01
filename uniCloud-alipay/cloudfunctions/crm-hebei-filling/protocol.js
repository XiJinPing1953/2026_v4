'use strict'
const { day, validateTarget } = require('./plan')
const { resolvePersonnel } = require('./personnel')
const decode = v => typeof v === 'string' ? JSON.parse(v) : v
const text = v => String(v ?? '').trim()
const xmlEscape = v => String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
function parseSoap(xml) {
 if (typeof xml !== 'string' || xml.length>8000000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('河北响应格式异常')
 const matches=[...xml.matchAll(/<(?:[\w.-]+:)?return(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?return>/g)]
 if(matches.length!==1)throw new Error('河北响应缺少唯一回执')
 let body=matches[0][1]
 if(body.startsWith('<![CDATA[')&&body.endsWith(']]>'))body=body.slice(9,-3)
 else body=body.replace(/&#x([\da-f]+);|&#(\d+);|&(quot|apos|lt|gt|amp);/gi,(_,hex,num,name)=>hex?String.fromCodePoint(parseInt(hex,16)):num?String.fromCodePoint(Number(num)):({quot:'"',apos:"'",lt:'<',gt:'>',amp:'&'}[name]))
 return JSON.parse(body)
}
function envelope(method,data,now) {
 return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://itelian.cn"><soap:Body><t:${method}><t:in0>${xmlEscape('hebei-boot'+day(now))}</t:in0><t:in1>${xmlEscape(JSON.stringify(data))}</t:in1></t:${method}></soap:Body></soap:Envelope>`
}
function buildPayload(plan,target,personnel,at) {
 validateTarget(plan,target)
 if(!Number.isFinite(Number(target.volume))||Number(target.volume)<=0)throw new Error('目标气瓶容积异常')
 const p=personnel.roles, names=p.filling1.personname+'，'+p.filling2.personname
 const cz={cztime:at,checkpersonid:p.before.personid,checkpersonname:p.before.personname,personid:p.filling1.personid+'，'+p.filling2.personid,personname:names,sydwid:6739}
 // Defaults are from the installed Hebei App 1.0.85 getYhCheckRecord.
 const jc={cqchecktime:at,cqperson:p.before.personname,cqxkz:'有',cqmedia:'是',cqtag:'是',cqzy:'是',cqcolor:'是',cqgbt15383:'是',cqpressure:'是',cqqx:'无',cqvalid:'是',cqsafe:'是',cqyz:'否',cqxr:'否',cqsjnx:'是',
  cztime:at,czgasid:target.product_no,cztemperature:String(plan.content.fields.temperature_c),czvolume:String(target.volume),czyc:'无',czperson:names,czcheckperson:p.after.personname,
  chperson:p.after.personname,chtime:at+600000,chczl:'是',chmf:'是',chgb:'无',chyc:'无',chtag:'是',chzl:String(plan.content.fields.quantity_kg)}
 return {czStr:JSON.stringify(cz),jcStr:JSON.stringify(jc),gasType:'gas',gasId:String(target.appid),mediumType:'medium_liquefaction',sydwCity:'130100',sydwBelt:'130130'}
}
function createTransport({request,config,now=()=>Date.now()}) {
 const allowed={sydw:['login'],gygas:['getCzPersonList','getGasCzRecordPage'],gygasgroup:['getGasGroupOrGasForCz'],fillgasinspect:['saveGyCzrecord']}
 async function call(service,method,data,{deadline=now()+45000}={}) {
  if(!allowed[service]?.includes(method))throw new Error('接口不在本次允许范围')
  const timeout=Math.min(8000,deadline-now()-1000)
  if(timeout<=0){const e=new Error('河北查询预算已用完，稍后继续核验');e.code='HEBEI_BUDGET';throw e}
  let result
  try {result=await request('https://hbnew.qiping.org.cn/ws/'+service,{method:'POST',data:envelope(method,data,now()),headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:'""'},timeout,dataType:'text'})}
  catch(_){throw new Error('河北接口网络异常')}
  if(Number(result.status)!==200)throw new Error('河北接口HTTP异常')
  return parseSoap(Buffer.isBuffer(result.data)?result.data.toString('utf8'):result.data)
 }
 async function authenticate(options) {
  if(!config.username||!config.password)throw new Error('未配置河北企业账号')
  const r=await call('sydw','login',{uname:config.username,pwd:config.password},options)
  if(String(r.code)!=='0')throw new Error('河北企业登录失败')
  const x=decode(r.data)
  if(String(x.id)!=='6739'||String(x.sydwBelt)!=='130130')throw new Error('河北企业身份不匹配')
  return {enterprise_id:'6739'}
 }
 async function personnel(options) {
  const r=await call('gygas','getCzPersonList',{sydwId:'6739',sydwBelt:'130130'},options)
  if(String(r.code)!=='0')throw new Error('河北人员查询失败')
  const people=decode(r.data)
  if(!Array.isArray(people))throw new Error('人员响应格式异常')
  return resolvePersonnel({roster:{enterprise_id:'6739',people},assignment:config.assignment,enterpriseId:'6739',now:now()})
 }
 async function lookup(tag,options) {
  const r=await call('gygasgroup','getGasGroupOrGasForCz',{sydwId:'6739',qrCode:tag},options)
  if(String(r.code)!=='0'||String(r.data)!=='1')throw new Error('河北未返回唯一单瓶')
  const x=decode(r.data2)
  return {tag:text(x.qrcode),product_no:text(x.originid),inner_no:text(x.innerid),medium:text(x.media),next_inspection:text(x.nextcheckdate).slice(0,10),status:text(x.gasstate),enterprise_id:String(x.sydwid),appid:x.appid,volume:x.realvolume}
 }
 async function records(date,{deadline=now()+45000}={}) {
  const end=new Date(Date.parse(date+'T00:00:00+08:00')+86400000)
  const endDay=day(end.getTime()), result=[],ids=new Set()
  let total=null,pages=null
  for(let page=1;page<=100;page++) {
   const r=await call('gygas','getGasCzRecordPage',{sydwId:'6739',startDay:date,endDay,pageNo:String(page)},{deadline})
   if(String(r.code)!=='0')throw new Error('河北充装回查失败')
   const p=decode(r.data)
   if(!Array.isArray(p.records)||!Number.isInteger(p.total)||!Number.isInteger(p.pages)||Number(p.current)!==page)throw new Error('河北分页响应异常')
   if(total===null){total=p.total;pages=p.pages}
   if(p.total!==total||p.pages!==pages)throw new Error('河北记录查询期间发生变化，稍后核验')
   for(const row of p.records){if(ids.has(String(row.id)))throw new Error('河北分页记录重复');ids.add(String(row.id));result.push(row)}
   if(page>=pages){if(result.length!==total)throw new Error('河北记录回查不完整');return result}
  }
  throw new Error('河北记录分页超过本次上限')
 }
 async function submit(payload,options) {return call('fillgasinspect','saveGyCzrecord',payload,options)}
 return {authenticate,personnel,lookup,records,submit}
}
function matchReceipt(job,records) {
 const cz=JSON.parse(job.payload.czStr),jc=JSON.parse(job.payload.jcStr),old=new Set(job.baseline_ids||[])
 const matches=records.filter(r=>!old.has(String(r.id))&&String(r.sydwid)==='6739'&&text(r.qrcode)===job.plan.content.expected_bottle.tag&&text(r.originid)===job.plan.content.expected_bottle.product_no&&text(r.innerid)===job.plan.content.expected_bottle.inner_no&&String(r.cylinderId)===job.payload.gasId&&Math.abs(Number(r.cztime)-cz.cztime)<1000&&text(r.personid)===cz.personid&&text(r.checkpersonid)===cz.checkpersonid&&text(r.personname)===cz.personname&&text(r.checkpersonname)===cz.checkpersonname&&text(r.czl)!==''&&Math.abs(Number(r.czl)-Number(jc.chzl))<0.001)
 return matches.length===1?{id:matches[0].id,record:matches[0]}:null
}
module.exports={createTransport,buildPayload,matchReceipt,parseSoap,envelope}
