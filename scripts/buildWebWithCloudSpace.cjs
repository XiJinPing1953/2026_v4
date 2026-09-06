#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const REPO_ROOT = path.resolve(__dirname, '..')
const SPACE_ID = 'env-00jxuffegf2n'
const SPACE_NAME = 'xintuonengyuan'
const OUTPUT_DIR = path.join(REPO_ROOT, 'dist', 'build', 'web')

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function findAlipaySpace(node) {
	if (!node || typeof node !== 'object') return null
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i += 1) {
			const found = findAlipaySpace(node[i])
			if (found) return found
		}
		return null
	}

	const id = normalizeString(node.id || node.spaceId || node.space_id || node.spaceid)
	const accessKey = normalizeString(node.accessKey || node.access_key)
	const secretKey = normalizeString(node.secretKey || node.secret_key)
	const spaceAppId = normalizeString(node.spaceAppId || node.space_app_id)
	if (id === SPACE_ID && accessKey && secretKey && spaceAppId) {
		return {
			id: SPACE_ID,
			name: normalizeString(node.name || node.spaceName) || SPACE_NAME,
			provider: 'alipay',
			spaceAppId,
			accessKey,
			secretKey,
			apiEndpoint:
				normalizeString(node.apiEndpoint || node.endpoint) ||
				`https://${SPACE_ID}.api-hz.cloudbasefunction.cn`,
			failoverEndpoint: normalizeString(node.failoverEndpoint || node.failover_endpoint)
		}
	}

	const values = Object.values(node)
	for (let i = 0; i < values.length; i += 1) {
		const found = findAlipaySpace(values[i])
		if (found) return found
	}
	return null
}

function loadAlipaySpace() {
	const projectsDir = path.join(os.homedir(), 'Library', 'Application Support', 'HBuilder X', 'projects')
	if (!fs.existsSync(projectsDir)) return null
	const projectDirs = fs.readdirSync(projectsDir)
	for (let i = 0; i < projectDirs.length; i += 1) {
		const settingPath = path.join(projectsDir, projectDirs[i], 'setting.json')
		if (!fs.existsSync(settingPath)) continue
		try {
			const found = findAlipaySpace(JSON.parse(fs.readFileSync(settingPath, 'utf8')))
			if (found) return found
		} catch (_) {
			// Ignore unrelated or incomplete HBuilderX project settings.
		}
	}
	return null
}

function readEntryScript(indexHtml) {
	const match = indexHtml.match(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/i) || []
	return match[1] || ''
}

function verifyOutput() {
	const indexPath = path.join(OUTPUT_DIR, 'index.html')
	if (!fs.existsSync(indexPath)) throw new Error('云空间 Web 构建失败：缺少 dist/build/web/index.html')
	const entryScript = readEntryScript(fs.readFileSync(indexPath, 'utf8'))
	if (!entryScript) throw new Error('云空间 Web 构建失败：未找到入口脚本')
	const entryPath = path.join(OUTPUT_DIR, entryScript.replace(/^\/+/, ''))
	if (!fs.existsSync(entryPath)) throw new Error(`云空间 Web 构建失败：缺少入口脚本 ${entryScript}`)
	if (!fs.readFileSync(entryPath, 'utf8').includes(SPACE_ID)) {
		throw new Error(`云空间 Web 构建失败：入口脚本未包含 ${SPACE_ID}`)
	}
	return entryScript
}

function run() {
	const space = loadAlipaySpace()
	if (!space) throw new Error(`未在 HBuilderX 项目配置中找到 ${SPACE_ID} 的支付宝云凭据`)
	const uniCli = path.join(REPO_ROOT, 'node_modules', '.bin', 'uni')
	const result = spawnSync(uniCli, ['build'], {
		cwd: REPO_ROOT,
		stdio: 'inherit',
		env: {
			...process.env,
			UNI_CLOUD_SPACES: JSON.stringify([space]),
			UNI_OUTPUT_DIR: OUTPUT_DIR
		}
	})
	if (result.error) throw result.error
	if (result.status !== 0) throw new Error(`uni Web 构建失败，退出码 ${result.status}`)

	const versionResult = spawnSync(process.execPath, [path.join(__dirname, 'writeH5Version.cjs'), `--output-dir=${OUTPUT_DIR}`, `--space-id=${SPACE_ID}`], {
		cwd: REPO_ROOT,
		stdio: 'inherit'
	})
	if (versionResult.error) throw versionResult.error
	if (versionResult.status !== 0) throw new Error(`版本文件生成失败，退出码 ${versionResult.status}`)
	const entryScript = verifyOutput()
	console.log(`[build:web:cloud] 构建完成，空间 ${SPACE_ID}，入口 ${entryScript}`)
}

try {
	run()
} catch (error) {
	console.error(error && error.message ? error.message : String(error))
	process.exit(1)
}
