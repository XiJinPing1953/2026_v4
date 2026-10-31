'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const json5 = require('json5')
const { initPreContext, preJson, preJs, preHtml } = require('@dcloudio/uni-cli-shared/dist/preprocess')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function routes(platform) {
  initPreContext(platform)
  return json5.parse(preJson(read('src/pages.json'))).pages.map(page => '/' + page.path)
}
function entry(platform) {
  initPreContext(platform)
  const source = preJs(read('src/services/pda/entry.js')).replace(/^import .*\n/gm, '').replace(/^export /gm, '')
  return vm.runInNewContext(source + '\n;({ isNativeAppPagePath, resolveLoginRedirectForRuntime, shouldRedirectToPreferredHome })', {
    normalizeText: value => String(value ?? '').trim(),
    canViewPage: (page, user) => user.role === 'superadmin' || user.pages?.includes(page)
  })
}
test('native routes retain all PDA, inspection and shared bottle timeline entries; web keeps its complete route list', () => {
  const original = json5.parse(read('src/pages.json')).pages.map(page => '/' + page.path)
  assert.deepEqual(routes('h5'), original)
  const native = routes('app-plus'), api = entry('app-plus')
  assert.ok(native.length < original.length)
  for (const page of original) {
    assert.equal(api.isNativeAppPagePath(page), native.includes(page), page)
    if (/^\/pages\/(pda|.*safety.*)\//.test(page)) assert.ok(native.includes(page), page)
  }
  for (const page of ['/pages/login/login', '/pages/index/index', '/pages/public/filling-label', '/pages/bottle/timeline']) assert.ok(native.includes(page), page)
  assert.equal(api.isNativeAppPagePath('/pages/pda/does-not-exist'), false)
})
test('native stale web redirects fall back to the app home; browser links, permitted native queries and account restrictions survive', () => {
  const native = entry('app-plus'), browser = entry('h5'), admin = { role: 'superadmin' }
  assert.equal(native.resolveLoginRedirectForRuntime('/pages/sale/detail?id=123', admin), '')
  assert.equal(native.shouldRedirectToPreferredHome('/pages/sale/detail', admin), true)
  assert.equal(browser.resolveLoginRedirectForRuntime('/pages/sale/detail?id=123', admin), '/pages/sale/detail?id=123')
  for (const target of ['/pages/pda/sale-create?customer_id=123', '/pages/bottle/timeline?bottle_no=22', '/pages/station-safety-inspection/detail?id=123']) {
    assert.equal(native.resolveLoginRedirectForRuntime(target, admin), target)
    assert.equal(native.shouldRedirectToPreferredHome(target, admin), false)
  }
  assert.equal(native.resolveLoginRedirectForRuntime('/pages/pda/reweigh', { role: 'pda_operator', pages: [] }), '')
  assert.equal(native.resolveLoginRedirectForRuntime('/pages/pda/reweigh', { role: 'safety_inspector' }), '')
  assert.equal(native.resolveLoginRedirectForRuntime('/pages/safety-management/daily?date=2026-10-31', { role: 'safety_inspector' }), '/pages/safety-management/daily?date=2026-10-31')
})
test('native startup excludes the desktop dashboard import and render; browser retains both', () => {
  const source = read('src/pages/index/index.vue')
  for (const platform of ['app-plus', 'h5']) {
    initPreContext(platform)
    const script = preJs(source.match(/<script setup>([\s\S]*?)<\/script>/)[1])
    const template = preHtml(source.match(/<template>([\s\S]*?)<\/template>/)[1])
    assert.equal(/import DashboardHome/.test(script), platform === 'h5')
    assert.equal(/<DashboardHome/.test(template), platform === 'h5')
  }
})
test('retained component graph has no literal navigation to an excluded page', () => {
  const native = new Set(routes('app-plus')), visited = new Set()
  const queue = [...native].map(page => 'src' + page + '.vue')
  const excluded = []
  while (queue.length) {
    const file = queue.pop()
    if (visited.has(file)) continue
    visited.add(file)
    initPreContext('app-plus')
    const source = preHtml(preJs(read(file)))
    // ACL registries intentionally describe all products, including web-only pages.
    if (!/services\/(pageAcl|pda\/entry)/.test(file)) {
      for (const match of source.matchAll(/['"`]((?:\/pages\/)[a-z0-9/-]+)(?:[?'"`])/g)) {
        if (!native.has(match[1])) excluded.push(file + ': ' + match[1])
      }
    }
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([@.][^'"]+)['"]/g)) {
      const spec = match[1]
      const base = spec.startsWith('@/') ? 'src/' + spec.slice(2) : path.join(path.dirname(file), spec)
      const resolved = ['', '.js', '.vue', '/index.js'].map(ext => base + ext).find(candidate => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile())
      if (resolved && /\.(js|vue)$/.test(resolved)) queue.push(resolved)
    }
  }
  assert.deepEqual(excluded, [])
})
