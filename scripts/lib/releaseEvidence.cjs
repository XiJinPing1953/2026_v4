'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const PRODUCTS = {
	web: ['src', 'index.html', 'vite.config.js', 'package.json', 'package-lock.json', 'scripts/writeH5Version.cjs', 'scripts/lib/releaseEvidence.cjs'],
	cloud: ['uniCloud-alipay/cloudfunctions', 'uniCloud-alipay/database'],
	pda: ['src', 'nativeplugins', 'package.json', 'package-lock.json'],
	'tank-gateway': ['apps/tank-gateway', 'scripts/tankTelemetryCore.cjs', 'electron-builder.tank.yml', 'package.json', 'package-lock.json'],
	'filling-permit-gateway': ['apps/filling-permit-gateway', 'scripts/fillingPermitCore.cjs', 'uniCloud-alipay/cloudfunctions/crm-filling-permit-gateway', 'electron-builder.filling-permit.yml', 'package.json', 'package-lock.json']
}
const RELEASE_INPUTS = ['config/release-products.json', 'config/domain-contracts.json', 'scripts/releaseWeb.cjs',
	'scripts/buildWebWithCloudSpace.cjs', 'scripts/createReleaseManifest.cjs', 'scripts/checkReleaseIntegrity.cjs',
	'scripts/syncDomainContracts.cjs', 'scripts/syncPageAclRegistry.cjs', 'scripts/lib/releaseEvidence.cjs']
const IGNORED = new Set(['node_modules', '.git', '.DS_Store'])
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function listFiles(root, entries) {
	const files = []
	function visit(relative) {
		const absolute = path.join(root, relative)
		if (!fs.existsSync(absolute) || IGNORED.has(path.basename(relative))) return
		if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error(`发布输入不允许符号链接：${relative}`)
		if (fs.statSync(absolute).isDirectory()) {
			for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name))
		} else files.push(relative.split(path.sep).join('/'))
	}
	for (const entry of entries) visit(entry)
	return [...new Set(files)].sort()
}

function git(root, args) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function sourceEvidence(root, product) {
	if (!PRODUCTS[product]) throw new Error(`未知产品：${product}`)
	const entries = [...PRODUCTS[product], ...RELEASE_INPUTS]
	const files = listFiles(root, entries).map((file) => ({ path: file, sha256: sha256(fs.readFileSync(path.join(root, file))) }))
	const tracked = new Set(git(root, ['ls-files', '-z']).split('\0').filter(Boolean))
	const untrackedInputs = files.filter((item) => !tracked.has(item.path)).map((item) => item.path)
	const changedTracked = git(root, ['diff', 'HEAD', '--name-only', '--', ...entries]).split('\n').filter(Boolean)
	return {
		product,
		sourceCommit: git(root, ['rev-parse', 'HEAD']),
		sourceDigest: sha256(JSON.stringify(files)),
		sourceDirty: changedTracked.length > 0 || untrackedInputs.length > 0,
		untrackedInputs,
		changedTracked,
		files
	}
}

function assertReproducible(evidence) {
	if (evidence.sourceDirty) throw new Error(`发布源未形成已提交版本（${evidence.product}）：${[...evidence.changedTracked, ...evidence.untrackedInputs].join('、')}`)
}

function artifactEvidence(directory) {
	const files = listFiles(directory, ['.']).filter((file) => !['version.json', 'release-manifest.json'].includes(file))
	const artifacts = files.map((file) => ({ path: file, sha256: sha256(fs.readFileSync(path.join(directory, file))) }))
	return { artifactDigest: sha256(JSON.stringify(artifacts)), artifacts }
}

function buildVersion({ root, directory, product = 'web', spaceId = null, provider = null, now = new Date() }) {
	const source = sourceEvidence(root, product)
	return {
		schemaVersion: 2,
		product,
		buildId: `${now.getTime()}-${crypto.randomBytes(4).toString('hex')}`,
		generatedAt: now.toISOString(),
		sourceCommit: source.sourceCommit,
		sourceDigest: source.sourceDigest,
		sourceDirty: source.sourceDirty,
		artifactDigest: artifactEvidence(directory).artifactDigest,
		environment: spaceId ? { provider, spaceId } : null
	}
}

function verifyVersion(root, directory, product = 'web', { requireClean = true } = {}) {
	const version = JSON.parse(fs.readFileSync(path.join(directory, 'version.json'), 'utf8'))
	const source = sourceEvidence(root, product)
	if (requireClean) assertReproducible(source)
	if (version.schemaVersion !== 2 || version.product !== product) throw new Error('发布版本格式或产品标识不匹配')
	if (version.sourceCommit !== source.sourceCommit || version.sourceDigest !== source.sourceDigest || version.sourceDirty !== source.sourceDirty) throw new Error('发布产物对应的源码已经变化，请重新构建')
	if (version.artifactDigest !== artifactEvidence(directory).artifactDigest) throw new Error('发布产物内容与构建版本不匹配')
	return version
}

module.exports = { PRODUCTS, sha256, listFiles, sourceEvidence, assertReproducible, artifactEvidence, buildVersion, verifyVersion }
