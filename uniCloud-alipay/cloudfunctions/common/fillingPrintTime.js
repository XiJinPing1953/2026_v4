"use strict"
// Keep business-date edits and corrections authoritative. Only the original BLE
// capture matching that business time can refine an hour/day to actual minutes.
function fillingPrintTime(row) {
 const value=String(row?.filling_time || row?.date || '').trim()
 const m=/^(\d{4}-\d{2}-\d{2})(?:[ T-](\d{2})(?::(\d{2})(?::(\d{2}))?)?)?$/.exec(value)
 if(!m)return ''
 const [,day,hour,minute,second]=m, at=Date.parse(day+'T00:00:00Z')
 if(!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==day||(hour!==undefined&&Number(hour)>23)||(minute!==undefined&&Number(minute)>59)||(second!==undefined&&Number(second)>59))return ''
 if(minute!==undefined)return `${day} ${hour}:${minute}`
 const reweigh=row?.reweigh
 const original=reweigh?.original_ble_capture || (Number(row?.source_version||1)===1&&reweigh?.capture_method==='ble'?reweigh.capture:null)
 const sampled=Number(original?.sampled_at)
 if(row?.entry_source==='pda_reweigh'&&original?.stable===true&&Number.isFinite(sampled)&&sampled>0&&Number.isFinite(new Date(sampled+28800000).getTime())) {
  const measured=new Date(sampled+28800000).toISOString().slice(0,16).replace('T',' ')
  if(measured.slice(0,10)===day&&(hour===undefined||measured.slice(11,13)===hour))return measured
 }
 return value
}
module.exports={fillingPrintTime}
