'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const load = async () => import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '../src/services/models/webSaleRecovery.js')).toString('base64'))
function setup(createWebSaleRecovery) {
  const rows = new Map(), requests = []; let who = 'user-a', next = 0, behavior
  const storage = { get: key => rows.get(key), set: (key, value) => rows.set(key, structuredClone(value)), remove: key => rows.delete(key) }
  const deps = { storage, actor: () => who, makeId: () => `web-test-operation-${++next}`, call: async (action, data) => { requests.push({ action, data: structuredClone(data) }); return behavior(action, data) } }
  return { client: createWebSaleRecovery(deps), reopen: () => createWebSaleRecovery(deps), rows, requests, storage,
    actor: value => { who = value }, behavior: value => { behavior = value } }
}
const saved = id => ({ code: 0, data: { protocol: 'web-sale-save/1', source_saved: true, sale_id: 'saved-source', operation_id: id, processing_state: 'complete' } })
test('lost response queries original operation, reload and changed form never generate a second save', async () => {
  const h = setup((await load()).createWebSaleRecovery)
  h.behavior((action, data) => { if (action === 'saveWebV1') throw Error('connection reset'); return saved(data.operation_id) })
  const result = await h.client.submit('', 'createV2', { amount: 100 })
  assert.equal(result.data.source_saved, true); assert.equal(h.requests.length, 2)
  const old = h.client.read(''); assert.equal(old.payload.amount, 100)
  await h.reopen().submit('', 'createV2', { amount: 999 })
  assert.equal(h.requests.filter(x => x.action === 'saveWebV1').length, 1)
})
test('query not found can only explicitly resend the same frozen request and operation ID', async () => {
  const h = setup((await load()).createWebSaleRecovery); let fail = true
  h.behavior((action, data) => { if (action === 'getWebSaveResultV1') return { code: 404, error_code: 'SALE_OPERATION_NOT_FOUND' }; if (fail) throw Error('network'); return saved(data.operation_id) })
  assert.equal((await h.client.submit('', 'createV2', { amount: 100 })).code, 503)
  await h.client.submit('', 'createV2', { amount: 200 }); assert.equal(h.requests.filter(x => x.action === 'saveWebV1').length, 1)
  fail = false; assert.equal((await h.reopen().resume('')).code, 0)
  const sends = h.requests.filter(x => x.action === 'saveWebV1')
  assert.deepEqual(sends[1].data, sends[0].data)
})
test('failed storage prevents network submission; acknowledgement failure still reports known saved', async () => {
  const h = setup((await load()).createWebSaleRecovery)
  h.storage.set = () => { throw Error('quota full') }
  await assert.rejects(h.client.submit('', 'createV2', {}), /quota/); assert.equal(h.requests.length, 0)
  const other = setup((await load()).createWebSaleRecovery)
  other.behavior((action, data) => { other.storage.set = () => { throw Error('quota after commit') }; return saved(data.operation_id) })
  assert.equal((await other.client.submit('', 'createV2', {})).data.source_saved, true)
  assert.ok(other.client.read(''))
})
test('account switch during reply cannot acknowledge or resend another account frozen request', async () => {
  const h = setup((await load()).createWebSaleRecovery)
  h.behavior((action, data) => { h.actor('user-b'); return saved(data.operation_id) })
  const result = await h.client.submit('', 'createV2', { amount: 100 })
  assert.equal(result.code, 499); assert.equal(h.client.read(''), null)
  h.actor('user-a'); assert.equal(h.client.read('').payload.amount, 100)
})
test('unconfirmed or malformed server success never clears frozen request', async () => {
  const h = setup((await load()).createWebSaleRecovery)
  h.behavior(() => ({ code: 0, data: { sale_id: 'unknown' } }))
  assert.equal((await h.client.submit('', 'createV2', {})).code, 503); assert.ok(h.client.read(''))
})
test('definitive validation rejection unlocks correction; acknowledged committed operation allows explicit next sale', async () => {
  const h = setup((await load()).createWebSaleRecovery)
  h.behavior(() => ({ code: 409, data: { source_saved: false, kind: 'bottle_flow_mismatch' } }))
  await h.client.submit('', 'createV2', { confirm: false }); assert.equal(h.client.read(''), null)
  h.behavior((action, data) => saved(data.operation_id))
  const r = await h.client.submit('', 'createV2', { confirm: true })
  h.client.acknowledge('', r.data.operation_id)
  const next = await h.client.submit('', 'createV2', { confirm: true })
  assert.notEqual(next.data.operation_id, r.data.operation_id)
})
