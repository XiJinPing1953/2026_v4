// DSX TTL protocol candidate. Diagnostic only until verified against the device.
// Supplier app supports legacy signed grams and current milligrams. Raw bytes
// remain available: delivered firmware and sensor status still need field verification.
export const FLOOR_SCALE_SERVICE_ID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E'
export const FLOOR_SCALE_WRITE_ID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'
export const FLOOR_SCALE_NOTIFY_ID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'
export const FLOOR_SCALE_NAME_PREFIX = 'WEIGHT_'

const HEADER = 0xaa
const FRAME_SIZES = [19, 23]

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
	let buffer = [], checksumErrors = 0, formatErrors = 0
	function reset() { buffer = []; checksumErrors = 0; formatErrors = 0 }
	function push(input) {
		const frames = []
		for (const byte of readBytes(input)) {
			buffer.push(byte)
			while (buffer.length) {
				if (buffer[0] !== HEADER) { buffer.shift(); continue }
				if (buffer.length < 4) break
				const size = buffer[3]
				if (!FRAME_SIZES.includes(size)) { formatErrors++; buffer.shift(); continue }
				if (buffer.length < size) break
				const candidate = buffer.slice(0, size)
				const checksum = candidate.reduce((value, next) => value ^ next, 0)
				if (candidate[1] !== 3 || candidate[2] !== 1 || candidate[5] !== size - 7 || candidate[6] !== (size === 19 ? 6 : 0x22) || checksum !== 0) {
					if (checksum !== 0) checksumErrors++; else formatErrors++
					buffer.shift()
					continue
				}
				frames.push({
					rawHex: hex(candidate),
					moduleId: candidate[7],
					adcHex: hex(candidate.slice(8, 12)),
					weightHex: hex(candidate.slice(12, size - 3)),
					format: size === 19 ? 'legacy-grams' : 'milligrams',
					status: candidate[size - 3],
					timestampHex: hex(candidate.slice(size - 2)),
					verifiedForCapture: false
				})
				buffer.splice(0, size)
			}
		}
		return frames
	}
	return { push, reset, getStats: () => ({ checksumErrors, formatErrors, bufferedBytes: buffer.length }) }
}

// Signed candidate display only, without BigInt (older Android JS engines).
// Two's complement magnitude avoids unsafe unsigned 64-bit intermediates.
export function floorScaleCandidateKg(frame) {
	const value = String(frame?.weightHex || '')
	const legacy = frame?.format === 'legacy-grams'
	if (!(legacy ? /^[0-9A-F]{8}$/ : /^[0-9A-F]{16}$/).test(value)) return null
	const negative = parseInt(value.slice(0, 2), 16) >= 0x80
	let magnitude = 0
	for (let i = 0; i < value.length; i += 2) {
		const byte = parseInt(value.slice(i, i + 2), 16)
		magnitude = magnitude * 256 + (negative ? 255 - byte : byte)
		if (!Number.isSafeInteger(magnitude)) return null
	}
	if (negative) magnitude += 1
	if (!Number.isSafeInteger(magnitude)) return null
	return (negative ? -magnitude : magnitude) / (legacy ? 1000 : 1000000)
}
