<template>
	<view class="list">
		<view v-if="title || subtitle || $slots.actions" class="list__header">
			<view>
				<text v-if="title" class="list__title">{{ title }}</text>
				<text v-if="subtitle" class="list__subtitle">{{ subtitle }}</text>
			</view>
			<view v-if="$slots.actions" class="list__actions">
				<slot name="actions" />
			</view>
		</view>

		<view v-if="loading" class="list__body">
			<AppSkeleton :rows="skeletonRows" card />
		</view>
		<view v-else-if="empty" class="list__body">
			<AppEmpty :title="emptyTitle" :subtitle="emptySubtitle">
				<template v-if="$slots.emptyAction" #action>
					<slot name="emptyAction" />
				</template>
			</AppEmpty>
		</view>
		<view v-else class="list__body">
			<slot />
		</view>
	</view>
</template>

<script setup>
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'

defineProps({
	title: { type: String, default: '' },
	subtitle: { type: String, default: '' },
	loading: { type: Boolean, default: false },
	empty: { type: Boolean, default: false },
	skeletonRows: { type: Number, default: 3 },
	emptyTitle: { type: String, default: '暂无数据' },
	emptySubtitle: { type: String, default: '' }
})
</script>

<style scoped>
.list {
	display: flex;
	flex-direction: column;
	gap: var(--crm-gap-sm);
}

.list__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--crm-gap-sm);
}

.list__title {
	font-size: var(--crm-font-md);
	font-weight: 700;
	color: var(--crm-text);
}

.list__subtitle {
	margin-top: 6rpx;
	display: block;
	font-size: var(--crm-font-sm);
	color: var(--crm-text-muted);
}

.list__actions {
	display: flex;
	gap: var(--crm-gap-xs);
	align-items: center;
}

.list__body {
	display: flex;
	flex-direction: column;
	gap: var(--crm-gap-sm);
}
</style>
