<template>
	<picker mode="multiSelector" :range="ranges" :value="selection" @columnchange="onColumnChange" @change="onChange" @cancel="syncSelection">
		<AppInput :model-value="modelValue" :label="label" placeholder="yyyy-mm-dd-hh" disabled prefix-icon="calendar" size="sm" />
	</picker>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import AppInput from '@/components/base/AppInput.vue'

const props = defineProps({ modelValue: { type: String, default: '' }, label: { type: String, default: '灌装日期' } })
const emit = defineEmits(['update:modelValue'])
const pad = (value) => String(value).padStart(2, '0')
const years = Array.from({ length: 231 }, (_, i) => String(1970 + i))
const months = Array.from({ length: 12 }, (_, i) => pad(i + 1))
const hours = Array.from({ length: 24 }, (_, i) => pad(i))
const selection = ref([0, 0, 0, 0])
const ranges = computed(() => [years, months,
	Array.from({ length: new Date(Date.UTC(Number(years[selection.value[0]]), selection.value[1] + 1, 0)).getUTCDate() }, (_, i) => pad(i + 1)), hours])
function syncSelection() {
	const now = new Date(Date.now() + 8 * 3600000)
	const parts = props.modelValue ? props.modelValue.split('-').map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours()]
	selection.value = [Math.max(0, Math.min(parts[0] - 1970, years.length - 1)), parts[1] - 1, parts[2] - 1, parts[3] ?? 0]
}
function onColumnChange(event) {
	selection.value[event.detail.column] = event.detail.value
	selection.value[2] = Math.min(selection.value[2], ranges.value[2].length - 1)
}
function onChange(event) {
	selection.value = [...event.detail.value]
	selection.value[2] = Math.min(selection.value[2], ranges.value[2].length - 1)
	emit('update:modelValue', ranges.value.map((range, i) => range[selection.value[i]]).join('-'))
}
watch(() => props.modelValue, syncSelection, { immediate: true })
</script>
