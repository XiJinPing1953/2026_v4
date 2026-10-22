const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const status = new Function(fs.readFileSync('src/services/pda/weighStatus.js', 'utf8').replace('export ', '') + ';return pdaWeighStatus')()
const live = { is_connected: true, is_online: true, is_stable: true, weight_kg: 120 }
test('stable scale alone does not show a completed bottle', () => {
 assert.equal(status(live).tone, 'waiting')
 assert.equal(status(live, { selected: true }).tone, 'waiting')
 assert.equal(status(live, { selected: true, captured: true, gross: 120 }).tone, 'ready')
})
test('swing and too-small out weight warn; pending corrections are not green', () => {
 assert.equal(status({ ...live, is_stable: false }, { selected: true }).tone, 'warning')
 assert.equal(status({ ...live, weight_kg: 90 }, { selected: true, tare: 100, positiveNet: true }).tone, 'warning')
 assert.equal(status(live, { selected: true, captured: true, gross: 119.5 }).tone, 'waiting')
})
test('return signed net remains usable; timeout or unloaded live scale cannot falsely turn green', () => {
 const bottle = { selected: true, captured: true, gross: 99.5, tare: 100 }
 assert.equal(status({ ...live, weight_kg: 99.5 }, bottle).tone, 'ready')
 assert.equal(status({ ...live, weight_kg: 4 }, bottle).tone, 'warning')
 assert.equal(status({ ...live, is_online: false }, bottle).tone, 'waiting')
 assert.equal(status({ ...live, is_connected: false }, bottle).tone, 'waiting')
})

test('unloading rejection stays red using the same anchor floor as capture', () => {
 const createAuto = new Function(fs.readFileSync('src/services/pda/autoReturnWeight.js', 'utf8').replace('export ', '') + ';return createAutoReweighWeight')()
 const auto = createAuto(); let now = 10000
 function frames(w) { let result; for(let i=0;i<34;i++) {now+=100; result=auto.feed({sampled_at:now,display_kg:w},100,now) ?? result} return result }
 assert.equal(frames(120),120); assert.equal(frames(119.5),119.5)
 assert.equal(frames(113.5),undefined)
 const state = status({...live,weight_kg:113.5},{selected:true,captured:true,gross:119.5,tare:100,minimumWeight:auto.minimumWeight(100)})
 assert.equal(state.tone,'warning')
 auto.reset(); assert.equal(auto.minimumWeight(100),50)
})
