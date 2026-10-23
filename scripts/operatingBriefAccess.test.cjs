'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { makeDb, loadHandler, invoke } = require('./lib/accountingTestHarness.cjs')

test('current funds require both home and customer permissions before reading financial sources', async () => {
  for (const [home, customer, code] of [[true, false, 403], [false, true, 403], [true, true, 0]]) {
    const reads = []
    const db = makeDb({ crm_users: [{ _id: 'user-1', token: 'test', role: 'user', role_template: 'user',
      page_permissions: { '/pages/index/index': { view: home }, '/pages/customer/list': { view: customer } } }] }, {
      get: (name, rows) => { if (name !== 'crm_users') reads.push(name); return { data: structuredClone(rows) } }
    })
    const result = await invoke(loadHandler('crm-dashboard', db), 'summaryV1', { section: 'current' })
    assert.equal(result.code, code, `home=${home}, customer=${customer}: ${result.msg}`)
    if (code === 403) {
      assert.deepEqual(reads, [])
      assert.equal(result.data?.current, undefined)
    } else {
      assert.equal(result.data.section, 'current')
      assert.equal(result.data.current.receivable, 0)
      assert.ok(reads.includes('crm_customer_receipts'))
    }
    assert.ok(db.writes.every(write => write.name === 'crm_operation_logs'), 'business sources are read-only')
  }
})
