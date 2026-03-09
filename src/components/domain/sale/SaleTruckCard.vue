<template>
	<AppCard :padding="size === 'sm' ? '24rpx' : '32rpx'">
		<view class="truck-grid" :class="{ 'truck-grid--sm': size === 'sm' }">
			<AppInput :model-value="modelValue.truckNo" label="车牌号 / 罐车号" placeholder="例如 冀A396VN" :size="size" @update:modelValue="(v) => update('truckNo', v)" />
			<AppInput :model-value="modelValue.truckOutGross" label="出厂毛重" placeholder="kg" :size="size" @update:modelValue="(v) => update('truckOutGross', v)" />
			<AppInput :model-value="modelValue.truckBackGross" label="回厂毛重" placeholder="kg" :size="size" @update:modelValue="(v) => update('truckBackGross', v)" />
			<AppInput :model-value="modelValue.truckSaleNet" label="计费净重" placeholder="kg" :size="size" @update:modelValue="(v) => update('truckSaleNet', v)" />
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
	},
	size: { type: String, default: 'md' }
})

const emit = defineEmits(['update:modelValue'])

function update(key, value) {
	emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<style scoped>
.truck-grid {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: 24rpx;
}

.truck-grid--sm {
	gap: 16rpx;
}

@media (max-width: 600px) {
	.truck-grid {
		grid-template-columns: 1fr;
	}
}
</style>
