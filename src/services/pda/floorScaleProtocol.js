// DSX TTL protocol candidate. Diagnostic only until verified against the device.
// Keep raw bytes: the signedness and status/timestamp semantics are undocumented.
export const FLOOR_SCALE_SERVICE_ID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E'
export const FLOOR_SCALE_WRITE_ID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'
export const FLOOR_SCALE_NOTIFY_ID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'
export const FLOOR_SCALE_NAME_PREFIX = 'WEIGHT_'

const HEADER = 0xaa
const FRAME_SIZE = 23

function hex(bytes) {
	return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
}

function readBytes(input) {
	if (input instanceof ArrayBuffer) return new Uint8Array(input)
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
	if (Array.isArray(input) && input.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) return Uint8Array.from(input)
	throw new TypeError('Expected byte data')
}

// Consumes fragmented and concatenated BLE notifications; never turns an
// undocumented measurement into a weight usable for a business record.
export function createFloorScaleFrameDecoder() {
	let buffer = []
	function reset() { buffer = [] }
	function push(input) {
		const frames = []
		for (const byte of readBytes(input)) {
			buffer.push(byte)
			while (buffer.length) {
				if (buffer[0] !== HEADER) { buffer.shift(); continue }
				if (buffer.length < 4) break
				if (buffer[3] !== FRAME_SIZE) { buffer.shift(); continue }
				if (buffer.length < FRAME_SIZE) break
				const candidate = buffer.slice(0, FRAME_SIZE)
				const checksum = candidate.reduce((value, next) => value ^ next, 0)
				if (candidate[1] !== 3 || candidate[2] !== 1 || candidate[5] !== 16 || candidate[6] !== 0x22 || checksum !== 0) {
					buffer.shift()
					continue
				}
				frames.push({
					rawHex: hex(candidate),
					moduleId: candidate[7],
					adcHex: hex(candidate.slice(8, 12)),
					weightHex: hex(candidate.slice(12, 20)),
					status: candidate[20],
					timestampHex: hex(candidate.slice(21, 23)),
					verifiedForCapture: false
				})
				buffer.splice(0, FRAME_SIZE)
			}
		}
		return frames
	}
	return { push, reset }
}

// Candidate display only. The protocol describes an eight-byte big-endian mg
// quantity but does not specify signedness or sensor fault semantics.
export function floorScaleCandidateKg(frame) {
	const value = String(frame?.weightHex || '')
	if (!/^[0-9A-F]{16}$/.test(value) || parseInt(value.slice(0, 2), 16) >= 0x80) return null
	let mg = 0
	for (let i = 0; i < value.length; i += 2) {
		mg = mg * 256 + parseInt(value.slice(i, i + 2), 16)
		if (!Number.isSafeInteger(mg)) return null
	}
	return mg / 1000000
}
