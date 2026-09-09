'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const RUNTIME_ROOTS = ['src', 'uniCloud-alipay/cloudfunctions', 'uniCloud-alipay/database', 'index.html', 'vite.config.js', 'package-lock.json', 'nativeplugins', 'apps']

function resolveReleaseScope(root, product, requested) {
	const file = path.join(root, 'config/release-products.json')
	const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
	const mode = requested || config.products?.[product]?.integrityScope || 'all'
	if (mode === 'all') return null
	if (mode !== 'deployment') throw new Error(`未知发布检查范围：${mode}`)
	const scope = config.products?.cloud?.deploymentScope
	if (!scope?.functions?.length || !Array.isArray(scope.databaseFiles)) throw new Error('范围检查必须明确函数和数据库清单')
	if (new Set(scope.functions).size !== scope.functions.length || new Set(scope.databaseFiles).size !== scope.databaseFiles.length) throw new Error('发布范围存在重复项')
	for (const name of scope.functions) {
		if (!/^[a-zA-Z0-9_-]+$/.test(name) || name === 'common' || !fs.existsSync(path.join(root, 'uniCloud-alipay/cloudfunctions', name, 'index.js'))) throw new Error(`无效云函数范围：${name}`)
	}
	for (const name of scope.databaseFiles) {
		if (!/^[a-zA-Z0-9_-]+\.(schema|index)\.json$/.test(name) || !fs.existsSync(path.join(root, 'uniCloud-alipay/database', name))) throw new Error(`无效数据库范围：${name}`)
	}
	const aclRevisions = scope.aclCanonicalRevisions || {}
	if (typeof aclRevisions !== 'object' || Array.isArray(aclRevisions)) throw new Error('ACL 历史来源必须按函数声明')
	for (const [name, versions] of Object.entries(aclRevisions)) {
		if (!scope.functions.includes(name)) throw new Error(`ACL 兼容版本超出发布函数范围：${name}`)
		if (!versions || typeof versions !== 'object' || Array.isArray(versions) || !Object.keys(versions).length) throw new Error(`ACL 历史来源无效：${name}`)
		for (const [kind, revision] of Object.entries(versions)) {
			if (!revision || !['helper', 'registry'].includes(kind) || !/^[0-9a-f]{40}$/.test(revision.commit || '') || !/^[0-9a-f]{64}$/.test(revision.sha256 || '')) throw new Error(`ACL 历史来源无效：${name}.${kind}`)
		}
	}
	if (scope.baseCommit || scope.sourceFiles) {
		if (!/^[0-9a-f]{40}$/.test(scope.baseCommit || '') || !Array.isArray(scope.sourceFiles) || !scope.sourceFiles.length) throw new Error('独立发布必须同时指定完整基线提交和源码清单')
		if (new Set(scope.sourceFiles).size !== scope.sourceFiles.length || scope.sourceFiles.some((file) => typeof file !== 'string' || file.includes('..') || path.isAbsolute(file))) throw new Error('独立发布源码清单无效')
		const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
		git(['merge-base', '--is-ancestor', scope.baseCommit, 'HEAD'])
		if (fs.existsSync(path.join(root, 'package.json'))) {
			const previous = JSON.parse(git(['show', `${scope.baseCommit}:package.json`]))
			const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
			for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides', 'resolutions', 'engines', 'packageManager']) {
				if (JSON.stringify(previous[key]) !== JSON.stringify(current[key])) throw new Error(`独立发布未授权变更依赖：package.json.${key}`)
			}
		}
		const changed = git(['diff', '--name-only', scope.baseCommit, '--', ...RUNTIME_ROOTS]).split('\n').filter(Boolean)
		const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...RUNTIME_ROOTS]).split('\n').filter(Boolean)
		const actual = [...new Set([...changed, ...untracked])].sort()
		const expected = [...scope.sourceFiles].sort()
		if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`发布源码范围不匹配；清单外：${actual.filter((f) => !expected.includes(f)).join('、')}；清单中未变化：${expected.filter((f) => !actual.includes(f)).join('、')}`)
		const databaseChanges = actual.filter((f) => f.startsWith('uniCloud-alipay/database/')).map((f) => f.slice('uniCloud-alipay/database/'.length))
		if (databaseChanges.some((f) => !scope.databaseFiles.includes(f))) throw new Error('数据库源码变化未列入发布范围')
	}
	return { functions: [...scope.functions], databaseFiles: [...scope.databaseFiles], ...(scope.baseCommit ? { baseCommit: scope.baseCommit, sourceFiles: [...scope.sourceFiles] } : {}), ...(Object.keys(aclRevisions).length ? { aclCanonicalRevisions: aclRevisions } : {}) }
}
module.exports = { resolveReleaseScope }
