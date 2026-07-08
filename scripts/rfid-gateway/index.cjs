#!/usr/bin/env node
'use strict'

const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const {
	RfidStreamParser,
	decodeXtEpc,
	normalizeHex
} = require('./protocol.cjs')

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toPositiveInt(value, fallback) {
	const num = Number(value)
	return Number.isFinite(num) && num > 0 ? Math.trunc(num) : fallback
}

function parseBool(value, fallback = false) {
	if (value === true || value === 'true' || value === '1' || value === 1) return true
	if (value === false || value === 'false' || value === '0' || value === 0) return false
	return fallback
}

function loadEnvFile(filePath) {
	if (!fs.existsSync(filePath)) return
	const raw = fs.readFileSync(filePath, 'utf8')
	raw.split(/\r?\n/).forEach((line) => {
		const text = normalizeString(line)
		if (!text || text.startsWith('#')) return
		const separator = text.indexOf('=')
		if (separator <= 0) return
		const key = text.slice(0, separator).trim()
		const value = text.slice(separator + 1).trim()
		if (!key || process.env[key] != null) return
		process.env[key] = value.replace(/^['"]|['"]$/g, '')
	})
}

function parseArgs(argv) {
	const args = {
		help: false,
		host: '',
		port: null
	}
	for (let index = 2; index < argv.length; index += 1) {
		const current = argv[index]
		if (current === '--help' || current === '-h') args.help = true
		else if (current === '--host') {
			args.host = normalizeString(argv[index + 1])
			index += 1
		} else if (current.startsWith('--host=')) {
			args.host = normalizeString(current.slice('--host='.length))
		} else if (current === '--port') {
			args.port = toPositiveInt(argv[index + 1], null)
			index += 1
		} else if (current.startsWith('--port=')) {
			args.port = toPositiveInt(current.slice('--port='.length), null)
		}
	}
	return args
}

function printHelp() {
	console.log(`
用法:
  node scripts/rfid-gateway/index.cjs
  node scripts/rfid-gateway/index.cjs --host 0.0.0.0 --port 8063

环境变量:
  RFID_GATEWAY_HOST=0.0.0.0
  RFID_GATEWAY_PORT=8063
  RFID_SESSION_WINDOW_MS=15000
  RFID_DEDUP_MS=1000
  RFID_LOG_LEVEL=info
  RFID_CLOUD_UPLOAD_ENABLED=false
  RFID_CLOUD_URL=
  RFID_CLOUD_PASSWORD=
  RFID_CLOUD_GATEWAY_ID=rfid-gate-main
`.trim())
}

function loadConfig(args = {}) {
	loadEnvFile(path.join(__dirname, '.env'))
	const logLevel = normalizeString(process.env.RFID_LOG_LEVEL).toLowerCase() || 'info'
	return {
		host: args.host || normalizeString(process.env.RFID_GATEWAY_HOST) || '0.0.0.0',
		port: args.port || toPositiveInt(process.env.RFID_GATEWAY_PORT, 8063),
		sessionWindowMs: toPositiveInt(process.env.RFID_SESSION_WINDOW_MS, 15000),
		dedupMs: toPositiveInt(process.env.RFID_DEDUP_MS, 1000),
		logLevel,
		gatewayId: normalizeString(process.env.RFID_GATEWAY_ID) || os.hostname() || 'rfid-gateway',
		cloudUploadEnabled: parseBool(process.env.RFID_CLOUD_UPLOAD_ENABLED, false),
		cloudUrl: normalizeString(process.env.RFID_CLOUD_URL),
		cloudPassword: normalizeString(process.env.RFID_CLOUD_PASSWORD),
		cloudGatewayId: normalizeString(process.env.RFID_CLOUD_GATEWAY_ID) || normalizeString(process.env.RFID_GATEWAY_ID) || os.hostname() || 'rfid-gateway'
	}
}

const LEVEL_ORDER = {
	error: 0,
	info: 1,
	debug: 2
}

function shouldLog(config, level) {
	const target = LEVEL_ORDER[config.logLevel] == null ? LEVEL_ORDER.info : LEVEL_ORDER[config.logLevel]
	const current = LEVEL_ORDER[level] == null ? LEVEL_ORDER.info : LEVEL_ORDER[level]
	return current <= target
}

function createLogger(config) {
	return function log(event, payload = {}, level = 'info') {
		if (!shouldLog(config, level)) return
		const doc = {
			event,
			at: new Date().toISOString(),
			...payload
		}
		process.stdout.write(`${JSON.stringify(doc)}\n`)
	}
}

function newSessionId(readerDeviceCode) {
	const stamp = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `rfid_${normalizeString(readerDeviceCode) || 'reader'}_${stamp}_${rand}`
}

function generateRequestId() {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

class RfidCloudUploader {
	constructor(config = {}, log = () => {}) {
		this.enabled = config.cloudUploadEnabled === true
		this.url = normalizeString(config.cloudUrl)
		this.password = normalizeString(config.cloudPassword)
		this.gatewayId = normalizeString(config.cloudGatewayId || config.gatewayId) || 'rfid-gateway'
		this.log = typeof log === 'function' ? log : () => {}
		this.token = ''
		this.tokenExpiresAt = 0
	}

	isConfigured() {
		return this.enabled && Boolean(this.url && this.password)
	}

	async call(action, data = {}, token = '') {
		if (typeof fetch !== 'function') throw new Error('当前 Node 版本缺少 fetch，请使用 Node 18 或更新版本')
		const headers = { 'content-type': 'application/json' }
		if (token) headers.Authorization = `Bearer ${token}`
		const requestId = generateRequestId()
		const startedAt = Date.now()
		const res = await fetch(this.url, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				action,
				data,
				request_id: requestId
			})
		})
		const text = await res.text()
		let json = {}
		try {
			json = text ? JSON.parse(text) : {}
		} catch (_) {
			throw new Error(`云端响应不是 JSON: ${text}`)
		}
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
		if (!json || json.code !== 0) throw new Error(json && json.msg ? json.msg : `云端调用失败: ${text}`)
		return {
			data: json.data || {},
			requestId,
			durationMs: Date.now() - startedAt
		}
	}

	async login() {
		const res = await this.call('loginV1', {
			password: this.password,
			gateway_id: this.gatewayId
		})
		this.token = normalizeString(res.data.token)
		if (!this.token) throw new Error('RFID 云端登录成功但未返回 token')
		const ttl = Number(res.data.expires_in_ms || res.data.expiresInMs || 0)
		this.tokenExpiresAt = ttl > 0 ? Date.now() + ttl - 60000 : Date.now() + 5 * 60 * 1000
		return this.token
	}

	async getToken() {
		if (this.token && this.tokenExpiresAt > Date.now()) return this.token
		return this.login()
	}

	async uploadSession(summary = {}) {
		if (!this.enabled) return { skipped: true, reason: 'disabled' }
		if (!this.isConfigured()) {
			this.log('rfid_cloud_upload_failed', {
				session_id: summary.session_id || '',
				reason: 'cloud_not_configured'
			}, 'error')
			return { skipped: true, reason: 'cloud_not_configured' }
		}
		const session = {
			...summary,
			gateway_id: this.gatewayId,
			uploaded_at: new Date().toISOString()
		}
		try {
			const token = await this.getToken()
			const res = await this.call('ingestSessionV1', { session }, token)
			this.log('rfid_cloud_upload_ok', {
				session_id: session.session_id || '',
				request_id: res.requestId,
				duration_ms: res.durationMs,
				inserted: res.data.inserted === true,
				status: res.data.status || '',
				bottle_total: res.data.bottle_total ?? session.bottle_total ?? 0,
				bound_bottle_total: res.data.bound_bottle_total ?? 0,
				unbound_bottle_total: res.data.unbound_bottle_total ?? 0,
				unknown_total: res.data.unknown_total ?? session.unknown_total ?? 0
			})
			return res
		} catch (error) {
			this.token = ''
			this.tokenExpiresAt = 0
			this.log('rfid_cloud_upload_failed', {
				session_id: session.session_id || '',
				error_message: normalizeString(error && error.message)
			}, 'error')
			return { error }
		}
	}
}

