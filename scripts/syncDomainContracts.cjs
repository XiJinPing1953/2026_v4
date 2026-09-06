'use strict'

const fs = require('fs')
const path = require('path')

function registry(root) {
	return JSON.parse(fs.readFileSync(path.join(root, 'config/domain-contracts.json'), 'utf8'))
}

function indexFieldType(property = {}) {
	const raw = Array.isArray(property.bsonType)
		? property.bsonType.find((item) => item !== 'null')
		: property.bsonType
	if (raw === 'number' || raw === 'double') return 'double'
	if (raw === 'int') return 'int'
	if (raw === 'long') return 'long'
	if (raw === 'bool' || raw === 'boolean') return 'bool'
	if (['float', 'array', 'point'].includes(raw)) return raw
	if (raw === 'string' || raw == null) return 'varchar'
	throw new Error(`无法自动推导支付宝索引类型：${raw}，请明确实际存储类型`)
}

function buildIndexFile(schema) {
	const properties = schema && schema.properties || {}
	return (Array.isArray(schema && schema.indexes) ? schema.indexes : []).map((index) => ({
		IndexName: index.name,
		MgoKeySchema: {
			MgoIndexKeys: Object.entries(index.key || {}).map(([name, direction]) => {
				if (![1, -1].includes(direction)) throw new Error(`不支持的索引方向：${index.name}.${name}=${direction}`)
				return ({
				Name: name,
				Direction: String(direction),
				Type: indexFieldType(properties[name])
			}) }),
			MgoIsUnique: Boolean(index.unique),
			MgoIsSparse: Boolean(index.sparse)
		}
	}))
}

function ensurePromotedSchemas(root, write = false) {
	const database = path.join(root, 'uniCloud-alipay/database')
	const changed = []
	for (const name of registry(root).promotedSchemas || []) {
		const legacyPath = path.join(database, 'schema', `${name}.schema.json`)
		const rootPath = path.join(database, `${name}.schema.json`)
		const indexPath = path.join(database, `${name}.index.json`)
		if (!fs.existsSync(legacyPath)) throw new Error(`待提升 schema 不存在：${path.relative(root, legacyPath)}`)
		if (!fs.existsSync(rootPath)) {
			changed.push(path.relative(root, rootPath))
			if (write) fs.writeFileSync(rootPath, fs.readFileSync(legacyPath))
		}
		const schemaPath = fs.existsSync(rootPath) ? rootPath : legacyPath
		const expectedIndexes = buildIndexFile(JSON.parse(fs.readFileSync(schemaPath, 'utf8')))
		const actualIndexes = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : null
		if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
			changed.push(path.relative(root, indexPath))
			if (write) fs.writeFileSync(indexPath, JSON.stringify(expectedIndexes, null, 2) + '\n')
		}
	}
	return changed
}

function contractPairs(root) {
	const contractRegistry = registry(root)
	const pairs = contractRegistry.copies.flatMap(({ source, targets }) => targets.map((target) => ({ source, target, json: false })))
	const database = path.join(root, 'uniCloud-alipay/database')
	for (const name of fs.readdirSync(database).filter((name) => name.endsWith('.schema.json')).sort()) {
		if (fs.existsSync(path.join(database, 'schema', name))) pairs.push({ source: `uniCloud-alipay/database/${name}`, target: `uniCloud-alipay/database/schema/${name}`, json: true })
	}
	return pairs
}

function sync(root, write = false) {
	const changed = ensurePromotedSchemas(root, write)
	for (const pair of contractPairs(root)) {
		const source = fs.readFileSync(path.join(root, pair.source), 'utf8')
		const targetPath = path.join(root, pair.target)
		const target = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : ''
		const equal = pair.json && target ? JSON.stringify(JSON.parse(source)) === JSON.stringify(JSON.parse(target)) : source === target
		if (equal) continue
		changed.push(pair.target)
		if (write) { fs.mkdirSync(path.dirname(targetPath), { recursive: true }); fs.writeFileSync(targetPath, source) }
	}
	if (changed.length && !write) throw new Error(`领域规则或 schema 副本不一致：\n${changed.join('\n')}`)
	return changed
}

if (require.main === module) {
	try { const changes = sync(path.resolve(__dirname, '..'), process.argv.includes('--write')); console.log(`领域规则/schema 副本检查通过；同步 ${changes.length} 项`) }
	catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { sync, contractPairs, buildIndexFile, ensurePromotedSchemas }
