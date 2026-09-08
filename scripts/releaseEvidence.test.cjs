'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { sourceEvidence, assertReproducible, artifactEvidence, verifyVersion } = require('./lib/releaseEvidence.cjs')
const { writeVersion } = require('./writeH5Version.cjs')
const { verifySourceEntry, verifyRemoteRelease } = require('./releaseWeb.cjs')
const { sync } = require('./syncDomainContracts.cjs')

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-release-test-'))
	t.after(() => fs.rmSync(root, { recursive: true, force: true }))
	const write = (file, content) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), content) }
	write('src/main.js', 'export const value = 1\n')
	write('index.html', '<script type="module" src="/src/main.js"></script>')
	write('.gitignore', 'dist\n')
	const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
	git('init'); git('add', '.'); git('-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'fixture')
	for (const out of ['h5', 'web']) {
		write(`dist/build/${out}/index.html`, '<script type="module" src="/assets/main.js"></script>')
		write(`dist/build/${out}/assets/main.js`, 'export const build = 1\n')
	}
	return { root, write, git }
}

test('rejects untracked cloud dependencies and dirty source even when HEAD exists', (t) => {
	const { root, write } = fixture(t)
	assertReproducible(sourceEvidence(root, 'web'))
	write('src/new-helper.js', 'export const a = true')
	assert.throws(() => assertReproducible(sourceEvidence(root, 'web')), /new-helper/)
})

test('stamps only selected output and rejects stale source or modified artifact', (t) => {
	const { root, write } = fixture(t)
	const web = path.join(root, 'dist/build/web')
	writeVersion({ root, directory: web })
	const old = fs.readFileSync(path.join(web, 'version.json'), 'utf8')
	writeVersion({ root })
	assert.equal(fs.readFileSync(path.join(web, 'version.json'), 'utf8'), old)
	verifyVersion(root, web)
	write('dist/build/web/assets/main.js', 'changed')
	assert.throws(() => verifyVersion(root, web), /产物内容/)
	write('dist/build/web/assets/main.js', 'export const build = 1\n')
	write('src/main.js', 'changed')
	assert.throws(() => verifyVersion(root, web, 'web', { requireClean: false }), /源码已经变化/)
})

test('rejects gateway HTML in CRM root entry', (t) => {
	const { root, write } = fixture(t)
	verifySourceEntry(root)
	write('index.html', '<title>新拓储罐网关</title>')
	assert.throws(() => verifySourceEntry(root), /不是 CRM/)
})

test('remote verification detects old version and changed entry bytes', async (t) => {
	const { root } = fixture(t)
	const directory = path.join(root, 'dist/build/web')
	const version = writeVersion({ root, directory })
	const serve = (override = {}) => async (url) => {
		const name = new URL(url).pathname.slice(1)
		const bytes = override[name] ?? fs.readFileSync(path.join(directory, name))
		return new Response(bytes)
	}
	const ok = await verifyRemoteRelease({ directory, baseUrl: 'https://example.invalid', fetchImpl: serve() })
	assert.equal(ok.status, 'version_verified')
	await assert.rejects(verifyRemoteRelease({ directory, baseUrl: 'https://example.invalid', fetchImpl: serve({ 'version.json': JSON.stringify({ ...version, buildId: 'old' }) }) }), /线上版本未匹配/)
	await assert.rejects(verifyRemoteRelease({ directory, baseUrl: 'https://example.invalid', fetchImpl: serve({ 'assets/main.js': 'old body' }) }), /线上资源未匹配/)
})

test('domain and schema check fails on semantic drift, then explicit sync fixes it', (t) => {
	const { root, write } = fixture(t)
	write('config/domain-contracts.json', JSON.stringify({ copies: [{ source: 'canonical.js', targets: ['local.js'] }] }))
	write('canonical.js', 'correct'); write('local.js', 'old')
	write('uniCloud-alipay/database/demo.schema.json', '{"required":["new"]}')
	write('uniCloud-alipay/database/schema/demo.schema.json', '{"required":["old"]}')
	assert.throws(() => sync(root), /不一致/)
	assert.equal(sync(root, true).length, 2)
	assert.deepEqual(sync(root), [])
})

