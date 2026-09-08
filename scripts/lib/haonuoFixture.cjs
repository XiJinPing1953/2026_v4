'use strict'
const {SPEC,CUSTOMER_ID,digest}=require('../../uniCloud-alipay/cloudfunctions/crm-haonuo-reconciliation/plan')
function fixture(){
 const base={customer_id:CUSTOMER_ID,customer_name:'浩诺',created_at:1,updated_at:1}
 const sales=Array.from({length:24},(_,i)=>({...base,_id:`sale-${String(i).padStart(2,'0')}`,date:SPEC.periods[i%11][0],price_unit:'m3',unit_price:5,
  settlement_mode:i<4?'':'customer_flow',flow_index_prev:1,flow_index_curr:2,flow_volume_m3:1,amount_received:[3433.5,7057,11150][i]||0,
  out_items:[{bottle_no:`preserve-${i}`,gross_weight:63.5}],back_items:[{bottle_no:`returned-${i}`}],deposit:150,payment_status:'unpaid'}))
 const t={crm_users:[{_id:'admin',token:'test',role:'superadmin'}],crm_customers:[{_id:CUSTOMER_ID,name:'浩诺',is_active:true,default_price_unit:'m3',default_unit_price:5,updated_at:1}],crm_sale_records:sales,
  crm_customer_flow_settlements:[62379.5,47746.5,23626.5,44535,36951.5,14338.5,0,21578,33293.5].map((amount,i)=>({...base,_id:`old-flow-${i}`,biz_date:SPEC.periods[i][0],should_receive:amount,amount_received:amount,sale_ids:[],status:'posted'})),
  crm_customer_receipts:[240068,60000].map((amount,i)=>({...base,_id:`old-receipt-${i}`,amount,biz_date:['2026-06-24','2026-08-07'][i],status:'posted',allocated_amount:amount,unallocated_amount:0})),
  crm_customer_allocations:Array.from({length:10},(_,i)=>({...base,_id:`old-alloc-${i}`,receipt_id:`old-receipt-${i<8?0:1}`,target_type:'flow_settlement',target_id:`old-flow-${i%9}`,allocate_amount:1})),
  crm_customer_opening_debts:[],crm_customer_receipt_adjustments:[],crm_collection_tasks:[],crm_collection_followups:[],crm_vouchers:[]}
 t.crm_customer_flow_settlements.push({...base,_id:SPEC.reuse_final_flow_id,status:'posted',biz_date:'2026-09-07',flow_index_prev:613882.9,flow_index_curr:614935.1,flow_volume_m3:1052.2,should_receive:5261,unit_price:5,amount_received:0,receipt_rounding_amount:0,sale_ids:[]})
 t.crm_customer_receipts.push({...base,_id:'already-void',status:'void',amount:24068,biz_date:'2026-06-24'})
 return t
}
function snapshot(t){const tables=Object.fromEntries(Object.entries(t).filter(([name])=>!['crm_users','crm_operation_logs'].includes(name)).map(([name,rows])=>[name,[...rows].sort((a,b)=>a._id<b._id?-1:a._id>b._id?1:0)]));return {tables,complete:true,snapshot_hash:digest(tables),customer_id:CUSTOMER_ID,absent_collections:[]}}
const evidence={customer_id:CUSTOMER_ID,confirmed_by_user:true,spec_hash:digest(SPEC),proof_sha256:['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)],source_commit:'d'.repeat(40)}
module.exports={fixture,snapshot,evidence}
