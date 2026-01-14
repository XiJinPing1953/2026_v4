<template>
	<view class="card" :class="variant ? `card--${variant}` : ''">
		<view v-if="title" class="card__title">{{ title }}</view>
		<slot />
	</view>
</template>

<script setup>
defineProps({
	title: { type: String, default: '' },
	variant: { type: String, default: '' }
})
</script>

<style scoped>
.card {
	background: #fff;
	border-radius: 16rpx;
	padding: 20rpx;
	box-shadow: 0 10rpx 28rpx rgba(17, 24, 39, 0.06);
}
.card__title {
	font-size: 30rpx;
	font-weight: 700;
	color: #111827;
	margin-bottom: 12rpx;
}
</style>
