'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs')
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync('src/services/models/offsetReleaseRecovery.js')).toString('base64')}`)
const request = () => ({ version: 1, customer_id: 'customer', receipt_id: 'credit', operation_id: 'release-fixed', expected_source_version: 'v1', attempted: false })
const data = () => ({ operation_id: 'release-fixed', receipt_id: 'credit', released_total: 50, remaining_unallocated: 88 })
test('lost deletion response is recovered by querying, without another source release', async () => {
	const { resumeOffsetRelease } = await modulePromise
	let writes = 0, stored
	const result = await resumeOffsetRelease(request(), { persist: row => { stored = structuredClone(row) }, submit: async () => { writes++; throw Error('timeout') }, query: async () => ({ code: 0, data: { status: 'saved', result: data() } }) })
	assert.equal(result.status, 'complete'); assert.equal(writes, 1)
	await resumeOffsetRelease(stored, { persist() {}, submit: async () => { writes++ } })
	assert.equal(writes, 1)
})
test('unknown deletion keeps its original payload across a reload and only retries the same operation', async () => {
	const { resumeOffsetRelease, readOffsetRelease } = await modulePromise
	let stored; const calls = [], persist = row => { stored = structuredClone(row) }, query = async () => ({ code: 0, data: { status: 'not_found' } })
	const first = await resumeOffsetRelease(request(), { persist, query, submit: async row => { calls.push(structuredClone(row)); throw Error('timeout') } })
	assert.equal(first.status, 'pending')
	const second = await resumeOffsetRelease(readOffsetRelease(stored, 'customer'), { persist, query, submit: async row => { calls.push(structuredClone(row)); return { code: 0, data: data() } } })
	assert.equal(second.status, 'complete'); assert.deepEqual(calls[0], calls[1])
	assert.throws(() => readOffsetRelease(stored, 'other-customer'), /不完整/)
})
test('query outage and persistence failure never create a second release request', async () => {
	const { resumeOffsetRelease } = await modulePromise
	let writes = 0
	const result = await resumeOffsetRelease({ ...request(), attempted: true }, { persist() {}, query: async () => { throw Error('offline') }, submit: async () => { writes++ } })
	assert.equal(result.status, 'pending'); assert.equal(writes, 0)
	await assert.rejects(resumeOffsetRelease(request(), { persist: () => { throw Error('full') }, submit: async () => { writes++ } }), /full/)
	assert.equal(writes, 0)
})
test('definite pre-write source conflict is rejected but retryable conflicts keep the old operation', async () => {
	const { resumeOffsetRelease } = await modulePromise
	const query = async () => ({ code: 0, data: { status: 'not_found' } })
	assert.equal((await resumeOffsetRelease(request(), { persist() {}, query, submit: async () => ({ code: 409, msg: 'source changed' }) })).status, 'rejected')
	assert.equal((await resumeOffsetRelease(request(), { persist() {}, query, submit: async () => ({ code: 409, data: { retryable: true } }) })).status, 'pending')
})
test('a rejected release remains terminal when cleanup fails, even after permission is restored', async () => {
	const { resumeOffsetRelease, readOffsetRelease } = await modulePromise
	let stored, writes = 0, queries = 0
	const persist = row => { stored = structuredClone(row) }
	const first = await resumeOffsetRelease(request(), { persist, submit: async () => { writes++; return { code: 403, msg: '权限已变更' } } })
	assert.equal(first.status, 'rejected')
	const reopened = readOffsetRelease(stored, 'customer')
	const second = await resumeOffsetRelease(reopened, { persist, submit: async () => { writes++; return { code: 0, data: data() } }, query: async () => { queries++; return { code: 0, data: { status: 'not_found' } } } })
	assert.equal(second.status, 'rejected'); assert.equal(writes, 1); assert.equal(queries, 0)
})
