#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ModbusRTU = require('modbus-serial')
const policy = require('../uniCloud-alipay/cloudfunctions/crm-filling-permit-gateway/permitPolicy')

const REGISTER = Object.freeze({
	PROTOCOL_VERSION: 0,
	GATEWAY_BOOT_ID: 1,
	REQUEST_BOOT_ID: 2,
	REQUEST_SEQ: 3,
	BOTTLE_LENGTH: 4,
	BOTTLE_CHAR_START: 5,
	BOTTLE_CHAR_END: 20,
	RESPONSE_BOOT_ID: 21,
	RESPONSE_SEQ: 22,
	RESULT_STATUS: 23,
	ALLOW_FILL_RAW: 24,
	REASON_CODE: 25,
	DETAIL_MASK_LOW: 26,
	DETAIL_MASK_HIGH: 27,
	GATEWAY_STATE: 28,
	FAULT_CODE: 29,
	HEARTBEAT: 30,
	LATENCY_MS: 31,
	COUNT: 32
})

const RESULT_STATUS = Object.freeze({ IDLE: 0, PROCESSING: 1, ALLOWED: 2, BUSINESS_DENIED: 3, SYSTEM_DENIED: 4 })
const GATEWAY_STATE = Object.freeze({ STOPPED: 0, STARTING: 1, READY: 2, BUSY: 3, DEGRADED: 4, FAULT: 5 })
const FAULT_CODE = Object.freeze({
	NONE: 0,
	CLOUD_UNAVAILABLE: 1,
	AUTH: 2,
	LOCAL_AUDIT: 3,
	MODBUS: 4,
	INTERNAL: 5,
	PORT_IN_USE: 6
})

function normalizeString(value) {
	return value == null ? '' : String(value).trim()
}

function toInt(value, fallback) {
	const number = Number(value)
	return Number.isFinite(number) ? Math.trunc(number) : fallback
}

function clampRegister(value) {
	return Math.min(Math.max(toInt(value, 0), 0), 0xffff)
}

function randomBootId() {
	let value = crypto.randomBytes(2).readUInt16BE(0)
	if (value === 0) value = 1
	return value
}

function normalizeConfig(input = {}) {
	const port = toInt(input.port, 502)
	const unitId = toInt(input.unitId ?? input.unit_id, 1)
	const timeoutMs = toInt(input.timeoutMs ?? input.timeout_ms, 5000)
	return {
		gatewayUrl: normalizeString(input.gatewayUrl || input.gateway_url),
		gatewayId: normalizeString(input.gatewayId || input.gateway_id) || os.hostname() || 'filling-permit-gateway',
		bindHost: normalizeString(input.bindHost || input.bind_host) || '0.0.0.0',
		port: port >= 1 && port <= 65535 ? port : 502,
		unitId: unitId >= 1 && unitId <= 247 ? unitId : 1,
		timeoutMs: Math.min(Math.max(timeoutMs, 500), 30000),
		heartbeatMs: Math.min(Math.max(toInt(input.heartbeatMs, 1000), 250), 5000),
		syncIntervalMs: Math.min(Math.max(toInt(input.syncIntervalMs, 30000), 5000), 3600000),
		autoStart: input.autoStart === true
	}
}

function bottleFromRegisters(registers) {
	const length = clampRegister(registers[REGISTER.BOTTLE_LENGTH])
	if (length < 1 || length > 16) throw new Error('瓶号长度必须为 1–16')
	let value = ''
	for (let index = 0; index < 16; index += 1) {
		const code = clampRegister(registers[REGISTER.BOTTLE_CHAR_START + index])
		if (index < length) {
			if (code < 0x21 || code > 0x7e) throw new Error(`瓶号第 ${index + 1} 个字符不是有效 ASCII`)
			value += String.fromCharCode(code)
		} else if (code !== 0) {
			throw new Error('瓶号未使用寄存器必须填 0')
		}
	}
	const normalized = policy.normalizeBottleNo(value)
	if (!policy.isValidBottleNo(normalized) || normalized.length !== length) throw new Error('瓶号格式或长度不匹配')
	return normalized
}

