const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const source = fs.readFileSync('src/services/pda/floorScaleDisplay.js', 'utf8').replace(/export /g, '')
const { floorScaleDisplayWeight: display } = vm.runInNewContext(source + '\n;({floorScaleDisplayWeight})')
const frame = weight_kg => ({ is_connected: true, is_online: true, weight_kg })
const { floorDisplayTarePoint } = vm.runInNewContext(source + '\n;({floorDisplayTarePoint})')

test('half-kilogram display preserves signed raw values without zero correction', () => {
	for (const [value, expected] of [[200, '200.0'], [200.249, '200.0'], [200.25, '200.5'], [-0.249, '0.0'], [-0.25, '-0.5'], [-0.5, '-0.5'], [7.148, '7.0']]) {
		const s = Object.freeze(frame(value))
		assert.equal(display(s), expected)
		assert.equal(display(s, { raw: true }), value.toFixed(3))
		assert.equal(s.weight_kg, value)
	}
})

test('stale, disconnected and invalid values cannot become a zero reading', () => {
	for (const s of [null, frame(null), frame(NaN), frame(Infinity), { ...frame(200), is_online: false }, { ...frame(200), is_connected: false }]) {
		assert.equal(display(s), '—'); assert.equal(display(s, { raw: true }), '—')
	}
})

test('display tare follows addition and removal without changing raw or saved gross', () => {
 const s=Object.freeze({...frame(20.123),device_id:'A',sampled_at:10000})
 const tare=floorDisplayTarePoint(s,10000)
 assert.equal(display(s,{tare}),'0.0');assert.equal(display(s),'20.0');assert.equal(s.weight_kg,20.123)
 assert.equal(display({...s,weight_kg:185.123},{tare}),'165.0')
 assert.equal(display({...s,weight_kg:0.123},{tare}),'-20.0')
 assert.equal(display({...s,weight_kg:185.123},{tare:null}),'185.0')
 assert.equal(display({...s,device_id:'B'},{tare}),'20.0')
 assert.equal(display({...s,is_online:false},{tare}),'—')
 assert.equal(floorDisplayTarePoint(s,13001),null)
 assert.equal(floorDisplayTarePoint({...s,qualified_frame:false},10000),null)
})
