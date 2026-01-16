<template>
	<AppCard>
		<AppInput :model-value="modelValue.paymentStatus" label="付款状态" placeholder="未付 / 挂账" @update:modelValue="(v) => update('paymentStatus', v)" />
		<AppInput :model-value="modelValue.amountReceived" label="已收金额" placeholder="数字" @update:modelValue="(v) => update('amountReceived', v)" />
		<AppInput :model-value="modelValue.paymentNote" label="备注" placeholder="可选" @update:modelValue="(v) => update('paymentNote', v)" />
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
