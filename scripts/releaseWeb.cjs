#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

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
	run(process.execPath, [path.join(REPO_ROOT, 'scripts', 'writeH5Version.cjs')])
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

function main() {
	if (process.argv.includes('--verify-only')) {
		verifyUniCloudSpace()
		return
	}
	buildWeb()
	deployWeb()
}

if (require.main === module) {
	try {
		main()
	} catch (error) {
		console.error(error && error.message ? error.message : String(error))
		process.exit(1)
	}
}

module.exports = {
	readEntryScript,
	verifySourceEntry,
	verifyUniCloudSpace
}
