#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')
const moduleBuiltin = require('module')

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function parseArgs(argv) {
	const out = {
		cwd: process.cwd(),
		outDir: ''
	}
	for (let i = 2; i < argv.length; i += 1) {
		const m = String(argv[i] || '').match(/^--([^=]+)=(.*)$/)
		if (!m) continue
		const key = m[1]
		const value = m[2]
		if (key === 'cwd') out.cwd = path.resolve(process.cwd(), value || '.')
		if (key === 'out-dir') out.outDir = path.resolve(process.cwd(), value || '')
	}
	if (!out.outDir) {
		const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
		out.outDir = path.join(os.tmpdir(), `crm-reg-module-rehearsal-${stamp}`)
	}
	return out
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true })
}

function copyFileSync(src, dst) {
	ensureDir(path.dirname(dst))
	fs.copyFileSync(src, dst)
}

function listRegSchemaFiles(repoRoot) {
	const schemaDir = path.join(repoRoot, 'uniCloud-alipay', 'database', 'schema')
	if (!fs.existsSync(schemaDir)) return []
	return fs
		.readdirSync(schemaDir)
		.filter((name) => /^crm_reg_.*\.schema\.json$/.test(name))
		.map((name) => path.join(schemaDir, name))
}

function listRegFunctionFiles(repoRoot) {
	const fnRoot = path.join(repoRoot, 'uniCloud-alipay', 'cloudfunctions')
	const names = ['crm-reg-bridge', 'crm-reg-ingest']
	const files = []
	for (const name of names) {
		const indexFile = path.join(fnRoot, name, 'index.js')
		if (fs.existsSync(indexFile)) files.push(indexFile)
	}
	return files
}

function readText(file) {
	return fs.readFileSync(file, 'utf8')
}

function extractRequireList(code) {
	const out = []
	const reg = /require\((['"])(.+?)\1\)/g
	let m = reg.exec(code)
	while (m) {
		out.push(m[2])
		m = reg.exec(code)
	}
	return out
}

function resolveRequirePath(fromFile, request) {
	const extCandidates = ['', '.js', '.cjs', '.json', '/index.js']
	for (const ext of extCandidates) {
		const target = path.resolve(path.dirname(fromFile), `${request}${ext}`)
		if (fs.existsSync(target) && fs.statSync(target).isFile()) return target
	}
	return ''
}

function checkDependencies(copiedFunctionFiles) {
	const builtins = new Set(moduleBuiltin.builtinModules)
	const issues = []
	for (const file of copiedFunctionFiles) {
		const code = readText(file)
		const requires = extractRequireList(code)
		for (const req of requires) {
			const request = normalizeString(req)
			if (!request) continue
			if (builtins.has(request) || request.startsWith('node:')) continue
			if (request.startsWith('./') || request.startsWith('../')) {
				const resolved = resolveRequirePath(file, request)
				if (!resolved) {
					issues.push({
						file,
						type: 'missing_relative_dependency',
						require: request,
						message: '相对依赖未在剥离目录中找到'
					})
				}
				continue
			}
			issues.push({
				file,
				type: 'external_dependency',
				require: request,
				message: '检测到非内置外部依赖，请确认剥离包已包含安装说明'
			})
		}
	}
	return issues
}

function toRelative(root, target) {
	return path.relative(root, target).replace(/\\/g, '/')
}

function main() {
	const args = parseArgs(process.argv)
	const repoRoot = path.resolve(args.cwd)
	const regFunctionFiles = listRegFunctionFiles(repoRoot)
	const regSchemaFiles = listRegSchemaFiles(repoRoot)
	if (!regFunctionFiles.length) {
		throw new Error('未找到 crm-reg-* 云函数文件')
	}
	if (!regSchemaFiles.length) {
		throw new Error('未找到 crm_reg_* schema 文件')
	}

	const copiedFiles = []
	for (const src of [...regFunctionFiles, ...regSchemaFiles]) {
		const rel = toRelative(repoRoot, src)
		const dst = path.join(args.outDir, rel)
		copyFileSync(src, dst)
		copiedFiles.push({
			source: src,
			target: dst,
			relative: rel
		})
	}

	const copiedFunctionFiles = copiedFiles
		.map((item) => item.target)
		.filter((item) => /\/cloudfunctions\/crm-reg-.*\/index\.js$/.test(item))

	const dependencyIssues = checkDependencies(copiedFunctionFiles)
	const report = {
		timestamp: Date.now(),
		repo_root: repoRoot,
		out_dir: args.outDir,
		copied_total: copiedFiles.length,
		copied_files: copiedFiles,
		dependency_issues: dependencyIssues,
		passed: dependencyIssues.length === 0
	}
	ensureDir(args.outDir)
	const reportFile = path.join(args.outDir, 'rehearsal-report.json')
	fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8')

	if (report.passed) {
		console.log(`REG_MODULE_REHEARSAL_OK out_dir=${args.outDir}`)
		console.log(`REG_MODULE_REHEARSAL_REPORT ${reportFile}`)
		return
	}
	console.error(`REG_MODULE_REHEARSAL_FAIL out_dir=${args.outDir}`)
	console.error(`REG_MODULE_REHEARSAL_REPORT ${reportFile}`)
	process.exit(2)
}

try {
	main()
} catch (err) {
	console.error(err && err.message ? err.message : String(err))
	process.exit(1)
}
