'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')

function setup(extra = []) {
 const db = makeDb({ crm_users: [{ _id: 'u', token: 'test', role: 'superadmin' }], crm_customers: [], crm_operation_logs: [], crm_bottles: [
  { _id: 'b80', bottle_no: '80', qr_code: '02546000226', pda_qr_code: 'BT1|80|124', tare_weight: 124 },
  { _id: 'b261', bottle_no: '261', qr_code: '02546000571', tare_weight: 117 }, ...extra
 ] }, { mutate: true })
 const handler = loadHandler('crm-bottle', db)
 return { db, scan: code => invoke(handler, 'resolveQrCodeV1', { pda_qr_code: code }) }
}

test('both photographed registration URLs and printed barcodes resolve to the same bottle', async () => {
 const { scan, db } = setup()
 for (const [code, no] of [['02546000226', '80'], ['02546000571', '261']]) {
  for (const raw of [code, `http://teshe.org.cn/Q?id=130108${code}`, `HTTPS://TESHE.ORG.CN/Q?ID=130108${code}`]) {
   const r = await scan(raw)
   assert.equal(r.code, 0, r.msg); assert.equal(r.data.bottle.bottle_no, no)
  }
 }
 assert.equal(db.writes.length, 0)
})

test('original PDA code and exact bottle-number lookup remain compatible', async () => {
 const { scan, db } = setup()
 assert.equal((await scan('BT1|80|124')).data.bottle.bottle_no, '80')
 const r = await invoke(loadHandler('crm-bottle', db), 'resolveBottleNoV1', { bottle_no: '80' })
 assert.equal(r.data.bottle._id, 'b80')
 assert.equal((await scan('80')).code, 404)
})

test('unknown URL, wrong region, arbitrary long numbers and lost leading zero never select a bottle', async () => {
 const { scan } = setup()
 for (const raw of ['http://other.example/Q?id=13010802546000226', 'http://teshe.org.cn.evil/Q?id=13010802546000226', 'http://teshe.org.cn/Q?id=99999902546000226', '13010802546000226', '2546000226', 'http://teshe.org.cn/Q?id=13010802546000226&other=1']) {
  assert.equal((await scan(raw)).code, 404, raw)
 }
 assert.equal((await scan('')).code, 400)
})

test('duplicate registration codes or collisions with existing PDA codes reject ambiguity', async () => {
 for (const extra of [{ _id: 'bOther', bottle_no: '99', qr_code: '02546000226' }, { _id: 'bOther', bottle_no: '99', pda_qr_code: '02546000226' }, { _id: 'bOther', bottle_no: '99', pda_qr_code: 'HTTP://TESHE.ORG.CN/Q?ID=13010802546000226' }]) {
  const { scan } = setup([extra])
  const r = await scan(extra.pda_qr_code || '02546000226')
  assert.equal(r.code, 409); assert.equal(r.data.match_type, 'multiple')
 }
})

test('same bottle matching both fields is still one unique result', async () => {
 const { scan, db } = setup()
 await db.collection('crm_bottles').doc('b80').update({ pda_qr_code: '02546000226' })
 assert.equal((await scan('02546000226')).data.bottle._id, 'b80')
})
