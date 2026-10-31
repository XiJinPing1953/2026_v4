const test = require('node:test'), assert = require('node:assert/strict')
const { wrapDatabase, withPerformanceTrace } = require('../uniCloud-alipay/cloudfunctions/common/performanceTrace')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function database() {
 const calls = [], command = {}, tx = { collection: name => collection(name), commit: () => 'committed' }
 function collection(name) { return { where() { return this }, doc() { return this }, field() { return this }, orderBy() { return this }, limit() { return this }, skip() { return this },
  async get(ms = 8) { calls.push(name); await delay(ms); if (name === 'bad') throw Error('original'); return { data: [name] } },
  async count() { calls.push(name); return { total: 1 } }, update() { return { updated: 1 } },
  aggregate() { return { match() { return this }, count() { return this }, async end() { calls.push(name); return { list: [name] } } } } } }
 return { raw: { command, collection, startTransaction: () => tx }, calls }
}
test('off by default: original handler result, SDK arguments, commands and transaction methods survive', async () => {
 const f = database(), db = wrapDatabase(f.raw), result = { code: 0 }
 const main = withPerformanceTrace(async () => { assert.equal(db.command, f.raw.command); assert.deepEqual(await db.collection('a').where({ secret: 'not logged' }).get(0), { data: ['a'] }); assert.equal(db.startTransaction().commit(), 'committed'); return result })
 assert.equal(await main({}), result); assert.deepEqual(f.calls, ['a'])
})
test('concurrent requests stay isolated; database union does not double-count parallel reads', async () => {
 const f = database(), db = wrapDatabase(f.raw)
 const main = withPerformanceTrace(async event => { await Promise.all([db.collection(event.action).get(15), db.collection(event.action).get(20)]); return { code: 0 } })
 const [a, b] = await Promise.all(['a', 'b'].map(action => main({ action, _performance_trace: `perf_12345678_${action}`, request_id: action })))
 for (const [result, name] of [[a, 'a'], [b, 'b']]) {
  assert.equal(result._performance.db.count, 2); assert.ok(result._performance.db.calls.every(call => call.collection === name))
  assert.ok(result._performance.db.wall_ms < result._performance.db.sum_ms)
  assert.ok(result._performance.function_ms >= result._performance.db.wall_ms)
 }
})
test('aggregate count is a pipeline stage, errors remain original, and metadata is bounded and redacted', async () => {
 const f = database(), db = wrapDatabase(f.raw)
 const main = withPerformanceTrace(async () => {
  await db.collection('aggregate').aggregate().match({ password: 'secret' }).count('total').end()
  await assert.rejects(db.collection('bad').get(0), /original/)
  for (let i = 0; i < 125; i++) await db.collection('a').count()
  return { code: 0 }
 })
 const result = await main({ _performance_trace: 'perf_123456789', token: 'private-token' })
 assert.equal(result._performance.db.count, 127); assert.equal(result._performance.db.calls.length, 120); assert.equal(result._performance.db.truncated, true)
 assert.ok(!JSON.stringify(result._performance).includes('secret')); assert.ok(!JSON.stringify(result._performance).includes('private-token'))
 assert.equal((await withPerformanceTrace(async () => ({ code: 401 }))({ _performance_trace: 'perf_123456789' }))._performance, undefined)
})
test('frontend tracing is opt-in, expires, correlates exact requests and preserves a tap start through navigation', () => {
 const fs = require('node:fs'), vm = require('node:vm'); let time = 100000
 class Clock extends Date { static now() { return time } }
 const logs = [], source = fs.readFileSync('src/services/performanceTrace.js', 'utf8').replace(/^import.*\n/gm, '').replace(/^export /gm, '')
 const api = vm.runInNewContext(source + ';({startPerformanceSession,startCloudTrace,finishCloudTrace,beginPageTrace,markPageTrace,readPerformanceEvents})', { Date: Clock, Math, console: { info: (...args) => logs.push(args) } })
 assert.equal(api.startCloudTrace('fn', 'read', 'r'), null)
 const session = api.startPerformanceSession(), page = api.beginPageTrace('/pages/pda/reweigh?private=not-logged', 'tap')
 time += 2000; assert.equal(api.beginPageTrace('/pages/pda/reweigh', 'navigation'), page)
 api.markPageTrace('onLoad'); const cloud = api.startCloudTrace('fn', 'read', 'req')
 time += 300; api.finishCloudTrace(cloud, { code: 0, _performance: { trace_id: session, request_id: 'wrong' } })
 const events = api.readPerformanceEvents(); assert.equal(events.at(-1).server, null); assert.equal(events.at(-1).elapsed_ms, 300)
 assert.ok(!JSON.stringify(events).includes('not-logged'))
 time += 600000; assert.equal(api.startCloudTrace('fn', 'read', 'r'), null)
})
