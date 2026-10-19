const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm')
function setup(exact = { code: 404 }) {
 const calls = []
 const source = fs.readFileSync('src/services/pda/bottle.js', 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')
 const api = vm.runInNewContext(source + '\n;({queryPdaBottleArchive})', {
  normalizeText: x => String(x || '').trim(), normalizeBottleNo: x => String(x || '').trim().toUpperCase().replace(/\s+/g, ''), normalizeQrCode: x => x,
  resolveBottleNoV1: async p => { calls.push(['exact', p]); return exact },
  getBottleV1: async p => { calls.push(['get', p]); return {code:0,data:{_id:p.id,bottle_no:'282',status:'in_station',bottle_next_check_date:'2027-01-01'}} },
  searchBottlesV1: async p => { calls.push(['list', p]); return {code:0,data:[{_id:'other'}],paging:{page:p.page,total:45,hasMore:p.page<3}} }
 })
 return {...api,calls}
}
test('exact bottle wins over fuzzy QR results and retains full archive', async () => {
 const x=setup({code:0,data:{bottle:{_id:'b282'}}}); const r=await x.queryPdaBottleArchive({keyword:' 282 '});
 assert.equal(r.data[0]._id,'b282'); assert.equal(r.data[0].bottle_next_check_date,'2027-01-01');assert.equal(r.paging.hasMore,false);assert.equal(x.calls.length,2)
})
test('scan directly fetches resolved id; status still filters exact archive',async()=>{
 const x=setup();const r=await x.queryPdaBottleArchive({id:'b282',keyword:'282',status:'at_customer'});assert.equal(r.data.length,0);assert.equal(x.calls[0][0],'get');assert.equal(x.calls.length,1)
})
test('missing exact falls back to paged fuzzy results; later pages skip resolution',async()=>{
 const x=setup();await x.queryPdaBottleArchive({keyword:'28',status:'in_station'});const r=await x.queryPdaBottleArchive({keyword:'28',status:'in_station',page:2});assert.equal(x.calls.length,3);assert.equal(x.calls[2][1].page,2);assert.equal(x.calls[2][1].status,'in_station');assert.equal(r.paging.hasMore,true)
})
test('ambiguous and unauthorized resolution errors do not silently become fuzzy matches',async()=>{
 for(const code of [409,401,403]){const x=setup({code});assert.equal((await x.queryPdaBottleArchive({keyword:'282'})).code,code);assert.equal(x.calls.length,1)}
})
