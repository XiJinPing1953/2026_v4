'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), vue = require('vue')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const script = file => { const text = fs.readFileSync(file, 'utf8'); return file.endsWith('.vue') ? text.match(/<script setup>([\s\S]*?)<\/script>/)[1] : text }
function load(file, names, globals = {}) {
 const source = script(file).replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '').replace(/^export /gm, '')
 return vm.runInNewContext(`${source}\n;({${names}})`, { ...vue, onBeforeUnmount() {}, setTimeout, clearTimeout, ...globals })
}
function functions(file, names, globals) {
 const source = script(file), ast = require('@babel/parser').parse(source, { sourceType: 'module' })
 const code = ast.program.body.filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name)).map(node => source.slice(node.start, node.end)).join('\n')
 return vm.runInNewContext(`${code}\n;({${names}})`, { setTimeout, clearTimeout, ...globals })
}
const station = 'src/components/domain/stationSafetyInspection/StationSafetyInspectionFormView.vue'
const home = 'src/components/domain/homeSafetyInspection/HomeSafetyInspectionFormView.vue'
test('actual exposed Vue signature instance accepts ink and still rejects an empty signature', async () => {
 const ink = vue.ref(true), instance = vue.ref(null), notices = []
 const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode() {}, nextSibling() {}, patchProp() {} })
 const Child = { setup(_, { expose }) { expose({ hasInk: ink, exportFile: async () => '/synthetic.png' }); return () => null } }
 const app = renderer.createApp({ setup: () => () => vue.h(Child, { ref: instance }) }); app.mount({})
 let uploads = 0
 const api = functions(station, ['saveSignature'], { signatureRefs: new Map([['A', instance.value]]), uni: { showToast: o => notices.push(o.title) }, uploadStationSafetyImage: async () => { uploads++; return 'cloud-signature' }, clientSubmissionId: vue.ref('operation'), markDirty() {} })
 const item = { item_code: 'A' }; await api.saveSignature(item)
 assert.equal(uploads, 1); assert.equal(item.responsible_signature_file_id, 'cloud-signature'); assert.equal(item.signature_uploading, false)
 ink.value = false; await api.saveSignature(item); assert.equal(uploads, 1); assert.equal(notices.at(-1), '请先手写签名'); app.unmount()
})
test('inspection storage failure stays visible and exit message never claims it was saved', async () => {
 for (const file of [station, home]) {
  let fails = true, prompt
  const globals = Object.fromEntries(['editMode','submitted','workflowMode','workflowDirty','hasPendingLocalPhotos','draftRestored'].map(k => [k, vue.ref(false)]))
  Object.assign(globals, Object.fromEntries(['remark','weather','draftKey','draftStorageKey','clientSubmissionId','draftError'].map(k => [k, vue.ref('')])) )
  Object.assign(globals, { dirty: vue.ref(true), draftReady: vue.ref(true), template: vue.ref({ template_code: 'test' }), flatItems: vue.ref([]), automaticStartedAt: vue.ref(1), automaticEndedAt: vue.ref(0), currentStep: vue.ref(0), draftTimer: null, allowNextBack: false, initialProgressFingerprint: vue.ref('before'), progressFingerprint: () => 'after', buildDraft: () => ({ text: 'unsaved' }), uni: { setStorageSync() { if (fails) throw Error('quota') }, showModal(o) { prompt = o; o.success({ confirm: false }) } } })
  const leave = file === station ? 'handleBack' : 'confirmLeave'
  const api = functions(file, ['saveDraft', leave], globals)
  assert.equal(api.saveDraft(), false); assert.match(globals.draftError.value, /未能保存/)
  assert.equal(await api[leave](), false); assert.match(prompt.content, /保存失败/); assert.doesNotMatch(prompt.content, /已.*保存.*草稿/)
  fails = false; assert.equal(api.saveDraft(), true); assert.equal(globals.draftError.value, '')
  await api[leave](); assert.match(prompt.content, /已.*保存.*草稿/)
 }
})
for (const kind of ['Customer', 'Movement']) test(`${kind} query rejects stale/reset/unmounted results and pages with the submitted filter snapshot`, async () => {
 const jobs = [], notices = [], hooks = []
 const api = load(`src/components/domain/pda/Pda${kind}QueryView.vue`, 'runSearch,loadMore,resetSearch,list,paging,loading,' + (kind === 'Customer' ? 'keyword' : 'filters'), {
  onBeforeUnmount: fn => hooks.push(fn), defineProps: () => ({ initialBottleNo: '' }), defineEmits: () => () => {}, isPdaAppMode: () => true,
  listPdaCustomers: request, listBottleMovementsV1: request, normalizeBottleNo: v => v, uni: { showToast: o => notices.push(o.title) }
 })
 function request(params) { const job = deferred(); jobs.push({ ...job, params }); return job.promise }
 function keyword(v) { if (kind === 'Customer') api.keyword.value = v; else api.filters.bottleNo = v }
 function done(index, id, more = false) { jobs[index].resolve({ code: 0, data: [{ _id: id }], paging: { page: jobs[index].params.page, hasMore: more, total: 42 } }) }
 keyword('old'); const old = api.runSearch(); keyword('new'); const newer = api.runSearch(); done(1, 'new', true); await newer; done(0, 'old'); await old
 assert.equal(api.list.value[0]._id, 'new')
 keyword('not-submitted'); const next = api.loadMore(); await api.loadMore(); assert.equal(jobs.length, 3)
 assert.equal(jobs[2].params[kind === 'Customer' ? 'keyword' : 'bottleNo'], 'new'); assert.equal(jobs[2].params.page, 2)
 jobs[2].reject(Error('offline')); await next; assert.equal(api.list.value.length, 1); assert.equal(api.paging.value.page, 1)
 const retry = api.loadMore(); done(3, 'page2'); await retry; assert.equal(api.list.value.length, 2)
 const reset = api.runSearch(); api.resetSearch(); done(4, 'late-reset'); await reset; assert.equal(api.list.value.length, 0)
 const unmount = api.runSearch(); hooks.forEach(fn => fn()); jobs[5].reject(Error('late-error')); await unmount; assert.deepEqual(notices, ['offline'])
})
test('suggestions invalidate old responses immediately on typing, selection and blur', async () => {
 const jobs = [], timers = new Map(); let id = 0
 const { usePdaSuggestions } = load('src/composables/pda/usePdaSuggestions.js', 'usePdaSuggestions', { normalizeText: s => String(s || '').trim(), setTimeout: fn => { timers.set(++id, fn); return id }, clearTimeout: n => timers.delete(n) })
 const api = usePdaSuggestions({ fetcher: () => { const job = deferred(); jobs.push(job); return job.promise } })
 const old = api.fetchItems('old'); api.handleInput('new'); jobs[0].resolve(['old']); await old; assert.equal(api.visible.value, false)
 const second = api.fetchItems('new'); api.handleSelect('selected'); jobs[1].resolve(['new']); await second; assert.equal(api.visible.value, false); assert.equal(timers.size, 0)
 const third = api.fetchItems('blurred'); api.handleBlur(); [...timers.values()].forEach(fn => fn()); jobs[2].resolve(['blurred']); await third; assert.equal(api.visible.value, false)
})
test('shared query isolates accounts, rejects cancelled work and does not throttle different filters', async () => {
 let token = 'A', epoch = 0; const jobs = []
 const { useQuery } = load('src/composables/useQuery.js', 'useQuery', { getToken: () => token, getQueryEpoch: () => epoch })
 const scope = vue.effectScope(); const api = scope.run(() => useQuery(key => { const job = deferred(); jobs.push(job); return job.promise }, { immediate: false, cacheKey: key => key, cacheTTL: 30000, throttleMs: 500 }))
 const a = api.run('one'), b = api.run('two'); assert.equal(jobs.length, 2)
 jobs[1].resolve(['new']); await b; jobs[0].resolve(['old']); assert.equal(await a, undefined); assert.equal(api.data.value[0], 'new')
 const reset = api.run('reset'); api.reset(); jobs[2].resolve(['reset']); assert.equal(await reset, undefined); assert.equal(api.data.value, null)
 const original = api.run('secret'); jobs[3].resolve(['A-only']); await original
 token = 'B'; const foreign = api.run('secret'); assert.equal(jobs.length, 5); jobs[4].resolve(['B-only']); await foreign
 epoch++; const written = api.run('secret'); assert.equal(jobs.length, 6); jobs[5].resolve(['after-write']); await written
 const hidden = api.run('hidden'); scope.stop(); jobs[6].resolve(['hidden']); assert.equal(await hidden, undefined)
})
test('a late response from a previous login never opens auth alerts or logs out the new account', async () => {
 let token = 'old'; const jobs = [], alerts = []
 const { callCloud } = load('src/services/api/callCloud.js', 'callCloud', { getToken: () => token, handle401: () => alerts.push('401'), handle403: () => alerts.push('403'), console: { info() {} }, uniCloud: { callFunction: () => { const job = deferred(); jobs.push(job); return job.promise } } })
 const old = callCloud('crm-customer', { action: 'listV1' }); token = 'new'; jobs[0].resolve({ result: { code: 401 } })
 assert.equal((await old).code, 499); assert.equal(alerts.length, 0)
 const active = callCloud('crm-customer', { action: 'listV1' }); jobs[1].resolve({ result: { code: 403 } }); await active; assert.deepEqual(alerts, ['403'])
})
test('PDA QR caches are account scoped, bounded and discard responses after account changes', async () => {
 for (const type of ['bottle', 'customer']) {
  let token = 'A', reads = 0, wait = null
  const shared = load('src/services/pda/shared.js', 'normalizeText,normalizeBottleNo,normalizeQrCode,toNumber')
  const api = load(`src/services/pda/${type}.js`, type === 'bottle' ? 'resolvePdaBottleByQrCode,bottleQrCache,bottleNoCache' : 'resolvePdaCustomerByQrCode,customerQrCache', {
   ...shared, getToken: () => token, parseFillingLabel: () => null,
   resolveBottlePdaQrCodeV1: resolve, resolveCustomerQrCodeV1: resolve
  })
  function resolve() { reads++; return wait ? wait.promise : Promise.resolve({ code: 0, data: { bottle: { bottle_no: String(reads) }, customer: { _id: String(reads) } } }) }
  const run = api[type === 'bottle' ? 'resolvePdaBottleByQrCode' : 'resolvePdaCustomerByQrCode']
  await run('same'); await run('same'); assert.equal(reads, 1)
  token = 'B'; await run('same'); assert.equal(reads, 2)
  for (let i = 0; i < 105; i++) await run(`qr${i}`)
  assert.ok(api[type === 'bottle' ? 'bottleQrCache' : 'customerQrCache'].size <= 100)
  wait = deferred(); const late = run('late'); token = 'C'; wait.resolve({ code: 0, data: { bottle: { bottle_no: 'late' }, customer: { _id: 'late' } } }); assert.equal((await late).code, 499)
 }
})

