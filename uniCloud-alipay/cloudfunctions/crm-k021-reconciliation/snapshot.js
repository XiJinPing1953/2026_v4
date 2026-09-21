'use strict'
const crypto = require('crypto')
const { readComplete } = require('./financialReadLocal')
const TABLES = ['crm_sale_records','crm_customer_receipts','crm_customer_allocations','crm_customer_flow_settlements','crm_customer_opening_debts','crm_customer_receipt_adjustments','crm_customer_deposit_accounts','crm_customer_deposit_entries','crm_collection_tasks','crm_collection_followups','crm_cashier_intakes','crm_cashier_intake_operations']
const SCOPE=["694045c0adf6dbd796e261eb","694045c0adf6dbd796e261d7"];
const optional = new Set(['crm_customer_receipt_adjustments','crm_collection_tasks','crm_collection_followups','crm_cashier_intakes','crm_cashier_intake_operations'])
const first = r => Array.isArray(r?.data) ? r.data[0] : r?.data
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v
const digest = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
async function snapshot(db, CUSTOMER_ID) {
 const started=Date.now(), customer=first(await db.collection('crm_customers').doc(CUSTOMER_ID).get())
 if (!customer || customer._id !== CUSTOMER_ID) throw Error('客户范围不符')
 if(CUSTOMER_ID!==SCOPE[0])throw Error("仅限K021主户");
 const allCustomers=await readComplete(db.collection("crm_customers"),{}, {command:db.command,source:"scope_customers",maxRows:10000});
 const members=allCustomers.filter(x=>SCOPE.includes(x._id));
 if(members.length!==2||members.find(x=>x._id===SCOPE[1]).settlement_customer_id!==SCOPE[0]||customer.settlement_customer_id&&customer.settlement_customer_id!==CUSTOMER_ID||allCustomers.some(x=>SCOPE.includes(x.settlement_customer_id)&&!SCOPE.includes(x._id)))throw Error("主子户范围已变化");
 const tables={crm_customers:members}, absent=[];
 for(const name of TABLES) {
  try { await db.collection(name).where({customer_id:db.command.in(SCOPE)}).count() }
  catch(e) { if(optional.has(name)&&String(e.message).trim()==='not found collection'){tables[name]=[];absent.push(name);continue}throw Error(name+': '+e.message) }
  tables[name]=await readComplete(db.collection(name),{customer_id:db.command.in(SCOPE)},{command:db.command,source:name,maxRows:10000})
 }
 const sales=tables.crm_sale_records.map(x=>x._id),receipts=tables.crm_customer_receipts.map(x=>x._id),targets=[...sales,...tables.crm_customer_opening_debts.map(x=>x._id)]
 for(const [name,field,ids] of [['crm_customer_receipts','source_id',sales],['crm_customer_allocations','receipt_id',receipts],['crm_customer_allocations','target_id',targets],['crm_customer_allocations','sale_id',sales]]) {
  for(let i=0;i<ids.length;i+=50){const rows=await readComplete(db.collection(name),{[field]:db.command.in(ids.slice(i,i+50))},{command:db.command,source:name+'_reverse',maxRows:10000});if(rows.some(x=>!SCOPE.includes(x.customer_id)||!tables[name].some(y=>y._id===x._id)))throw Error('范围外反向关联')}
 }
 const voucherMap=new Map();let hasVouchers=true
 try {await db.collection('crm_vouchers').where({customer_id:db.command.in(SCOPE)}).count()}catch(e){if(String(e.message).trim()!=='not found collection')throw e;hasVouchers=false;absent.push('crm_vouchers')}
 for(const field of hasVouchers ? ['customer_id','source','source_key'] : []) {
  const values=field==='customer_id'?SCOPE:sales.map(x=>'sale:'+x)
  for(let i=0;i<values.length;i+=50){const rows=await readComplete(db.collection('crm_vouchers'),{[field]:db.command.in(values.slice(i,i+50))},{command:db.command,source:'crm_vouchers',maxRows:10000});for(const x of rows)voucherMap.set(x._id,x)}
 }
 tables.crm_vouchers=[...voucherMap.values()]
 for(const rows of Object.values(tables))rows.sort((a,b)=>a._id.localeCompare(b._id))
 const again=first(await db.collection('crm_customers').doc(CUSTOMER_ID).get());if(digest(again)!==digest(customer))throw Error('读取期间客户变化')
 return {customer_id:CUSTOMER_ID,tables,complete:true,atomic_snapshot:false,absent_collections:absent,read_started_at:started,read_completed_at:Date.now(),snapshot_hash:digest(tables),counts:Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.length]))}
}
module.exports={snapshot,digest,canonical}
