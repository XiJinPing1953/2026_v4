'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { sync } = require('./syncDomainContracts.cjs')
const { sourceEvidence, assertReproducible, listFiles } = require('./lib/releaseEvidence.cjs')

function verifyRelativeDependencies(root) {
	const cloud = 'uniCloud-alipay/cloudfunctions'
	const missing = []
	for (const file of listFiles(root, [cloud]).filter((file) => /\.(c?js)$/.test(file))) {
		const directory = path.dirname(path.join(root, file))
		const text = fs.readFileSync(path.join(root, file), 'utf8')
		for (const match of text.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)) {
			const target = path.resolve(directory, match[1])
			if (!['', '.js', '.cjs', '.json', '/index.js'].some((suffix) => fs.existsSync(target + suffix))) missing.push(`${file}: ${match[1]}`)
		}
	}
	if (missing.length) throw new Error(`云函数本地依赖缺失：\n${missing.join('\n')}`)
}

function checkReleaseIntegrity({ root = path.resolve(__dirname, '..'), product = 'web', requireClean = false } = {}) {
	sync(root)
	execFileSync(process.execPath, [path.join(root, 'scripts/syncPageAclRegistry.cjs')], { cwd: root, stdio: 'pipe' })
	verifyRelativeDependencies(root)
	const source = sourceEvidence(root, product)
	if (requireClean) assertReproducible(source)
	return source
}

if (require.main === module) {
	try {
		const product = (process.argv.find((arg) => arg.startsWith('--product=')) || '--product=web').slice(10)
		const result = checkReleaseIntegrity({ product, requireClean: process.argv.includes('--require-clean') })
		console.log(`发布依赖检查通过：${product} source=${result.sourceCommit.slice(0, 12)} dirty=${result.sourceDirty}`)
	} catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { checkReleaseIntegrity, verifyRelativeDependencies }
