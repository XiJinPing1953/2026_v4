const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function load(path, names, context = {}) {
 const source = fs.readFileSync(path, 'utf8').replace(/^import.*\n/gm, '').replace(/^export /gm, '')
 return vm.runInNewContext(`${source}\n;({${names}})`, { ...context })
}
const { reweighHistoryTime, readReweighDraft } = load('src/services/pda/reweighDraft.js', 'reweighHistoryTime,readReweighDraft')
const { savedLabel, supersededOperationIds } = load('src/services/pda/fillingPrint.js', 'savedLabel,supersededOperationIds', { normalizePrintLabel: label => { if (!label) throw Error('missing'); return label } })
const { localFillingRounds, historyPrintEntry } = load('src/services/pda/reweighHistory.js', 'localFillingRounds,historyPrintEntry', { reweighHistoryTime, readReweighDraft, savedLabel, supersededOperationIds })
function entry(id, round = 'round1') { return { operationId: id, roundId: round, bottleNo: '55', date: '2026-10-22 12:00:00',
 receipt: { saved: true, complete: true, fillingId: id }, frozen: { mode: 'create', payload: { operation_id: id, bottle_no: '55', gross_weight: 150 },
 label: { company: '新拓能源', bottle_no: '55', gross_weight: 150, tare_weight: 110, net_weight: 40 } } } }
test('local rounds retain ended rounds, count distinct bottles, and never write/migrate storage', () => {
 const e1 = entry('one'), e2 = entry('two'), e3 = entry('three', 'round2'), noRound = entry('unknown', '')
 const state = JSON.stringify({ version: 1, ownerId: 'owner', history: [e1, e2, noRound], current: e3 })
 const rounds = localFillingRounds('owner', { getStorageSync: key => { assert.equal(key, 'crm_pda_reweigh_v1:owner'); return state }, setStorageSync: () => assert.fail('write') })
 assert.equal(rounds.length, 2); assert.equal(rounds.find(row => row.id === 'round1').bottle_count, 1)
 assert.equal(rounds.find(row => row.id === 'round1').rows.length, 2)
 assert.equal(JSON.stringify(historyPrintEntry(rounds[0].rows[0])), JSON.stringify(e1))
})
test('history refuses foreign account and omits superseded snapshots', () => {
 const old = entry('one'), correction = entry('two'); correction.frozen.mode = 'correct'; correction.frozen.payload.filling_id = 'one'; correction.receipt.fillingId = 'one'
 const state = { version: 1, ownerId: 'owner', history: [old], current: correction }
 const storage = { getStorageSync: () => state }
 assert.throws(() => localFillingRounds('other', storage), /无法读取/)
 assert.equal(localFillingRounds('owner', storage)[0].rows.length, 1)
 assert.equal(localFillingRounds('owner', storage)[0].rows[0].id, 'two')
})
test('remote print entry requires authoritative label plus operation, never infers from current row weights', () => {
 assert.equal(historyPrintEntry({ id: 'x', gross_weight: 150, tare_weight: 110, net_weight: 40 }), null)
 const row = { id: 'x', operation_id: 'op', bottle_no: '55', gross_weight: 150, label: entry('op').frozen.label }
 assert.equal(savedLabel(historyPrintEntry(row)).gross_weight, 150)
 assert.equal(historyPrintEntry(row).receipt.fillingId, 'x')
})

