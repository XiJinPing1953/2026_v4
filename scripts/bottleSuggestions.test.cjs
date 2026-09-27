'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const model = fs.readFileSync('src/services/models/bottle.js', 'utf8').replace(/export\s*\{[\s\S]*?\}\s*$/m, '')
const source = fs.readFileSync('src/composables/useBottleSuggestions.js', 'utf8')
  .replace(/^import .*\n/gm, '').replace(/export\s*\{[\s\S]*?\}\s*$/m, '')
function harness(rows, exactResult, rejectExact = false) {
  const calls = []
  const search = vm.runInNewContext(model + '\n' + source + '\nsearchBottleSuggestions', {
    resolveBottleNoV1: async ({ bottle_no }) => {
      calls.push({ exact: bottle_no })
      if (rejectExact) throw new Error('unavailable')
      return exactResult
    },
    searchBottlesV1: async params => {
      calls.push(params)
      return { code: 0, total: rows.length, data: rows.slice((params.page - 1) * params.pageSize, params.page * params.pageSize) }
    }
  })
  return { search, calls }
}
const bottle25 = { _id: 'b25', bottle_no: '25', tare_weight: 124, is_active: true }
const exact = bottle => ({ code: 0, data: { bottle } })

test('25 beyond the 500-row fuzzy scan cap is first and carries id/tare for selection', async () => {
  const rows = Array.from({ length: 852 }, (_, i) => ({ _id: `qr-${i}`, bottle_no: `X${i}`, qr_code: '02546000672', is_active: true }))
  rows[700] = bottle25
  const { search, calls } = harness(rows, exact(bottle25))
  const result = await search('25', { limit: 20 })
  assert.equal(result[0]._id, 'b25')
  assert.equal(result[0].tare_weight, 124)
  assert.equal(result.length, 20)
  assert.equal(calls.filter(c => c.page).length, 1)
  assert.equal(calls[1].include_summary, false)
})

test('exact result merges with fuzzy results without duplicates', async () => {
  const { search } = harness([{ _id: 'b125', bottle_no: '125' }, bottle25, { _id: 'b250', bottle_no: '250' }], exact(bottle25))
  assert.deepEqual(Array.from(await search(' 25 '), b => b.bottle_no), ['25', '250', '125'])
})

test('inactive exact bottle is excluded and missing exact lookup preserves fuzzy search', async () => {
  for (const response of [exact({ ...bottle25, is_active: false }), { code: 404 }, { code: 409 }]) {
    const { search } = harness([{ _id: 'b250', bottle_no: '250', is_active: true }], response)
    assert.deepEqual(Array.from(await search('25'), b => b.bottle_no), ['250'])
  }
})

test('exact lookup failure falls back to fuzzy search; empty input makes no calls', async () => {
  const { search, calls } = harness([bottle25], null, true)
  assert.equal((await search(' ')).length, 0)
  assert.equal(calls.length, 0)
  assert.equal((await search('25'))[0]._id, 'b25')
})