function writeBottleToRegisters(registers, bottleNo) {
	const normalized = policy.normalizeBottleNo(bottleNo)
	if (!policy.isValidBottleNo(normalized)) throw new Error('瓶号格式无效')
	registers[REGISTER.BOTTLE_LENGTH] = normalized.length
	for (let index = 0; index < 16; index += 1) {
		registers[REGISTER.BOTTLE_CHAR_START + index] = index < normalized.length ? normalized.charCodeAt(index) : 0
	}
	return normalized
}

function resultRegisters(result = {}) {
	const allowed = result.allowed === true
	const systemDenied = result.outcome === 'system_denied'
	return {
		[REGISTER.RESULT_STATUS]: allowed ? RESULT_STATUS.ALLOWED : systemDenied ? RESULT_STATUS.SYSTEM_DENIED : RESULT_STATUS.BUSINESS_DENIED,
		[REGISTER.ALLOW_FILL_RAW]: allowed ? 1 : 0,
		[REGISTER.REASON_CODE]: clampRegister(result.reason_code),
		[REGISTER.DETAIL_MASK_LOW]: clampRegister(result.detail_mask_low),
		[REGISTER.DETAIL_MASK_HIGH]: clampRegister(result.detail_mask_high)
	}
}

function createRegisterBank(bootId = randomBootId()) {
	const values = new Uint16Array(REGISTER.COUNT)
	values[REGISTER.PROTOCOL_VERSION] = 1
	values[REGISTER.GATEWAY_BOOT_ID] = clampRegister(bootId) || 1
	values[REGISTER.GATEWAY_STATE] = GATEWAY_STATE.STOPPED
	return values
}

function dailyFileName(prefix, timestamp = Date.now()) {
	return `${prefix}-${policy.chinaDayText(timestamp)}.jsonl`
}

class LocalAuditJournal {
	constructor(rootDir) {
		this.rootDir = path.resolve(rootDir)
		this.pendingPath = path.join(this.rootDir, 'pending-audits.jsonl')
	}

	ensureDir() {
		fs.mkdirSync(this.rootDir, { recursive: true })
	}

	appendLine(filePath, value) {
		this.ensureDir()
		const file = fs.openSync(filePath, 'a')
		try {
			fs.writeSync(file, `${JSON.stringify(value)}\n`, null, 'utf8')
			fs.fsyncSync(file)
		} finally {
			fs.closeSync(file)
		}
	}

	appendEvent(event) {
		const now = Number(event && event.recorded_at) || Date.now()
		const entry = { ...event, recorded_at: now }
		this.appendLine(path.join(this.rootDir, dailyFileName('permit-audit', now)), entry)
		return entry
	}

	queue(record) {
		this.appendLine(this.pendingPath, { type: 'pending', request_id: record.request_id, record, recorded_at: Date.now() })
	}

	markSynced(requestId) {
		this.appendLine(this.pendingPath, { type: 'synced', request_id: normalizeString(requestId), recorded_at: Date.now() })
	}

	listPending(limit = 100) {
		let text = ''
		try {
			text = fs.readFileSync(this.pendingPath, 'utf8')
		} catch (err) {
			if (err && err.code === 'ENOENT') return []
			throw err
		}
		const pending = new Map()
		for (const line of text.split(/\r?\n/)) {
			if (!line.trim()) continue
			let entry
			try {
				entry = JSON.parse(line)
			} catch (_) {
				continue
			}
			const requestId = normalizeString(entry.request_id)
			if (!requestId) continue
			if (entry.type === 'pending' && entry.record) pending.set(requestId, entry.record)
			if (entry.type === 'synced') pending.delete(requestId)
		}
		return Array.from(pending.values()).slice(0, Math.max(toInt(limit, 100), 1))
	}
}

class CloudClient {
	constructor(getConfig, getToken, clearToken) {
		this.getConfig = getConfig
		this.getToken = getToken
		this.clearToken = clearToken || (() => {})
	}

