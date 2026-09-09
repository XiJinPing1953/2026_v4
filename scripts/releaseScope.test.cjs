'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const RELEASE_TREE = path.resolve(__dirname, '..')
const { resolveReleaseScope } = require(path.join(RELEASE_TREE, 'scripts/lib/releaseScope.cjs'))

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-scope-counterexample-'))
	t.after(() => fs.rmSync(root, { recursive: true, force: true }))
	const write = (file, content) => {
		const target = path.join(root, file)
		fs.mkdirSync(path.dirname(target), { recursive: true })
		fs.writeFileSync(target, content)
	}
	const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
	git('init')
	write('.gitignore', 'release\ndist\n')
	write('package.json', '{"dependencies":{"example":"1"}}\n')
	write('package-lock.json', '{}\n')
	write('src/accounting.js', 'export const version = 1\n')
	write('uniCloud-alipay/cloudfunctions/crm-target/index.js', "require('./retained')\n")
	write('uniCloud-alipay/cloudfunctions/crm-target/retained.js', 'module.exports = true\n')
	write('uniCloud-alipay/cloudfunctions/crm-other/index.js', 'exports.main = () => {}\n')
	write('uniCloud-alipay/database/unchanged.schema.json', '{}\n')
	git('add', '.')
	git('-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'baseline')
	return { root, write, git, baseCommit: git('rev-parse', 'HEAD') }
}

function writeScope(write, { baseCommit, sourceFiles }) {
	write('config/release-products.json', JSON.stringify({
		products: {
			cloud: {
				integrityScope: 'deployment',
				deploymentScope: {
					functions: ['crm-target'],
					databaseFiles: [],
					baseCommit,
					sourceFiles
				}
			}
		}
	}))
}

test('exact deployment source scope rejects smuggling, omissions, retained-package edits and a wrong base', (t) => {
	const { root, write, git, baseCommit } = fixture(t)
	write('src/accounting.js', 'export const version = 2\n')
	writeScope(write, { baseCommit, sourceFiles: ['src/accounting.js'] })
	assert.deepEqual(resolveReleaseScope(root, 'cloud'), { functions: ['crm-target'], databaseFiles: [], baseCommit, sourceFiles: ['src/accounting.js'] })
	write('package.json', '{"dependencies":{"example":"2"}}\n')
	assert.throws(() => resolveReleaseScope(root, 'cloud'), /未授权变更依赖/)
	write('package.json', '{"dependencies":{"example":"1"},"scripts":{"build":"node build"}}\n')
	assert.doesNotThrow(() => resolveReleaseScope(root, 'cloud'))
	write('package-lock.json', '{"changed":true}\n')
	assert.throws(() => resolveReleaseScope(root, 'cloud'), /清单外.*package-lock/)
	write('package-lock.json', '{}\n')

	write('src/smuggled.js', 'export const smuggled = true\n')
	assert.throws(() => resolveReleaseScope(root, 'cloud'), /清单外.*src\/smuggled\.js/)
	fs.rmSync(path.join(root, 'src/smuggled.js'))

	write('uniCloud-alipay/cloudfunctions/crm-target/retained.js', 'module.exports = false\n')
	assert.throws(() => resolveReleaseScope(root, 'cloud'), /清单外.*retained\.js/)
	write('uniCloud-alipay/cloudfunctions/crm-target/retained.js', 'module.exports = true\n')

	write('src/accounting.js', 'export const version = 1\n')
	assert.throws(() => resolveReleaseScope(root, 'cloud'), /清单中未变化.*src\/accounting\.js/)
	write('src/accounting.js', 'export const version = 2\n')

	const tree = git('write-tree')
	const wrongBase = execFileSync('git', ['commit-tree', tree, '-m', 'unrelated root'], {
		cwd: root,
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Release Test',
			GIT_AUTHOR_EMAIL: 'release-test@example.invalid',
			GIT_COMMITTER_NAME: 'Release Test',
			GIT_COMMITTER_EMAIL: 'release-test@example.invalid'
		}
	}).trim()
	assert.match(wrongBase, /^[0-9a-f]{40}$/)
	writeScope(write, { baseCommit: wrongBase, sourceFiles: ['src/accounting.js'] })
	assert.throws(() => resolveReleaseScope(root, 'cloud'))
})

