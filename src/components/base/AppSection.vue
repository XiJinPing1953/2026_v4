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
	border-radius: 18rpx;
	padding: 18rpx;
	box-shadow: 0 10rpx 28rpx rgba(17, 24, 39, 0.06);
}
.section__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 12rpx;
}
.section__title {
	font-size: 30rpx;
	font-weight: 800;
	color: var(--crm-text);
}
.section__actions {
	display: flex;
	gap: 8rpx;
	align-items: center;
}
</style>
