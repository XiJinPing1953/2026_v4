<template>
	<view v-if="visible" class="suggest-list">
		<view v-if="loading && items.length === 0" class="suggest-list__state">
			<text class="suggest-list__state-text">联想加载中...</text>
		</view>
		<view v-else-if="items.length === 0" class="suggest-list__state">
			<text class="suggest-list__state-text">{{ emptyText }}</text>
		</view>
		<scroll-view v-else scroll-y class="suggest-list__scroll">
			<view
				v-for="item in items"
				:key="item.key"
				class="suggest-item"
				hover-class="suggest-item--active"
				@click="emit('select', item)"
			>
				<text class="suggest-item__title">{{ item.title || '-' }}</text>
				<text v-if="item.subtitle" class="suggest-item__subtitle">{{ item.subtitle }}</text>
			</view>
		</scroll-view>
	</view>
</template>

<script setup>
defineProps({
	visible: { type: Boolean, default: false },
	loading: { type: Boolean, default: false },
	items: { type: Array, default: () => [] },
	emptyText: { type: String, default: '暂无匹配结果' }
})

const emit = defineEmits(['select'])
</script>

<style scoped>
.suggest-list {
	margin-top: 8rpx;
	border-radius: 20rpx;
	border: 1rpx solid #bfdbfe;
	background: #fff;
	box-shadow: 0 18rpx 40rpx rgba(15, 23, 42, 0.08);
	overflow: hidden;
}

.suggest-list__scroll {
	max-height: 540rpx;
}

.suggest-list__state {
	padding: 24rpx 28rpx;
}

.suggest-list__state-text {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.suggest-item {
	padding: 22rpx 28rpx;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
	border-bottom: 1rpx solid #e5edf8;
	background: #fff;
}

.suggest-item:last-child {
	border-bottom: none;
}

.suggest-item--active {
	background: #eff6ff;
}

.suggest-item__title {
	font-size: 28rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.suggest-item__subtitle {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	line-height: 1.5;
}
</style>
