'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const stripImports = source => source.replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '')
function load(file, names, globals) {
  const source = stripImports(fs.readFileSync(path.join(root, file), 'utf8'))
    .replace(/^export /gm, '').replace(/\s*\/\/ #ifdef APP-PLUS[\s\S]*?\/\/ #endif/g, '')
  return vm.runInNewContext(`${source}\n;({${names.join(',')}})`, globals)
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function harness(options = {}) {
  const storage = new Map(), navigations = []
  let pages = options.pages || [{ route: 'pages/pda/sale-create', options: { customer_id: 'c1', customer_name: '测试地点' } }]
  let user = options.user || null, checks = 0
  const globals = {
    getCurrentPages: () => pages,
    clearAuth: () => { user = null },
    uni: {
      getStorageSync: key => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: key => storage.delete(key),
      reLaunch: async ({ url }) => {
        navigations.push(url)
        if (options.navigationGate) await options.navigationGate.promise
        pages = [{ route: url.split('?')[0].replace(/^\//, '') }]
      }
    }
  }
  const navigation = load('src/services/navigation.js', ['goLogin', 'setPendingLoginRedirect', 'getPendingLoginRedirect', 'consumePendingLoginRedirect'], globals)
  const canViewPage = (page, actor) => actor?.role === 'superadmin' || Boolean(actor?.allowedPages?.includes(page))
  const entry = load('src/services/pda/entry.js', ['normalizeAppPagePath', 'resolveHomePath', 'resolveLoginRedirectForRuntime', 'shouldRedirectToPreferredHome'], {
    normalizeText: value => String(value ?? '').trim(), canViewPage
  })
  const appSource = fs.readFileSync(path.join(root, 'src/App.vue'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  const app = vm.runInNewContext(`${stripImports(appSource).replace('export default', 'const app =')}\n;app`, {
    ...globals, ...navigation, ...entry, canViewPage, getUser: () => user,
    syncCurrentUser: async () => { checks++; return options.check ? options.check() : user ? { code: 0, user } : { code: 401 } },
    ensureLatestH5Bundle: async () => {}, restoreScannerProfile: async () => {}, console: { log() {} }
  })
  const instance = { ...app.methods }
  return { ...navigation, bootstrap: () => instance.bootstrapAuth(), navigations, checks: () => checks,
    setPages: value => { pages = value }, setUser: value => { user = value } }
}

test('late startup guards on login or an empty stack preserve the original sale deep link', async () => {
  const h = harness()
  await h.goLogin()
  const target = '/pages/pda/sale-create?customer_id=c1&customer_name=%E6%B5%8B%E8%AF%95%E5%9C%B0%E7%82%B9'
  assert.equal(h.getPendingLoginRedirect(), target)
  await h.bootstrap(); await h.bootstrap(); await h.goLogin()
  assert.equal(h.getPendingLoginRedirect(), target)
  assert.deepEqual(h.navigations, ['/pages/login/login'])
  h.setPages([]); await h.goLogin()
  assert.equal(h.getPendingLoginRedirect(), target)
})

test('explicit redirect replacement and explicit logout clearing remain available', async () => {
  const h = harness({ pages: [{ route: 'pages/login/login', options: { redirect: '/pages/pda/sale-create' } }] })
  h.setPendingLoginRedirect('/pages/pda/sale-create')
  await h.goLogin({ redirectUrl: '/pages/pda/home?from=login' })
  assert.equal(h.getPendingLoginRedirect(), '/pages/pda/home?from=login')
  await h.goLogin({ captureCurrent: false })
  assert.equal(h.getPendingLoginRedirect(), '')
  assert.equal(h.navigations.length, 0)
  h.setPendingLoginRedirect('/pages/pda/sale-create')
  h.setPendingLoginRedirect('/pages/login/login?redirect=x')
  assert.equal(h.getPendingLoginRedirect(), '')
})

test('authenticated login page restores permitted target before default home and concurrent startup does not overwrite it', async () => {
  const check = deferred(), navigationGate = deferred()
  const h = harness({ pages: [{ route: 'pages/login/login' }], user: { role: 'superadmin' }, check: () => check.promise, navigationGate })
  h.setPendingLoginRedirect('/pages/pda/sale-create?customer_id=c1')
  const first = h.bootstrap(), second = h.bootstrap()
  assert.equal(h.checks(), 1)
  check.resolve({ code: 0, user: { role: 'superadmin' } })
  await new Promise(resolve => setImmediate(resolve))
  const third = h.bootstrap()
  assert.equal(h.checks(), 1)
  assert.deepEqual(h.navigations, ['/pages/pda/sale-create?customer_id=c1'])
  navigationGate.resolve(); await Promise.all([first, second, third])
  assert.equal(h.getPendingLoginRedirect(), '')
  assert.equal(h.navigations.length, 1)
})

test('denied target falls back to account home without widening page permissions', async () => {
  const h = harness({ pages: [{ route: 'pages/login/login' }], user: { role: 'pda_operator', allowedPages: ['/pages/pda/home'] } })
  h.setPendingLoginRedirect('/pages/pda/sale-create')
  await h.bootstrap()
  assert.deepEqual(h.navigations, ['/pages/pda/home'])
  assert.equal(h.getPendingLoginRedirect(), '')
})

test('failed authentication check without a user does not consume pending destination', async () => {
  const h = harness({ pages: [{ route: 'pages/login/login' }], check: async () => ({ code: -1, msg: 'offline' }) })
  h.setPendingLoginRedirect('/pages/pda/sale-create')
  await h.bootstrap()
  assert.equal(h.getPendingLoginRedirect(), '/pages/pda/sale-create')
  assert.equal(h.navigations.length, 0)
})
