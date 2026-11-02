"use strict"
const { fillingPrintTime } = require('./fillingPrintTimeLocal')
async function withFillingPrintTimes(doc, db) {
 const proofs = Array.isArray(doc.mobile_filling_label_sources) ? doc.mobile_filling_label_sources : []
 const sources = new Map(), ids = [...new Set(proofs.filter(p=>!fillingPrintTime({filling_time:p.filling_time}) && typeof p.filling_id==='string').map(p=>p.filling_id))]
 for (let offset=0;offset<ids.length;offset+=50) {
  const result = await db.collection('crm_fillings').where({_id:db.command.in(ids.slice(offset,offset+50))}).limit(50)
   .field({_id:true,operation_id:true,source_version:true,bottle_no:true,filling_time:true,date:true,entry_source:true,'reweigh.original_ble_capture':true,'reweigh.capture':true,'reweigh.capture_method':true,'reweigh.label':true}).get()
  if (!Array.isArray(result.data)) throw new Error('原灌装时间读取失败，请重试打印')
  for (const row of result.data) sources.set(row._id,row)
 }
 const weights = ['tare_weight','gross_weight','net_weight']
 const out_items = (doc.out_items || []).map(item=>{
  const matches=proofs.filter(p=>String(p.bottle_no)===String(item.bottle_no) && weights.every((key,i)=>Number.isFinite(Number(item[['tare','gross','net'][i]])) && item[['tare','gross','net'][i]]!=null && item[['tare','gross','net'][i]]!=='' && Number(p[key])===Number(item[['tare','gross','net'][i]])))
  let time=''
  if(matches.length===1) {
   const proof=matches[0], source=sources.get(proof.filling_id)
   time=fillingPrintTime({filling_time:proof.filling_time})
   if(!time && source && source.operation_id===proof.operation_id && Number(source.source_version)===Number(proof.source_version) && String(source.bottle_no)===String(item.bottle_no) && weights.every(key=>source.reweigh?.label?.[key]===proof[key])) time=fillingPrintTime(source)
  }
  return {...item,filling_time:time}
 })
 // Return bottles have no frozen filling association in this sales protocol.
 return {...doc,out_items,back_items:(doc.back_items||[]).map(item=>({...item,filling_time:''}))}
}
module.exports={fillingPrintTime,withFillingPrintTimes}
