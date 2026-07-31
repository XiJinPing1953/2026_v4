<template>
	<AppPage hide-nav hide-bottle-query :body-padding="false">
		<view class="inspection-shell">
			<view class="inspection-shell__top">
				<view v-if="back" class="inspection-shell__back" @click="goBack">‹</view>
				<view class="inspection-shell__heading">
					<text class="inspection-shell__eyebrow">入户随瓶安全巡检</text>
					<text class="inspection-shell__title">{{ title }}</text>
					<text v-if="subtitle" class="inspection-shell__subtitle">{{ subtitle }}</text>
				</view>
				<view v-if="$slots.action" class="inspection-shell__action">
					<slot name="action" />
				</view>
			</view>
			<view class="inspection-shell__body">
				<slot />
			</view>
		</view>
	</AppPage>
</template>

<script setup>
import AppPage from '@/components/base/AppPage.vue'

const props = defineProps({
	title: { type: String, required: true },
	subtitle: { type: String, default: '' },
	back: { type: Boolean, default: false },
	fallback: { type: String, default: '/pages/home-safety-inspection/home' },
	beforeBack: { type: Function, default: null }
})

async function goBack() {
	if (props.beforeBack) {
		const allowed = await props.beforeBack()
		if (allowed === false) return
	}
	const pages = getCurrentPages()
	if (pages.length > 1) {
		uni.navigateBack()
		return
	}
	uni.reLaunch({ url: props.fallback })
}
</script>

<style scoped>
.inspection-shell {
	min-height: 100vh;
	background: #f3f6fa;
	padding-bottom: calc(36rpx + env(safe-area-inset-bottom));
	box-sizing: border-box;
}
.inspection-shell__top {
	display: flex;
	align-items: flex-start;
	gap: 20rpx;
	padding: calc(28rpx + env(safe-area-inset-top)) 28rpx 28rpx;
	color: #fff;
	background: linear-gradient(135deg, #0f766e, #0b5f58);
	box-shadow: 0 12rpx 28rpx rgba(15, 118, 110, 0.18);
}
.inspection-shell__back {
	width: 64rpx;
	height: 64rpx;
	line-height: 58rpx;
	text-align: center;
	font-size: 54rpx;
	border-radius: 18rpx;
	background: rgba(255, 255, 255, 0.14);
}
.inspection-shell__heading {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
}
.inspection-shell__eyebrow {
	font-size: 21rpx;
	opacity: 0.78;
}
.inspection-shell__title {
	margin-top: 4rpx;
	font-size: 34rpx;
	font-weight: 800;
	line-height: 1.25;
}
.inspection-shell__subtitle {
	margin-top: 8rpx;
	font-size: 23rpx;
	line-height: 1.45;
	opacity: 0.86;
}
.inspection-shell__action {
	flex: none;
}
.inspection-shell__body {
	padding: 24rpx;
}
</style>
