#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { artifactEvidence, sha256 } = require('./lib/releaseEvidence.cjs')
const { verifyRemoteRelease } = require('./releaseWeb.cjs')

// This entry only reads public files. It never builds, logs in, uploads or repairs data.
async function verifyWebReadback({ directory, receiptPath, policyPath = null, policySha256 = null, fetchImpl = fetch }) {
	if (!directory || !receiptPath) throw new Error('必须显式指定 --directory 和 --receipt')
	fs.mkdirSync(path.dirname(path.resolve(receiptPath)), { recursive: true, mode: 0o700 })
	const fd = fs.openSync(receiptPath, 'wx', 0o600)
	const evidence = { kind: 'remote_verification', deploymentReceipt: false, financialWrites: 0, verifierSha256: sha256(fs.readFileSync(path.join(__dirname, 'releaseWeb.cjs'))) }
	try {
		const version = JSON.parse(fs.readFileSync(path.join(directory, 'version.json'), 'utf8'))
		if (version.sourceDirty !== false || version.schemaVersion !== 2 || version.product !== 'web' || !/^[a-f0-9]{40}$/.test(version.sourceCommit || '') || artifactEvidence(directory).artifactDigest !== version.artifactDigest) throw new Error('本地产物或版本证据不完整')
		if (version.environment?.provider !== 'alipay' || !/^[a-z0-9-]+$/.test(version.environment?.spaceId || '')) throw new Error('本地产物未绑定有效支付宝空间')
		evidence.buildId = version.buildId
		evidence.sourceCommit = version.sourceCommit
		evidence.environment = version.environment
		let deliveryPolicy = null
		if (policyPath) {
			deliveryPolicy = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
			if (!/^[a-f0-9]{64}$/.test(policySha256 || '') || sha256(JSON.stringify(deliveryPolicy)) !== policySha256) throw new Error('必须提供匹配的 --policy-sha256，不自动接受差异清单变化')
		} else if (policySha256) throw new Error('--policy-sha256 必须配合 --policy')
		const result = await verifyRemoteRelease({ directory, baseUrl: `https://${version.environment.spaceId}-static.normal.cloudstatic.cn`, deliveryPolicy, fetchImpl })
		fs.writeFileSync(fd, JSON.stringify({ ...evidence, ...result }, null, 2) + '\n')
		return result
	} catch (error) {
		fs.writeFileSync(fd, JSON.stringify({ ...evidence, status: 'verification_failed', reason: error.message, evidence: error.evidence || null }, null, 2) + '\n')
		throw error
	} finally { fs.closeSync(fd) }
}

if (require.main === module) {
	const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const index = arg.indexOf('='); return [arg.slice(0, index), arg.slice(index + 1)] }))
	const allowed = new Set(['--directory', '--receipt', '--policy', '--policy-sha256'])
	if (Object.keys(args).some((arg) => !allowed.has(arg))) { console.error('仅支持显式读取目录、回执和差异清单参数'); process.exitCode = 1 }
	else verifyWebReadback({ directory: args['--directory'], receiptPath: args['--receipt'], policyPath: args['--policy'], policySha256: args['--policy-sha256'] })
		.then((result) => console.log(JSON.stringify({ status: result.status, buildId: result.buildId, checked: result.checked.length, declaredCssVariants: result.checked.filter((item) => item.deliveryVariant).length })))
		.catch((error) => { console.error(error.message); process.exitCode = 1 })
}

module.exports = { verifyWebReadback }
