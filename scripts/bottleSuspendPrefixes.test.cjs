const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')
const { digest } = require('../uniCloud-alipay/cloudfunctions/crm-bottle/suspendPrefixes')
const row = (id, extra = {}) => ({ _id: id, bottle_no: id, is_active: true, updated_at: 1, bottle_next_check_date: '2020-01-01', pressure_gauge_next_check_date: '2020-01-01', safety_valve_next_check_date: '2020-01-01', ...extra })
function setup(hooks = {}) {
 const tables = { crm_users: [{ _id: 'admin', token: 'test', role: 'superadmin' }], crm_bottles: ['Y1','Z1','N1','J1','X1'].map(id => row(id)), crm_operation_logs: [] }
 const db = makeDb(tables, { mutate: true, transaction: true, txDocumentObject: true, ...hooks })
 return { tables, db, main: loadHandler('crm-bottle', db) }
}
test('full preview, rollback, commit, backup and retry preserve all historical fields', async () => {
 const h = setup(), original = structuredClone(h.tables.crm_bottles)
 const preview = await invoke(h.main, 'suspendPrefixesV1', { phase: 'preview' })
 assert.equal(preview.code, 0, preview.msg); assert.equal(preview.data.total, 4); assert.equal(h.db.writes.length, 0)
 const data = { items: preview.data.plan }
 const rehearsal = await invoke(h.main, 'suspendPrefixesV1', { ...data, phase: 'rehearse' })
 assert.equal(rehearsal.code, 0, rehearsal.msg); assert.equal(rehearsal.data.status, 'rolled_back')
 assert.deepEqual(h.tables.crm_bottles, original); assert.equal(h.tables.crm_operation_logs.length, 0)
 const executed = await invoke(h.main, 'suspendPrefixesV1', { ...data, phase: 'execute' })
 assert.equal(executed.code, 0, executed.msg); assert.equal(executed.data.updated, 4)
 for (const r of h.tables.crm_bottles) {
  const before = original.find(b => b._id === r._id)
  if (r._id === 'X1') assert.deepEqual(r, before)
  else { assert.equal(r.is_active, false); assert.deepEqual({ ...r, is_active: true, updated_at: 1 }, before) }
 }
 assert.deepEqual(h.tables.crm_operation_logs[0].before, original.filter(r => r._id !== 'X1').sort((a,b)=>a._id.localeCompare(b._id)))
 const count = h.db.writes.length
 const replay = await invoke(h.main, 'suspendPrefixesV1', { ...data, phase: 'execute' })
 assert.equal(replay.data.idempotent, true); assert.equal(h.db.writes.length, count)
})
test('changed originals, unrelated prefixes and non-admin callers cannot mutate records', async () => {
 for (const mode of ['stale', 'scope', 'role']) {
  const h = setup(), target = h.tables.crm_bottles.find(r => r._id === (mode === 'scope' ? 'X1' : 'Y1'))
  const items = [{ id: target._id, expected_hash: digest(target) }]
  if (mode === 'stale') target.updated_at++
  if (mode === 'role') h.tables.crm_users[0].role = 'worker'
  const before = structuredClone(h.tables.crm_bottles)
  const r = await invoke(h.main, 'suspendPrefixesV1', { phase: 'execute', items })
  assert.notEqual(r.code, 0); assert.deepEqual(h.tables.crm_bottles, before); assert.equal(h.tables.crm_operation_logs.filter(r => r.action === 'bottle_suspend_yznj_20261024').length, 0)
 }
})
test('partial transaction failure rolls back every bottle and the backup log', async () => {
 let writes = 0
 const h = setup({ txWrite: () => { if (++writes === 2) throw Error('simulated failure') } })
 const before = structuredClone(h.tables.crm_bottles), items = before.slice(0, 2).map(r => ({ id:r._id, expected_hash:digest(r) }))
 const r = await invoke(h.main, 'suspendPrefixesV1', { phase:'execute', items })
 assert.equal(r.code,409); assert.deepEqual(h.tables.crm_bottles,before); assert.equal(h.tables.crm_operation_logs.length,0)
})
test('dashboard and inspection candidates count only active bottles for all three inspections', async () => {
 const h = setup()
 for(const r of h.tables.crm_bottles) r.is_active = r._id === 'X1'
 h.tables.crm_bottles.push(row('Y-inactive-due', { is_active: false, bottle_next_check_date: new Date().toISOString().slice(0,10) }))
 const r = await invoke(loadHandler('crm-dashboard',h.db), 'summaryV1', { section:'quick' })
 assert.equal(r.code,0,r.msg)
 for(const module of ['bottle','gauge','valve']) {
  assert.equal(r.data.inspection_due[module].overdue,1); assert.equal(r.data.inspection_due[module].due_60d,0)
  const list = await invoke(h.main,'listV1',{is_active:true,inspection_due_module:module,inspection_due_state:'overdue_or_due_60d',include_summary:false,include_deposit:false})
  assert.equal(list.code,0,list.msg); assert.equal(list.paging.total,1); assert.equal(list.data[0].bottle_no,'X1')
 }
 h.tables.crm_bottles.find(r=>r._id==='Y1').is_active=true
 const restored = await invoke(loadHandler('crm-dashboard',h.db),'summaryV1',{section:'quick'})
 assert.equal(restored.data.inspection_due.bottle.overdue,2)
})
