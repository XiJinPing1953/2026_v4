<template>
	<AppCard>
		<AppInput :model-value="modelValue.date" label="日期" placeholder="YYYY-MM-DD" @update:modelValue="(v) => update('date', v)" />
		<AppInput :model-value="modelValue.customerName" label="客户" placeholder="客户名称" @update:modelValue="(v) => update('customerName', v)" />
		<AppInput :model-value="modelValue.deliveryMan" label="配送员" placeholder="姓名/组合" @update:modelValue="(v) => update('deliveryMan', v)" />
		<AppInput :model-value="modelValue.vehicleNo" label="车辆" placeholder="车牌或编号" @update:modelValue="(v) => update('vehicleNo', v)" />
		<AppInput :model-value="modelValue.priceUnit" label="计价单位" placeholder="kg / bottle / m3" @update:modelValue="(v) => update('priceUnit', v)" />
		<AppInput :model-value="modelValue.unitPrice" label="单价" placeholder="数字" @update:modelValue="(v) => update('unitPrice', v)" />
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