	async call(action, data = {}, token = '') {
		const config = normalizeConfig(this.getConfig())
		if (!config.gatewayUrl) throw Object.assign(new Error('未配置云端接口 URL'), { kind: 'network' })
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), config.timeoutMs)
		try {
			const headers = { 'content-type': 'application/json' }
			if (token) headers.authorization = `Bearer ${token}`
			const response = await fetch(config.gatewayUrl, {
				method: 'POST',
				headers,
				body: JSON.stringify({ action, data, request_id: data.request_id || makeRequestId(config.gatewayId) }),
				signal: controller.signal
			})
			const text = await response.text()
			let json
			try {
				json = text ? JSON.parse(text) : {}
			} catch (_) {
				throw Object.assign(new Error('云端响应不是 JSON'), { kind: 'network' })
			}
			if (response.status === 401 || json.code === 401) {
				this.clearToken()
				throw Object.assign(new Error(json.msg || '网关鉴权失败'), { kind: 'auth', status: 401 })
			}
			if (!response.ok || json.code !== 0) {
				throw Object.assign(new Error(json.msg || `HTTP ${response.status}`), {
					kind: json && json.data && json.data.failure_kind ? json.data.failure_kind : 'cloud_audit',
					status: response.status
				})
			}
			return json.data || {}
		} catch (err) {
			if (err && err.name === 'AbortError') throw Object.assign(new Error('云端查询超时'), { kind: 'timeout' })
			if (err && !err.kind) err.kind = 'network'
			throw err
		} finally {
			clearTimeout(timer)
		}
	}

	async checkPermit(payload) {
		let token
		try {
			token = await this.getToken()
		} catch (err) {
			if (err && !err.kind) err.kind = 'auth'
			throw err
		}
		if (!token) throw Object.assign(new Error('网关未登录'), { kind: 'auth' })
		return this.call('checkPermitV1', payload, token)
	}

	async syncAudits(records) {
		let token
		try {
			token = await this.getToken()
		} catch (err) {
			if (err && !err.kind) err.kind = 'auth'
			throw err
		}
		if (!token) throw Object.assign(new Error('网关未登录'), { kind: 'auth' })
		return this.call('syncAuditV1', { records }, token)
	}
}

function makeRequestId(gatewayId, bootId, sequence) {
	const prefix = normalizeString(gatewayId).replace(/[^A-Za-z0-9_-]/g, '_') || 'gateway'
	const suffix = crypto.randomBytes(4).toString('hex')
	return `permit_${prefix}_${clampRegister(bootId)}_${clampRegister(sequence)}_${Date.now().toString(36)}_${suffix}`
}

function systemReasonForError(err) {
	const kind = normalizeString(err && err.kind)
	if (kind === 'timeout' || kind === 'network') return 'system_timeout_or_network'
	if (kind === 'database') return 'system_database'
	if (kind === 'auth') return 'system_auth'
	if (kind === 'cloud_audit') return 'system_cloud_audit'
	return 'system_internal'
}

class FillingPermitRuntime {
	constructor(options = {}) {
		this.getConfig = options.getConfig || (() => ({}))
		this.cloudClient = options.cloudClient
		this.journal = options.journal
		this.onState = options.onState || (() => {})
		this.bootIdFactory = options.bootIdFactory || randomBootId
		this.bootId = clampRegister(options.bootId || this.bootIdFactory()) || 1
		this.registers = createRegisterBank(this.bootId)
		this.server = null
		this.running = false
		this.busy = false
		this.activeKey = ''
		this.lastSubmittedKey = ''
		this.lastRequestSequence = null
		this.startCount = 0
		this.heartbeatTimer = null
		this.syncTimer = null
		this.stats = { total: 0, allowed: 0, denied: 0, faults: 0 }
		this.lastQuery = null
	}

	snapshot() {
		return {
			running: this.running,
			busy: this.busy,
			bootId: this.bootId,
			gatewayState: this.registers[REGISTER.GATEWAY_STATE],
			faultCode: this.registers[REGISTER.FAULT_CODE],
			heartbeat: this.registers[REGISTER.HEARTBEAT],
			lastQuery: this.lastQuery,
			stats: { ...this.stats },
			registers: Array.from(this.registers)
		}
	}

	emit(message = '') {
		this.onState({ ...this.snapshot(), message })
	}

