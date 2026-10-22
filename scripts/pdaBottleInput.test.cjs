const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), vue = require('vue')
function setup(native = true, initial = '') {
 const props = vue.reactive({ modelValue: initial, type: 'text', disabled: false, readonly: false, confirmHold: false }), events = []
 const scope = vue.effectScope()
 const source = fs.readFileSync('src/components/domain/pda/PdaBottleInput.vue','utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*\n/gm,'')
 const api = scope.run(() => vm.runInNewContext(source+'\n;({letters, textMode, keyboardType, confirm})', { ...vue, defineOptions() {}, defineProps: () => props, defineEmits: () => (name,value) => { events.push([name,value]); if(name==='update:modelValue')props.modelValue=value }, isPdaAppMode: () => native }))
 return {props, events, ...api, stop: () => scope.stop()}
}
test('numeric entry preserves leading zeros and final IME digit before confirm', t => {
 const h=setup();t.after(h.stop);assert.equal(h.keyboardType.value,'number')
 h.props.modelValue='00';h.confirm({detail:{value:'0015'}})
 assert.equal(h.props.modelValue,'0015');assert.equal(h.events[0][0],'update:modelValue');assert.equal(h.events[1][0],'confirm')
})
test('letter entry and restored alphanumeric values are never coerced', async t => {
 const h=setup(true,'X046');t.after(h.stop);assert.equal(h.keyboardType.value,'text');h.confirm({detail:{value:'X046'}});assert.equal(h.props.modelValue,'X046')
 h.props.modelValue='';await vue.nextTick();assert.equal(h.keyboardType.value,'number');h.letters.value=true;assert.equal(h.keyboardType.value,'text')
})
test('locked input ignores late keyboard confirm', t => {
 const h=setup();t.after(h.stop);h.props.disabled=true;h.confirm({detail:{value:'15'}});assert.equal(h.events.length,0)
 h.props.disabled=false;h.props.readonly=true;h.confirm({detail:{value:'15'}});assert.equal(h.events.length,0)
})
test('Chrome retains text entry and original confirm contract', t => {
 const h=setup(false,'00');t.after(h.stop);assert.equal(h.keyboardType.value,'text');h.confirm({detail:{value:'0015'}})
 assert.equal(h.props.modelValue,'00');assert.equal(h.events.length,1);assert.equal(h.events[0][0],'confirm')
})
