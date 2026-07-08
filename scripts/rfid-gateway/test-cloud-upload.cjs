#!/usr/bin/env node
'use strict'

const assert = require('assert')
const http = require('http')
const { RfidCloudUploader } = require('./index.cjs')

function listen(server) {
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => resolve(server.address()))
	})
}

function close(server) {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error)
			else resolve()
		})
	})
}

function readJson(req) {
	return new Promise((resolve, reject) => {
		const chunks = []
		req.on('data', (chunk) => chunks.push(chunk))
		req.on('end', () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
			} catch (error) {
				reject(error)
			}
		})
		req.on('error', reject)
	})
}

async function run(name, fn) {
	try {
		await fn()
		process.stdout.write(`ok - ${name}\n`)
	} catch (error) {
		process.stderr.write(`not ok - ${name}\n`)
		throw error
	}
}

run('uploads RFID session through gateway token flow', async () => {
	const requests = []
	const server = http.createServer(async (req, res) => {
		const body = await readJson(req)
		requests.push({
			authorization: req.headers.authorization || '',
			body
		})
		res.setHeader('content-type', 'application/json')
		if (body.action === 'loginV1') {
			res.end(JSON.stringify({
				code: 0,
				data: {
					token: 'test-token',
					expires_in_ms: 600000,
					gateway_id: body.data.gateway_id
				}
			}))
			return
		}
		if (body.action === 'ingestSessionV1') {
			assert.strictEqual(req.headers.authorization, 'Bearer test-token')
			res.end(JSON.stringify({
				code: 0,
				data: {
					inserted: true,
					status: 'complete',
					bottle_total: 2,
					bound_bottle_total: 0,
					unbound_bottle_total: 2,
					unknown_total: 0
				}
			}))
			return
		}
		res.statusCode = 400
		res.end(JSON.stringify({ code: 400, msg: 'unknown action' }))
	})

	const address = await listen(server)
	const logs = []
	try {
		const uploader = new RfidCloudUploader({
			cloudUploadEnabled: true,
			cloudUrl: `http://${address.address}:${address.port}`,
			cloudPassword: 'secret',
			cloudGatewayId: 'rfid-gate-main'
		}, (event, payload) => {
			logs.push({ event, payload })
		})
		const res = await uploader.uploadSession({
			session_id: 'rfid_test_001',
			reader_device_code: '0001',
			started_at: '2026-06-18T04:13:53.898Z',
			ended_at: '2026-06-18T04:14:10.396Z',
			vehicle_epc: '585401020000000000011FA3',
			bottles: [
				{ epc: '58540101000000000087AD01' },
				{ epc: '58540101000000001388E035' }
			],
			unknown_tags: [],
			vehicle_conflict: false
		})
		assert.strictEqual(res.data.inserted, true)
		assert.strictEqual(requests.length, 2)
		assert.strictEqual(requests[0].body.action, 'loginV1')
		assert.strictEqual(requests[0].body.data.gateway_id, 'rfid-gate-main')
		assert.strictEqual(requests[1].body.action, 'ingestSessionV1')
		assert.strictEqual(requests[1].body.data.session.gateway_id, 'rfid-gate-main')
		assert.strictEqual(requests[1].body.data.session.session_id, 'rfid_test_001')
		assert.strictEqual(logs[0].event, 'rfid_cloud_upload_ok')
		assert.strictEqual(logs[0].payload.bottle_total, 2)
	} finally {
		await close(server)
	}
}).then(() => {
	process.stdout.write('all rfid cloud upload tests passed\n')
})
