const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/services/pda/floorScaleProtocol.js', 'utf8').replace(/export /g, '')
const { createFloorScaleFrameDecoder, floorScaleCandidateKg } = vm.runInThisContext(`${source}\n;({createFloorScaleFrameDecoder, floorScaleCandidateKg})`)

function frame(weight = [0, 0, 0, 0, 0, 0, 0, 1]) {
	const bytes = [0xaa, 3, 1, 23, 0, 16, 0x22, 0, 1, 2, 3, 4, ...weight, 1, 0, 42]
	bytes[4] = bytes.reduce((v, b) => v ^ b, 0)
	return bytes
}
test('reassembles a split 23-byte frame without treating unverified data as a weight', () => {
	const d = createFloorScaleFrameDecoder(), f = frame()
	assert.deepEqual(d.push(f.slice(0, 17)), [])
	const [received] = d.push(f.slice(17))
	assert.equal(received.weightHex, '0000000000000001')
	assert.equal(received.status, 1)
	assert.equal(received.verifiedForCapture, false)
	assert.equal('weightKg' in received, false)
})
test('recovers from noise, invalid checksum and bad frame headers', () => {
	const d = createFloorScaleFrameDecoder(), bad = frame()
	bad[15] ^= 1
	const bytes = [9, 0xaa, 1, 2, 3, ...bad, ...frame()]
	assert.equal(d.push(bytes).length, 1)
})
test('handles adjacent frames and typed-array offsets', () => {
	const d = createFloorScaleFrameDecoder(), bytes = Uint8Array.from([8, ...frame(), ...frame(), 9])
	assert.equal(d.push(bytes.subarray(1, -1)).length, 2)
})
test('disconnect reset discards old fragments', () => {
	const d = createFloorScaleFrameDecoder(), f = frame()
	d.push(f.slice(0, 10)); d.reset()
	assert.equal(d.push(f.slice(10)).length, 0)
	assert.equal(d.push(f).length, 1)
})
test('candidate signed conversion rejects unsafe magnitudes and remains unverified', () => {
	const d = createFloorScaleFrameDecoder()
	const [f] = d.push(frame([0, 0, 0, 0, 0, 15, 66, 64]))
	assert.equal(floorScaleCandidateKg(f), 1)
	assert.equal(f.verifiedForCapture, false)
	assert.equal(floorScaleCandidateKg({ weightHex: '8000000000000000' }), null)
	assert.equal(floorScaleCandidateKg({ weightHex: '0020000000000000' }), null)
	assert.equal(floorScaleCandidateKg({ weightHex: 'invalid' }), null)
})
