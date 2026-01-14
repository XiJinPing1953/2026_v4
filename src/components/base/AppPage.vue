<template>
	<view class="page">
		<view v-if="title" class="page__header">
			<text class="page__title">{{ title }}</text>
			<text v-if="subtitle" class="page__subtitle">{{ subtitle }}</text>
		</view>
		<view class="page__body">
			<slot />
		</view>
	</view>
</template>

<script setup>
defineProps({
	title: { type: String, default: '' },
	subtitle: { type: String, default: '' }
})
</script>

<style scoped>
.page {
	min-height: 100vh;
	background: var(--crm-bg);
	padding: 24rpx 20rpx 48rpx;
	box-sizing: border-box;
}
.page__header {
	margin-bottom: 18rpx;
}
.page__title {
	font-size: 40rpx;
	font-weight: 800;
	color: var(--crm-text);
	line-height: 1.1;
}
.page__subtitle {
	margin-top: 6rpx;
	display: block;
	font-size: 24rpx;
	color: var(--crm-text-muted);
}
.page__body {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}
</style>