function printView(options = {}) {
 const vue = require('vue'), { ref } = vue
 const rows = [entry('one'), entry('two')].map(item => ({ id: item.operationId, print_entry: item }))
 const form = { types: ref([]), type: ref('filling'), typeLabel: ref('罐装复秤'), date: ref('2026-10-22'), bottleNo: ref(''), rows: ref(rows), loading: ref(false), rounds: ref([]), roundId: ref('round'), pageActive: ref(true), activate() {}, deactivate() { this.pageActive.value = false } }
 const sends = [], closeCalls = []
 const printer = { busy: ref(false), connected: ref(true), reason: () => '', close: () => { closeCalls.push(true) }, reprint: async item => { sends.push(item.operationId); return options.send ? options.send(item) : true } }
 const source = fs.readFileSync('src/components/domain/pda/PdaReweighRecordsView.vue', 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import.*\n/gm, '')
 const view = vm.runInNewContext(`${source}\n;({printRound,stopBatch,batchBusy,batchMessage,deactivate})`, { ...vue, useRecordPageScroll: () => () => {}, watch: () => {}, defineExpose: () => {}, defineEmits: () => {}, usePdaReweighRecords: () => form,
  historyPrintEntry, usePdaFillingPrinter: () => printer, uni: { showModal: params => { assert.match(params.content, /2 张/); params.success({ confirm: options.confirm !== false }) } } })
 return { view, sends, closeCalls }
}
test('explicit round confirmation sends each label once and repeated clicks cannot create a second batch', async () => {
 let resolve
 const h = printView({ send: () => new Promise(done => { resolve = done }) })
 const task = h.view.printRound(); await new Promise(done => setImmediate(done))
 await h.view.printRound(); assert.deepEqual(h.sends, ['one'])
 resolve(true); await new Promise(done => setImmediate(done)); assert.deepEqual(h.sends, ['one', 'two'])
 resolve(true); await task; assert.equal(h.view.batchBusy.value, false)
})
test('batch failure stops without retry and explicit stop closes connection and cancels remaining labels', async () => {
 const failed = printView({ send: async () => false }); await failed.view.printRound()
 assert.deepEqual(failed.sends, ['one']); assert.match(failed.view.batchMessage.value, /已停止/)
 let resolve
 const stopped = printView({ send: () => new Promise(done => { resolve = done }) })
 const task = stopped.view.printRound(); await new Promise(done => setImmediate(done)); stopped.view.stopBatch()
 assert.equal(stopped.closeCalls.length, 1)
 resolve(true); await task; assert.deepEqual(stopped.sends, ['one'])
 const declined = printView({ confirm: false }); await declined.view.printRound(); assert.deepEqual(declined.sends, [])
})

test('async round browsing retains all chunks, reuses an unchanged root and never migrates or writes', async () => {
 const draft = load('src/services/pda/reweighDraft.js', 'reweighDraftKey,readReweighDraftAsync')
 const work = load('src/services/pda/reweighWorkStore.js', 'readReweighHistoryRoot,readReweighHistorySnapshot', draft)
 const { createLocalFillingRoundsReader } = load('src/services/pda/reweighHistory.js', 'createLocalFillingRoundsReader', { ...draft, ...work, reweighHistoryTime, savedLabel, supersededOperationIds })
 const key = draft.reweighDraftKey('owner'), map = new Map(), parts = []
 for (let i = 0; i < 50; i++) {
  const name = `${key}:history:${i}`; parts.push({ key: name, count: 40 })
  map.set(name, JSON.stringify(Array.from({ length: 40 }, (_, j) => entry(`${i}-${j}`))))
 }
 map.set(key, JSON.stringify({ version: 2, ownerId: 'owner', historyChunks: parts, current: entry('current') }))
 let reads = 0, active = 0, max = 0, valid = true
 const storage = { async getStorage(name) { reads++; active++; max = Math.max(active,max); await new Promise(r => setImmediate(r)); active--; return map.get(name) }, getStorageSync() { assert.fail('sync read') }, setStorageSync() { assert.fail('write') } }
 const reader = createLocalFillingRoundsReader()
 const first = await reader('owner', storage, () => valid)
 assert.equal(first[0].rows.length, 2001); assert.ok(max <= 4); assert.equal(reads, 53)
 reads = 0; assert.equal(await reader('owner', storage), first); assert.equal(reads, 2)
 map.set(key, JSON.stringify({ version: 2, ownerId: 'owner', historyChunks: parts, current: entry('new-current') }))
 const changed = await reader('owner', storage); assert.notEqual(changed, first)
 valid = false; await assert.rejects(reader('owner', storage, () => valid), /账号/)
 map.delete(parts[0].key); map.set(key, JSON.stringify({ version: 2, ownerId: 'owner', historyChunks: parts, current: entry('third-current') }))
 await assert.rejects(reader('owner', storage), /分段无法读取/)
})
