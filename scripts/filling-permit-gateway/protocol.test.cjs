'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const ModbusRTU = require('modbus-serial')
const {
	REGISTER,
	RESULT_STATUS,
	GATEWAY_STATE,
	FAULT_CODE,
	createRegisterBank,
	bottleFromRegisters,
	writeBottleToRegisters,
	LocalAuditJournal,
	FillingPermitRuntime,
	policy
} = require('../fillingPermitCore.cjs')

function waitFor(predicate, timeoutMs = 1000) {
	const started = Date.now()
	return new Promise((resolve, reject) => {
		const check = () => {
			if (predicate()) return resolve()
			if (Date.now() - started >= timeoutMs) return reject(new Error('waitFor timeout'))
			setTimeout(check, 5)
		}
		check()
	})
}

function getFreePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer()
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			server.close(() => resolve(address.port))
		})
	})
}

class MemoryJournal {
	constructor(options = {}) {
		this.events = []
		this.pending = []
		this.failAppend = options.failAppend === true
	}
	appendEvent(event) {
		if (this.failAppend) throw new Error('disk fault')
		this.events.push(event)
	}
	queue(record) { this.pending.push(record) }
	markSynced(requestId) { this.pending = this.pending.filter((item) => item.request_id !== requestId) }
	listPending() { return this.pending.slice() }
}

function allowResult() {
	return {
		...policy.buildResult([], { now: Date.now() }),
		normalized_bottle_no: 'Y013'
	}
}

function createHarness(options = {}) {
	const journal = options.journal || new MemoryJournal()
	let calls = 0
	const cloudClient = options.cloudClient || {
		checkPermit: async () => {
			calls += 1
			return { result: allowResult(), audited: true }
		},
		syncAudits: async (records) => ({ synced_request_ids: records.map((item) => item.request_id) })
	}
	const runtime = new FillingPermitRuntime({
		bootId: 123,
		getConfig: () => ({ gatewayId: 'test-gateway', bindHost: '127.0.0.1', port: 15020, unitId: 1 }),
		journal,
		cloudClient
	})
	runtime.running = true
	runtime.registers[REGISTER.GATEWAY_STATE] = GATEWAY_STATE.READY
	return { runtime, journal, cloudClient, getCalls: () => calls }
}

function submit(runtime, { bootId = 123, sequence = 1, bottleNo = 'Y013' } = {}) {
	writeBottleToRegisters(runtime.registers, bottleNo)
	runtime.writeRegister(REGISTER.REQUEST_BOOT_ID, bootId)
	runtime.writeRegister(REGISTER.REQUEST_SEQ, sequence)
}

test('32个寄存器默认安全，协议版本和非零boot正确', () => {
	const registers = createRegisterBank(99)
	assert.equal(registers.length, 32)
	assert.equal(registers[REGISTER.PROTOCOL_VERSION], 1)
	assert.equal(registers[REGISTER.GATEWAY_BOOT_ID], 99)
	assert.equal(registers[REGISTER.ALLOW_FILL_RAW], 0)
	assert.equal(registers[REGISTER.GATEWAY_STATE], GATEWAY_STATE.STOPPED)
})

test('每字ASCII瓶号按长度解析，边界和尾部填0严格校验', () => {
	const registers = createRegisterBank(1)
	for (const value of ['1', 'Y013', 'A'.repeat(16)]) {
		writeBottleToRegisters(registers, value)
		assert.equal(bottleFromRegisters(registers), value)
	}
	registers[REGISTER.BOTTLE_LENGTH] = 0
	assert.throws(() => bottleFromRegisters(registers), /1–16/)
	writeBottleToRegisters(registers, 'Y013')
	registers[REGISTER.BOTTLE_CHAR_START + 4] = 65
	assert.throws(() => bottleFromRegisters(registers), /必须填 0/)
})

test('只允许HMI写请求区，输出区写入返回Modbus地址错误', () => {
	const { runtime } = createHarness()
	assert.equal(runtime.writeRegister(REGISTER.REQUEST_BOOT_ID, 123), 123)
	assert.throws(
		() => runtime.writeRegister(REGISTER.ALLOW_FILL_RAW, 1),
		(err) => err && err.modbusErrorCode === 2
	)
})

