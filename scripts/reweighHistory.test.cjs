'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/services/pda/reweighDraft.js', 'utf8').replace(/^export /gm, '')
const { createReweighDraftStore, reweighHistoryTime, pruneReweighHistory } = vm.runInNewContext(source + '\n;({createReweighDraftStore,reweighHistoryTime,pruneReweighHistory})', { Date })
const copy = value => JSON.parse(JSON.stringify(value))
const row = (id, time, complete = true) => ({ operationId: id, bottleNo: '130', capture: { sampled_at: Date.parse(time) }, receipt: { saved: true, complete } })
const old = () => row('old-complete', '2026-10-20T23:59:59+08:00')
const today = () => row('today', '2026-10-21T00:00:00+08:00')
const data = () => ({ version: 1, ownerId: 'u1', current: { operationId: 'active-draft', bottleNo: '180', frozen: null }, history: [old(), today()], metadata: { round: { _id: 'round-1', bottle_count: 2 }, pendingRound: null }, savedAt: 123 })
function fixture(mode = 'return', initial = data(), hooks = {}) {
 const key = `${mode === 'return' ? 'crm_pda_return_reweigh_v1' : 'crm_pda_reweigh_v1'}:u1`
 const map = new Map([[key, JSON.stringify(initial)], ['crm_token', 'login-preserved'], ['crm_pda_weigh_trace_v1', JSON.stringify({ sampleCount: 2318 })], ['crm_pda_return_reweigh_v1:other', 'other-account-untouched']])
 const writes = []
 const storage = { getStorageSync: k => map.get(k), setStorageSync(k, value) { hooks.write?.(k, value); writes.push(k); map.set(k, value) } }
 const store = createReweighDraftStore('u1', storage, hooks.owner || (() => 'u1'), mode)
 return { key, backupKey: `${key}:history-backup-before-20261021`, map, writes, storage, store }
}

test('weighing time uses frozen capture and UTC+8 with real seconds across midnight', () => {
 const item = { ...old(), frozen: { payload: { capture: today().capture } } }
 assert.equal(reweighHistoryTime(item), '2026-10-21 00:00:00')
 assert.equal(reweighHistoryTime(old()), '2026-10-20 23:59:59')
 assert.equal(reweighHistoryTime({ date: '2026-10-21 11:15:38' }), '2026-10-21 11:15:38')
 assert.equal(reweighHistoryTime({ date: '2026-10-21-11' }), '—')
 assert.equal(reweighHistoryTime({ date: '2026-02-30 11:15:38' }), '—')
 assert.equal(reweighHistoryTime({ capture: { sampled_at: 1e30 } }), '—')
})

test('both account stores remove old completed history with backup and preserve draft, round, login and samples', () => {
 for (const mode of ['return', 'filling']) {
  const original = data(), f = fixture(mode, original), untouched = new Map(f.map)
  const result = f.store.load()
  assert.deepEqual(copy(result.history), [today()])
  assert.deepEqual(copy(result.current), original.current)
  assert.deepEqual(copy(result.metadata), original.metadata)
  assert.deepEqual(JSON.parse(f.map.get(f.backupKey)), original)
  assert.equal(JSON.parse(f.map.get(f.key)).history.length, 1)
  for (const [key, value] of untouched) if (key !== f.key) assert.equal(f.map.get(key), value)
  assert.deepEqual(f.writes, [f.backupKey, f.key])
  createReweighDraftStore('u1', f.storage, () => 'u1', mode).load()
  assert.equal(f.writes.length, 2, 'reloading clean data does not migrate again')
 }
})

test('cleanup never discards unfinished recovery, unknown dates or future records', () => {
 const pending = { ...old(), operationId: 'pending', receipt: { saved: true, complete: false } }
 const unknown = { operationId: 'unknown', bottleNo: '1', receipt: { complete: true }, date: 'invalid' }
 const future = row('future', '2026-10-22T10:10:10+08:00')
 assert.deepEqual(copy(pruneReweighHistory([old(), pending, unknown, today(), future])), [pending, unknown, today(), future])
})

test('old current receipt cannot reappear when archived later; future history survives saves and backup is retained', () => {
 const initial = { ...data(), current: old() }, f = fixture('return', initial)
 const loaded = f.store.load(), backup = f.map.get(f.backupKey)
 const future = row('future', '2026-10-22T10:10:10+08:00')
 const history = f.store.save(loaded.current, [...loaded.history, loaded.current, future], loaded.metadata)
 assert.deepEqual(copy(history), [today(), future])
 assert.equal(f.map.get(f.backupKey), backup)
 assert.deepEqual(JSON.parse(f.map.get(f.key)).current, initial.current)
})

test('backup or replacement failure preserves existing stored data', () => {
 for (const failBackup of [true, false]) {
  const f = fixture('return', data(), { write: key => { if (key.includes('history-backup') === failBackup) throw Error('storage full') } })
  const before = f.map.get(f.key)
  assert.throws(() => f.store.load(), /storage full/)
  assert.equal(f.map.get(f.key), before)
  if (!failBackup) assert.deepEqual(JSON.parse(f.map.get(f.backupKey)), data())
 }
})

test('account change and concurrent draft changes still reject writes', () => {
 let owner = 'u1'; const f = fixture('return', data(), { owner: () => owner })
 const loaded = f.store.load()
 owner = 'u2'
 assert.throws(() => f.store.save(loaded.current, loaded.history), /登录账号已变化/)
 owner = 'u1'; f.map.set(f.key, 'changed by another page')
 assert.throws(() => f.store.save(loaded.current, loaded.history), /另一页面更新/)
 assert.equal(f.map.get(f.key), 'changed by another page')
})
