'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const repoRoot = path.resolve(__dirname, '..')
const cloudFunctionsRoot = path.join(repoRoot, 'uniCloud-alipay', 'cloudfunctions')
const writeMode = process.argv.includes('--write')
const functionScope = process.argv.find((arg) => arg.startsWith('--functions='))?.slice(12).split(',')
if (functionScope && (writeMode || functionScope.some((name) => !/^[a-zA-Z0-9_-]+$/.test(name) || name === 'common'))) throw new Error('ACL 范围检查须为有效函数且只读')
if (functionScope) for (const name of functionScope) if (!fs.existsSync(path.join(cloudFunctionsRoot, name, 'index.js'))) throw new Error(`ACL 函数不存在：${name}`)
const compatibility = process.argv.includes('--release-compatibility')
if (compatibility && (!functionScope || writeMode)) throw new Error('历史 ACL 仅允许在显式发布范围内只读核对')
const compatibilityScope = compatibility ? require('./lib/releaseScope.cjs').resolveReleaseScope(repoRoot, 'cloud', 'deployment') : null
if (compatibilityScope && JSON.stringify([...functionScope].sort()) !== JSON.stringify([...compatibilityScope.functions].sort())) throw new Error('ACL 兼容检查与发布函数范围不一致')
const historical = new Map()
function canonicalContent(directory, canonicalFile) {
	const kind = canonicalFile.name === 'pageAclLocal.js' ? 'helper' : 'registry'
	const revision = compatibilityScope?.aclCanonicalRevisions?.[path.basename(directory)]?.[kind]
	if (!revision) return canonicalFile.content
	const sourcePath = `uniCloud-alipay/cloudfunctions/common/${kind === 'helper' ? 'pageAcl.js' : 'pageAclRegistry.js'}`
	const key = `${revision.commit}:${sourcePath}`
	if (!historical.has(key)) historical.set(key, execFileSync('git', ['show', key], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
	const content = historical.get(key)
	if (crypto.createHash('sha256').update(content).digest('hex') !== revision.sha256) throw new Error(`ACL 历史来源哈希不匹配：${key}`)
	return content
}
const canonicalFiles = [
	{
		name: 'pageAclRegistryLocal.js',
		sourcePath: path.join(cloudFunctionsRoot, 'common', 'pageAclRegistry.js'),
		transform: (content) => content
	},
	{
		name: 'pageAclRegistry.js',
		sourcePath: path.join(cloudFunctionsRoot, 'common', 'pageAclRegistry.js'),
		transform: (content) => content
	},
	{
		name: 'pageAclLocal.js',
		sourcePath: path.join(cloudFunctionsRoot, 'common', 'pageAcl.js'),
		transform: (content) => content
	}
].map((item) => ({
	...item,
	content: item.transform(fs.readFileSync(item.sourcePath, 'utf8'))
}))

const cloudFunctionDirs = fs
	.readdirSync(cloudFunctionsRoot, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && entry.name !== 'common')
	.filter((entry) => !functionScope || functionScope.includes(entry.name))
	.map((entry) => path.join(cloudFunctionsRoot, entry.name))
const forceSyncedCloudFunctions = new Set([
	'crm-home-safety-inspection',
	'crm-home-safety-export',
	'crm-station-safety-inspection',
	'crm-station-safety-export',
	'crm-pda-scale'
])

const targets = cloudFunctionDirs.flatMap((directory) =>
	canonicalFiles
		.map((canonicalFile) => ({
			filePath: path.join(directory, canonicalFile.name),
			content: canonicalContent(directory, canonicalFile)
		}))
		.filter(
				(target) =>
				fs.existsSync(target.filePath) ||
				Boolean(compatibilityScope?.aclCanonicalRevisions?.[path.basename(directory)]?.[path.basename(target.filePath) === 'pageAclLocal.js' ? 'helper' : 'registry']) ||
				(target.filePath.endsWith('/pageAclRegistry.js') &&
					fs.existsSync(path.join(directory, 'pageAclLocal.js'))) ||
				forceSyncedCloudFunctions.has(path.basename(path.dirname(target.filePath)))
		)
)

const changed = []
for (const target of targets) {
	const current = fs.existsSync(target.filePath) ? fs.readFileSync(target.filePath, 'utf8') : ''
	if (current === target.content) continue
	changed.push(path.relative(repoRoot, target.filePath))
	if (writeMode) fs.writeFileSync(target.filePath, target.content)
}

if (changed.length && !writeMode) {
	console.error(`ACL registry fallback 不一致（${changed.length} 个）：`)
	changed.forEach((item) => console.error(`- ${item}`))
	process.exitCode = 1
} else if (changed.length) {
	console.log(`已同步 ${changed.length} 个 ACL fallback 文件`)
} else {
	console.log(`ACL fallback 已一致（${targets.length} 个文件）`)
}
