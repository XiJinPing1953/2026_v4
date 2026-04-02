#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

function readUtf8(filePath) {
	return fs.readFileSync(filePath, 'utf8')
}

function extractEntry(indexHtml) {
	const scriptMatch =
		indexHtml.match(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/i) || []
	const styleMatch =
		indexHtml.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/i) || []
	return {
		entryScript: scriptMatch[1] || '',
		entryStyle: styleMatch[1] || ''
	}
}

function main() {
	const candidateDirs = [
		path.resolve(process.cwd(), 'dist/build/h5'),
		path.resolve(process.cwd(), 'dist/build/web')
	]
	const outputDirs = candidateDirs.filter((dir) => fs.existsSync(path.join(dir, 'index.html')))
	if (!outputDirs.length) {
		console.error('[writeH5Version] missing dist/build/h5/index.html or dist/build/web/index.html')
		process.exit(1)
	}
	const buildId = `${Date.now()}`
	const generatedAt = new Date().toISOString()
	for (const dir of outputDirs) {
		const indexPath = path.join(dir, 'index.html')
		const versionPath = path.join(dir, 'version.json')
		const indexHtml = readUtf8(indexPath)
		const { entryScript, entryStyle } = extractEntry(indexHtml)
		const payload = {
			buildId,
			generatedAt,
			entryScript,
			entryStyle
		}
		fs.writeFileSync(versionPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
		console.log(`[writeH5Version] wrote ${path.relative(process.cwd(), versionPath)}`)
	}
}

main()
