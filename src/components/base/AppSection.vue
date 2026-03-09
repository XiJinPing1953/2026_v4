<template>
	<view class="section">
		<view v-if="title" class="section__header">
			<text class="section__title">{{ title }}</text>
			<view class="section__actions">
				<slot name="actions" />
			</view>
		</view>
		<view class="section__body">
			<slot />
		</view>
	</view>
</template>

<script setup>
defineProps({
	title: { type: String, default: '' }
})
</script>

<style scoped>
.section {
	background: #fff;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid var(--crm-border);
	overflow: hidden;
}
.section__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16rpx 24rpx;
	background: #f8f8f8;
	border-bottom: 1rpx solid var(--crm-border);
}
.section__title {
	font-size: 28rpx;
	font-weight: 700;
	color: var(--crm-text);
}
.section__body {
	padding: 24rpx;
}
.section__actions {
	display: flex;
	gap: 8rpx;
	align-items: center;
}
</style>
