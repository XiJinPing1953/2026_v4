'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

class MemoryCollection {
	constructor(rows = [], options = {}) {
		this.rows = rows
		this.uniqueRequestId = options.uniqueRequestId === true
		this.query = null
		this.max = Infinity
		this.failGet = false
		this.failAdd = false
	}
	where(query) {
		const next = new MemoryCollection(this.rows, { uniqueRequestId: this.uniqueRequestId })
		next.query = query
		next.failGet = this.failGet
		next.failAdd = this.failAdd
		return next
	}
	limit(value) { this.max = value; return this }
	async get() {
		if (this.failGet) throw new Error('database get failed')
		const query = this.query || {}
		const data = this.rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value)).slice(0, this.max)
		return { data }
	}
	async add(row) {
		if (this.failAdd) throw new Error('database add failed')
		if (this.uniqueRequestId && row.request_id && this.rows.some((item) => item.request_id === row.request_id)) {
			throw new Error('E11000 duplicate key')
		}
		const saved = { ...row, _id: `id-${this.rows.length + 1}` }
		this.rows.push(saved)
		return { id: saved._id }
	}
}

function makePasswordHash(password) {
	const iterations = 10000
	const salt = '00112233445566778899aabbccddeeff'
	const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex')
	return `pbkdf2-sha256$${iterations}$${salt}$${hash}`
}

const collections = {
	crm_bottles: new MemoryCollection([
		{
			_id: 'bottle-1',
			bottle_no: 'Y013',
			is_active: true,
			status: 'in_station',
			bottle_next_check_date: '2099-01-01',
			pressure_gauge_next_check_date: '2099-01-01',
			safety_valve_next_check_date: '2099-01-01',
			updated_at: Date.now()
		}
	]),
	crm_filling_permit_audits: new MemoryCollection([], { uniqueRequestId: true }),
	crm_operation_logs: new MemoryCollection()
}

process.env.FILLING_PERMIT_GATEWAY_PASSWORD_HASH = makePasswordHash('secret-123')
process.env.FILLING_PERMIT_GATEWAY_TOKEN_SECRET = 'test-token-secret-with-at-least-32-bytes'
global.uniCloud = { database: () => ({ collection: (name) => collections[name] }) }

const cloudFunction = require('../../uniCloud-alipay/cloudfunctions/crm-filling-permit-gateway/index.js')

async function login() {
	const response = await cloudFunction.main({
		action: 'loginV1',
		request_id: 'login-request-0001',
		data: { gateway_id: 'gw-test', password: 'secret-123' }
	})
	assert.equal(response.code, 0)
	return response.data.token
}

function checkEvent(token, requestId, bottleNo = 'Y013') {
	return {
		action: 'checkPermitV1',
		request_id: `transport-${requestId}`,
		headers: { authorization: `Bearer ${token}` },
		data: {
			request_id: requestId,
			gateway_id: 'gw-test',
			hmi_boot_id: 100,
			hmi_request_seq: 1,
			bottle_no: bottleNo,
			requested_at: Date.now()
		}
	}
}

test('healthV1暴露独立配置状态，错误密码拒绝', async () => {
	const health = await cloudFunction.main({ action: 'healthV1' })
	assert.equal(health.code, 0)
	assert.equal(health.data.protocol_version, 1)
	assert.equal(health.data.password_configured, true)
	const denied = await cloudFunction.main({ action: 'loginV1', data: { gateway_id: 'gw-test', password: 'wrong' } })
	assert.equal(denied.code, 401)
})

test('允许结果必须先写云端审计，同request_id幂等返回且不重复', async () => {
	const token = await login()
	const requestId = 'permit-cloud-allow-0001'
	const first = await cloudFunction.main(checkEvent(token, requestId))
	assert.equal(first.code, 0)
	assert.equal(first.data.audited, true)
	assert.equal(first.data.result.allowed, true)
	assert.equal(collections.crm_filling_permit_audits.rows.filter((item) => item.request_id === requestId).length, 1)
	const second = await cloudFunction.main(checkEvent(token, requestId))
	assert.equal(second.code, 0)
	assert.equal(second.data.idempotent, true)
	assert.equal(collections.crm_filling_permit_audits.rows.filter((item) => item.request_id === requestId).length, 1)
})

test('云端审计写入失败绝不返回允许', async () => {
	const token = await login()
	collections.crm_filling_permit_audits.failAdd = true
	const response = await cloudFunction.main(checkEvent(token, 'permit-audit-fail-0002'))
	collections.crm_filling_permit_audits.failAdd = false
	assert.equal(response.code, 503)
	assert.equal(response.data.failure_kind, 'cloud_audit')
})

test('气瓶库读取失败时只有系统禁止审计成功后才返回', async () => {
	const token = await login()
	collections.crm_bottles.failGet = true
	const response = await cloudFunction.main(checkEvent(token, 'permit-db-fail-0003'))
	collections.crm_bottles.failGet = false
	assert.equal(response.code, 0)
	assert.equal(response.data.audited, true)
	assert.equal(response.data.result.allowed, false)
	assert.equal(response.data.result.reason_code, 92)
})

test('syncAuditV1只收系统禁止记录并按request_id幂等', async () => {
	const token = await login()
	const requestId = 'permit-local-sync-0004'
	const record = {
		request_id: requestId,
		gateway_id: 'gw-test',
		hmi_boot_id: 100,
		hmi_request_seq: 9,
		bottle_no_input: 'X046',
		normalized_bottle_no: 'X046',
		allowed: false,
		outcome: 'system_denied',
		reason_key: 'system_timeout_or_network',
		requested_at: Date.now(),
		evaluated_at: Date.now()
	}
	const event = { action: 'syncAuditV1', headers: { authorization: `Bearer ${token}` }, data: { records: [record] } }
	assert.equal((await cloudFunction.main(event)).code, 0)
	assert.equal((await cloudFunction.main(event)).code, 0)
	assert.equal(collections.crm_filling_permit_audits.rows.filter((item) => item.request_id === requestId).length, 1)
	const bad = await cloudFunction.main({ ...event, data: { records: [{ ...record, request_id: 'permit-bad-sync-0005', allowed: true }] } })
	assert.notEqual(bad.code, 0)
})
