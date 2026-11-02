const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const source = fs.readFileSync('src/services/pda/floorScaleDisplay.js', 'utf8').replace(/export /g, '')
const { floorScaleDisplayWeight: display } = vm.runInNewContext(source + '\n;({floorScaleDisplayWeight})')
const frame = weight_kg => ({ is_connected: true, is_online: true, weight_kg })
const { floorZeroObservation } = vm.runInNewContext(source + '\n;({floorZeroObservation})')

test('half-kilogram display preserves signed raw values without zero correction', () => {
	for (const [value, expected] of [[200, '200.0'], [200.249, '200.0'], [200.25, '200.5'], [-0.249, '0.0'], [-0.25, '-0.5'], [-0.5, '-0.5'], [7.148, '7.0']]) {
		const s = Object.freeze(frame(value))
		assert.equal(display(s), expected)
		assert.equal(display(s, { raw: true }), value.toFixed(3))
		assert.equal(s.weight_kg, value)
	}
})

test('45-minute observation measures unrounded drift and rejects missing or stale samples', () => {
	let clock = 10000
	const point = weight => ({ ...frame(weight), sampled_at: clock, device_id: 'scale', connection_key: 'attempt1' })
	const o = floorZeroObservation(point(0), () => clock)
	o.sample(point(-0.124)); clock += 1000
	o.sample(point(0.121)); clock += 4000
	const missing = o.sample({...point(0), sampled_at: clock - 4000})
	assert.equal(missing.count, 2); assert.equal(missing.missing, 1); assert.equal(missing.last, 0.121)
	clock += 2695000
	const end = o.sample(point(-0.251)); assert.equal(end.status, '45分钟观察结束'); assert.equal(end.min, -0.251); assert.equal(end.max, 0.121); assert.equal(end.first, -0.124); assert.equal(end.count, 3)
	assert.equal(o.sample(point(200)).count, 3)
})
test('a successor connection cannot contribute to the existing empty-platform observation', () => {
	const s = { ...frame(-0.5), sampled_at: 1000, device_id: 'scale', connection_key: 'first' }
	const o = floorZeroObservation(s, () => 1000); o.sample(s)
	const end = o.sample({ ...s, connection_key: 'second', weight_kg: 200 }); assert.equal(end.status, '连接已结束'); assert.equal(end.last, -0.5)
})
test('stale, disconnected and invalid values cannot become a zero reading', () => {
	for (const s of [null, frame(null), frame(NaN), frame(Infinity), { ...frame(200), is_online: false }, { ...frame(200), is_connected: false }]) {
		assert.equal(display(s), '—'); assert.equal(display(s, { raw: true }), '—')
	}
})