test('release evidence excludes its own manifest and version from artifact digest', (t) => {
	const { root, write } = fixture(t)
	const dir = path.join(root, 'dist/build/web')
	const before = artifactEvidence(dir).artifactDigest
	write('dist/build/web/release-manifest.json', '{}')
	writeVersion({ root, directory: dir })
	assert.equal(artifactEvidence(dir).artifactDigest, before)
})

test('release configuration and scripts are part of the committed source evidence', (t) => {
	const { root, write } = fixture(t)
	write('config/release-products.json', '{"environment":{"spaceId":"other"}}')
	assert.throws(() => assertReproducible(sourceEvidence(root, 'web')), /release-products/)
	write('scripts/releaseWeb.cjs', 'target = "other"')
	assert.throws(() => assertReproducible(sourceEvidence(root, 'web')), /releaseWeb/)
})

test('remote verification rejects a missing or stale lazy chunk and CSS', async (t) => {
	const { root, write } = fixture(t)
	write('dist/build/web/assets/lazy.js', 'lazy build')
	write('dist/build/web/assets/main.css', 'body { color: black }')
	const directory = path.join(root, 'dist/build/web')
	writeVersion({ root, directory })
	for (const broken of ['assets/lazy.js', 'assets/main.css']) {
		await assert.rejects(verifyRemoteRelease({ directory, baseUrl: 'https://example.invalid', fetchImpl: async (url) => {
			const file = new URL(url).pathname.slice(1)
			return new Response(file === broken ? 'old bytes' : fs.readFileSync(path.join(directory, file)))
		} }), /线上资源未匹配/)
	}
})

test('cloud manifest requires explicit deployment scope and excludes init data from database changes', (t) => {
	const { createManifest } = require('./createReleaseManifest.cjs')
	const { root, write } = fixture(t)
	write('config/domain-contracts.json', JSON.stringify({ copies: [], promotedSchemas: [] }))
	write('scripts/syncPageAclRegistry.cjs', '')
	write('uniCloud-alipay/cloudfunctions/crm-test/index.js', 'exports.main = () => {}')
	write('uniCloud-alipay/database/demo.schema.json', '{}')
	write('uniCloud-alipay/database/demo.init_data.json', '[{"private":true}]')
	const config = { environment: { spaceId: 'test' }, products: { cloud: { version: 'test', output: 'release/cloud', deploymentScope: { functions: ['crm-test'], databaseFiles: ['demo.schema.json'] } } } }
	write('config/release-products.json', JSON.stringify(config))
	const manifest = createManifest({ root, product: 'cloud', requireClean: false })
	assert.equal(manifest.functions.length, 1)
	assert.equal(manifest.databaseChanges.length, 1)
	assert.equal(manifest.databaseChanges[0].kind, 'schema')
	config.products.cloud.deploymentScope.databaseFiles.push('demo.init_data.json')
	write('config/release-products.json', JSON.stringify(config))
	assert.throws(() => createManifest({ root, product: 'cloud', requireClean: false }), /禁止初始化数据/)
})

test('cloud manifest rejects a committed function whose required helper is missing', (t) => {
	const { createManifest } = require('./createReleaseManifest.cjs')
	const { root, write, git } = fixture(t)
	write('config/domain-contracts.json', JSON.stringify({ copies: [], promotedSchemas: [] }))
	write('config/release-products.json', JSON.stringify({
		environment: { spaceId: 'test' },
		products: { cloud: { version: 'test', output: 'release/cloud', deploymentScope: { functions: ['crm-test'], databaseFiles: [] } } }
	}))
	write('scripts/syncPageAclRegistry.cjs', '')
	write('uniCloud-alipay/database/demo.schema.json', '{}')
	write('uniCloud-alipay/cloudfunctions/crm-test/index.js', "require('./requiredHelper')\nexports.main = () => {}\n")
	git('add', '.')
	git('-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'broken cloud source')
	assert.throws(() => createManifest({ root, product: 'cloud' }), /云函数本地依赖缺失.*requiredHelper/s)
})
