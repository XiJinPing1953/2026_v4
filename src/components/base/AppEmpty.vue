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
	padding: 48rpx 24rpx;
	border: 1rpx dashed var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fcfcfc;
	text-align: center;
}
.empty__title {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text-muted);
	text-transform: uppercase;
}
.empty__sub {
	margin-top: 12rpx;
	display: block;
	font-size: 24rpx;
	color: var(--crm-text-muted);
}
.empty__action {
	margin-top: 24rpx;
	display: flex;
	justify-content: center;
}
</style>
