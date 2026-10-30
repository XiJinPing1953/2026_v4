'use strict'
const test=require('node:test'),assert=require('node:assert/strict')

test('export covers every loaded page, quotes fields, and marks the matching inspection modules',async()=>{
 const {loadInspectionCandidates}=await import('../src/services/bottleInspectionCandidates.mjs')
 const {buildInspectionExportCsv}=await import('../src/services/bottleInspectionExport.mjs')
 const data=Array.from({length:105},(_,i)=>({_id:String(i),bottle_no:String(i+1),is_active:true,current_customer_name:i===0?'张,"三"':'普通',bottle_next_check_date:'2026-10-29',pressure_gauge_next_check_date:'2026-11-01',safety_valve_next_check_date:'2027-01-01'}))
 const filter={inspection_due_module:'all',inspection_due_state:'overdue',is_active:true}
 const rows=await loadInspectionCandidates(async p=>({code:0,data:data.slice((p.page-1)*50,p.page*50),paging:{total:105,hasMore:p.page<3}}),filter)
 const csv=buildInspectionExportCsv(rows,filter,Date.parse('2026-10-30T00:00:00+08:00'))
 assert.equal(csv.split('\r\n').length,106)
 assert.match(csv,/"张,""三"""/)
 assert.match(csv,/瓶检（已过期）/)
 assert.doesNotMatch(csv,/表检（60天内到期）/)
 const future=buildInspectionExportCsv([data[0]],{...filter,inspection_due_state:'due_60d'},Date.parse('2026-10-30T00:00:00+08:00'))
 assert.match(future,/表检（60天内到期）/);assert.doesNotMatch(future,/瓶检（已过期）/)
})