test('customer suggestions omit unused summary and bottle scans while customer query keeps deposit counts', async () => {
 const shared = load('src/services/pda/shared.js', 'normalizeText,normalizeQrCode,toNumber'), requests = []
 const { listPdaCustomers } = load('src/services/pda/customer.js', 'listPdaCustomers', { ...shared, listCustomersV1: async params => { requests.push(params); return { code: 0, data: [] } } })
 await listPdaCustomers({ keyword: '客户', includeDeposit: false }); await listPdaCustomers({ keyword: '查询' })
 assert.equal(requests[0].includeSummary, false); assert.equal(requests[0].includeDeposit, false)
 assert.equal(requests[1].includeSummary, false); assert.equal(requests[1].includeDeposit, true)
})
test('caller-specific cancellation never cancels another identical cloud query', async () => {
 const jobs = []; let firstCurrent = true
 const { callCloud } = load('src/services/api/callCloud.js', 'callCloud', { getToken: () => 'same', handle401() {}, handle403() {}, console: { info() {} }, uniCloud: { callFunction: () => { const job = deferred(); jobs.push(job); return job.promise } } })
 const a = callCloud('crm-filling', { action: 'listV1', isResponseCurrent: () => firstCurrent })
 const b = callCloud('crm-filling', { action: 'listV1', isResponseCurrent: () => true })
 assert.equal(jobs.length, 2); firstCurrent = false
 jobs[0].resolve({ result: { code: 0 } }); jobs[1].resolve({ result: { code: 0 } })
 assert.equal((await a).code, 499); assert.equal((await b).code, 0)
})