	setFailClosed(gatewayState, faultCode) {
		this.registers[REGISTER.ALLOW_FILL_RAW] = 0
		this.registers[REGISTER.GATEWAY_STATE] = gatewayState
		this.registers[REGISTER.FAULT_CODE] = faultCode
	}

	vector() {
		return {
			getHoldingRegister: (addr) => this.readRegister(addr),
			getMultipleHoldingRegisters: (addr, length) => this.readRegisters(addr, length),
			setRegister: (addr, value) => this.writeRegister(addr, value)
		}
	}

	validateAddress(address) {
		const addr = toInt(address, -1)
		if (addr < 0 || addr >= REGISTER.COUNT) {
			const error = new Error('Illegal data address')
			error.modbusErrorCode = 2
			throw error
		}
		return addr
	}

	readRegister(address) {
		return this.registers[this.validateAddress(address)]
	}

	readRegisters(address, length) {
		const start = this.validateAddress(address)
		const count = toInt(length, 0)
		if (count < 1 || start + count > REGISTER.COUNT) {
			const error = new Error('Illegal data address')
			error.modbusErrorCode = 2
			throw error
		}
		return Array.from(this.registers.slice(start, start + count))
	}

	writeRegister(address, value) {
		const addr = this.validateAddress(address)
		if (addr < REGISTER.REQUEST_BOOT_ID || addr > REGISTER.BOTTLE_CHAR_END) {
			const error = new Error('Register is read-only')
			error.modbusErrorCode = 2
			throw error
		}
		this.registers[addr] = clampRegister(value)
		if (addr === REGISTER.REQUEST_SEQ) this.onSequenceCommit()
		return this.registers[addr]
	}

	onSequenceCommit() {
		if (!this.running) return
		const bootId = this.registers[REGISTER.REQUEST_BOOT_ID]
		const sequence = this.registers[REGISTER.REQUEST_SEQ]
		const key = `${bootId}:${sequence}`
		if (sequence === 0) return
		const isDuplicate = key === this.lastSubmittedKey
		const expectedSequence = this.lastRequestSequence == null ? sequence : this.lastRequestSequence === 65535 ? 1 : this.lastRequestSequence + 1
		const isOutOfOrder = sequence !== expectedSequence
		this.registers[REGISTER.ALLOW_FILL_RAW] = 0
		this.registers[REGISTER.RESULT_STATUS] = RESULT_STATUS.PROCESSING
		this.registers[REGISTER.REASON_CODE] = 0
		this.registers[REGISTER.DETAIL_MASK_LOW] = 0
		this.registers[REGISTER.DETAIL_MASK_HIGH] = 0
		this.registers[REGISTER.RESPONSE_BOOT_ID] = 0
		this.registers[REGISTER.RESPONSE_SEQ] = 0
		if (isDuplicate || isOutOfOrder) {
			this.activeKey = `rejected:${key}`
			void this.rejectWithoutCloud({ bootId, sequence, key }, 'system_protocol')
			return
		}
		this.lastSubmittedKey = key
		this.lastRequestSequence = sequence
		if (this.busy) {
			this.activeKey = `rejected:${key}`
			void this.rejectWithoutCloud({ bootId, sequence, key }, 'system_busy')
			return
		}
		this.busy = true
		this.activeKey = key
		this.registers[REGISTER.GATEWAY_STATE] = GATEWAY_STATE.BUSY
		void this.processRequest({ bootId, sequence, key })
	}

	buildRecord(request, bottleNo, result, startedAt, extra = {}) {
		const config = normalizeConfig(this.getConfig())
		return {
			request_id: request.requestId || makeRequestId(config.gatewayId, request.bootId, request.sequence),
			gateway_id: config.gatewayId,
			hmi_boot_id: request.bootId,
			hmi_request_seq: request.sequence,
			bottle_no_input: bottleNo || '',
			normalized_bottle_no: policy.normalizeBottleNo(bottleNo),
			allowed: result.allowed === true,
			outcome: result.outcome,
			reason_code: result.reason_code,
			reason_key: result.reason_key,
			reason_text: result.reason_text,
			detail_mask: Number(result.detail_mask) >>> 0,
			failure_keys: result.failure_keys || [],
			checks: result.checks || {},
			bottle_snapshot: result.bottle_snapshot || null,
			latency_ms: Math.min(Date.now() - startedAt, 65535),
			requested_at: startedAt,
			evaluated_at: Number(result.evaluated_at) || Date.now(),
			source: 'local_gateway',
			...extra
		}
	}

