'use strict'
const {snapshot}=require('./snapshot')
const first=r=>Array.isArray(r?.data)?r.data[0]:r?.data
exports.main=async(event={})=>{
 try {
  if(typeof event.token!=='string'||!event.token.trim())return{code:403,msg:'需要超级管理员登录'}
  const db=uniCloud.database(),user=first(await db.collection('crm_users').where({token:event.token}).limit(1).get())
  if(!user||user.role!=='superadmin')return{code:403,msg:'仅超级管理员可读取修正原值'}
  const id=event.data?.customer_id
  if(!/^[a-f0-9]{24}$/.test(id||''))return{code:400,msg:'客户编号无效'}
  if(event.action==='inspectV1')return{code:0,data:await snapshot(db,id)}
  return{code:400,msg:'当前仅开放原值读取，修正入口尚未启用'}
 }catch(e){return{code:409,msg:e.message}}
}
