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
	padding: 4rpx 16rpx;
	border-radius: var(--crm-radius-md);
	align-self: flex-start;
	border: 1rpx solid transparent;
}
.tag__text {
	font-size: 20rpx;
	font-weight: 700;
	text-transform: uppercase;
}
.tag--info { 
	background: #f3f3f3; 
	color: #181818; 
	border-color: #dddbda;
}
.tag--success { 
	background: #dff0d8; 
	color: #2e844a; 
	border-color: #c9e2b3;
}
.tag--warning { 
	background: #fcf8e3; 
	color: #fe9339; 
	border-color: #faebcc;
}
.tag--danger { 
	background: #f2dede; 
	color: #ea001e; 
	border-color: #ebccd1;
}
.tag--soft {
	background: #eef2f7;
	color: #0b5cab;
}
</style>