	async appendReceived(record) {
		this.journal.appendEvent({ event: 'request_received', ...record })
	}

	async rejectWithoutCloud(request, reasonKey) {
		const startedAt = Date.now()
		let result = policy.systemDenied(reasonKey, { now: startedAt })
		const config = normalizeConfig(this.getConfig())
		const requestId = makeRequestId(config.gatewayId, request.bootId, request.sequence)
		let bottleNo = ''
		try {
			bottleNo = bottleFromRegisters(this.registers)
		} catch (_) {}
		let record = this.buildRecord({ ...request, requestId }, bottleNo, result, startedAt)
		try {
			await this.appendReceived(record)
			this.journal.appendEvent({ event: 'request_resolved', ...record })
			this.journal.queue(record)
		} catch (_) {
			result = policy.systemDenied('system_local_audit', { now: Date.now() })
			record = this.buildRecord({ ...request, requestId }, bottleNo, result, startedAt)
			this.setFailClosed(GATEWAY_STATE.FAULT, FAULT_CODE.LOCAL_AUDIT)
		}
		this.stats.total += 1
		this.stats.denied += 1
		this.stats.faults += 1
		this.publishResult(request, result, startedAt)
	}

	async processRequest(request) {
		const startedAt = Date.now()
		const config = normalizeConfig(this.getConfig())
		request.requestId = makeRequestId(config.gatewayId, request.bootId, request.sequence)
		let bottleNo = ''
		let result
		let record
		try {
			try {
				bottleNo = bottleFromRegisters(this.registers)
			} catch (err) {
				result = policy.systemDenied('system_protocol', { now: startedAt })
			}
			if (request.bootId !== this.bootId) result = policy.systemDenied('system_protocol', { now: startedAt })
			record = this.buildRecord(request, bottleNo, result || policy.systemDenied('system_not_ready', { now: startedAt }), startedAt)
			try {
				await this.appendReceived(record)
			} catch (err) {
				result = policy.systemDenied('system_local_audit', { now: Date.now() })
				this.stats.faults += 1
				this.setFailClosed(GATEWAY_STATE.FAULT, FAULT_CODE.LOCAL_AUDIT)
			}

			if (!result) {
				try {
					const response = await this.cloudClient.checkPermit({
						request_id: request.requestId,
						gateway_id: config.gatewayId,
						hmi_boot_id: request.bootId,
						hmi_request_seq: request.sequence,
						bottle_no: bottleNo,
						requested_at: startedAt
					})
					result = response.result || response
					if (result.allowed === true && response.audited !== true) {
						throw Object.assign(new Error('云端允许结果缺少审计确认'), { kind: 'cloud_audit' })
					}
				} catch (err) {
					result = policy.systemDenied(systemReasonForError(err), { now: Date.now() })
				}
			}

			record = this.buildRecord(request, bottleNo, result, startedAt, { source: result.outcome === 'system_denied' ? 'local_gateway' : 'cloud_check' })
			try {
				this.journal.appendEvent({ event: 'request_resolved', ...record })
			} catch (_) {
				result = policy.systemDenied('system_local_audit', { now: Date.now() })
				record = this.buildRecord(request, bottleNo, result, startedAt)
				this.setFailClosed(GATEWAY_STATE.FAULT, FAULT_CODE.LOCAL_AUDIT)
			}
			if (result.outcome === 'system_denied') {
				try {
					this.journal.queue(record)
				} catch (_) {
					result = policy.systemDenied('system_local_audit', { now: Date.now() })
					this.setFailClosed(GATEWAY_STATE.FAULT, FAULT_CODE.LOCAL_AUDIT)
				}
			}
		} catch (_) {
			result = policy.systemDenied('system_internal', { now: Date.now() })
			this.setFailClosed(GATEWAY_STATE.FAULT, FAULT_CODE.INTERNAL)
		} finally {
			this.stats.total += 1
			if (result && result.allowed) this.stats.allowed += 1
			else this.stats.denied += 1
			if (result && result.outcome === 'system_denied') this.stats.faults += 1
			this.busy = false
			if (this.activeKey === request.key) {
				this.publishResult(request, result || policy.systemDenied('system_internal'), startedAt)
				this.activeKey = ''
			}
		}
	}

