'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function app(options = {}) {
 const store = options.store || new Map(), calls = [], modals = []
 let user = options.user || 'u1', completed = 0
 const record = { value: { _id: 'f1', bottle_no: '1', entry_source: 'pda_reweigh', source_version: 3, fill_weight: 50, reweigh: { gross_weight: 170, net_weight: 70 } } }
 const context = vm.createContext({ Math, Date, ref: value => ({ value }), reactive: value => value,
  computed: fn => ({ get value() { return fn() } }), watch: (getter, callback, settings) => { if (settings?.immediate) callback(getter()) },
  getUser: () => ({ _id: user }),
  uni: { getStorageSync: key => store.get(key), setStorageSync: (key,value) => { if(options.storageFails) throw Error('quota'); store.set(key, JSON.parse(JSON.stringify(value))) }, removeStorageSync: key => store.delete(key),
   showModal: async data => { modals.push(data); return { confirm: true } } },
  previewReweighV1: async data => { calls.push(['preview',data]); return options.preview || { code: 0, data: { mode: 'correct', date: '2026-10-19-10', filling: record.value, context_hash: 'hash', gross_weight: data.gross_weight, net_weight: data.gross_weight - 100, fill_weight: data.gross_weight - 120 } } },
  correctReweighV1: async data => { calls.push(['correct',JSON.parse(JSON.stringify(data))]); if (options.correct) return options.correct(data); return { code: 0, data: { operation_id: data.operation_id, complete: false, saved_total: 1 } } },
  getReweighOperationV1: async id => { calls.push(['get',id]); return options.get ? options.get(id) : { code: 404 } },
  retryReweighOperationV1: async id => { calls.push(['retry',id]); return { code: 0, data: { operation_id: id, complete: true } } }
 })
 const source = fs.readFileSync('src/composables/useReweighCorrection.js','utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'')
 vm.runInContext(source,context)
 const ui = context.useReweighCorrection({ record, canUpdate: { value: options.canUpdate !== false }, onComplete: async () => { completed++ } })
 return { ui, store, calls, modals, record, completed: () => completed, setUser: value => { user = value } }
}

test('manual correction uses server preview, reason, source version, and persists before dispatch', async () => {
 const a = app(); a.ui.form.gross_weight = '175'; a.ui.form.reason = '核对秤值'; await a.ui.submit()
 const sent = a.calls.find(x => x[0] === 'correct')[1]
 assert.equal(sent.gross_weight,175); assert.equal(sent.expected_source_version,3); assert.equal(sent.capture_method,'manual')
 assert.equal(sent.reason,'核对秤值'); assert.equal('fill_weight' in sent,false); assert.equal('capture' in sent,false)
 assert.match(a.modals[0].content,/50.0 → 55.0 kg（\+5.0 kg）/)
 assert.equal(a.store.get('crm:reweigh:correction:u1:f1').payload.operation_id,sent.operation_id)
 assert.equal(a.ui.statusText.value,'更正已保存，后续核查待完成'); assert.equal(a.completed(),0)
})

test('lost acknowledgement and 404 resend the original frozen number and payload', async () => {
 let count=0
 const a=app({ correct: async data => { if (count++===0) throw Error('network'); return {code:0,data:{operation_id:data.operation_id,complete:false}} } })
 a.ui.form.gross_weight='175'; a.ui.form.reason='修正'; await a.ui.submit()
 const original = a.calls.find(x=>x[0]==='correct')[1]
 a.ui.form.gross_weight='999'; a.ui.form.reason='different'; await a.ui.submit(); await a.ui.recover()
 const sent=a.calls.filter(x=>x[0]==='correct'); assert.equal(sent.length,2); assert.deepEqual(sent[1][1],original)
 assert.equal(a.ui.isFrozen.value,true)
})

test('explicit rejection clears operation id, next corrected submission gets a new id', async () => {
 let count=0
 const a=app({correct:async data=>++count===1?{code:409,msg:'原单已变化',data:{rejected:true}}:{code:0,data:{operation_id:data.operation_id,complete:false}}})
 a.ui.form.gross_weight='175'; a.ui.form.reason='修正'; await a.ui.submit()
 assert.equal(a.ui.isFrozen.value,false); assert.equal(a.store.get('crm:reweigh:correction:u1:f1').payload,null)
 a.ui.form.gross_weight='176'; await a.ui.submit()
 const sent=a.calls.filter(x=>x[0]==='correct'); assert.notEqual(sent[0][1].operation_id,sent[1][1].operation_id)
})

