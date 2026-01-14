<template>
	<view class="tag" :class="`tag--${kind}`">
		<text class="tag__text"><slot /></text>
	</view>
</template>

<script setup>
defineProps({
	kind: { type: String, default: 'info' } // info | success | warning | danger
})
</script>

<style scoped>
.tag {
	padding: 8rpx 14rpx;
	border-radius: 999rpx;
	align-self: flex-start;
}
.tag__text {
	font-size: 22rpx;
	font-weight: 700;
}
.tag--info { background: rgba(37, 99, 235, 0.10); color: #1d4ed8; }
.tag--success { background: rgba(22, 163, 74, 0.10); color: #15803d; }
.tag--warning { background: rgba(245, 158, 11, 0.12); color: #b45309; }
.tag--danger { background: rgba(220, 38, 38, 0.10); color: #b91c1c; }
</style>
