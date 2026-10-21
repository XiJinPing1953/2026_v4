const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/services/api/reweigh.js', 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')
function harness(responses, onWait = () => {}) {
 const calls = [], waits = []
 let token = 'original-token', tokenReads = 0
 const api = vm.runInNewContext(source + ';({listReturnReweighRecordsV1,listFillingReweighRecordsV1,listReturnReweighRoundRecordsV1,saveReturnReweighV1})', {
  getToken: () => { tokenReads += 1; return token },
  callCloud: async (name, options) => {
   calls.push({ name, ...options })
   const response = responses[Math.min(calls.length - 1, responses.length - 1)]
   if (response instanceof Error) throw response
   return response
  },
  submitBatchFillingOperation() {}, getFillingOperationV1() {}, retryFillingOperationV1() {},
  setTimeout: (resolve, delay) => { waits.push(delay); onWait(); resolve() }
 })
 return { api, calls, waits, setToken: value => { token = value }, tokenReads: () => tokenReads }
}
const unknown = { code: 400, msg: '未知 action' }
for (const method of ['listReturnReweighRecordsV1', 'listFillingReweighRecordsV1', 'listReturnReweighRoundRecordsV1']) {
 test(`${method}: first success is unchanged`, async () => {
  const result = { code: 0, data: { rows: [{ id: 'one' }] } }, h = harness([result])
  assert.equal(await h.api[method]({ date: '2026-10-21' }), result)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].action, method)
  assert.deepEqual(h.waits, [])
 })
 test(`${method}: transient unknown action recovers, persistent failure stops`, async () => {
  const result = { code: 0, data: { rows: [{ id: 'one' }] } }, h = harness([unknown, { code: 400, msg: '未知ACTION' }, result])
  assert.equal(await h.api[method]({}), result)
  assert.deepEqual(h.waits, [200, 500])
  assert.equal(h.calls.length, 3)
  const failed = harness([unknown]), response = await failed.api[method]({})
  assert.equal(failed.calls.length, 3)
  assert.equal(response.code, 400)
  assert.equal(response.msg, '复秤查询服务暂未同步，请稍后重试')
  assert.equal(response.data, undefined)
 })
}
test('other business errors, nonmatching messages, and network errors never retry', async () => {
 for (const result of [{ code: 401, msg: '未知 action' }, { code: '400', msg: '未知 action' }, { code: 400, msg: '未知 action listV1' }, { code: 400, msg: '参数错误' }, { code: 500, msg: '未知 action' }]) {
  const h = harness([result])
  assert.equal(await h.api.listReturnReweighRecordsV1({}), result)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.waits, [])
 }
 const error = new Error('offline'), h = harness([error])
 await assert.rejects(h.api.listReturnReweighRecordsV1({}), error)
 assert.equal(h.calls.length, 1)
 assert.deepEqual(h.waits, [])
})
test('cancellation during retry wait prevents the next request', async () => {
 let active = true
 const h = harness([unknown], () => { active = false })
 const result = await h.api.listReturnReweighRecordsV1({}, { shouldContinue: () => active })
 assert.equal(result.code, 499)
 assert.equal(h.calls.length, 1)
 assert.deepEqual(h.waits, [200])
 const inactive = harness([unknown])
 assert.equal((await inactive.api.listFillingReweighRecordsV1({}, { shouldContinue: () => false })).code, 499)
 assert.equal(inactive.calls.length, 0)
})
test('all retries retain the initially captured token, including an empty token', async () => {
 for (const originalToken of ['original-token', '']) {
  const h = harness([unknown, { code: 0 }], () => h.setToken('new-login-token'))
  h.setToken(originalToken)
  assert.equal((await h.api.listReturnReweighRecordsV1({})).code, 0)
  assert.deepEqual(h.calls.map(call => call.token), [originalToken, originalToken])
  assert.equal(h.tokenReads(), 1)
 }
})
test('save requests do not gain automatic retries', async () => {
 const h = harness([unknown])
 assert.equal(await h.api.saveReturnReweighV1({ operation_id: 'one' }), unknown)
 assert.equal(h.calls.length, 1)
 assert.deepEqual(h.waits, [])
})

function realCloudHarness() {
 let token='old-login',active=true,cleared=0;const calls=[],modals=[]
 const context={getToken:()=>token,clearAuth:()=>{cleared++;token=''},getCurrentPages:()=>[],
  uni:{showModal:modal=>modals.push(modal),showToast(){},removeStorageSync(){},setStorageSync(){},reLaunch:async()=>{}},
  uniCloud:{callFunction:options=>new Promise(resolve=>calls.push({options,resolve}))},console:{info(){}},setTimeout,
  submitBatchFillingOperation(){},getFillingOperationV1(){},retryFillingOperationV1(){}}
 const clean=file=>fs.readFileSync(file,'utf8').replace(/^import .*\n/gm,'').replace(/export /g,'')
 vm.runInNewContext(clean('src/services/navigation.js')+'\n'+clean('src/services/api/callCloud.js')+'\n'+clean('src/services/api/reweigh.js')+'\nthis.list=listReturnReweighRoundRecordsV1',context)
 return {calls,modals,setToken:value=>{token=value},setActive:value=>{active=value},cleared:()=>cleared,run:()=>context.list({round_id:'round-1'},{shouldContinue:()=>active})}
}
test('real cloud path suppresses stale 401 auth side effects after account change or page hide',async()=>{
 for(const mode of ['account','hide']){
  const h=realCloudHarness(),pending=h.run();assert.equal(h.calls.length,1)
  if(mode==='account')h.setToken('new-login');else h.setActive(false)
  h.calls[0].resolve({result:{code:401,msg:'expired'}})
  assert.equal((await pending).code,499);assert.equal(h.modals.length,0);assert.equal(h.cleared(),0)
 }
})
test('a guarded 401 modal cannot clear a later login, while valid active 401 still works',async()=>{
 for(const changed of [true,false]){
  const h=realCloudHarness(),pending=h.run();h.calls[0].resolve({result:{code:401,msg:'expired'}});assert.equal((await pending).code,401)
  assert.equal(h.modals.length,1);if(changed)h.setToken('new-login')
  h.modals[0].success();assert.equal(h.cleared(),changed?0:1)
 }
})