test('known saved operation resumes remaining work and clears draft only at complete',async()=>{
 const a=app({get:async id=>({code:0,data:{operation_id:id,complete:false,saved_total:1}})})
 a.ui.form.gross_weight='175'; a.ui.form.reason='修正'; await a.ui.submit(); await a.ui.recover()
 assert.equal(a.calls.filter(x=>x[0]==='correct').length,1); assert.equal(a.completed(),1); assert.equal(a.ui.isFrozen.value,false)
 assert.equal(a.store.has('crm:reweigh:correction:u1:f1'),false)
})

test('missing reason, permission denial, and account change do not dispatch',async()=>{
 for(const options of [{},{canUpdate:false}]){const a=app(options);a.ui.form.gross_weight='175';await a.ui.submit();assert.equal(a.calls.length,0)}
 const a=app();a.ui.form.gross_weight='175';a.ui.form.reason='修正';a.setUser('u2');await a.ui.submit();assert.equal(a.calls.length,0)
})

test('other account cannot restore frozen correction and double click only submits once',async()=>{
 const a=app();a.ui.form.gross_weight='175';a.ui.form.reason='修正';await Promise.all([a.ui.submit(),a.ui.submit()])
 assert.equal(a.calls.filter(x=>x[0]==='correct').length,1)
 const b=app({store:a.store,user:'u2'});assert.equal(b.ui.isFrozen.value,false);assert.equal(b.calls.length,0)
})

test('same-account second tab restores pending submission instead of a second correction',async()=>{
 const a=app();const b=app({store:a.store});a.ui.form.gross_weight='175';a.ui.form.reason='修正';await a.ui.submit()
 b.ui.form.gross_weight='180';b.ui.form.reason='另一次';await b.ui.submit()
 assert.equal(b.calls.length,0);assert.equal(b.ui.frozen.value.operation_id,a.ui.frozen.value.operation_id)
})

test('web templates compile and normal filling retains fill_weight with a clear label',()=>{
 const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc')
 for(const name of ['FillingEditView','FillingListView','FillingBatchPreview']){
  const source=fs.readFileSync(`src/components/domain/filling/${name}.vue`,'utf8');const {descriptor,errors}=parse(source)
  assert.deepEqual(errors,[]);compileScript(descriptor,{id:name});assert.deepEqual(compileTemplate({source:descriptor.template.content,id:name,filename:name+'.vue'}).errors,[])
 }
 const source=fs.readFileSync('src/components/domain/filling/FillingEditView.vue','utf8')
 assert.match(source,/updateFillingV1\(\{ _id: recordId.value, remark:/)
 const list=fs.readFileSync('src/components/domain/filling/FillingListView.vue','utf8')
 assert.match(list,/本次灌装量合计/);assert.match(list,/getFillWeightLabel\(item.record_type\)/);assert.match(list,/item.fill_weight/)
})


test('code zero rejected rollback receipt unlocks a new operation but saved sources stay frozen',async()=>{
 for(const saved of [0,1]) {
  const a=app({correct:async data=>({code:0,data:{operation_id:data.operation_id,status:'failed',saved_total:saved,rejected:true}})})
  a.ui.form.gross_weight='175';a.ui.form.reason='修正';await a.ui.submit()
  assert.equal(a.ui.isFrozen.value,saved===1)
 }
})


test('storage failure never dispatches a correction that cannot be recovered',async()=>{
 const a=app({storageFails:true});a.ui.form.gross_weight='175';a.ui.form.reason='修正';await a.ui.submit()
 assert.equal(a.calls.filter(x=>x[0]==='correct').length,0);assert.equal(a.ui.isFrozen.value,false)
 assert.match(a.ui.error.value,/本地草稿保存失败/)
})

test('filling list uses the original weighing minute in UTC+8 and does not invent legacy minutes', async () => {
 const source = fs.readFileSync('src/services/mappers/filling.js', 'utf8')
 const { formatFillingTime } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
 const at = Date.parse('2026-10-21T07:23:45Z')
 assert.equal(formatFillingTime({ entry_source: 'pda_reweigh', reweigh: { measured_at: at } }), '2026-10-21 15:23')
 assert.equal(formatFillingTime({ entry_source: 'pda_reweigh', reweigh: { measured_at: at + 3600000, original_ble_capture: { sampled_at: at } } }), '2026-10-21 15:23')
 assert.equal(formatFillingTime({ entry_source: 'pda_reweigh', reweigh: { measured_at: at + 3600000, original_ble_capture: { sampled_at: at + 3600000 }, backfill: { measured_at: at } } }), '2026-10-21 15:23')
 assert.equal(formatFillingTime({ filling_time: '2026-10-21-15' }), '2026-10-21 15时')
})
