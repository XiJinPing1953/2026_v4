<template>
	<AppCard :padding="size === 'sm' ? '24rpx' : '32rpx'">
		<view class="flow-grid" :class="{ 'flow-grid--sm': size === 'sm' }">
			<AppInput :model-value="modelValue.flowPrev" label="上次表数" placeholder="0.00" :size="size" @update:modelValue="(v) => update('flowPrev', v)" />
			<AppInput :model-value="modelValue.flowCurr" label="本次表数" placeholder="0.00" :size="size" @update:modelValue="(v) => update('flowCurr', v)" />
			<AppInput :model-value="modelValue.flowVolume" label="用气量" placeholder="m3" :size="size" @update:modelValue="(v) => update('flowVolume', v)" />
			<AppInput :model-value="modelValue.flowRatio" label="理论系数" placeholder="可选" :size="size" @update:modelValue="(v) => update('flowRatio', v)" />
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
.flow-grid {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: 24rpx;
}

.flow-grid--sm {
	gap: 16rpx;
}

@media (max-width: 600px) {
	.flow-grid {
		grid-template-columns: 1fr;
	}
}
</style>
