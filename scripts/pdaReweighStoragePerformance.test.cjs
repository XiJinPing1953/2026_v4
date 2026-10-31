const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm')
const source = fs.readFileSync('src/services/pda/reweighDraft.js', 'utf8').replace(/^export /gm, '')
const { createReweighDraftStore, readReweighDraft } = vm.runInNewContext(source + ';({createReweighDraftStore,readReweighDraft})')
const clone = value => JSON.parse(JSON.stringify(value))
const entry = id => ({ operationId: `op-${id}`, bottleNo: String(id), roundId: 'round', date: '2026-10-30 10:00:00',
 receipt: { saved: true, complete: true, fillingId: `fill-${id}` }, preview: { bottle: { bottle_no: String(id), tare_weight: 100 }, basis: { gross_weight: 105 }, label: { bottle_no: String(id), gross_weight: 150, tare_weight: 100, net_weight: 50 } },
 capture: { sampled_at: Date.parse('2026-10-30T10:00:00+08:00'), measurement_id: 'scale', stable: true },
 frozen: { mode: 'create', payload: { operation_id: `op-${id}`, bottle_no: String(id), gross_weight: 150, context_hash: 'server', date: '2026-10-30 10:00:00', capture: { measurement_id: 'scale', stable: true } }, label: { bottle_no: String(id), gross_weight: 150, tare_weight: 100, net_weight: 50 } } })
function fixture(mode = 'filling', count = 2000) {
 const key = `crm_pda_${mode === 'return' ? 'return_' : ''}reweigh_v1:u1`
 const initial = { version: 1, ownerId: 'u1', current: entry('current'), history: Array.from({ length: count }, (_, i) => entry(i)), metadata: { round: { _id: 'round', bottle_count: count } } }
 const map = new Map([[key, JSON.stringify(initial)]]), stats = { bytes: 0, writes: [] }
 const hooks = {}
 const storage = { getStorageSync(k) { hooks.read?.(k); const value = map.get(k); stats.bytes += value?.length || 0; return value },
 setStorageSync(k, value) { hooks.write?.(k); stats.bytes += value.length; stats.writes.push(k); map.set(k, value); hooks.afterWrite?.(k) }, removeStorageSync: k => map.delete(k) }
 const store = createReweighDraftStore('u1', storage, () => 'u1', mode)
 return { key, initial, map, storage, stats, store, hooks, mode, reset() { stats.bytes = 0; stats.writes = [] } }
}
for (const mode of ['filling', 'return']) test(`${mode}: 2000 records stay complete across migration, current edits and next bottle with bounded native I/O`, () => {
 const f = fixture(mode), state = f.store.load(), old = f.map.get(f.key)
 assert.equal(f.map.get(f.key), old, 'read alone does not migrate')
 const history = f.store.save(state.current, state.history, state.metadata)
 assert.equal(f.map.get(`${f.key}:before-chunked-v2`), old)
 assert.deepEqual(clone(readReweighDraft('u1', f.storage, mode).history), f.initial.history)
 f.reset()
 for (let i = 0; i < 5; i++) f.store.save({ ...state.current, remark: String(i) }, history, state.metadata)
 assert.equal(f.stats.writes.length, 5, 'only current/manifest is written during weighing')
 assert.ok(f.stats.bytes / 5 < 40000, `per-save native I/O ${f.stats.bytes / 5}`)
 f.reset()
 f.store.save({ operationId: 'next', bottleNo: '' }, [...history, entry('new')], state.metadata)
 assert.equal(f.stats.writes.length, 2, 'one tail chunk and one manifest')
 assert.ok(f.stats.bytes < 45000, `next bottle native I/O ${f.stats.bytes}`)
 const restored = createReweighDraftStore('u1', f.storage, () => 'u1', mode).load()
 assert.equal(restored.current.operationId, 'next'); assert.equal(restored.history.length, 2001)
 assert.equal(restored.history.at(-1).operationId, 'op-new')
 const unknown = { ...restored.history[100], receipt: { saved: true, complete: false } }
 f.store.save(restored.current, history.map((row, i) => i === 100 ? unknown : row), state.metadata)
 assert.equal(readReweighDraft('u1', f.storage, mode).history[100].receipt.complete, false)
})
test('failed chunk/root writes and ambiguous root completion retain a fully recoverable snapshot', () => {
 for (const phase of ['chunk', 'root', 'root-after']) {
  const f = fixture('return', 45), loaded = f.store.load()
  const history = f.store.save(loaded.current, loaded.history, loaded.metadata), before = f.map.get(f.key)
  f.hooks.write = key => { if ((phase === 'chunk' && key.includes(':history:')) || (phase === 'root' && key === f.key)) throw Error('quota') }
  f.hooks.afterWrite = key => { if (phase === 'root-after' && key === f.key) throw Error('native response lost') }
  assert.throws(() => f.store.save({ operationId: 'next', bottleNo: '' }, [...history, entry('new')]), /quota|native response/)
  f.hooks.write = null; f.hooks.afterWrite = null
  const recovered = createReweighDraftStore('u1', f.storage, () => 'u1', 'return').load()
  assert.equal(recovered.history.length, phase === 'root-after' ? 46 : 45)
  if (phase !== 'root-after') assert.equal(f.map.get(f.key), before)
 }
})
test('missing chunk refuses load instead of silently replacing history; stale page refuses writes', () => {
 const f = fixture('filling', 85), loaded = f.store.load(); f.store.save(loaded.current, loaded.history)
 const stale = createReweighDraftStore('u1', f.storage); const state = stale.load()
 f.store.save({ ...loaded.current, remark: 'updated' }, loaded.history)
 assert.throws(() => stale.save(state.current, state.history), /另一页面更新/)
 const root = f.map.get(f.key), chunk = JSON.parse(root).historyChunks[1].key
 f.map.delete(chunk)
 assert.throws(() => createReweighDraftStore('u1', f.storage).load(), /分段无法读取/)
 assert.equal(f.map.get(f.key), root)
})
test('replacing the tail removes only obsolete chunks after the root is verified', () => {
 const f = fixture('filling', 45), loaded = f.store.load(); let history = f.store.save(loaded.current, loaded.history)
 for (let i = 0; i < 10; i++) history = f.store.save(loaded.current, [...history, entry(`new-${i}`)])
 const chunks = JSON.parse(f.map.get(f.key)).historyChunks
 assert.equal([...f.map.keys()].filter(key => key.includes(':history:')).length, chunks.length)
 assert.equal(readReweighDraft('u1', f.storage).history.length, 55)
})

