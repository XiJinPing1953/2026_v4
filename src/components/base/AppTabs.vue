<template>
	<view class="tabs">
		<view
			v-for="tab in items"
			:key="tab.value"
			class="tab-item"
			:class="{ 'tab-item--active': modelValue === tab.value }"
			@click="$emit('update:modelValue', tab.value)"
		>
			<text class="tab-label">{{ tab.label }}</text>
			<view v-if="modelValue === tab.value" class="tab-indicator" />
		</view>
	</view>
</template>

<script setup>
defineProps({
	modelValue: { type: String, required: true },
	items: {
		type: Array,
		default: () => [] // Array of { label: string, value: string }
	}
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
.tabs {
	display: flex;
	gap: 48rpx;
	padding: 0 4rpx;
}

.tab-item {
	position: relative;
	padding: 16rpx 0 24rpx;
	cursor: pointer;
	display: flex;
	flex-direction: column;
	align-items: center;
	transition: all 0.2s;
}

.tab-label {
	font-size: 26rpx;
	color: var(--crm-text-muted);
	font-weight: 500;
}

.tab-item--active .tab-label {
	color: var(--crm-primary);
	font-weight: 700;
}

.tab-indicator {
	position: absolute;
	bottom: 0;
	left: 0;
	right: 0;
	height: 6rpx;
	background: var(--crm-primary);
	border-radius: 3rpx 3rpx 0 0;
}
</style>
