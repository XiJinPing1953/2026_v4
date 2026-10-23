const test = require('node:test'), assert = require('node:assert/strict')
const { createFillingLabels, qrUrl, snapshot } = require('../uniCloud-alipay/cloudfunctions/crm-filling/fillingLabels')
const fs = require('fs'), vm = require('vm')
const frontend = vm.runInNewContext(fs.readFileSync('src/services/pda/fillingLabel.js','utf8').replace(/^import.*\n/gm,'').replace(/^export /gm,'')+';({parseFillingLabel})')
const label = { company:'新拓能源', bottle_no:'90', tare_weight:110, gross_weight:185.5, net_weight:75.5 }
function harness() {
 const row = { _id:'f1', entry_source:'pda_reweigh', bottle_no:'90', operation_id:'op1', source_version:1, operator:'王师傅', created_at:100, reweigh:{label,measured_at:1792567380000} }
 const tables = {crm_fillings:[row],crm_filling_labels:[]}
 const db = { command:{gt:v=>({gt:v})},collection:name=>{
  const q = where => ({ get:async()=>({data:tables[name].filter(r=>Object.entries(where).every(([k,v])=>v?.gt!==undefined?r[k]>v.gt:r[k]===v))}),limit(){return this} })
  return {doc:id=>q({_id:id}),where:q,add:async d=>tables[name].push(d)}
 }}
 return {tables,row,api:createFillingLabels({db})}
}
test('opaque token exposes whitelist only, URL weights tamper rejected, correction and later filling invalidate', async()=>{
 const h=harness(), issued=await h.api.issue({_id:'worker'},{filling_id:'f1',operation_id:'op1'})
 assert.equal(issued.code,0);assert.ok(issued.data.qr_url.startsWith('https://xintuonengyuan.com/#/pages/public/filling-label?'))
 const parsed=frontend.parseFillingLabel(issued.data.qr_url)
 assert.equal(parsed.bottle_no,'90'); assert.match(parsed.token,/^[a-f0-9]{48}$/)
 const publicRead=await h.api.read({token:parsed.token});assert.equal(publicRead.data.operator,'王师傅');assert.equal(publicRead.data.valid,true);assert.equal(publicRead.data.filling_id,undefined);assert.match(publicRead.data.weighed_at,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
 assert.equal((await h.api.read({...parsed,gross_weight:1},true)).code,409)
 assert.equal((await h.api.read(parsed,true)).code,0)
 h.row.source_version++; assert.equal((await h.api.read(parsed,true)).code,409);assert.equal((await h.api.read(parsed)).data.valid,false)
 h.row.source_version--;h.tables.crm_fillings.push({...h.row,_id:'f2',created_at:101});assert.equal((await h.api.read(parsed,true)).code,409)
})
test('unknown tokens have no data; original registration URLs remain outside label parser',async()=>{
 const h=harness();assert.equal((await h.api.read({token:'f1'})).code,404);assert.equal(frontend.parseFillingLabel('https://example.com/90'),null)
 assert.throws(()=>frontend.parseFillingLabel('https://env-00jxuffegf2n-static.normal.cloudstatic.cn/#/pages/public/filling-label?t=bad'))
})
test('deployed schema is valid JSON and denies all direct client access',()=>{
 const schema=JSON.parse(fs.readFileSync('uniCloud-alipay/database/crm_filling_labels.schema.json','utf8'))
 for(const action of ['read','create','update','delete'])assert.equal(schema.permission[action],false)
 assert.ok(schema.required.includes('snapshot'));assert.equal(schema.properties.snapshot.bsonType,'object')
})

test('old cloudstatic labels remain readable while new labels use the custom domain',()=>{
 const current=qrUrl({_id:'a'.repeat(48),snapshot:label})
 const legacy=current.replace('https://xintuonengyuan.com','https://env-00jxuffegf2n-static.normal.cloudstatic.cn')
 assert.equal(frontend.parseFillingLabel(current).bottle_no,'90')
 assert.deepEqual(JSON.parse(JSON.stringify(frontend.parseFillingLabel(current))),JSON.parse(JSON.stringify(frontend.parseFillingLabel(legacy))))
 assert.equal(frontend.parseFillingLabel(current.replace('xintuonengyuan.com','xintuonengyuan.com.attacker.example')),null)
})

test('database snapshot field order never invalidates a matching original label',async()=>{
 const h=harness(),issued=await h.api.issue({_id:'worker'},{filling_id:'f1',operation_id:'op1'})
 const parsed=frontend.parseFillingLabel(issued.data.qr_url),stored=h.tables.crm_filling_labels[0]
 stored.snapshot=Object.fromEntries(Object.entries(stored.snapshot).reverse())
 assert.equal((await h.api.read({token:parsed.token})).data.valid,true)
 assert.equal((await h.api.read(parsed,true)).code,0)
 stored.snapshot.gross_weight++
 assert.equal((await h.api.read({token:parsed.token})).data.valid,false)
})
