<template>
	<view class="card" :class="[variant ? `card--${variant}` : '']" :style="{ padding: padding }">
		<view v-if="title" class="card__header">
			<text class="card__title">{{ title }}</text>
		</view>
		<view class="card__body">
			<slot />
		</view>
	</view>
</template>

<script setup>
defineProps({
	title: { type: String, default: '' },
	variant: { type: String, default: '' },
	padding: { type: String, default: '24rpx' }
})
</script>

<style scoped>
.card {
	background: #fff;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid var(--crm-border);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
.card__header {
	padding: 16rpx 24rpx;
	border-bottom: 1rpx solid var(--crm-border);
	background: #f8f8f8;
}
.card__title {
	font-size: 28rpx;
	font-weight: 700;
	color: var(--crm-text);
}
.card__body {
	flex: 1;
}
</style>
