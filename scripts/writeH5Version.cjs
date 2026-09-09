#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { buildVersion } = require('./lib/releaseEvidence.cjs')

function extractEntry(html) {
 return {
  entryScript: (html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/i) || [])[1] || '',
  entryStyle: (html.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/i) || [])[1] || ''
 }
}

function writeVersion({ root = path.resolve(__dirname, '..'), directory, spaceId = null } = {}) {
 // Stamp only this build output; never assign a new time to an older sibling build.
 const target = path.resolve(root, directory || 'dist/build/h5')
 const html = fs.readFileSync(path.join(target, 'index.html'), 'utf8')
 const entry = extractEntry(html)
 if (!entry.entryScript) throw new Error('缺少网页入口脚本，不能生成版本凭据')
 const version = { ...buildVersion({ root, directory: target, spaceId, provider: spaceId ? 'alipay' : null }), ...entry }
 fs.writeFileSync(path.join(target, 'version.json'), JSON.stringify(version, null, 2) + '\n')
 return version
}

if (require.main === module) {
 try {
  const arg = process.argv.find((item) => item.startsWith('--output-dir='))
  const space = process.argv.find((item) => item.startsWith('--space-id='))
  const version = writeVersion({ directory: arg?.slice('--output-dir='.length), spaceId: space?.slice('--space-id='.length) })
  console.log(`[writeH5Version] ${version.product} ${version.buildId} source=${version.sourceCommit.slice(0, 12)} dirty=${version.sourceDirty}`)
 } catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { extractEntry, writeVersion }
