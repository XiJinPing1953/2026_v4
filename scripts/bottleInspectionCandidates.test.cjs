const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = () => import('../src/services/bottleInspectionCandidates.mjs')
test('sorts all pages naturally before display, preserves IDs and disables unused summaries', async () => {
 const {loadInspectionCandidates} = await load()
 const source = Array.from({length: 105}, (_, i) => ({_id: String(i), bottle_no: String(105-i)}))
 const rows = await loadInspectionCandidates(async p => {
  assert.equal(p.include_summary,false); assert.equal(p.include_deposit,false)
  assert.equal(p.is_active,true)
  return {code:0,data:source.slice((p.page-1)*50,p.page*50),paging:{total:105,hasMore:p.page<3}}
 },{is_active:true})
 assert.deepEqual(rows.map(r=>Number(r.bottle_no)),Array.from({length:105},(_,i)=>i+1))
 assert.equal(rows[49].bottle_no,'50'); assert.equal(rows[50].bottle_no,'51')
 assert.equal(new Set(rows.map(r=>r._id)).size,105)
})
test('numeric bottles precede prefixes, with stable leading-zero and duplicate-number ties', async()=>{
 const {compareInspectionBottles} = await load()
 const rows=['N10','10','N2','2','002',''].map((bottle_no,i)=>({_id:String(i),bottle_no}))
 assert.deepEqual(rows.sort(compareInspectionBottles).map(r=>r.bottle_no),['002','2','10','N2','N10',''])
 assert.ok(compareInspectionBottles({_id:'a',bottle_no:'N2'},{_id:'b',bottle_no:'N2'})<0)
})
test('rejects duplicate and incomplete pages instead of silently changing selection scope',async()=>{
 const {loadInspectionCandidates} = await load()
 await assert.rejects(loadInspectionCandidates(async()=>({code:0,data:[{_id:'a'},{_id:'a'}],total:2}),{}),/重复/)
 await assert.rejects(loadInspectionCandidates(async()=>({code:0,data:[],total:2}),{}),/未加载完整/)
 await assert.rejects(loadInspectionCandidates(async()=>({code:0,data:[],total:20001}),{}),/缩小范围/)
})