function createTagRecord(event, now) {
	const xt = event.xt || decodeXtEpc(event.epc)
	return {
		epc: event.epc,
		epc_kind: xt.epc_kind || 'unknown_epc',
		entity_type: xt.entity_type || 'unknown',
		serial: xt.serial || '',
		is_xt: xt.is_xt === true,
		crc_ok: xt.crc_ok === true,
		read_count: 1,
		first_seen_at: now,
		last_seen_at: now
	}
}

function updateTagRecord(record, now) {
	record.read_count += 1
	record.last_seen_at = now
	return record
}

class RfidSessionTracker {
	constructor(options = {}) {
		this.windowMs = toPositiveInt(options.sessionWindowMs, 15000)
		this.dedupMs = toPositiveInt(options.dedupMs, 1000)
		this.log = typeof options.log === 'function' ? options.log : () => {}
		this.onSummary = typeof options.onSummary === 'function' ? options.onSummary : null
		this.sessions = new Map()
		this.pending = new Map()
	}

	processTag(event, at = Date.now()) {
		const xt = event.xt || decodeXtEpc(event.epc)
		const readerDeviceCode = normalizeString(event.reader_device_code) || 'unknown'
		const session = this.getActiveSession(readerDeviceCode, at)
		const result = {
			reader_device_code: readerDeviceCode,
			epc: event.epc,
			epc_kind: xt.epc_kind || 'unknown_epc',
			entity_type: xt.entity_type || 'unknown',
			serial: xt.serial || '',
			is_xt: xt.is_xt === true,
			crc_ok: xt.crc_ok === true,
			in_session: false,
			deduped: false,
			session_id: session ? session.session_id : ''
		}

		if (xt.entity_type === 'vehicle' && xt.crc_ok) {
			const nextSession = this.openOrRefreshVehicleSession(readerDeviceCode, event, at)
			result.in_session = true
			result.session_id = nextSession.session_id
			return result
		}

		if (session) {
			const addRes = this.addTagToSession(session, event, at)
			result.in_session = true
			result.deduped = addRes.deduped
			result.session_id = session.session_id
			return result
		}

		this.addPending(readerDeviceCode, event, at)
		return result
	}

