#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { checkReleaseIntegrity } = require('./checkReleaseIntegrity.cjs')
const { verifyVersion, sha256, artifactEvidence } = require('./lib/releaseEvidence.cjs')
const { createManifest } = require('./createReleaseManifest.cjs')

const REPO_ROOT = path.resolve(__dirname, '..')
const HBUILDERX_CLI = '/Applications/HBuilderX.app/Contents/MacOS/cli'
const PROJECT_NAME = path.basename(REPO_ROOT)
const PROVIDER = 'alipay'
const SPACE_ID = 'env-00jxuffegf2n'
const WEB_TITLE = '新拓能源'
const OUTPUT_DIR = path.join(REPO_ROOT, 'dist', 'build', 'web')

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: REPO_ROOT,
		stdio: 'inherit'
	})
	if (result.error) throw result.error
	if (result.status !== 0) {
		throw new Error(`${path.basename(command)} 执行失败，退出码 ${result.status}`)
	}
}

function readEntryScript(indexHtml) {
	const match =
		indexHtml.match(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/i) ||
		[]
	return match[1] || ''
}

function verifySourceEntry(projectRoot = REPO_ROOT) {
	const indexPath = path.join(projectRoot, 'index.html')
	if (!fs.existsSync(indexPath)) {
		throw new Error('发布已停止：项目根目录缺少 index.html')
	}
	const source = fs.readFileSync(indexPath, 'utf8')
	if (!source.includes('/src/main.js') && !source.includes('./src/main.js')) {
		throw new Error(
			'发布已停止：根 index.html 不是 CRM 的 uni-app 入口，请不要把储罐网关 HTML 放在项目根目录'
		)
	}
	if (source.includes('新拓储罐网关') || source.includes('apps/tank-gateway')) {
		throw new Error('发布已停止：检测到储罐网关页面混入 CRM 根入口')
	}
	console.log('[release:web] CRM 根入口校验通过')
}

function verifyUniCloudSpace(outputDir = OUTPUT_DIR) {
	const indexPath = path.join(outputDir, 'index.html')
	if (!fs.existsSync(indexPath)) {
		throw new Error(`发布已停止：缺少 ${path.relative(REPO_ROOT, indexPath)}`)
	}
	const indexHtml = fs.readFileSync(indexPath, 'utf8')
	const entryScript = readEntryScript(indexHtml)
	if (!entryScript) {
		throw new Error('发布已停止：未在 index.html 中找到入口脚本')
	}
	const entryPath = path.join(outputDir, entryScript.replace(/^\/+/, ''))
	if (!fs.existsSync(entryPath)) {
		throw new Error(`发布已停止：缺少入口脚本 ${entryScript}`)
	}
	const source = fs.readFileSync(entryPath, 'utf8')
	if (!source.includes(SPACE_ID)) {
		throw new Error(
			`发布已停止：构建包没有关联 uniCloud 空间 ${SPACE_ID}，不会上传到线上`
		)
	}
	console.log(`[release:web] uniCloud 空间校验通过：${SPACE_ID}`)
	return { indexPath, entryPath }
}

function buildWeb() {
	verifySourceEntry()
	checkReleaseIntegrity({ product: 'web', requireClean: true })
	run(HBUILDERX_CLI, [
		'cloud',
		'functions',
		'--prj',
		PROJECT_NAME,
		'--provider',
		PROVIDER,
		'--assignspace',
		SPACE_ID
	])
	run(HBUILDERX_CLI, [
		'publish',
		'web',
		'--project',
		REPO_ROOT,
		'--webTitle',
		WEB_TITLE,
		'--webHosting',
		'false',
		'--provider',
		PROVIDER,
		'--spaceId',
		SPACE_ID
	])
	run(process.execPath, [path.join(REPO_ROOT, 'scripts', 'writeH5Version.cjs'), `--output-dir=${OUTPUT_DIR}`, `--space-id=${SPACE_ID}`])
	verifyUniCloudSpace()
}

function deployWeb() {
	run(HBUILDERX_CLI, [
		'hosting',
		'deploy',
		'--prj',
		PROJECT_NAME,
		'--space',
		SPACE_ID,
		'--provider',
		PROVIDER,
		'--source',
		path.relative(REPO_ROOT, OUTPUT_DIR)
	])
}

async function verifyRemoteRelease({ directory = OUTPUT_DIR, baseUrl = `https://${SPACE_ID}-static.normal.cloudstatic.cn`, fetchImpl = fetch } = {}) {
	const expected = JSON.parse(fs.readFileSync(path.join(directory, 'version.json'), 'utf8'))
	const get = async (relative) => {
		const url = new URL(relative.replace(/^\/+/, ''), `${baseUrl.replace(/\/+$/, '')}/`)
		url.searchParams.set('release_check', expected.buildId)
		const result = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
		if (!result.ok) throw new Error(`线上发布读取失败：${relative} HTTP ${result.status}`)
		return result
	}
	const actual = await (await get('version.json')).json()
	for (const key of ['schemaVersion', 'product', 'buildId', 'sourceCommit', 'sourceDigest', 'artifactDigest', 'sourceDirty']) {
		if (actual[key] !== expected[key]) throw new Error(`线上版本未匹配：${key}`)
	}
	for (const file of artifactEvidence(directory).artifacts.map((item) => item.path)) {
		const relative = file.replace(/^\/+/, '')
		const local = fs.readFileSync(path.join(directory, relative))
		const remote = Buffer.from(await (await get(relative)).arrayBuffer())
		if (sha256(local) !== sha256(remote)) throw new Error(`线上资源未匹配：${relative}`)
	}
	return { status: 'version_verified', verifiedAt: new Date().toISOString(), buildId: actual.buildId, businessAcceptance: 'not_verified' }
}

async function main() {
	if (process.argv.includes('--verify-only')) {
		verifySourceEntry()
		verifyUniCloudSpace()
		verifyVersion(REPO_ROOT, OUTPUT_DIR, 'web', { requireClean: false })
		return
	}
	buildWeb()
	const version = verifyVersion(REPO_ROOT, OUTPUT_DIR)
	if (version.environment?.spaceId !== SPACE_ID || version.environment?.provider !== PROVIDER) throw new Error('版本清单中的部署环境不匹配')
	const manifest = createManifest({ product: 'web', directory: OUTPUT_DIR })
	deployWeb()
	try {
		manifest.deployment = await verifyRemoteRelease()
	} catch (error) {
		manifest.deployment = { status: 'verification_failed', verifiedAt: new Date().toISOString(), reason: error.message }
		throw error
	} finally {
		// The uploaded manifest describes the immutable candidate; deployment evidence is a separate receipt.
		const receiptDirectory = path.join(REPO_ROOT, 'release', 'receipts')
		fs.mkdirSync(receiptDirectory, { recursive: true })
		fs.writeFileSync(path.join(receiptDirectory, `${version.buildId}.json`), JSON.stringify(manifest, null, 2) + '\n')
	}
	console.log('[release:web] 线上版本、入口与源码版本匹配；业务验收需另行记录')
}

if (require.main === module) {
	main().catch((error) => {
		console.error(error && error.message ? error.message : String(error))
		process.exitCode = 1
	})
}

module.exports = {
	readEntryScript,
	verifySourceEntry,
	verifyUniCloudSpace,
	verifyRemoteRelease
}
