<template>
	<view class="page">
		<view v-if="title" class="page__header">
			<view class="header__top">
				<view class="header__icon-box">
					<AppIcon :name="icon || 'document'" size="48rpx" color="#fff" />
				</view>
				<view class="header__content">
					<text class="header__label">{{ subtitle || '记录' }}</text>
					<text class="header__title">{{ title }}</text>
				</view>
				<view v-if="$slots.headerActions" class="header__actions">
					<slot name="headerActions" />
				</view>
			</view>
			
			<!-- SLDS Highlights Panel Slot -->
			<view v-if="$slots.highlights" class="header__highlights">
				<slot name="highlights" />
			</view>

			<!-- SLDS Tabs Slot -->
			<view v-if="$slots.tabs" class="header__tabs">
				<slot name="tabs" />
			</view>
		</view>

		<view class="page__body" :class="{ 'page__body--padded': bodyPadding }">
			<slot />
		</view>

		<!-- Global Float Navigation -->
		<AppFloatNav v-if="showFloatNav" />
	</view>
</template>

<script setup>
import { computed } from 'vue'
import AppFloatNav from '@/components/base/AppFloatNav.vue'
import AppIcon from '@/components/base/AppIcon.vue'

const props = defineProps({
	title: { type: String, default: '' },
	subtitle: { type: String, default: '' },
	icon: { type: String, default: '' },
	hideNav: { type: Boolean, default: false },
	bodyPadding: { type: Boolean, default: true }
})

// Hide float nav on login page or if explicitly disabled
const showFloatNav = computed(() => {
	// Simple check: if title is missing, it might be a custom page like login? 
	// Better: Login page explicitly sets hideNav or we check route (but route check in component is tricky in uni-app sometimes)
	// For now, let's assume if hideNav prop is true, we hide it.
	return !props.hideNav
})
</script>

<style scoped>
.page {
	min-height: 100vh;
	background: var(--crm-bg);
	padding-bottom: 48rpx;
	box-sizing: border-box;
	position: relative;
}
.page__header {
	background: #fff;
	border-bottom: 1rpx solid var(--crm-border);
	padding: 24rpx 32rpx 0; /* No bottom padding, handled by slots or content */
	margin-bottom: 24rpx;
}
.header__top {
	display: flex;
	align-items: center;
	gap: 24rpx;
	padding-bottom: 24rpx;
}
.header__icon-box {
	width: 80rpx;
	height: 80rpx;
	background: var(--crm-primary);
	border-radius: var(--crm-radius-sm);
	display: flex;
	align-items: center;
	justify-content: center;
}
.header__content {
	flex: 1;
	display: flex;
	flex-direction: column;
}
.header__label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	text-transform: uppercase;
	letter-spacing: 1rpx;
}
.header__title {
	font-size: 36rpx;
	font-weight: 700;
	color: var(--crm-text);
	line-height: 1.2;
}
.header__actions {
	display: flex;
	gap: 16rpx;
}
.header__highlights {
	border-top: 1rpx solid var(--crm-border-weak);
	padding: 24rpx 0;
	display: flex;
	flex-wrap: wrap;
	gap: 48rpx;
}
.header__tabs {
	margin-top: 8rpx;
}
.page__body {
	display: flex;
	flex-direction: column;
}
.page__body--padded {
	padding: 0 24rpx;
	gap: 24rpx;
}
</style>
