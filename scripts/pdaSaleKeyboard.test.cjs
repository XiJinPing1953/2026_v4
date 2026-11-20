const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')

function code(file) {
	const body = fs.readFileSync(file, 'utf8')
	return (body.match(/<script setup>([\s\S]*?)<\/script>/)?.[1] || body)
		.replace(/^import .*$/gm, '').replace(/^export /gm, '')
}
function lookup(fetcher) {
	const events = [], props = vue.reactive({ modelValue:'旧字', selectedId:'', confirmSearch:true, minLength:1, fetcher })
	const scope = vue.effectScope()
	const globals = { ...vue, setTimeout, clearTimeout, onBeforeUnmount:vue.onScopeDispose,
		normalizeText:value=>String(value || '').trim(), defineProps:()=>props,
		uni:{ hideKeyboard:()=>events.push(['hide']) },
		defineEmits:()=> (name,value)=>{events.push([name,value]);if(name==='update:modelValue')props.modelValue=value}
	}
	const source = code('src/composables/pda/usePdaSuggestions.js') + '\n' + code('src/components/domain/pda/PdaLookupSuggestField.vue')
	const field = scope.run(()=>vm.runInNewContext(source+'\n;({onConfirm,onBlur,onSelect,onInput,items,visible})',globals))
	return {field,props,events,stop:()=>scope.stop()}
}
const tick = () => new Promise(resolve=>setImmediate(resolve))

test('IME final handwriting is used for lookup; blur keeps returned customers selectable',async t=>{
	const names=[], row = {key:'b',title:'新字',raw:{_id:'b',name:'新字'}}
	const h=lookup(async value=>{ names.push(value);return [row] });t.after(h.stop)
	h.field.onConfirm({detail:{value:'新字'}})
	h.field.onBlur();await new Promise(r=>setTimeout(r,175))
	assert.deepEqual(names,['新字'])
	assert.equal(h.props.modelValue,'新字')
	assert.equal(h.field.visible.value,true)
	assert.equal(h.events.some(e=>e[0]==='select'),false)
	h.field.onSelect(h.field.items.value[0])
	assert.equal(h.events.find(e=>e[0]==='select')[1]._id,'b')
	assert.equal(h.field.visible.value,false)
})

test('a new query or a scanned customer invalidates a late suggestion result',async t=>{
	let finish
	const h=lookup(key=>key==='旧字'?new Promise(r=>{finish=r}):Promise.resolve([]));t.after(h.stop)
	h.field.onConfirm()
	h.field.onConfirm({detail:{value:'无结果'}});await tick()
	finish([{title:'旧字',raw:{_id:'old'}}]);await tick()
	assert.equal(h.field.items.value.length,0)
	h.props.modelValue='旧字';h.field.onConfirm();h.props.selectedId='scanned';await vue.nextTick()
	finish([{title:'旧字',raw:{_id:'old'}}]);await tick()
	assert.equal(h.field.visible.value,false)
	assert.equal(h.events.some(e=>e[0]==='select'),false)
})

test('bottle IME and on-page confirm use one path, preserve the last digit and keep failed input editable',async()=>{
	const file=code('src/components/domain/pda/PdaNativeSaleView.vue')
	const methods=file.slice(file.indexOf('async function confirmManualBottle'),file.indexOf('async function openNext'))
	const manualOpen=vue.ref(true), bottleInput=vue.ref('001'), seen=[]
	let ok=false,hidden=0
	const api=vm.runInNewContext(methods+'\n;({addManualBottle,selectManualBottle})',{
		manualOpen,bottleInput,busy:vue.ref(false),locked:vue.ref(false),
		chooseBottle:async value=>{seen.push(value);return ok},uni:{hideKeyboard:()=>hidden++}
	})
	await api.addManualBottle({detail:{value:'0015'}})
	assert.deepEqual(seen,['0015']);assert.equal(manualOpen.value,true)
	bottleInput.value='0015';ok=true;await api.addManualBottle()
	assert.deepEqual(seen,['0015','0015']);assert.equal(manualOpen.value,false);assert.equal(hidden,1)
	await api.selectManualBottle({bottle_no:'other'});assert.equal(seen.length,2)
})
