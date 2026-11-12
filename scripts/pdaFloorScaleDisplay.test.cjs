const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
const source = fs.readFileSync('src/services/pda/floorScaleDisplay.js', 'utf8').replace(/export /g, '')
const { floorScaleDisplayWeight: display } = vm.runInNewContext(source + '\n;({floorScaleDisplayWeight})')
const frame = weight_kg => ({ is_connected: true, is_online: true, weight_kg })

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

test('session display weight is authoritative and raw weight remains inspectable', () => {
 const s=Object.freeze({...frame(184.76),display_kg:184.5})
 assert.equal(display(s),'184.5')
 assert.equal(display(s,{raw:true}),'184.760')
 assert.equal(s.weight_kg,184.76)
 for(const value of [null,undefined,NaN,Infinity]) assert.equal(display({...s,display_kg:value}),'185.0')
 for(const invalid of [{is_online:false},{is_connected:false},{qualified_frame:false},{warming:true}]) assert.equal(display({...s,...invalid}),'—')
})

test('old display tare options no longer subtract from live gross', () => {
 const s={...frame(185.123),device_id:'A',connection_key:'s1'}
 assert.equal(display(s,{tare:{kg:20,deviceId:'A',connectionKey:'s1'}}),'185.0')
 assert.equal(display({...s,weight_kg:0}),'0.0')
 assert.equal(display({...s,weight_kg:-20}),'-20.0')
})