test('unchanged lifecycle saves verify conflict but do not rewrite storage; nested edits still persist', () => {
 const f=fixture('return',2000),loaded=f.store.load()
 let history=f.store.save(loaded.current,loaded.history,loaded.metadata)
 const committed=f.map.get(f.key);f.reset()
 for(let i=0;i<3;i++)f.store.save(loaded.current,history,loaded.metadata)
 assert.equal(f.stats.writes.length,0);assert.equal(f.map.get(f.key),committed)
 loaded.current.remark='changed';f.store.save(loaded.current,history,loaded.metadata)
 assert.equal(f.stats.writes.length,1)
 loaded.metadata.round.bottle_count++;f.store.save(loaded.current,history,loaded.metadata)
 assert.equal(f.stats.writes.length,2)
 const state=createReweighDraftStore('u1',f.storage,()=> 'u1','return').load();f.reset()
 const fresh=createReweighDraftStore('u1',f.storage,()=> 'u1','return');const restored=fresh.load()
 fresh.save(restored.current,restored.history,restored.metadata);assert.equal(f.stats.writes.length,0)
 f.map.set(f.key,committed)
 assert.throws(()=>fresh.save(restored.current,restored.history,restored.metadata),/另一页面更新/)
 assert.equal(state.current.remark,'changed')
})
test('unchanged drafts still reject a different account',()=>{
 const f=fixture(),state=f.store.load();f.store.save(state.current,state.history,state.metadata)
 let owner='u1';const store=createReweighDraftStore('u1',f.storage,()=>owner),restored=store.load()
 owner='u2';f.reset();assert.throws(()=>store.save(restored.current,restored.history,restored.metadata),/登录账号/)
 assert.equal(f.stats.writes.length,0)
})
