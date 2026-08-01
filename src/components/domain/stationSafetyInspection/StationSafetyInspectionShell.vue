<template>
	<AppPage hide-nav hide-bottle-query :body-padding="false">
		<view class="shell">
			<view class="shell__top">
				<view v-if="back" class="shell__back" @click="goBack">‹</view>
				<view class="shell__heading">
					<text class="shell__eyebrow">无极县新拓能源开发有限公司</text>
					<text class="shell__title">{{ title }}</text>
					<text v-if="subtitle" class="shell__subtitle">{{ subtitle }}</text>
				</view>
				<view v-if="$slots.action" class="shell__action"><slot name="action" /></view>
			</view>
			<view class="shell__body"><slot /></view>
		</view>
	</AppPage>
</template>

<script setup>
import AppPage from '@/components/base/AppPage.vue'

const props = defineProps({
	title: { type: String, required: true },
	subtitle: { type: String, default: '' },
	back: { type: Boolean, default: false },
	fallback: { type: String, default: '/pages/station-safety-inspection/home' },
	beforeBack: { type: Function, default: null }
})

async function goBack() {
	if (props.beforeBack && (await props.beforeBack()) === false) return
	if (getCurrentPages().length > 1) return uni.navigateBack()
	uni.reLaunch({ url: props.fallback })
}
</script>

<style scoped>
.shell { min-height: 100vh; box-sizing: border-box; padding-bottom: calc(36rpx + env(safe-area-inset-bottom)); background: #f3f6fa; }
.shell__top { display: flex; align-items: flex-start; gap: 20rpx; padding: calc(28rpx + env(safe-area-inset-top)) 28rpx 28rpx; color: #fff; background: linear-gradient(135deg, #9a3412, #c2410c); box-shadow: 0 12rpx 28rpx rgba(154, 52, 18, .18); }
.shell__back { width: 64rpx; height: 64rpx; line-height: 58rpx; text-align: center; font-size: 54rpx; border-radius: 18rpx; background: rgba(255,255,255,.14); }
.shell__heading { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.shell__eyebrow { font-size: 20rpx; opacity: .8; }
.shell__title { margin-top: 4rpx; font-size: 34rpx; font-weight: 800; line-height: 1.25; }
.shell__subtitle { margin-top: 8rpx; font-size: 23rpx; line-height: 1.45; opacity: .88; }
.shell__action { flex: none; }
.shell__body { padding: 24rpx; }
</style>
