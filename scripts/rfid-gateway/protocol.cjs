'use strict'

const RFID_MODBUS_ADDRESS = 0x01
const RFID_MODBUS_FUNCTION_WRITE_MULTIPLE = 0x10
const RFID_REGISTER_EPC_CANDIDATES = new Set([0x03e8, 0x03e9])
const RFID_EPC_BYTE_LENGTH = 12
const RFID_PAYLOAD_BYTE_LENGTH = 2 + RFID_EPC_BYTE_LENGTH
const XT_PREFIX = Buffer.from([0x58, 0x54])
const XT_VERSION = 0x01
const XT_TYPE_BOTTLE = 0x01
const XT_TYPE_VEHICLE = 0x02

function normalizeHex(value) {
	return String(value == null ? '' : value).replace(/[^0-9a-fA-F]/g, '').toUpperCase()
}

function toHex(buffer) {
	return Buffer.from(buffer || []).toString('hex').toUpperCase()
}

function toByte(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	return Math.max(0, Math.min(0xff, Math.trunc(num)))
}

function crc16Modbus(buffer) {
	let crc = 0xffff
	for (const byte of Buffer.from(buffer || [])) {
		crc ^= byte
		for (let index = 0; index < 8; index += 1) {
			if (crc & 0x0001) crc = (crc >> 1) ^ 0xa001
			else crc >>= 1
		}
	}
	return crc & 0xffff
}

function readUInt48BE(buffer, offset = 0) {
	const source = Buffer.from(buffer || [])
	if (source.length < offset + 6) return 0n
	let value = 0n
	for (let index = 0; index < 6; index += 1) {
		value = (value << 8n) + BigInt(source[offset + index])
	}
	return value
}

function writeUInt48BE(buffer, value, offset = 0) {
	let num = BigInt(value)
	if (num < 0n || num > 0xffffffffffffn) throw new Error('XT EPC serial must be between 0 and 281474976710655')
	for (let index = 5; index >= 0; index -= 1) {
		buffer[offset + index] = Number(num & 0xffn)
		num >>= 8n
	}
}

function decodeXtEpc(epcHex) {
	const normalized = normalizeHex(epcHex)
	if (normalized.length !== RFID_EPC_BYTE_LENGTH * 2) {
		return {
			epc: normalized,
			is_xt: false,
			epc_kind: 'unknown_epc',
			entity_type: 'unknown',
			crc_ok: false
		}
	}
	const epc = Buffer.from(normalized, 'hex')
	const hasPrefix = epc[0] === XT_PREFIX[0] && epc[1] === XT_PREFIX[1]
	if (!hasPrefix) {
		return {
			epc: normalized,
			is_xt: false,
			epc_kind: 'unknown_epc',
			entity_type: 'unknown',
			crc_ok: false
		}
	}
	const version = epc[2]
	const type = epc[3]
	const expectedCrc = crc16Modbus(epc.subarray(0, 10))
	const actualCrc = epc.readUInt16LE(10)
	const crcOk = expectedCrc === actualCrc
	let entityType = 'unknown'
	let epcKind = 'unknown_epc'
	if (version === XT_VERSION && crcOk && type === XT_TYPE_BOTTLE) {
		entityType = 'bottle'
		epcKind = 'bottle'
	} else if (version === XT_VERSION && crcOk && type === XT_TYPE_VEHICLE) {
		entityType = 'vehicle'
		epcKind = 'vehicle'
	} else if (!crcOk) {
		epcKind = 'invalid_xt'
	} else if (version !== XT_VERSION) {
		epcKind = 'unsupported_xt_version'
	}
	const serial = readUInt48BE(epc, 4)
	return {
		epc: normalized,
		is_xt: true,
		epc_kind: epcKind,
		entity_type: entityType,
		version,
		type,
		serial: serial.toString(),
		serial_hex: epc.subarray(4, 10).toString('hex').toUpperCase(),
		crc_ok: crcOk,
		expected_crc: expectedCrc.toString(16).toUpperCase().padStart(4, '0'),
		actual_crc: actualCrc.toString(16).toUpperCase().padStart(4, '0')
	}
}

function encodeXtEpc(entityType, serial) {
	const typeText = String(entityType || '').trim().toLowerCase()
	const type = typeText === 'vehicle' ? XT_TYPE_VEHICLE : typeText === 'bottle' ? XT_TYPE_BOTTLE : Number(entityType)
	if (type !== XT_TYPE_BOTTLE && type !== XT_TYPE_VEHICLE) throw new Error('XT EPC entityType must be bottle or vehicle')
	const epc = Buffer.alloc(RFID_EPC_BYTE_LENGTH)
	epc[0] = XT_PREFIX[0]
	epc[1] = XT_PREFIX[1]
	epc[2] = XT_VERSION
	epc[3] = type
	writeUInt48BE(epc, BigInt(serial), 4)
	const crc = crc16Modbus(epc.subarray(0, 10))
	epc.writeUInt16LE(crc, 10)
	return epc.toString('hex').toUpperCase()
}

