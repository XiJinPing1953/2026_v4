<template>
	<view class="preset-bar">
		<view
			v-for="item in items"
			:key="item.value"
			class="preset-bar__item"
			:class="{ 'preset-bar__item--active': modelValue === item.value }"
			@click="$emit('update:modelValue', item.value)"
		>
			{{ item.label }}
		</view>
	</view>
</template>

<script setup>
defineProps({
	modelValue: { type: String, default: 'custom' },
	items: {
		type: Array,
		default: () => [
			{ label: '今日', value: 'today' },
			{ label: '本周', value: 'week' },
			{ label: '本月', value: 'month' },
			{ label: '自定义', value: 'custom' }
		]
	}
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
.preset-bar {
	display: inline-flex;
	align-items: center;
	gap: 8rpx;
	padding: 8rpx;
	background: #eef2ff;
	border-radius: 999rpx;
}

.preset-bar__item {
	min-width: 108rpx;
	padding: 12rpx 28rpx;
	border-radius: 999rpx;
	color: var(--crm-text-muted);
	font-size: 24rpx;
	font-weight: 600;
	text-align: center;
	transition: all 0.2s ease;
}

.preset-bar__item--active {
	background: #fff;
	color: var(--crm-text);
	box-shadow: 0 8rpx 20rpx rgba(15, 23, 42, 0.08);
}
</style>