	publishResult(request, result, startedAt) {
		const fields = resultRegisters(result)
		this.registers[REGISTER.ALLOW_FILL_RAW] = 0
		this.registers[REGISTER.RESPONSE_BOOT_ID] = clampRegister(request.bootId)
		this.registers[REGISTER.RESULT_STATUS] = fields[REGISTER.RESULT_STATUS]
		this.registers[REGISTER.ALLOW_FILL_RAW] = fields[REGISTER.ALLOW_FILL_RAW]
		this.registers[REGISTER.REASON_CODE] = fields[REGISTER.REASON_CODE]
		this.registers[REGISTER.DETAIL_MASK_LOW] = fields[REGISTER.DETAIL_MASK_LOW]
		this.registers[REGISTER.DETAIL_MASK_HIGH] = fields[REGISTER.DETAIL_MASK_HIGH]
		this.registers[REGISTER.LATENCY_MS] = Math.min(Math.max(Date.now() - startedAt, 0), 65535)
		if (result && result.outcome === 'system_denied') {
			this.registers[REGISTER.GATEWAY_STATE] = GATEWAY_STATE.DEGRADED
			if (this.registers[REGISTER.FAULT_CODE] === FAULT_CODE.NONE) {
				const reasonCode = Number(result.reason_code)
				if (reasonCode === 93) this.registers[REGISTER.FAULT_CODE] = FAULT_CODE.AUTH
				else if (reasonCode === 96) this.registers[REGISTER.FAULT_CODE] = FAULT_CODE.LOCAL_AUDIT
				else if (reasonCode === 97 || reasonCode === 99) this.registers[REGISTER.FAULT_CODE] = FAULT_CODE.MODBUS
				else if (reasonCode === 95) this.registers[REGISTER.FAULT_CODE] = FAULT_CODE.INTERNAL
				else this.registers[REGISTER.FAULT_CODE] = FAULT_CODE.CLOUD_UNAVAILABLE
			}
		} else {
			this.registers[REGISTER.GATEWAY_STATE] = GATEWAY_STATE.READY
			this.registers[REGISTER.FAULT_CODE] = FAULT_CODE.NONE
		}
		this.registers[REGISTER.RESPONSE_SEQ] = clampRegister(request.sequence)
		this.lastQuery = {
			bootId: request.bootId,
			sequence: request.sequence,
			allowed: Boolean(result && result.allowed),
			reasonCode: Number.isFinite(Number(result && result.reason_code))
				? Number(result.reason_code)
				: 95,
			reasonText: normalizeString(result && result.reason_text),
			latencyMs: this.registers[REGISTER.LATENCY_MS],
			completedAt: Date.now()
		}
		this.emit(this.lastQuery.reasonText)
	}

	async syncPending() {
		if (!this.running || this.busy) return { synced: 0 }
		const pending = this.journal.listPending(50)
		if (!pending.length) return { synced: 0 }
		try {
			const response = await this.cloudClient.syncAudits(pending)
			const syncedIds = Array.isArray(response.synced_request_ids) ? response.synced_request_ids : []
			for (const requestId of syncedIds) this.journal.markSynced(requestId)
			this.emit(`已补传 ${syncedIds.length} 条系统禁止审计`)
			return { synced: syncedIds.length }
		} catch (_) {
			return { synced: 0 }
		}
	}

