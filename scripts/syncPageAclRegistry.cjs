'use strict'

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const cloudFunctionsRoot = path.join(repoRoot, 'uniCloud-alipay', 'cloudfunctions')
const writeMode = process.argv.includes('--write')
const functionScope = process.argv.find((arg) => arg.startsWith('--functions='))?.slice(12).split(',')
if (functionScope && (writeMode || functionScope.some((name) => !/^[a-zA-Z0-9_-]+$/.test(name) || name === 'common'))) throw new Error('ACL 范围检查须为有效函数且只读')
if (functionScope) for (const name of functionScope) if (!fs.existsSync(path.join(cloudFunctionsRoot, name, 'index.js'))) throw new Error(`ACL 函数不存在：${name}`)
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
			content: canonicalFile.content
		}))
		.filter(
				(target) =>
				fs.existsSync(target.filePath) ||
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