function parseRfidTagFrame(frame) {
	const source = Buffer.from(frame || [])
	const byteCount = source[6]
	const payloadStart = 7
	const payloadEnd = payloadStart + byteCount
	const register = source.readUInt16BE(2)
	const quantity = source.readUInt16BE(4)
	const payload = source.subarray(payloadStart, payloadEnd)
	const deviceCode = payload.subarray(0, 2)
	const epc = payload.subarray(2, 2 + RFID_EPC_BYTE_LENGTH)
	const expectedCrc = crc16Modbus(source.subarray(0, payloadEnd))
	const actualCrc = source.readUInt16LE(payloadEnd)
	const crcOk = expectedCrc === actualCrc
	const epcHex = toHex(epc)
	return {
		frame_hex: toHex(source),
		slave_address: source[0],
		function_code: source[1],
		register: register.toString(16).toUpperCase().padStart(4, '0'),
		quantity,
		byte_count: byteCount,
		reader_device_code: toHex(deviceCode),
		epc: epcHex,
		xt: decodeXtEpc(epcHex),
		crc_ok: crcOk,
		expected_crc: expectedCrc.toString(16).toUpperCase().padStart(4, '0'),
		actual_crc: actualCrc.toString(16).toUpperCase().padStart(4, '0')
	}
}

function isLikelyRfidTagHeader(buffer) {
	if (buffer.length < 7) return false
	if (buffer[0] !== RFID_MODBUS_ADDRESS) return false
	if (buffer[1] !== RFID_MODBUS_FUNCTION_WRITE_MULTIPLE) return false
	const register = buffer.readUInt16BE(2)
	if (!RFID_REGISTER_EPC_CANDIDATES.has(register)) return false
	if (buffer[6] !== RFID_PAYLOAD_BYTE_LENGTH) return false
	return true
}

class RfidStreamParser {
	constructor(options = {}) {
		this.maxBufferBytes = Math.max(Number(options.maxBufferBytes) || 4096, 128)
		this.buffer = Buffer.alloc(0)
	}

	push(chunk) {
		if (!chunk || chunk.length <= 0) return []
		const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		this.buffer = Buffer.concat([this.buffer, nextChunk])
		if (this.buffer.length > this.maxBufferBytes) {
			const dropped = this.buffer.length - this.maxBufferBytes
			this.buffer = this.buffer.subarray(dropped)
			return [
				{
					type: 'parse_error',
					reason: 'buffer_overflow',
					dropped_bytes: dropped
				},
				...this.drain()
			]
		}
		return this.drain()
	}

	drain() {
		const events = []
		while (this.buffer.length > 0) {
			const first = this.buffer[0]

			if (first === 0x00) {
				events.push({
					type: 'heartbeat',
					frame_hex: '00'
				})
				this.buffer = this.buffer.subarray(1)
				continue
			}

			if (first === 0x01) {
				if (this.buffer.length < 7) break
				if (!isLikelyRfidTagHeader(this.buffer)) {
					events.push({
						type: 'parse_error',
						reason: 'unexpected_modbus_header',
						byte_hex: first.toString(16).toUpperCase().padStart(2, '0')
					})
					this.buffer = this.buffer.subarray(1)
					continue
				}
				const byteCount = this.buffer[6]
				const frameLength = 7 + byteCount + 2
				if (this.buffer.length < frameLength) break
				const frame = this.buffer.subarray(0, frameLength)
				const parsed = parseRfidTagFrame(frame)
				if (!parsed.crc_ok) {
					events.push({
						type: 'parse_error',
						reason: 'crc_mismatch',
						frame_hex: parsed.frame_hex,
						expected_crc: parsed.expected_crc,
						actual_crc: parsed.actual_crc
					})
				} else {
					events.push({
						type: 'tag',
						...parsed
					})
				}
				this.buffer = this.buffer.subarray(frameLength)
				continue
			}

			if (first === 0x55 || first === 0x22) {
				if (this.buffer.length < 8) break
				const frame = this.buffer.subarray(0, 8)
				events.push({
					type: 'ignored',
					reason: first === 0x55 ? 'debug_command' : 'debug_response',
					frame_hex: toHex(frame)
				})
				this.buffer = this.buffer.subarray(8)
				continue
			}

			if (first === 0xa0) {
				if (this.buffer.length < 2) break
				const length = this.buffer[1]
				if (length < 3 || length > 64) {
					events.push({
						type: 'parse_error',
						reason: 'invalid_uhf_length',
						frame_hex: toHex(this.buffer.subarray(0, Math.min(this.buffer.length, 8)))
					})
					this.buffer = this.buffer.subarray(1)
					continue
				}
				const frameLength = 2 + length
				if (this.buffer.length < frameLength) break
				const frame = this.buffer.subarray(0, frameLength)
				events.push({
					type: 'ignored',
					reason: 'uhf_protocol_response',
					frame_hex: toHex(frame)
				})
				this.buffer = this.buffer.subarray(frameLength)
				continue
			}

			events.push({
				type: 'parse_error',
				reason: 'unknown_frame_prefix',
				byte_hex: first.toString(16).toUpperCase().padStart(2, '0')
			})
			this.buffer = this.buffer.subarray(1)
		}
		return events
	}
}

module.exports = {
	RFID_EPC_BYTE_LENGTH,
	RFID_PAYLOAD_BYTE_LENGTH,
	XT_TYPE_BOTTLE,
	XT_TYPE_VEHICLE,
	crc16Modbus,
	decodeXtEpc,
	encodeXtEpc,
	normalizeHex,
	parseRfidTagFrame,
	RfidStreamParser,
	toHex
}
