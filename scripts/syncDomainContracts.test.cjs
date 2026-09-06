'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { sync, buildIndexFile } = require('./syncDomainContracts.cjs')

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-contract-test-'))
	t.after(() => fs.rmSync(root, { recursive: true, force: true }))
	const write = (file, value) => {
		const target = path.join(root, file)
		fs.mkdirSync(path.dirname(target), { recursive: true })
		fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
	}
	write('config/domain-contracts.json', {
		version: 1,
		copies: [],
		promotedSchemas: ['events']
	})
	return { root, write }
}

function eventSchema(extra = {}) {
	return {
		bsonType: 'object',
		properties: {
			code: { bsonType: 'string' },
			event_at: { bsonType: ['null', 'long'] },
			active: { bsonType: 'bool' }
		},
		indexes: [
			{ name: 'uniq_code', key: { code: 1 }, unique: true },
			{ name: 'idx_cursor', key: { event_at: -1, _id: -1 } }
		],
		...extra
	}
}

test('check-only reports a nested-only schema without changing the fixture', (t) => {
	const { root, write } = fixture(t)
	write('uniCloud-alipay/database/schema/events.schema.json', eventSchema())
	assert.throws(() => sync(root), /events\.schema\.json/)
	assert.equal(fs.existsSync(path.join(root, 'uniCloud-alipay/database/events.schema.json')), false)
	assert.equal(fs.existsSync(path.join(root, 'uniCloud-alipay/database/events.index.json')), false)
})

test('explicit sync promotes the schema and generates the upload index definition', (t) => {
	const { root, write } = fixture(t)
	write('uniCloud-alipay/database/schema/events.schema.json', eventSchema())
	const changed = sync(root, true)
	assert.deepEqual(changed.sort(), [
		'uniCloud-alipay/database/events.index.json',
		'uniCloud-alipay/database/events.schema.json'
	])
	assert.deepEqual(sync(root), [])
	const indexes = JSON.parse(fs.readFileSync(path.join(root, 'uniCloud-alipay/database/events.index.json'), 'utf8'))
	assert.deepEqual(indexes[1].MgoKeySchema.MgoIndexKeys, [
		{ Name: 'event_at', Direction: '-1', Type: 'long' },
		{ Name: '_id', Direction: '-1', Type: 'varchar' }
	])
	assert.equal(indexes[0].MgoKeySchema.MgoIsUnique, true)
})

test('after promotion the root schema is authoritative and repairs the compatibility copy', (t) => {
	const { root, write } = fixture(t)
	write('uniCloud-alipay/database/schema/events.schema.json', eventSchema())
	sync(root, true)
	const canonical = eventSchema({ required: ['code'] })
	write('uniCloud-alipay/database/events.schema.json', canonical)
	assert.throws(() => sync(root), /database\/schema\/events\.schema\.json/)
	sync(root, true)
	assert.deepEqual(
		JSON.parse(fs.readFileSync(path.join(root, 'uniCloud-alipay/database/schema/events.schema.json'), 'utf8')),
		canonical
	)
})

test('index generation keeps field order, direction, uniqueness and supported BSON types', () => {
	const indexes = buildIndexFile(eventSchema())
	assert.deepEqual(indexes.map((item) => item.IndexName), ['uniq_code', 'idx_cursor'])
	assert.deepEqual(indexes[0].MgoKeySchema.MgoIndexKeys, [
		{ Name: 'code', Direction: '1', Type: 'varchar' }
	])
})

test('unsupported index types and directions stop generation instead of silently coercing them', () => {
	assert.throws(() => buildIndexFile({ properties: { at: { bsonType: 'timestamp' } }, indexes: [{ name: 'at', key: { at: 1 } }] }), /无法自动推导/)
	assert.throws(() => buildIndexFile({ indexes: [{ name: 'text', key: { note: 'text' } }] }), /不支持的索引方向/)
})