test('real ACL scope rejects selected drift, ignores unselected drift locally, and preserves full-repo failure', (t) => {
	const { root, write } = fixture(t)
	const aclScript = fs.readFileSync(path.join(RELEASE_TREE, 'scripts/syncPageAclRegistry.cjs'))
	write('scripts/syncPageAclRegistry.cjs', aclScript)
	write('uniCloud-alipay/cloudfunctions/common/pageAcl.js', 'module.exports = { acl: true }\n')
	write('uniCloud-alipay/cloudfunctions/common/pageAclRegistry.js', 'module.exports = { registry: true }\n')
	for (const name of ['crm-target', 'crm-other']) {
		write(`uniCloud-alipay/cloudfunctions/${name}/pageAclLocal.js`, 'module.exports = { acl: true }\n')
		write(`uniCloud-alipay/cloudfunctions/${name}/pageAclRegistry.js`, 'module.exports = { registry: true }\n')
		write(`uniCloud-alipay/cloudfunctions/${name}/pageAclRegistryLocal.js`, 'module.exports = { registry: true }\n')
	}
	const run = (args = []) => execFileSync(process.execPath, [path.join(root, 'scripts/syncPageAclRegistry.cjs'), ...args], {
		cwd: root,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	})
	assert.doesNotThrow(() => run(['--functions=crm-target']))

	write('uniCloud-alipay/cloudfunctions/crm-target/pageAclRegistryLocal.js', 'selected drift\n')
	assert.throws(() => run(['--functions=crm-target']), /Command failed/)
	write('uniCloud-alipay/cloudfunctions/crm-target/pageAclRegistryLocal.js', 'module.exports = { registry: true }\n')

	write('uniCloud-alipay/cloudfunctions/crm-other/pageAclRegistryLocal.js', 'unselected drift\n')
	assert.doesNotThrow(() => run(['--functions=crm-target']))
	assert.throws(() => run(), /Command failed/)
})

test('production ACL compatibility pins historical canonical bytes without weakening the default check', (t) => {
	const { root, write, git } = fixture(t)
	for (const file of ['scripts/syncPageAclRegistry.cjs', 'scripts/lib/releaseScope.cjs']) write(file, fs.readFileSync(path.join(RELEASE_TREE, file)))
	const helper = 'module.exports = { acl: "production" }\n'
	const registry = 'module.exports = { registry: "production" }\n'
	write('uniCloud-alipay/cloudfunctions/common/pageAcl.js', helper)
	write('uniCloud-alipay/cloudfunctions/common/pageAclRegistry.js', registry)
	git('add', '.')
	git('-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'production ACL canonical source')
	const commit = git('rev-parse', 'HEAD')
	const pin = (content) => ({ commit, sha256: crypto.createHash('sha256').update(content).digest('hex') })
	const revisions = { 'crm-target': { helper: pin(helper), registry: pin(registry) } }
	const config = (aclCanonicalRevisions = revisions) => write('config/release-products.json', JSON.stringify({ products: { cloud: {
		integrityScope: 'deployment', deploymentScope: { functions: ['crm-target'], databaseFiles: [], aclCanonicalRevisions }
	} } }))
	config()
	write('uniCloud-alipay/cloudfunctions/common/pageAcl.js', 'module.exports = { acl: "new" }\n')
	write('uniCloud-alipay/cloudfunctions/common/pageAclRegistry.js', 'module.exports = { registry: "new" }\n')
	write('uniCloud-alipay/cloudfunctions/crm-target/pageAclLocal.js', helper)
	write('uniCloud-alipay/cloudfunctions/crm-target/pageAclRegistry.js', registry)
	write('uniCloud-alipay/cloudfunctions/crm-target/pageAclRegistryLocal.js', registry)
	const args = ['--functions=crm-target', '--release-compatibility']
	const run = (options = args) => execFileSync(process.execPath, [path.join(root, 'scripts/syncPageAclRegistry.cjs'), ...options], {
		cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
	})
	assert.doesNotThrow(() => run())
	assert.throws(() => run([]), /Command failed/)
	assert.throws(() => run(['--functions=crm-target']), /Command failed/)
	assert.throws(() => run(['--release-compatibility']), /仅允许/)
	assert.throws(() => run([...args, '--write']), /只读/)
	assert.throws(() => run(['--functions=crm-other', '--release-compatibility']), /范围不一致/)
	for (const [file, content] of [['pageAclLocal.js', helper], ['pageAclRegistry.js', registry], ['pageAclRegistryLocal.js', registry]]) {
		fs.rmSync(path.join(root, 'uniCloud-alipay/cloudfunctions/crm-target', file))
		assert.throws(() => run(), /Command failed/, `missing pinned file: ${file}`)
		write(`uniCloud-alipay/cloudfunctions/crm-target/${file}`, content)
	}

	write('uniCloud-alipay/cloudfunctions/crm-target/pageAclRegistryLocal.js', 'unexpected content\n')
	assert.throws(() => run(), /Command failed/)
	write('uniCloud-alipay/cloudfunctions/crm-target/pageAclRegistryLocal.js', registry)
	config({ 'crm-target': { helper: pin(helper), registry: { ...pin(registry), sha256: '0'.repeat(64) } } })
	assert.throws(() => run(), /哈希不匹配/)
	config({ 'crm-target': { registry: { ...pin(registry), commit: '0'.repeat(40) } } })
	assert.throws(() => run(), /Command failed/)
	config({ 'crm-other': revisions['crm-target'] })
	assert.throws(() => run(), /超出发布函数范围/)
	config({ 'crm-target': { registry: null } })
	assert.throws(() => run(), /历史来源无效/)
	config()
	assert.doesNotThrow(() => run())
})