test('inventory polling pauses in background and discards late success/error after leaving', async () => {
 const globals = { inventoryVisible: true, inventoryMounted: true, inventoryRevision: 0, inventoryRefreshRunning: false, freshnessTimer: null, inventoryRefreshTimer: null, document: { hidden: false }, clockNow: vue.ref(0), summary: { inventory: { current: { marker: 'preserved' } } } }
 const timers = new Set(), jobs = []
 Object.assign(globals, { setInterval: fn => { timers.add(fn); return fn }, clearInterval: fn => timers.delete(fn), console: { warn() {} }, getCurrentGasInventoryV1: () => { const job = deferred(); jobs.push(job); return job.promise } })
 const source = script('src/components/domain/gasIn/GasInListView.vue'), names = ['refreshCurrentInventory','stopInventoryPolling','startInventoryPolling','inventoryVisibilityChanged']
 const ast = require('@babel/parser').parse(source, { sourceType: 'module' })
 const code = ast.program.body.filter(n => n.type === 'FunctionDeclaration' && names.includes(n.id.name)).map(n => source.slice(n.start,n.end)).join('\n')
 vm.createContext(globals); vm.runInContext(code, globals)
 globals.startInventoryPolling(); globals.startInventoryPolling(); assert.equal(timers.size, 2)
 const old = globals.refreshCurrentInventory(); globals.document.hidden = true; globals.inventoryVisibilityChanged(); assert.equal(timers.size, 0)
 jobs[0].resolve({ code: 0, data: { current: { physical: {} } } }); await old; assert.equal(globals.summary.inventory.current.marker, 'preserved')
 await globals.refreshCurrentInventory(); assert.equal(jobs.length, 1)
 globals.document.hidden = false; globals.inventoryVisibilityChanged(); assert.equal(timers.size, 2); assert.equal(jobs.length, 2)
 globals.inventoryVisible = false; globals.stopInventoryPolling(); jobs[1].reject(Error('late')); await tick()
 assert.equal(globals.summary.inventory.current.marker, 'preserved'); assert.equal(timers.size, 0)
})
