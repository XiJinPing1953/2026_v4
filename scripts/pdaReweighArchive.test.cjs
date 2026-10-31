const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const load = (file, names, globals = {}) => vm.runInNewContext(fs.readFileSync(file, 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '') + `;({${names}})`, globals)
const draft = load('src/services/pda/reweighDraft.js', 'createReweighDraftStore,createReweighId,validReweighEntry,readReweighDraft,readReweighDraftAsync,reweighDraftKey')
const work = load('src/services/pda/reweighWorkStore.js', 'createReweighWorkStore,readReweighHistoryRoot,readReweighHistorySnapshot', { ...draft, })
const row = (id, round = 'old', complete = true) => ({ operationId: `op-${id}`, bottleNo: String(id), roundId: round, date: '2026-10-31 08:00:00',
 receipt: { saved: true, complete, fillingId: `fill-${id}` }, frozen: { mode: 'create', payload: { operation_id: `op-${id}`, bottle_no: String(id) }, label: { bottle_no: String(id), gross_weight: 150, tare_weight: 100, net_weight: 50 } } })
const empty = () => ({ operationId: 'empty', bottleNo: '' })
test('native cache only reuses immutable chunks: roots stay fresh, writes invalidate and owner changes clear it', async () => {
 const f = fixture(), create = () => work.createReweighWorkStore('u', f.storage, () => 'u', 'filling', { reuseImmutableChunks: true })
 f.seed(Array.from({length:85}, (_, i) => row(i,'active')))
 const first = create(); await first.loadAsync()
 f.calls.length = 0
 const second = create(), loaded = await second.loadAsync()
 assert.equal(loaded.history.length,85)
 assert.equal(f.calls.filter(x=>x[0]==='async').length,2)
 assert.ok(f.calls.every(x=>x[1].endsWith(':work-v3')))
 second.save(empty(),[...loaded.history,row('new','active')],loaded.metadata)
 assert.equal((await create().loadAsync()).history.length,86)
 // A changed root referencing a new missing chunk cannot be satisfied by old cached chunks.
 const key=f.key+':work-v3', before=f.map.get(key), head=JSON.parse(before)
 head.historyChunks[0].key=f.key+':history:missing';f.map.set(key,JSON.stringify(head))
 await assert.rejects(create().loadAsync(),/分段/)
 f.map.set(key,before)
 work.createReweighWorkStore('another',f.storage,()=> 'another','filling',{reuseImmutableChunks:true})
 f.calls.length=0;await create().loadAsync()
 assert.equal(f.calls.filter(x=>x[0]==='async').length,5)
})

