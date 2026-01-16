<template>
	<AppCard>
		<AppInput :model-value="modelValue.flowPrev" label="上次表数" placeholder="数字" @update:modelValue="(v) => update('flowPrev', v)" />
		<AppInput :model-value="modelValue.flowCurr" label="本次表数" placeholder="数字" @update:modelValue="(v) => update('flowCurr', v)" />
		<AppInput :model-value="modelValue.flowVolume" label="用气量" placeholder="m3" @update:modelValue="(v) => update('flowVolume', v)" />
		<AppInput :model-value="modelValue.flowRatio" label="理论系数" placeholder="可选" @update:modelValue="(v) => update('flowRatio', v)" />
	</AppCard>
</template>

<script setup>
import AppCard from '@/components/base/AppCard.vue'
import AppInput from '@/components/base/AppInput.vue'

const props = defineProps({
	modelValue: {
		type: Object,
		default: () => ({})
	}
})

const emit = defineEmits(['update:modelValue'])

function update(key, value) {
	emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>