	getActiveSession(readerDeviceCode, at) {
		const session = this.sessions.get(readerDeviceCode)
		if (!session) return null
		if (session.expires_at <= at) {
			this.finalize(readerDeviceCode, 'expired', at)
			return null
		}
		return session
	}

	openOrRefreshVehicleSession(readerDeviceCode, event, at) {
		let session = this.sessions.get(readerDeviceCode)
		if (!session || session.expires_at <= at) {
			if (session) this.finalize(readerDeviceCode, 'expired', at)
			session = {
				session_id: newSessionId(readerDeviceCode),
				reader_device_code: readerDeviceCode,
				started_at: at,
				last_seen_at: at,
				expires_at: at + this.windowMs,
				vehicle_epc: event.epc,
				vehicles: new Map(),
				bottles: new Map(),
				unknown_tags: new Map(),
				vehicle_conflict: false,
				timer: null
			}
			this.sessions.set(readerDeviceCode, session)
			this.attachPending(session, at)
		}
		session.last_seen_at = at
		session.expires_at = at + this.windowMs
		if (session.vehicle_epc && session.vehicle_epc !== event.epc) session.vehicle_conflict = true
		if (!session.vehicle_epc) session.vehicle_epc = event.epc
		this.addTagToMap(session.vehicles, event, at)
		this.scheduleFinalize(readerDeviceCode)
		return session
	}

	addTagToSession(session, event, at) {
		session.last_seen_at = at
		session.expires_at = Math.max(session.expires_at, at + this.windowMs)
		const xt = event.xt || decodeXtEpc(event.epc)
		const target = xt.entity_type === 'bottle' && xt.crc_ok ? session.bottles : session.unknown_tags
		const addRes = this.addTagToMap(target, event, at)
		this.scheduleFinalize(session.reader_device_code)
		return addRes
	}

	addTagToMap(map, event, at) {
		const existing = map.get(event.epc)
		if (existing) {
			const deduped = at - existing.last_seen_at <= this.dedupMs
			updateTagRecord(existing, at)
			return { record: existing, deduped }
		}
		const record = createTagRecord(event, at)
		map.set(event.epc, record)
		return { record, deduped: false }
	}

	addPending(readerDeviceCode, event, at) {
		const list = this.pending.get(readerDeviceCode) || []
		const next = list.filter((item) => at - item.at <= this.windowMs)
		next.push({ event, at })
		this.pending.set(readerDeviceCode, next)
	}

	attachPending(session, at) {
		const list = this.pending.get(session.reader_device_code) || []
		const retained = []
		list.forEach((item) => {
			if (at - item.at <= this.windowMs) this.addTagToSession(session, item.event, item.at)
			else retained.push(item)
		})
		if (retained.length) this.pending.set(session.reader_device_code, retained)
		else this.pending.delete(session.reader_device_code)
	}

	scheduleFinalize(readerDeviceCode) {
		const session = this.sessions.get(readerDeviceCode)
		if (!session) return
		if (session.timer) clearTimeout(session.timer)
		const delay = Math.max(session.expires_at - Date.now(), 1)
		session.timer = setTimeout(() => {
			this.finalize(readerDeviceCode, 'expired', Date.now())
		}, delay)
	}

	finalize(readerDeviceCode, reason = 'manual', at = Date.now()) {
		const session = this.sessions.get(readerDeviceCode)
		if (!session) return null
		if (session.timer) clearTimeout(session.timer)
		this.sessions.delete(readerDeviceCode)
		const summary = this.buildSummary(session, reason, at)
		this.log('rfid_session_summary', summary, 'info')
		if (this.onSummary) {
			Promise.resolve()
				.then(() => this.onSummary(summary))
				.catch((error) => {
					this.log('rfid_cloud_upload_failed', {
						session_id: summary.session_id || '',
						error_message: normalizeString(error && error.message)
					}, 'error')
				})
		}
		return summary
	}

