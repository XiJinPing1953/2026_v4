<template>
	<view class="empty">
		<text class="empty__title">{{ title }}</text>
		<text v-if="subtitle" class="empty__sub">{{ subtitle }}</text>
		<view v-if="$slots.action" class="empty__action"><slot name="action" /></view>
	</view>
</template>

<script setup>
defineProps({
	title: { type: String, default: '暂无数据' },
	subtitle: { type: String, default: '' }
})
</script>

<style scoped>
.empty {
	padding: 36rpx 18rpx;
	border: 1rpx dashed var(--crm-border);
	border-radius: 18rpx;
	background: #fff;
	text-align: center;
}
.empty__title {
	font-size: 28rpx;
	font-weight: 800;
	color: var(--crm-text);
}
.empty__sub {
	margin-top: 8rpx;
	display: block;
	font-size: 24rpx;
	color: var(--crm-text-muted);
}
.empty__action {
	margin-top: 16rpx;
	display: flex;
	justify-content: center;
}
</style>