test('提交后立即清零，所有结果完成后才提交response_seq', async () => {
	let resolveCloud
	const cloudClient = {
		checkPermit: () => new Promise((resolve) => { resolveCloud = resolve }),
		syncAudits: async () => ({ synced_request_ids: [] })
	}
	const { runtime } = createHarness({ cloudClient })
	submit(runtime)
	assert.equal(runtime.registers[REGISTER.RESULT_STATUS], RESULT_STATUS.PROCESSING)
	assert.equal(runtime.registers[REGISTER.ALLOW_FILL_RAW], 0)
	assert.equal(runtime.registers[REGISTER.RESPONSE_SEQ], 0)
	await waitFor(() => typeof resolveCloud === 'function')
	resolveCloud({ result: allowResult(), audited: true })
	await waitFor(() => !runtime.busy)
	assert.equal(runtime.registers[REGISTER.RESULT_STATUS], RESULT_STATUS.ALLOWED)
	assert.equal(runtime.registers[REGISTER.ALLOW_FILL_RAW], 1)
	assert.equal(runtime.registers[REGISTER.REASON_CODE], 0)
	assert.equal(runtime.registers[REGISTER.RESPONSE_BOOT_ID], 123)
	assert.equal(runtime.registers[REGISTER.RESPONSE_SEQ], 1)
	assert.equal(runtime.lastQuery.allowed, true)
	assert.equal(runtime.lastQuery.reasonCode, 0)
})

test('boot不匹配和输入不完整均系统禁止且不访问云端', async () => {
	for (const setup of ['boot', 'input']) {
		const harness = createHarness()
		if (setup === 'boot') submit(harness.runtime, { bootId: 124 })
		else {
			writeBottleToRegisters(harness.runtime.registers, 'Y013')
			harness.runtime.registers[REGISTER.BOTTLE_CHAR_START + 4] = 65
			harness.runtime.writeRegister(REGISTER.REQUEST_BOOT_ID, 123)
			harness.runtime.writeRegister(REGISTER.REQUEST_SEQ, 1)
		}
		await waitFor(() => !harness.runtime.busy)
		assert.equal(harness.runtime.registers[REGISTER.ALLOW_FILL_RAW], 0, setup)
		assert.equal(harness.runtime.registers[REGISTER.RESULT_STATUS], RESULT_STATUS.SYSTEM_DENIED, setup)
		assert.equal(harness.runtime.registers[REGISTER.REASON_CODE], 97, setup)
		assert.equal(harness.getCalls(), 0, setup)
	}
})

test('重复序号默认系统禁止，16位序号回绕后的新值可提交', async () => {
	const harness = createHarness()
	submit(harness.runtime, { sequence: 65535 })
	await waitFor(() => !harness.runtime.busy)
	assert.equal(harness.getCalls(), 1)
	harness.runtime.writeRegister(REGISTER.REQUEST_SEQ, 65535)
	await waitFor(() => harness.runtime.registers[REGISTER.RESPONSE_SEQ] === 65535)
	assert.equal(harness.getCalls(), 1)
	assert.equal(harness.runtime.registers[REGISTER.ALLOW_FILL_RAW], 0)
	assert.equal(harness.runtime.registers[REGISTER.REASON_CODE], 97)
	submit(harness.runtime, { sequence: 1 })
	await waitFor(() => !harness.runtime.busy)
	assert.equal(harness.getCalls(), 2)
	submit(harness.runtime, { sequence: 65535 })
	await waitFor(() => harness.runtime.registers[REGISTER.RESPONSE_SEQ] === 65535)
	assert.equal(harness.getCalls(), 2)
	assert.equal(harness.runtime.registers[REGISTER.REASON_CODE], 97)
})

test('并发新请求禁止并使旧允许结果失效', async () => {
	let resolveFirst
	let calls = 0
	const cloudClient = {
		checkPermit: () => {
			calls += 1
			return new Promise((resolve) => { resolveFirst = resolve })
		},
		syncAudits: async () => ({ synced_request_ids: [] })
	}
	const { runtime } = createHarness({ cloudClient })
	submit(runtime, { sequence: 1 })
	submit(runtime, { sequence: 2 })
	await waitFor(() => runtime.registers[REGISTER.RESPONSE_SEQ] === 2)
	assert.equal(runtime.registers[REGISTER.ALLOW_FILL_RAW], 0)
	assert.equal(runtime.registers[REGISTER.REASON_CODE], 99)
	resolveFirst({ result: allowResult(), audited: true })
	await waitFor(() => !runtime.busy)
	assert.equal(calls, 1)
	assert.equal(runtime.registers[REGISTER.RESPONSE_SEQ], 2)
	assert.equal(runtime.registers[REGISTER.ALLOW_FILL_RAW], 0)
})