	async start() {
		if (this.running) return this.snapshot()
		const config = normalizeConfig(this.getConfig())
		if (this.startCount > 0) this.bootId = clampRegister(this.bootIdFactory()) || 1
		this.startCount += 1
		this.lastSubmittedKey = ''
		this.lastRequestSequence = null
		this.registers.fill(0)
		this.registers[REGISTER.PROTOCOL_VERSION] = 1
		this.registers[REGISTER.GATEWAY_BOOT_ID] = this.bootId
		this.registers[REGISTER.GATEWAY_STATE] = GATEWAY_STATE.STARTING
		this.running = true
		let auditHealthy = true
		try {
			this.journal.appendEvent({ event: 'gateway_started', gateway_boot_id: this.bootId, gateway_id: config.gatewayId })
		} catch (_) {
			auditHealthy = false
			this.stats.faults += 1
		}
		const server = new ModbusRTU.ServerTCP(this.vector(), { host: config.bindHost, port: config.port, unitID: config.unitId })
		this.server = server
		server.on('socketError', (err) => {
			this.stats.faults += 1
			this.setFailClosed(GATEWAY_STATE.FAULT, err && err.code === 'EADDRINUSE' ? FAULT_CODE.PORT_IN_USE : FAULT_CODE.MODBUS)
			this.emit(err && err.message ? err.message : 'Modbus 服务故障')
		})
		server.on('serverError', (err) => {
			this.stats.faults += 1
			this.setFailClosed(GATEWAY_STATE.FAULT, FAULT_CODE.MODBUS)
			this.emit(err && err.message ? err.message : 'Modbus 服务故障')
		})
		try {
			await new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('Modbus TCP 监听启动超时')), 3000)
				server.once('initialized', () => {
					clearTimeout(timer)
					resolve()
				})
				server.once('serverError', (err) => {
					clearTimeout(timer)
					reject(err)
				})
			})
		} catch (err) {
			this.running = false
			this.setFailClosed(GATEWAY_STATE.FAULT, err && err.code === 'EADDRINUSE' ? FAULT_CODE.PORT_IN_USE : FAULT_CODE.MODBUS)
			try {
				server.close(() => {})
			} catch (_) {}
			this.server = null
			this.emit(err && err.message ? err.message : 'Modbus TCP 监听失败')
			throw err
		}
		this.heartbeatTimer = setInterval(() => {
			if (!this.running) return
			this.registers[REGISTER.HEARTBEAT] = (this.registers[REGISTER.HEARTBEAT] + 1) & 0xffff
			if (auditHealthy && !this.busy && this.registers[REGISTER.GATEWAY_STATE] === GATEWAY_STATE.STARTING) {
				this.registers[REGISTER.GATEWAY_STATE] = GATEWAY_STATE.READY
			}
			this.emit()
		}, config.heartbeatMs)
		this.syncTimer = setInterval(() => void this.syncPending(), config.syncIntervalMs)
		if (auditHealthy) {
			this.registers[REGISTER.GATEWAY_STATE] = GATEWAY_STATE.READY
			this.emit(`Modbus TCP 已监听 ${config.bindHost}:${config.port}`)
		} else {
			this.setFailClosed(GATEWAY_STATE.FAULT, FAULT_CODE.LOCAL_AUDIT)
			this.emit('本地审计目录不可写，网关保持禁止')
		}
		return this.snapshot()
	}

	async stop() {
		this.running = false
		this.busy = false
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
		if (this.syncTimer) clearInterval(this.syncTimer)
		this.heartbeatTimer = null
		this.syncTimer = null
		this.registers[REGISTER.ALLOW_FILL_RAW] = 0
		this.registers[REGISTER.RESULT_STATUS] = RESULT_STATUS.IDLE
		this.registers[REGISTER.GATEWAY_STATE] = GATEWAY_STATE.STOPPED
		if (this.server) {
			try {
				this.server.close(() => {})
			} catch (_) {}
		}
		this.server = null
		this.emit('网关已停止')
		return this.snapshot()
	}
}

module.exports = {
	REGISTER,
	RESULT_STATUS,
	GATEWAY_STATE,
	FAULT_CODE,
	normalizeString,
	toInt,
	clampRegister,
	randomBootId,
	normalizeConfig,
	bottleFromRegisters,
	writeBottleToRegisters,
	resultRegisters,
	createRegisterBank,
	dailyFileName,
	LocalAuditJournal,
	CloudClient,
	makeRequestId,
	systemReasonForError,
	FillingPermitRuntime,
	policy
}
