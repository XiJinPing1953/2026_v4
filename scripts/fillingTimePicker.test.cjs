const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { computed, reactive, ref, watch, nextTick } = require('vue')
const { parse } = require('@vue/compiler-sfc')

function picker(value) {
	const source = fs.readFileSync('src/components/domain/filling/FillingTimePicker.vue', 'utf8')
	const { descriptor } = parse(source)
	const props = reactive({ modelValue: value })
	const emitted = []
	const api = vm.runInNewContext(descriptor.scriptSetup.content.replace(/^import .*\n/gm, '') + '\n;({ dateValue, hourValue, hourIndex, dateSelection, hourSelection, dateRanges, onDateColumnChange, onHourColumnChange, syncSelection, onDateChange, onHourChange })', {
		computed, ref, watch, defineProps: () => props, defineEmits: () => (name, value) => { emitted.push({ name, value }); props.modelValue = value }
	})
	return { ...api, props, emitted, date: value => { const [y,m,d] = value.split('-').map(Number); api.onDateChange({ detail: { value: [y-1970,m-1,d-1] } }) }, hour: value => api.onHourChange({ detail: { value: [value] } }) }
}

test('changing only the date preserves the hour and changing only the hour preserves the date', () => {
	const ui = picker('2026-10-24-01')
	assert.equal(ui.dateValue.value, '2026-10-24')
	assert.equal(ui.hourValue.value, '01')
	ui.date('2024-02-29')
	assert.equal(ui.props.modelValue, '2024-02-29-01')
	ui.hour(24)
	assert.equal(ui.props.modelValue, '2024-02-29-23')
	ui.hour(1)
	assert.equal(ui.props.modelValue, '2024-02-29-00')
})

test('historical unknown hour stays unknown until explicitly selected, and is distinct from midnight', () => {
	const ui = picker('2026-09-28')
	assert.equal(ui.hourIndex.value, 0)
	assert.equal(ui.emitted.length, 0)
	ui.date('2026-09-29')
	assert.equal(ui.props.modelValue, '2026-09-29')
	ui.hour(1)
	assert.equal(ui.props.modelValue, '2026-09-29-00')
	ui.hour(0)
	assert.equal(ui.props.modelValue, '2026-09-29')
})

test('loading another record or resetting the parent updates both picker values without emitting', async () => {
	const ui = picker('2026-10-24-23')
	ui.props.modelValue = '2024-02-29'
	await nextTick()
	assert.equal(ui.dateValue.value, '2024-02-29')
	assert.equal(ui.hourIndex.value, 0)
	assert.deepEqual(Array.from(ui.dateSelection.value), [54,1,28])
	ui.props.modelValue = '2026-10-25-00'
	await nextTick()
	assert.equal(ui.dateValue.value, '2026-10-25')
	assert.equal(ui.hourIndex.value, 1)
	assert.deepEqual(Array.from(ui.hourSelection.value), [1])
	assert.equal(ui.emitted.length, 0)
})

test('cancelling changed date and hour wheels restores the confirmed values without emitting', () => {
	const ui = picker('2026-10-24-01')
	ui.onDateColumnChange({ detail: { column: 2, value: 26 } })
	ui.onHourColumnChange({ detail: { column: 0, value: 9 } })
	ui.syncSelection()
	assert.deepEqual(Array.from(ui.dateSelection.value), [56,9,23])
	assert.deepEqual(Array.from(ui.hourSelection.value), [2])
	assert.equal(ui.props.modelValue, '2026-10-24-01')
	assert.equal(ui.emitted.length, 0)
})

test('month and year changes clamp the day for short months and leap years', () => {
	const ui = picker('2024-01-31-23')
	ui.onDateColumnChange({ detail: { column: 1, value: 1 } })
	assert.equal(ui.dateRanges.value[2].length, 29)
	assert.equal(ui.dateSelection.value[2], 28)
	ui.onDateColumnChange({ detail: { column: 0, value: 55 } })
	assert.equal(ui.dateRanges.value[2].length, 28)
	assert.equal(ui.dateSelection.value[2], 27)
	ui.onDateChange({ detail: { value: ui.dateSelection.value } })
	assert.equal(ui.props.modelValue, '2025-02-28-23')
})