test('超时、401、HTTP/数据库、云审计和内部异常全部禁止且当前请求只调用一次', async () => {
	for (const kind of ['timeout', 'auth', 'network', 'database', 'cloud_audit', 'internal']) {
		let calls = 0
		const cloudClient = {
			checkPermit: async () => {
				calls += 1
				throw Object.assign(new Error(kind), { kind })
			},
			syncAudits: async () => ({ synced_request_ids: [] })
		}
		const { runtime, journal } = createHarness({ cloudClient })
		submit(runtime)
		await waitFor(() => !runtime.busy)
		assert.equal(runtime.registers[REGISTER.ALLOW_FILL_RAW], 0, kind)
		assert.equal(runtime.registers[REGISTER.RESULT_STATUS], RESULT_STATUS.SYSTEM_DENIED, kind)
		assert.equal(calls, 1, kind)
		assert.equal(journal.pending.length, 1, kind)
	}
})

test('云端允许缺少审计确认时转换为系统禁止', async () => {
	const cloudClient = {
		checkPermit: async () => ({ result: allowResult(), audited: false }),
		syncAudits: async () => ({ synced_request_ids: [] })
	}
	const { runtime } = createHarness({ cloudClient })
	submit(runtime)
	await waitFor(() => !runtime.busy)
	assert.equal(runtime.registers[REGISTER.ALLOW_FILL_RAW], 0)
	assert.equal(runtime.registers[REGISTER.REASON_CODE], 94)
})

test('本地磁盘首条审计失败时不访问云端并保持许可为0', async () => {
	let calls = 0
	const journal = new MemoryJournal({ failAppend: true })
	const cloudClient = {
		checkPermit: async () => { calls += 1; return { result: allowResult(), audited: true } },
		syncAudits: async () => ({ synced_request_ids: [] })
	}
	const { runtime } = createHarness({ journal, cloudClient })
	submit(runtime)
	await waitFor(() => !runtime.busy)
	assert.equal(calls, 0)
	assert.equal(runtime.registers[REGISTER.ALLOW_FILL_RAW], 0)
	assert.equal(runtime.registers[REGISTER.REASON_CODE], 96)
	assert.equal(runtime.registers[REGISTER.FAULT_CODE], FAULT_CODE.LOCAL_AUDIT)
})

test('云端已审计允许后若本地结果刷盘失败仍转换为系统禁止', async () => {
	let appendCount = 0
	const journal = new MemoryJournal()
	journal.appendEvent = (event) => {
		appendCount += 1
		if (appendCount === 2) throw new Error('result fsync failed')
		journal.events.push(event)
	}
	const { runtime } = createHarness({ journal })
	submit(runtime)
	await waitFor(() => !runtime.busy)
	assert.equal(runtime.registers[REGISTER.ALLOW_FILL_RAW], 0)
	assert.equal(runtime.registers[REGISTER.RESULT_STATUS], RESULT_STATUS.SYSTEM_DENIED)
	assert.equal(runtime.registers[REGISTER.REASON_CODE], 96)
	assert.equal(runtime.registers[REGISTER.FAULT_CODE], FAULT_CODE.LOCAL_AUDIT)
})

test('每个请求本地记录received和resolved，系统禁止进入幂等补传队列', async () => {
	const cloudClient = {
		checkPermit: async () => { throw Object.assign(new Error('offline'), { kind: 'network' }) },
		syncAudits: async (records) => ({ synced_request_ids: records.map((item) => item.request_id) })
	}
	const { runtime, journal } = createHarness({ cloudClient })
	submit(runtime)
	await waitFor(() => !runtime.busy)
	assert.deepEqual(journal.events.map((item) => item.event), ['request_received', 'request_resolved'])
	assert.equal(journal.pending.length, 1)
	await runtime.syncPending()
	assert.equal(journal.pending.length, 0)
})

test('按日JSONL强制写盘并用request_id折叠补传状态', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filling-permit-journal-'))
	const journal = new LocalAuditJournal(root)
	journal.appendEvent({ event: 'request_received', request_id: 'req-1', recorded_at: Date.parse('2026-07-20T00:00:00Z') })
	assert.equal(fs.existsSync(path.join(root, 'permit-audit-2026-07-20.jsonl')), true)
	journal.queue({ request_id: 'req-1', allowed: false })
	journal.queue({ request_id: 'req-1', allowed: false })
	assert.equal(journal.listPending().length, 1)
	journal.markSynced('req-1')
	assert.equal(journal.listPending().length, 0)
})

