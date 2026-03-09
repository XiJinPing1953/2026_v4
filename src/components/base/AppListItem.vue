<template>
	<view class="item" :class="{ 'item--clickable': clickable }" @click="$emit('click')">
		<view class="item__main">
			<!-- Left Icon -->
			<view v-if="icon || $slots.icon" class="item__icon-wrapper" :class="iconClass">
				<slot name="icon">
					<AppIcon :name="icon" size="40rpx" color="#fff" />
				</slot>
			</view>

			<!-- Header Content -->
			<view class="item__content">
				<view class="item__row">
					<view class="item__heading">
						<slot name="header">
							<text v-if="title" class="item__title">{{ title }}</text>
							<text v-if="subtitle" class="item__subtitle">{{ subtitle }}</text>
						</slot>
					</view>
					<view class="item__right">
						<AppTag v-if="status" :kind="statusKind" size="sm">{{ status }}</AppTag>
						<slot name="right" />
					</view>
				</view>
				
				<!-- Meta Info (Tags etc) -->
				<view v-if="$slots.meta" class="item__meta">
					<slot name="meta" />
				</view>
			</view>
		</view>

		<view v-if="$slots.default" class="item__body">
			<slot />
		</view>
		
		<view v-if="$slots.footer" class="item__footer">
			<slot name="footer" />
		</view>
	</view>
</template>

<script setup>
import AppTag from '@/components/base/AppTag.vue'
import AppIcon from '@/components/base/AppIcon.vue'

defineProps({
	title: { type: String, default: '' },
	subtitle: { type: String, default: '' },
	status: { type: String, default: '' },
	statusKind: { type: String, default: 'info' },
	clickable: { type: Boolean, default: false },
	icon: { type: String, default: '' },
	iconClass: { type: String, default: 'bg-primary' }
})

defineEmits(['click'])
</script>

<style scoped>
.item {
	background: #fff;
	border-radius: var(--crm-radius-sm);
	padding: 24rpx;
	border: 1rpx solid var(--crm-border);
	display: flex;
	flex-direction: column;
	gap: 16rpx;
	transition: background 0.2s;
	position: relative;
	overflow: hidden;
}

.item--clickable:active {
	background: #f3f3f3;
}

.item__main {
	display: flex;
	gap: 24rpx;
	align-items: flex-start;
}

.item__icon-wrapper {
	width: 80rpx;
	height: 80rpx;
	border-radius: var(--crm-radius-sm);
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
}

.item__content {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	min-width: 0;
}

.item__row {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	gap: 20rpx;
}

.item__heading {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	flex: 1;
}

.item__title {
	font-size: 28rpx;
	font-weight: 700;
	color: var(--crm-text);
	line-height: 1.4;
}

.item__subtitle {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.item__right {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 8rpx;
}

.item__meta {
	margin-top: 8rpx;
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.item__body {
	padding-top: 16rpx;
	border-top: 1rpx solid var(--crm-border);
}

.item__footer {
	display: flex;
	justify-content: flex-end;
	gap: 16rpx;
	margin-top: 8rpx;
}

/* SLDS Inspired Icon Colors */
.bg-primary { background: #0176d3; }
.bg-success { background: #2e844a; }
.bg-warning { background: #fe9339; }
.bg-danger { background: #ea001e; }
.bg-info { background: #0b5cab; }
.bg-purple { background: #7c3aed; }
.bg-teal { background: #00a1e0; }
.bg-emerald { background: #00b19d; }
</style>
