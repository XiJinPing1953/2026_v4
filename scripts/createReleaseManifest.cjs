'use strict'

const fs = require('fs')
const path = require('path')
const { listFiles, artifactEvidence, sha256 } = require('./lib/releaseEvidence.cjs')
const { checkReleaseIntegrity } = require('./checkReleaseIntegrity.cjs')

function createManifest({ root = path.resolve(__dirname, '..'), product, directory, requireClean = true } = {}) {
	const config = JSON.parse(fs.readFileSync(path.join(root, 'config/release-products.json'), 'utf8'))
	const settings = config.products[product]
	if (!settings) throw new Error(`未知产品：${product}`)
	const source = checkReleaseIntegrity({ root, product, requireClean })
	const output = path.resolve(root, directory || settings.output)
	const cloudRoot = path.join(root, 'uniCloud-alipay/cloudfunctions')
	const scope = settings.deploymentScope
	if (product === 'cloud' && (!scope?.functions?.length || !Array.isArray(scope.databaseFiles))) throw new Error('云发布必须明确函数和数据库变更范围')
	const functions = product === 'cloud' ? scope.functions.map((name) => {
			if (!/^[a-zA-Z0-9_-]+$/.test(name) || name === 'common') throw new Error(`无效云函数：${name}`)
			const functionRoot = path.join(cloudRoot, name)
			if (!fs.existsSync(path.join(functionRoot, 'index.js'))) throw new Error(`云函数入口不存在：${name}`)
			const files = listFiles(functionRoot, ['.']).map((file) => ({ path: file, sha256: sha256(fs.readFileSync(path.join(functionRoot, file))) }))
			return { name, digest: sha256(JSON.stringify(files)), files }
		}) : []
	const databaseChanges = product === 'cloud' ? scope.databaseFiles.map((name) => {
		if (!/^[a-zA-Z0-9_-]+\.(schema|index)\.json$/.test(name)) throw new Error(`数据库发布只允许显式 schema/index，禁止初始化数据：${name}`)
		const file = `uniCloud-alipay/database/${name}`
		return { path: file, kind: name.endsWith('.index.json') ? 'index' : 'schema', sha256: sha256(fs.readFileSync(path.join(root, file))) }
	}) : []
	const artifacts = fs.existsSync(output) ? artifactEvidence(output) : { artifactDigest: null, artifacts: [] }
	const manifest = {
		schemaVersion: 1, product, productVersion: settings.version, createdAt: new Date().toISOString(),
		environment: config.environment,
		source, ...artifacts, functions,
		databaseChanges,
		manifestKind: 'release_candidate',
		deploymentReceiptLocation: 'release/receipts/<buildId>.json',
		deployment: { status: 'not_deployed', verifiedAt: null },
		acceptance: { status: 'not_verified', requirements: settings.acceptance }
	}
	fs.mkdirSync(output, { recursive: true })
	fs.writeFileSync(path.join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
	return manifest
}

if (require.main === module) {
	try {
		const get = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
		const manifest = createManifest({ product: get('product'), directory: get('output-dir'), requireClean: !process.argv.includes('--preview') })
		console.log(`发布清单已生成：${manifest.product} ${manifest.productVersion}；部署状态未验证`)
	} catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { createManifest }
