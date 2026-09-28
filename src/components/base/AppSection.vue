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
	border-radius: var(--crm-radius-md);
	border: 1rpx solid var(--crm-border);
	overflow: hidden;
}
.section__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16rpx 24rpx;
	background: #fff;
	border-bottom: 1rpx solid var(--crm-border-weak);
}
.section__title {
	font-size: 28rpx;
	font-weight: 600;
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

/* H5 mobile layout; keep desktop and native layouts intact. */
/* #ifdef H5 */
@media (max-width: 767px) {
 .section { min-width:0; max-width:100%; box-sizing:border-box; }
 .section__header { flex-wrap:wrap; gap:8px; padding:12px; }
 .section__title { min-width:0; font-size:16px; overflow-wrap:anywhere; }
 .section__actions { flex-wrap:wrap; min-width:0; max-width:100%; gap:8px; }
 .section__body { min-width:0; padding:12px; }
}
/* #endif */
</style>
