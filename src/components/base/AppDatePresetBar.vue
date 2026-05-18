<template>
	<view class="preset-bar" :class="{ 'preset-bar--disabled': disabled }">
		<view
			v-for="item in items"
			:key="item.value"
			class="preset-bar__item"
			:class="{
				'preset-bar__item--active': modelValue === item.value,
				'preset-bar__item--disabled': disabled
			}"
			@click="onPresetClick(item.value)"
		>
			{{ item.label }}
		</view>
	</view>
</template>

<script setup>
const props = defineProps({
	modelValue: { type: String, default: 'custom' },
	disabled: { type: Boolean, default: false },
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

const emit = defineEmits(['update:modelValue'])

function onPresetClick(value) {
	if (props.disabled) return
	emit('update:modelValue', value)
}
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

.preset-bar--disabled {
	opacity: 0.72;
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

.preset-bar__item--disabled {
	pointer-events: none;
}

.preset-bar__item--active {
	background: #fff;
	color: var(--crm-text);
	box-shadow: 0 8rpx 20rpx rgba(15, 23, 42, 0.08);
}
</style>
