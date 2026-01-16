<template>
	<AppCard>
		<view class="grid-3">
			<AppInput :model-value="modelValue.date" label="日期" placeholder="YYYY-MM-DD" @update:modelValue="(v) => update('date', v)" />
			<AppInput :model-value="modelValue.customerName" label="客户" placeholder="客户名称" @update:modelValue="(v) => update('customerName', v)" />
			<AppInput :model-value="modelValue.deliveryMan1" label="配送员1" placeholder="姓名" @update:modelValue="(v) => update('deliveryMan1', v)" />
			<AppInput :model-value="modelValue.deliveryMan2" label="配送员2" placeholder="姓名" @update:modelValue="(v) => update('deliveryMan2', v)" />
			<AppInput :model-value="modelValue.vehicleNo" label="车辆" placeholder="车牌或编号" @update:modelValue="(v) => update('vehicleNo', v)" />
			<view class="unit-group">
				<AppInput :model-value="modelValue.unitPrice" label="单价" placeholder="数字" @update:modelValue="(v) => update('unitPrice', v)" />
				<AppInput :model-value="modelValue.priceUnit" label="单位" placeholder="kg / bottle / m3" @update:modelValue="(v) => update('priceUnit', v)" />
			</view>
		</view>
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

<style scoped>
.grid-3 {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 16rpx;
}
.unit-group {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12rpx;
}
@media (max-width: 600px) {
	.grid-3 {
		grid-template-columns: 1fr;
	}
	.unit-group {
		grid-template-columns: 1fr;
	}
}
</style>
