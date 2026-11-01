'use strict'
const crypto = require('node:crypto')
const ALLOWED = new Set(['registration_mark','equipment_type','product_no','gas_medium_code','qr_code','pda_qr_code','manufacturer','volume_l','manufacture_date','bottle_check_date','bottle_next_check_date','remark'])
function canonical(value) {
 if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
 if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}'
 return JSON.stringify(value)
}
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex')
const one = result => Array.isArray(result?.data) ? result.data[0] : result?.data
function createCorrection({db,payload,config}) {
 if (hash(payload)!==config.payload_sha256 || payload.batch_id!==config.batch_id || !Array.isArray(payload.items) || !payload.items.length) throw Error('固定批次载荷不符')
 const ids=new Set(),nos=new Set()
 for(const item of payload.items) {
  if(!item._id || item._id!==item.before?._id || item.bottle_no!==item.before.bottle_no || ids.has(item._id) || nos.has(item.bottle_no)) throw Error('批次身份冲突')
  ids.add(item._id);nos.add(item.bottle_no)
  if(!Number.isSafeInteger(item.expected_updated_at) || item.before.updated_at!==item.expected_updated_at || !Number.isSafeInteger(item.applied_at) || !Number.isSafeInteger(item.rollback_at) || item.rollback_at<=item.applied_at || item.applied_at<=item.expected_updated_at) throw Error('版本无效')
  const fields=Object.keys(item.set||{})
  if(!fields.length || fields.some(k=>!ALLOWED.has(k))) throw Error('超出字段范围')
  if(item.before.pda_qr_code && item.set.pda_qr_code!==undefined) throw Error('不允许覆盖已有PDA码')
  for(const [key,value] of Object.entries(item.set)) {
   if(key==='volume_l' ? !(typeof value==='number' && value>0 && Number.isFinite(value)) : !(typeof value==='string' && value.trim())) throw Error('无效字段值')
   if(key==='gas_medium_code' && !['LNG','LPG','O2','N2','Ar','OTHER'].includes(value)) throw Error('介质无效')
   if(key==='qr_code' && !/^\d{11}$/.test(value)) throw Error('标签号无效')
   if(/_date$/.test(key) && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)) throw Error('日期无效')
  }
 }
 if(!Array.isArray(payload.groups) || payload.groups.flat().length!==ids.size || new Set(payload.groups.flat()).size!==ids.size || payload.groups.some(g=>!g.length || g.length>10 || g.some(id=>!ids.has(id)))) throw Error('分组无效')
 const items=new Map(payload.items.map(x=>[x._id,x]))
 const after=item=>({...item.before,...item.set,updated_at:item.applied_at})
 const restored=item=>({...item.before,updated_at:item.rollback_at})
 function classify(item,current) {
  if(!current || current._id!==item._id || current.bottle_no!==item.bottle_no) return 'identity_conflict'
  if(hash(current)===hash(after(item))) return 'applied'
  if(hash(current)===hash(restored(item))) return 'rolled_back'
  if(hash(current)===hash(item.before)) return 'ready'
  return 'source_changed'
 }
 function authorized(event) {
  const got=crypto.createHash('sha256').update(String(event.secret||'')).digest(),expected=Buffer.from(config.secret_sha256,'hex')
  return got.length===expected.length && crypto.timingSafeEqual(got,expected) && event.batch_id===config.batch_id
 }
 async function snapshot(page) {
  if(!Number.isInteger(page)||page<1||page>100) throw Error('页码无效')
  const c=db.collection('crm_bottles'),total=await c.count(),r=await c.orderBy('_id','asc').skip((page-1)*100).limit(100).get()
  return {total:total.total,records:r.data,page,source:'raw crm_bottles'}
 }
 async function checkCodes(database,selected,mode) {
  const desired=selected.map(item=>mode==='rollback'?restored(item):after(item)),selectedIds=new Set(selected.map(x=>x._id)),codes=[...new Set(desired.flatMap(x=>[x.qr_code,x.pda_qr_code]).filter(Boolean))]
  if(!codes.length)return
  const found=await database.collection('crm_bottles').where(db.command.or([{qr_code:db.command.in(codes)},{pda_qr_code:db.command.in(codes)}])).limit(100).get()
  if(!Array.isArray(found.data)||found.data.length>=100) throw Error('扫码冲突读取不完整')
  const all=[...found.data.filter(x=>!selectedIds.has(x._id)),...desired],owners=new Map()
  for(const row of all) for(const code of [row.qr_code,row.pda_qr_code].filter(Boolean)) {
   if(owners.has(code)&&owners.get(code)!==row._id) throw Error('扫码标识冲突')
   owners.set(code,row._id)
  }
 }
 async function run(mode,group) {
  if(!Number.isInteger(group)||!payload.groups[group]) throw Error('分组不存在')
  const selected=payload.groups[group].map(id=>items.get(id)),tx=mode==='probe'?db:await db.startTransaction()
  let commitAttempted=false
  try {
   const results=[]
   for(const item of selected)results.push({bottle_no:item.bottle_no,state:classify(item,one(await tx.collection('crm_bottles').doc(item._id).get()))})
   const allowed=mode==='rollback'?['applied','rolled_back']:['ready','applied']
   if(results.some(x=>!allowed.includes(x.state))) {if(mode!=='probe')await tx.rollback();return {group,results,changed:0}}
   await checkCodes(tx,selected,mode)
   if(mode==='probe')return {group,results,changed:0}
   let changed=0
   for(let i=0;i<selected.length;i++) {
    const item=selected[i],done=mode==='rollback'?'rolled_back':'applied'
    if(results[i].state===done)continue
    let patch={...item.set,updated_at:item.applied_at}
    if(mode==='rollback') {
     patch={updated_at:item.rollback_at}
     for(const k of Object.keys(item.set))patch[k]=Object.hasOwn(item.before,k)?item.before[k]:db.command.remove()
    }
    const version=mode==='rollback'?item.applied_at:item.expected_updated_at
    const response=await tx.collection('crm_bottles').where({_id:item._id,updated_at:version}).update(patch)
    if(Number(response.updated)!==1)throw Error('原值版本变化')
    changed++;results[i].state=done
   }
   commitAttempted=true;await tx.commit()
   for(let i=0;i<selected.length;i++)results[i].state=classify(selected[i],one(await db.collection('crm_bottles').doc(selected[i]._id).get()))
   return {group,results,changed}
  } catch(error) {
   if(mode!=='probe'&&!commitAttempted)await tx.rollback().catch(()=>{})
   return {group,changed:null,state:commitAttempted?'unknown':'rejected',reason:commitAttempted?'提交结果待回查':String(error.message)}
  }
 }
 return async event=>{
  if(!authorized(event))return {code:403,msg:'无权访问固定批次'}
  if(event.mode==='capabilities')return {code:0,data:{batch_id:config.batch_id,payload_sha256:config.payload_sha256,code_sha256:config.code_sha256,count:payload.items.length,groups:payload.groups.length,fields:[...ALLOWED]}}
  try {
   if(event.mode==='snapshot')return {code:0,data:await snapshot(event.page)}
   if(!['probe','apply','rollback'].includes(event.mode))return {code:400,msg:'不支持的操作'}
   if(event.mode!=='probe'&&event.confirm!==event.mode.toUpperCase()+':'+config.batch_id)return {code:403,msg:'缺少固定批次确认'}
   return {code:0,data:await run(event.mode,event.group)}
  }catch(error){return {code:409,msg:String(error.message)}}
 }
}
module.exports={createCorrection,canonical,hash}