	buildSummary(session, reason, at) {
		const vehicles = Array.from(session.vehicles.values())
		const bottles = Array.from(session.bottles.values())
		const unknownTags = Array.from(session.unknown_tags.values())
		return {
			session_id: session.session_id,
			reader_device_code: session.reader_device_code,
			reason,
			started_at: new Date(session.started_at).toISOString(),
			ended_at: new Date(at).toISOString(),
			duration_ms: Math.max(at - session.started_at, 0),
			vehicle_epc: session.vehicle_epc || '',
			vehicle_epcs: vehicles.map((item) => item.epc),
			vehicle_serials: vehicles.map((item) => item.serial).filter(Boolean),
			vehicle_conflict: session.vehicle_conflict === true || vehicles.length > 1,
			bottle_total: bottles.length,
			bottles,
			unknown_total: unknownTags.length,
			unknown_tags: unknownTags
		}
	}

	finalizeAll(reason = 'shutdown') {
		const summaries = []
		for (const readerDeviceCode of Array.from(this.sessions.keys())) {
			const summary = this.finalize(readerDeviceCode, reason, Date.now())
			if (summary) summaries.push(summary)
		}
		return summaries
	}
}

function buildTagLog(event, sessionResult, remote = {}) {
	return {
		remote_address: remote.remoteAddress || '',
		remote_port: remote.remotePort || null,
		reader_device_code: event.reader_device_code,
		epc: event.epc,
		epc_kind: sessionResult.epc_kind,
		entity_type: sessionResult.entity_type,
		serial: sessionResult.serial,
		is_xt: sessionResult.is_xt,
		crc_ok: event.crc_ok === true,
		frame_hex: event.frame_hex,
		in_session: sessionResult.in_session,
		deduped: sessionResult.deduped,
		session_id: sessionResult.session_id
	}
}

function startServer(config) {
	const log = createLogger(config)
	const cloudUploader = new RfidCloudUploader(config, log)
	const tracker = new RfidSessionTracker({
		sessionWindowMs: config.sessionWindowMs,
		dedupMs: config.dedupMs,
		log,
		onSummary: (summary) => cloudUploader.uploadSession(summary)
	})
	const server = net.createServer((socket) => {
		const parser = new RfidStreamParser()
		const remote = {
			remoteAddress: socket.remoteAddress,
			remotePort: socket.remotePort
		}
		log('rfid_connection', {
			status: 'connected',
			...remote
		})

		socket.on('data', (chunk) => {
			const events = parser.push(chunk)
			events.forEach((event) => {
				if (event.type === 'heartbeat') {
					log('rfid_heartbeat', {
						...remote,
						frame_hex: event.frame_hex
					})
					return
				}
				if (event.type === 'tag') {
					const result = tracker.processTag(event)
					log('rfid_tag_seen', buildTagLog(event, result, remote))
					return
				}
				if (event.type === 'ignored') {
					log('rfid_frame_ignored', {
						...remote,
						reason: event.reason,
						frame_hex: event.frame_hex
					})
					return
				}
				if (event.type === 'parse_error') {
					log('rfid_parse_error', {
						...remote,
						...event
					}, 'error')
				}
			})
		})

		socket.on('error', (error) => {
			log('rfid_connection', {
				status: 'socket_error',
				...remote,
				error_message: normalizeString(error && error.message)
			}, 'error')
		})

		socket.on('close', () => {
			log('rfid_connection', {
				status: 'closed',
				...remote
			})
		})
	})

	server.on('error', (error) => {
		log('rfid_parse_error', {
			reason: 'server_error',
			error_message: normalizeString(error && error.message)
		}, 'error')
	})

	server.listen(config.port, config.host, () => {
		log('rfid_connection', {
			status: 'listening',
			host: config.host,
			port: config.port,
			gateway_id: config.gatewayId,
			session_window_ms: config.sessionWindowMs,
			dedup_ms: config.dedupMs,
			cloud_upload_enabled: config.cloudUploadEnabled === true,
			cloud_upload_configured: cloudUploader.isConfigured()
		})
	})

	function shutdown(signal) {
		log('rfid_connection', {
			status: 'shutdown',
			signal
		})
		tracker.finalizeAll('shutdown')
		server.close(() => process.exit(0))
		setTimeout(() => process.exit(0), 1500).unref()
	}

	process.once('SIGINT', shutdown)
	process.once('SIGTERM', shutdown)

	return { server, tracker, log, cloudUploader }
}

function main() {
	const args = parseArgs(process.argv)
	if (args.help) {
		printHelp()
		return
	}
	const config = loadConfig(args)
	startServer(config)
}

if (require.main === module) {
	main()
}

module.exports = {
	RfidSessionTracker,
	RfidCloudUploader,
	buildTagLog,
	createLogger,
	loadConfig,
	parseArgs,
	startServer
}
