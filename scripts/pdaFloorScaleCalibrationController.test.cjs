const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const protocol = fs.readFileSync('src/services/pda/floorScaleCalibration.js', 'utf8').replace(/export /g, '')
const controller = fs.readFileSync('src/services/pda/floorScaleCalibrationController.js', 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')
const { createFloorScaleCalibrationController } = vm.runInThisContext(`${protocol}\n${controller}\n;({createFloorScaleCalibrationController})`)
function rig(options = {}) {
	const records = options.records || new Map(), sent = []
	let clock = 100000, kg = 0
	const weigh = value => { kg = value; clock += 2000 }
	let owner = options.owner || 'u1', device = 'A', session = 's1', connected = true, permitted = true
	const storage = { getStorageSync: k => records.get(k), setStorageSync: (k, v) => { if (options.failStore) throw new Error('quota'); records.set(k, v) } }
	const c = createFloorScaleCalibrationController({ ownerId: owner, storage, ownerMatches: () => owner === (options.owner || 'u1'),
		connection: () => ({ is_connected: connected, is_online: connected, sampled_at: clock, error_code:'reading', device_id: device, connection_key: session, can_calibrate: true }), canStart: () => permitted,
		now:()=>clock, stableReading: () => ({ kg, ad:100, stable:true, connectionKey:session, from:clock-1500, at:clock }),
		send: async (...args) => { sent.push(args); if (options.send) return options.send(...args) }, timeoutMs: options.timeoutMs || 100 })
	return { c, records, sent, weigh, owner: x => owner = x, device: x => device = x, session: x => session = x, connected: x => connected = x, permit: x => permitted = x }
}
test('persists before sending, requires explicit review, and completes both steps', async () => {
	let recordAtSend; const records = new Map()
	const r = rig({ records, send: () => { recordAtSend = JSON.parse(records.get('crm_pda_floor_calibration_v1')) } })
	assert.equal((await r.c.issueZero()).sent, true)
	assert.equal(recordAtSend.pending.kind, 'zero'); assert.equal(recordAtSend.pending.needsReconnect, true)
	assert.equal(r.c.getState().pending.needsReconnect, false); assert.equal(r.c.getState().requiresReview, true)
	await assert.rejects(r.c.issueZero(), /待核对/)
	r.weigh(0); r.c.resolvePending(true); assert.equal(r.c.getState().zeroFor, 'A')
	assert.equal((await r.c.issueMass('0.500')).sent, true); assert.equal(r.c.getState().pending.grams, 500)
	r.weigh(0.5); r.c.confirmLoad(); r.weigh(0); r.c.resolvePending(true); assert.equal(r.c.getState().requiresReview, false); assert.equal(r.c.getState().zeroFor, '')
	assert.equal(r.c.getState().lastVerified.kind, 'mass'); assert.equal(r.sent.length, 2)
})
test('unknown outcome survives restart, blocks retries and requires reconnect and same device', async () => {
	const records = new Map(), r = rig({ records, send: () => { throw new Error('disconnect') } })
	assert.equal((await r.c.issueZero()).sent, false); assert.equal(r.c.getState().pending.needsReconnect, true)
	const restored = rig({ records }); await assert.rejects(restored.c.issueZero(), /待核对/)
	assert.throws(() => restored.c.resolvePending(true), /重新连接/)
	restored.device('B'); restored.session('s2'); assert.throws(() => restored.c.resolvePending(true), /原来的地秤/)
	restored.device('A'); restored.c.resolvePending(false)
	assert.equal(restored.c.getState().requiresReview, true); assert.equal(restored.c.getState().zeroFor, '')
	await assert.rejects(restored.c.issueMass('1'), /归零/)
})
test('timeout blocks concurrent duplicate and late transport success never marks calibration verified', async () => {
	let finish; const r = rig({ timeoutMs: 10, send: () => new Promise(resolve => { finish = resolve }) })
	const first = r.c.issueZero(); await assert.rejects(r.c.issueZero(), /待核对/)
	assert.equal((await first).sent, false); finish(); await Promise.resolve()
	assert.equal(r.c.getState().pending.needsReconnect, true); assert.equal(r.c.getState().zeroFor, '')
	assert.equal(r.sent.length, 1)
})
test('invalid mass, storage failure, changed account and another operator never send', async () => {
	const r = rig(); await assert.rejects(r.c.issueMass('1'), /归零/); assert.equal(r.sent.length, 0)
	const options = { failStore: true }, bad = rig(options); await assert.rejects(bad.c.issueZero(), /quota/); assert.equal(bad.sent.length, 0)
	const records = new Map(), a = rig({ records, send: () => { throw new Error('lost') } }); await a.c.issueZero()
	const b = rig({ records, owner: 'u2' }); assert.match(b.c.getState().error, /原账号/); await assert.rejects(b.c.issueZero(), /原账号/)
	const changed = rig(); changed.owner('u2'); await assert.rejects(changed.c.issueZero(), /账号已变化/); assert.equal(changed.sent.length, 0)
})
test('requires fresh readings before a command and again before operator review', async () => {
	let live = false, sent = 0, clock = 10000; const records = new Map()
	const c = createFloorScaleCalibrationController({ ownerId: 'u1', storage: { getStorageSync: k => records.get(k), setStorageSync: (k, v) => records.set(k, v) },
		ownerMatches: () => true, canStart: () => true, now:()=>clock, stableReading:()=>({kg:0,ad:0,stable:true,connectionKey:'s1',from:clock-1500,at:clock}),
		connection: () => ({ is_connected: true, is_online: live, sampled_at: clock, error_code:'reading', device_id: 'A', connection_key: 's1', can_calibrate: true }),
		send: async () => { sent++; live = false } })
	await assert.rejects(c.issueZero(), /数据已中断或过期/); assert.equal(sent, 0)
	live = true; assert.equal((await c.issueZero()).sent, true); assert.equal(sent, 1)
	assert.throws(() => c.resolvePending(true), /数据已中断或过期/)
	live = true; clock += 2000; c.resolvePending(true); assert.equal(c.getState().zeroFor, 'A')
})

test('200 kg, tenfold wrong units, false success and 18 kg residual are distinguished', async () => {
	const r = rig(); await r.c.issueZero(); r.weigh(0); r.c.resolvePending(true)
	await assert.rejects(r.c.issueMass('200000'), /1000 kg/)
	await r.c.issueMass('200')
	assert.deepEqual(Array.from(r.sent[1][0]).slice(-4),[0,3,13,64])
	r.weigh(0.2); assert.throws(()=>r.c.confirmLoad(),/不符/)
	r.weigh(200); r.c.confirmLoad(); r.weigh(18)
	assert.throws(()=>r.c.resolvePending(true),/空台/)
	assert.equal(r.c.getState().requiresReview,true)
	r.weigh(0); r.c.resolvePending(true)
	assert.equal(r.c.getState().lastVerified.loaded.kg,200)
	assert.equal(r.c.getState().lastVerified.empty.kg,0)
})

test('daily zero keeps an existing verified span and does not require recalibration', async () => {
 const records=new Map(), r=rig({records}); await r.c.issueZero();r.weigh(0);r.c.resolvePending(true)
 await r.c.issueMass('20');r.weigh(20);r.c.confirmLoad();r.weigh(0);r.c.resolvePending(true)
 const span=JSON.stringify(r.c.getState().lastVerified), before=r.sent.length
 await r.c.issueZero();r.weigh(0.02);r.c.resolvePending(true)
 assert.equal(r.c.getState().requiresReview,false);assert.equal(JSON.stringify(r.c.getState().lastVerified),span)
 assert.equal(r.c.getState().lastZero.empty.kg,0.02);assert.equal(r.sent.length,before+1)
 assert.equal(r.sent.at(-1)[0][6],7)
})
test('independent reference check certifies empty/load/unload without sending any command',()=>{
 const r=rig();r.c.beginCheck('20');assert.equal(r.sent.length,0)
 r.weigh(0);assert.throws(()=>r.c.confirmLoad(),/不符/)
 r.weigh(20.04);r.c.confirmLoad();r.weigh(-0.02);r.c.resolvePending(true)
 assert.equal(r.sent.length,0);assert.equal(r.c.getState().lastVerified.kind,'check')
 assert.equal(r.c.getState().lastVerified.grams,20000);assert.equal(r.c.getState().requiresReview,false)
 const b=rig({records:r.records,owner:'operator'});assert.equal(b.c.getState().lastVerified.kind,'check')
})
test('failed reference check stays unverified; a daily zero cannot hide that result',async()=>{
 const r=rig();r.c.beginCheck('20');r.c.resolvePending(false)
 await r.c.issueZero();r.weigh(0);r.c.resolvePending(true)
 assert.equal(r.c.getState().requiresReview,true);assert.equal(r.c.getState().lastVerified,null)
})
