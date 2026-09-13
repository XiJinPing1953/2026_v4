'use strict'
const crypto = require('crypto')
const { readComplete } = require('./financialReadLocal')
const CUSTOMER_ID = '694045c0adf6dbd796e261b5'
const TABLES = ['crm_sale_records','crm_customer_receipts','crm_customer_allocations','crm_customer_flow_settlements','crm_customer_opening_debts','crm_customer_receipt_adjustments','crm_customer_deposit_accounts','crm_customer_deposit_entries','crm_collection_tasks','crm_collection_followups']
const optional = new Set(['crm_customer_receipt_adjustments','crm_collection_tasks','crm_collection_followups'])
const first = r => Array.isArray(r?.data) ? r.data[0] : r?.data
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v
const digest = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
async function snapshot(db) {
 const started=Date.now(), customer=first(await db.collection('crm_customers').doc(CUSTOMER_ID).get())
 if (!customer || customer.name !== '鲍立雄') throw Error('客户范围不符')
 const tables={crm_customers:[customer]}, absent=[]
 for(const name of TABLES) {
  try { await db.collection(name).where({customer_id:CUSTOMER_ID}).count() }
  catch(e) { if(optional.has(name)&&String(e.message).trim()==='not found collection'){tables[name]=[];absent.push(name);continue}throw Error(name+': '+e.message) }
  tables[name]=await readComplete(db.collection(name),{customer_id:CUSTOMER_ID},{command:db.command,source:name,maxRows:10000})
 }
 const sales=tables.crm_sale_records.map(x=>x._id),receipts=tables.crm_customer_receipts.map(x=>x._id),targets=[...sales,...tables.crm_customer_opening_debts.map(x=>x._id)]
 for(const [name,field,ids] of [['crm_customer_receipts','source_id',sales],['crm_customer_allocations','receipt_id',receipts],['crm_customer_allocations','target_id',targets],['crm_customer_allocations','sale_id',sales]]) {
  for(let i=0;i<ids.length;i+=50){const rows=await readComplete(db.collection(name),{[field]:db.command.in(ids.slice(i,i+50))},{command:db.command,source:name+'_reverse',maxRows:10000});if(rows.some(x=>x.customer_id!==CUSTOMER_ID||!tables[name].some(y=>y._id===x._id)))throw Error('范围外反向关联')}
 }
 const voucherMap=new Map();let hasVouchers=true
 try {await db.collection('crm_vouchers').where({customer_id:CUSTOMER_ID}).count()}catch(e){if(String(e.message).trim()!=='not found collection')throw e;hasVouchers=false;absent.push('crm_vouchers')}
 for(const field of hasVouchers ? ['customer_id','source','source_key'] : []) {
  const values=field==='customer_id'?[CUSTOMER_ID]:sales.map(x=>'sale:'+x)
  for(let i=0;i<values.length;i+=50){const rows=await readComplete(db.collection('crm_vouchers'),{[field]:db.command.in(values.slice(i,i+50))},{command:db.command,source:'crm_vouchers',maxRows:10000});for(const x of rows)voucherMap.set(x._id,x)}
 }
 tables.crm_vouchers=[...voucherMap.values()]
 for(const rows of Object.values(tables))rows.sort((a,b)=>a._id.localeCompare(b._id))
 const again=first(await db.collection('crm_customers').doc(CUSTOMER_ID).get());if(digest(again)!==digest(customer))throw Error('读取期间客户变化')
 return {customer_id:CUSTOMER_ID,tables,complete:true,atomic_snapshot:false,absent_collections:absent,read_started_at:started,read_completed_at:Date.now(),snapshot_hash:digest(tables),counts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length]))}
}
exports.main=async(event={})=>{try{const db=uniCloud.database();if(typeof event.token!=='string'||!event.token)return{code:403,msg:'未登录'};const user=first(await db.collection('crm_users').where({token:event.token}).limit(1).get());if(user?.role!=='superadmin')return{code:403,msg:'仅超级管理员'};if(event.data?.customer_id!==CUSTOMER_ID)return{code:400,msg:'客户范围不符'};if(event.action!=='inspectV1')return{code:400,msg:'当前仅只读取证'};return{code:0,data:await snapshot(db)}}catch(e){return{code:409,msg:e.message}}}
