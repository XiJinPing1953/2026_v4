<template>
	<view class="stat" @click="$emit('click')">
		<view class="stat__meta">
			<text class="stat__label">{{ label }}</text>
			<text v-if="hint" class="stat__hint">{{ hint }}</text>
		</view>
		<text class="stat__value">{{ value }}</text>
	</view>
</template>

<script setup>
defineProps({
	label: { type: String, required: true },
	value: { type: [String, Number], default: '-' },
	hint: { type: String, default: '' }
})

defineEmits(['click'])
</script>

<style scoped>
.stat {
	background: linear-gradient(180deg, rgba(37, 99, 235, 0.08), rgba(255, 255, 255, 0.9));
	border: 1rpx solid rgba(37, 99, 235, 0.16);
	border-radius: 18rpx;
	padding: 16rpx;
}
.stat__meta {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
}
.stat__label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
	font-weight: 700;
}
.stat__hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}
.stat__value {
	margin-top: 10rpx;
	display: block;
	font-size: 40rpx;
	font-weight: 900;
	color: var(--crm-text);
}
</style>
