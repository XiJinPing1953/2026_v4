'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { sync } = require('./syncDomainContracts.cjs')
const { sourceEvidence, assertReproducible, listFiles } = require('./lib/releaseEvidence.cjs')
const { resolveReleaseScope } = require('./lib/releaseScope.cjs')

function verifyRelativeDependencies(root, scope = null) {
	const cloud = 'uniCloud-alipay/cloudfunctions'
	const missing = []
	const entries = scope ? scope.functions.map((name) => `${cloud}/${name}`) : [cloud]
	for (const file of listFiles(root, entries).filter((file) => /\.(c?js)$/.test(file))) {
		const directory = path.dirname(path.join(root, file))
		const text = fs.readFileSync(path.join(root, file), 'utf8')
		for (const match of text.matchAll(/require\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
			const target = path.resolve(directory, match[1])
			if (!['', '.js', '.cjs', '.json', '/index.js'].some((suffix) => fs.existsSync(target + suffix))) missing.push(`${file}: ${match[1]}`)
			// Legacy packages try the shared ACL then use a shipped local fallback.
			// Other parent-directory imports make the package non-independent.
			if (scope && match[1].startsWith('../') && !(match[1] === '../common/pageAcl' && /require\s*\(\s*['"]\.\/pageAclLocal['"]\s*\)/.test(text))) missing.push(`${file}: 包外依赖 ${match[1]}`)
		}
	}
	if (missing.length) throw new Error(`云函数本地依赖缺失：\n${missing.join('\n')}`)
}

function checkReleaseIntegrity({ root = path.resolve(__dirname, '..'), product = 'web', requireClean = false, scope } = {}) {
	const selected = resolveReleaseScope(root, product, scope)
	sync(root, false, selected)
	execFileSync(process.execPath, [path.join(root, 'scripts/syncPageAclRegistry.cjs'), ...(selected ? [`--functions=${selected.functions.join(',')}`] : [])], { cwd: root, stdio: 'pipe' })
	verifyRelativeDependencies(root, selected)
	const source = sourceEvidence(root, product)
	source.integrityScope = selected || 'all'
	if (requireClean) assertReproducible(source)
	return source
}

if (require.main === module) {
	try {
		const product = (process.argv.find((arg) => arg.startsWith('--product=')) || '--product=web').slice(10)
		const scope = process.argv.find((arg) => arg.startsWith('--scope='))?.slice(8)
		const result = checkReleaseIntegrity({ product, scope, requireClean: process.argv.includes('--require-clean') })
		console.log(`发布依赖检查通过：${product} source=${result.sourceCommit.slice(0, 12)} dirty=${result.sourceDirty}`)
	} catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { checkReleaseIntegrity, verifyRelativeDependencies }
