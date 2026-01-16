<template>
	<AppCard>
		<view class="card-body">
			<AppInput :model-value="modelValue.truckNo" label="TRUCK 瓶号" placeholder="TRUCK-xxxx" @update:modelValue="(v) => update('truckNo', v)" />
			<AppInput :model-value="modelValue.truckOutGross" label="出厂毛重" placeholder="kg" @update:modelValue="(v) => update('truckOutGross', v)" />
			<AppInput :model-value="modelValue.truckBackGross" label="回厂毛重" placeholder="kg" @update:modelValue="(v) => update('truckBackGross', v)" />
			<AppInput :model-value="modelValue.truckSaleNet" label="计费净重" placeholder="kg" @update:modelValue="(v) => update('truckSaleNet', v)" />
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
.card-body {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}
</style>