test('真实Modbus TCP FC03/FC06/FC16按约定完成一次查询', async () => {
	const port = await getFreePort()
	const journal = new MemoryJournal()
	const runtime = new FillingPermitRuntime({
		bootId: 321,
		getConfig: () => ({ gatewayId: 'modbus-test', bindHost: '127.0.0.1', port, unitId: 1, heartbeatMs: 250 }),
		journal,
		cloudClient: {
			checkPermit: async () => ({ result: allowResult(), audited: true }),
			syncAudits: async () => ({ synced_request_ids: [] })
		}
	})
	const client = new ModbusRTU()
	try {
		await runtime.start()
		await client.connectTCP('127.0.0.1', { port })
		client.setID(1)
		const bottle = 'Y013'
		const payload = [bottle.length, ...Array.from({ length: 16 }, (_, index) => (index < bottle.length ? bottle.charCodeAt(index) : 0))]
		await client.writeRegisters(REGISTER.BOTTLE_LENGTH, payload)
		await client.writeRegister(REGISTER.REQUEST_BOOT_ID, 321)
		await client.writeRegister(REGISTER.REQUEST_SEQ, 7)
		await waitFor(() => runtime.registers[REGISTER.RESPONSE_SEQ] === 7)
		const response = await client.readHoldingRegisters(0, 32)
		assert.equal(response.data[REGISTER.PROTOCOL_VERSION], 1)
		assert.equal(response.data[REGISTER.RESPONSE_BOOT_ID], 321)
		assert.equal(response.data[REGISTER.RESULT_STATUS], RESULT_STATUS.ALLOWED)
		assert.equal(response.data[REGISTER.ALLOW_FILL_RAW], 1)
		assert.equal(response.data[REGISTER.RESPONSE_SEQ], 7)
		await assert.rejects(() => client.writeRegister(REGISTER.ALLOW_FILL_RAW, 1))
	} finally {
		try { client.close(() => {}) } catch (_) {}
		await runtime.stop()
	}
})

test('端口占用时启动失败且许可保持0', async () => {
	const port = await getFreePort()
	const blocker = net.createServer()
	await new Promise((resolve, reject) => {
		blocker.once('error', reject)
		blocker.listen(port, '127.0.0.1', resolve)
	})
	const runtime = new FillingPermitRuntime({
		bootId: 400,
		getConfig: () => ({ gatewayId: 'port-test', bindHost: '127.0.0.1', port, unitId: 1 }),
		journal: new MemoryJournal(),
		cloudClient: { checkPermit: async () => ({ result: allowResult(), audited: true }), syncAudits: async () => ({ synced_request_ids: [] }) }
	})
	try {
		await assert.rejects(() => runtime.start(), (err) => err && err.code === 'EADDRINUSE')
		assert.equal(runtime.registers[REGISTER.ALLOW_FILL_RAW], 0)
		assert.equal(runtime.registers[REGISTER.GATEWAY_STATE], GATEWAY_STATE.FAULT)
		assert.equal(runtime.registers[REGISTER.FAULT_CODE], FAULT_CODE.PORT_IN_USE)
	} finally {
		await new Promise((resolve) => blocker.close(resolve))
	}
})

test('同一应用内停止再启动会生成新boot ID并清除旧响应', async () => {
	const port = await getFreePort()
	const bootIds = [111, 222]
	const runtime = new FillingPermitRuntime({
		bootIdFactory: () => bootIds.shift(),
		getConfig: () => ({ gatewayId: 'restart-test', bindHost: '127.0.0.1', port, unitId: 1 }),
		journal: new MemoryJournal(),
		cloudClient: { checkPermit: async () => ({ result: allowResult(), audited: true }), syncAudits: async () => ({ synced_request_ids: [] }) }
	})
	await runtime.start()
	assert.equal(runtime.bootId, 111)
	runtime.registers[REGISTER.RESPONSE_BOOT_ID] = 111
	runtime.registers[REGISTER.RESPONSE_SEQ] = 9
	runtime.registers[REGISTER.ALLOW_FILL_RAW] = 1
	await runtime.stop()
	await runtime.start()
	try {
		assert.equal(runtime.bootId, 222)
		assert.equal(runtime.registers[REGISTER.GATEWAY_BOOT_ID], 222)
		assert.equal(runtime.registers[REGISTER.RESPONSE_SEQ], 0)
		assert.equal(runtime.registers[REGISTER.ALLOW_FILL_RAW], 0)
	} finally {
		await runtime.stop()
	}
})