test('native chunk reuse is bounded and expires; it never turns missing storage into an empty history', async () => {
 let time=1000;class Clock extends Date {static now(){return time}}
 const cached=load('src/services/pda/reweighWorkStore.js','createReweighWorkStore',{...draft,Date:Clock,})
 const f=fixture(),create=()=>cached.createReweighWorkStore('u',f.storage,()=> 'u','filling',{reuseImmutableChunks:true})
 f.seed(Array.from({length:45},(_,i)=>row(i,'active')));await create().loadAsync();time+=60001;f.calls.length=0
 await create().loadAsync();assert.equal(f.calls.filter(x=>x[0]==='async').length,4)
 const large=Array.from({length:80},(_,i)=>({...row(i,'active'),remark:'x'.repeat(8000)}))
 const store=create();const loaded=await store.loadAsync();store.save(empty(),large,loaded.metadata);f.calls.length=0
 assert.equal((await create().loadAsync()).history.length,80)
 assert.equal(f.calls.filter(x=>x[0]==='async').length,4)
})
function fixture(mode = 'filling') {
 const key = draft.reweighDraftKey('u', mode), map = new Map(), calls = [], writes = []
 let owner = 'u', fail = null
 const storage = { getStorageSync(k) { calls.push(['sync', k]); return map.get(k) }, async getStorage(k) { calls.push(['async', k]); return map.get(k) },
  setStorageSync(k, value) { if (fail?.(k, 'before')) throw Error('quota'); map.set(k, value); writes.push(k); if (fail?.(k, 'after')) throw Error('response lost') }, removeStorageSync: k => map.delete(k) }
 return { key, map, calls, writes, storage, mode, store: () => work.createReweighWorkStore('u', storage, () => owner, mode),
  owner(value) { owner = value }, fail(value) { fail = value }, seed(history, metadata = { round: { _id: 'active' } }, current = empty()) { map.set(key, JSON.stringify({ version: 1, ownerId: 'u', current, history, metadata })) } }
}
test('a round larger than the cache still reuses a bounded subset on repeated sequential scans', async () => {
 const cached = load('src/services/pda/reweighWorkStore.js', 'createReweighWorkStore,cacheState:()=>({units:cacheUnits,size:chunkCache.size})', { ...draft, })
 const f = fixture(), create = () => cached.createReweighWorkStore('u', f.storage, () => 'u', 'filling', { reuseImmutableChunks: true })
 f.seed(Array.from({ length: 340 }, (_, i) => ({ ...row(i, 'active'), remark: 'x'.repeat(1800) })))
 await create().loadAsync()
 for (let visit = 0; visit < 3; visit++) {
  f.calls.length = 0
  const loaded = await create().loadAsync()
  const reads = f.calls.filter(([kind, key]) => kind === 'async' && key.includes(':history:')).length
  assert.equal(loaded.history.length, 340)
  assert.ok(reads < 9, `visit ${visit}: all ${reads} chunks were read again`)
  assert.equal(f.calls.filter(([kind, key]) => kind === 'async' && key.endsWith(':work-v3')).length, 2)
  assert.ok(cached.cacheState().units <= 256 * 1024)
  assert.ok(cached.cacheState().size <= 32)
 }
})
for (const mode of ['filling', 'return']) test(`${mode}: archived 2000 rows never enter working recovery; query still contains every label`, async () => {
 const f = fixture(mode), old = Array.from({ length: 2000 }, (_, i) => row(i, 'old', i % 2 === 0)), active = [row('current', 'active')], pending = { ...row('unknown', 'old', false), receipt: { saved: false, complete: false } }
 f.seed([...old, ...active, pending]); const original = f.map.get(f.key)
 const loaded = await f.store().loadAsync()
 assert.equal(loaded.history.length, 2); assert.equal(f.map.get(f.key), original)
 f.calls.length = 0; f.writes.length = 0
 const again = await f.store().loadAsync()
 assert.equal(again.history.length, 2); assert.equal(f.writes.length, 0)
 assert.equal(f.calls.length, 3); assert.ok(f.calls.every(([kind, key]) => kind === 'async' && !key.includes(':archive:')))
 const all = await work.readReweighHistorySnapshot('u', f.storage, mode)
 assert.equal(all.history.length, 2002); assert.equal(new Set(all.history.map(x => x.operationId)).size, 2002)
 assert.ok(all.history.every(x => x.frozen.label.net_weight === 50))
})
test('confirmed end archives the whole round, clears last-round payload and leaves only pending work', async () => {
 const f = fixture(); f.seed([row('a', 'active'), row('b', 'active')])
 const store = f.store(), state = await store.loadAsync()
 const kept = store.save(empty(), state.history, { round: null, localRoundEnded: true, lastEndedRound: { _id: 'active', bottle_nos: ['a', 'b'] } })
 assert.equal(kept.length, 0)
 f.calls.length = 0
 const restored = await f.store().loadAsync()
 assert.equal(restored.history.length, 0); assert.equal(restored.metadata.lastEndedRound, null); assert.equal(f.calls.length, 2)
 assert.equal((await work.readReweighHistorySnapshot('u', f.storage)).history.length, 2)
})
test('pending end still restores its known records and the original operation identity', async () => {
 const f = fixture('return'); f.seed([row('a', 'closing')], { round: null, pendingEndRound: { round_id: 'closing' } })
 const state = await f.store().loadAsync()
 assert.equal(state.history.length, 1); assert.equal(state.metadata.pendingEndRound.round_id, 'closing')
})
test('archive corruption only affects history queries; missing active chunks still block unsafe work', async () => {
 const f = fixture(); f.seed([row('old'), row('a', 'active')]); await f.store().loadAsync()
 const root = JSON.parse(f.map.get(f.key + ':work-v3')), archive = JSON.parse(f.map.get(root.metadata.archiveHead))
 f.map.delete(archive.chunks[0].key)
 assert.equal((await f.store().loadAsync()).history.length, 1)
 await assert.rejects(work.readReweighHistorySnapshot('u', f.storage), /归档分段/)
 f.map.delete(f.key + ':work-v3' + root.historyChunks[0].key.slice(f.key.length))
 await assert.rejects(f.store().loadAsync(), /历史分段/)
})
test('failed archive/root writes and lost root receipt retain either old or complete committed state', async () => {
 for (const phase of ['archive', 'root', 'root-after']) {
  const f = fixture(); f.seed([row('a', 'active')]); const store = f.store(), state = await store.loadAsync()
  f.fail((key, position) => phase === 'archive' ? key.includes(':archive:') && position === 'before' : key === f.key + ':work-v3' && position === (phase === 'root-after' ? 'after' : 'before'))
  assert.throws(() => store.save(empty(), state.history, { round: null, localRoundEnded: true }), /quota|response lost/)
  f.fail(null)
  const restored = await f.store().loadAsync(), all = await work.readReweighHistorySnapshot('u', f.storage)
  assert.equal(all.history.length, 1); assert.equal(restored.history.length, phase === 'root-after' ? 0 : 1)
 }
})
test('migration rejects corrupt rows, changed legacy roots and foreign accounts', async () => {
 const corrupt = fixture(); corrupt.seed([{ operationId: 'bad', bottleNo: '1', frozen: { mode: 'create', payload: { operation_id: 'different' } } }])
 await assert.rejects(corrupt.store().loadAsync(), /无法读取或识别/); assert.equal(corrupt.writes.length, 0)
 const f = fixture(); f.seed([row('a')]); const nativeSet = f.storage.setStorageSync
 f.storage.setStorageSync = (key, value) => { nativeSet(key, value); if (key.endsWith(':index')) f.map.set(f.key, f.map.get(f.key) + ' ') }
 await assert.rejects(f.store().loadAsync(), /另一页面/); assert.equal(f.map.has(f.key + ':work-v3'), false)
 const other = fixture(); other.seed([row('a')]); other.owner('different'); await assert.rejects(other.store().loadAsync(), /登录账号/)
})

test('saved pending old rounds migrate from existing work root once and remain available only in queries', async () => {
 const f = fixture(); f.seed([row('a', 'active', false), row('b', 'active', false)])
 const store = f.store(), first = await store.loadAsync()
 const rootKey=f.key+':work-v3', root=JSON.parse(f.map.get(rootKey)); root.metadata.round=null; root.metadata.localRoundEnded=true
 f.map.set(rootKey,JSON.stringify(root)); f.calls.length=0
 const migrated=await f.store().loadAsync(); assert.equal(migrated.history.length,0)
 const history=await work.readReweighHistorySnapshot('u',f.storage)
 assert.equal(history.history.length,2); assert.ok(history.history.every(x=>x.receipt.saved&&!x.receipt.complete))
 f.calls.length=0;f.writes.length=0;await f.store().loadAsync()
 assert.equal(f.writes.length,0);assert.equal(f.calls.length,2)
 assert.ok(f.calls.every(x=>!x[1].includes(':archive:')))
})
