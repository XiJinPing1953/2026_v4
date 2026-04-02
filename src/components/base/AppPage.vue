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
			<AppEmpty
				v-if="isDenied"
				title="无权限访问"
				subtitle="当前账号没有该页面的查看权限，请联系超级管理员配置页面权限。"
			/>
			<slot v-else />
		</view>

		<AppBottleQueryFloat v-if="showBottleQueryFloat && !isDenied" />
	</view>
</template>

<script setup>
import { computed } from 'vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppBottleQueryFloat from '@/components/base/AppBottleQueryFloat.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { normalizePagePath } from '@/services/pageAcl'
import { useAuthGuard } from '@/composables/useAuthGuard'

const props = defineProps({
	title: { type: String, default: '' },
	subtitle: { type: String, default: '' },
	icon: { type: String, default: '' },
	hideNav: { type: Boolean, default: false },
	hideBottleQuery: { type: Boolean, default: false },
	bodyPadding: { type: Boolean, default: true }
})

const { requirePageView } = useAuthGuard()
const showBottleQueryFloat = computed(() => !props.hideBottleQuery)
const currentPagePath = computed(() => {
	const pages = getCurrentPages()
	const current = pages[pages.length - 1]
	return normalizePagePath(current?.route || '')
})
const isDenied = computed(() => Boolean(currentPagePath.value) && !requirePageView(currentPagePath.value))
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
