<template>
	<view class="item" :class="{ 'item--clickable': clickable }" @click="$emit('click')">
		<view v-if="title || subtitle || status || $slots.header" class="item__header">
			<view class="item__heading">
				<slot name="header">
					<text v-if="title" class="item__title">{{ title }}</text>
					<text v-if="subtitle" class="item__subtitle">{{ subtitle }}</text>
				</slot>
			</view>
			<AppTag v-if="status" :kind="statusKind">{{ status }}</AppTag>
			<view v-if="$slots.headerActions" class="item__header-actions">
				<slot name="headerActions" />
			</view>
		</view>

		<view v-if="$slots.meta" class="item__meta">
			<slot name="meta" />
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

defineProps({
	title: { type: String, default: '' },
	subtitle: { type: String, default: '' },
	status: { type: String, default: '' },
	statusKind: { type: String, default: 'info' },
	clickable: { type: Boolean, default: false }
})

defineEmits(['click'])
</script>

<style scoped>
.item {
	background: var(--crm-surface);
	border-radius: var(--crm-radius-lg);
	padding: 18rpx;
	border: 1rpx solid var(--crm-border-weak);
	box-shadow: var(--crm-shadow-sm);
	display: flex;
	flex-direction: column;
	gap: var(--crm-gap-sm);
}

.item--clickable {
	transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.item--clickable:active {
	transform: translateY(2rpx);
	box-shadow: var(--crm-shadow-md);
}

.item__header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: var(--crm-gap-sm);
}

.item__heading {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
}

.item__title {
	font-size: var(--crm-font-md);
	font-weight: 700;
	color: var(--crm-text);
}

.item__subtitle {
	font-size: var(--crm-font-sm);
	color: var(--crm-text-muted);
}

.item__meta {
	display: flex;
	flex-wrap: wrap;
	gap: var(--crm-gap-xs);
	color: var(--crm-text-muted);
	font-size: var(--crm-font-sm);
}

.item__body {
	display: flex;
	flex-direction: column;
	gap: var(--crm-gap-xs);
}

.item__footer {
	display: flex;
	justify-content: flex-end;
	gap: var(--crm-gap-sm);
}

.item__header-actions {
	display: flex;
	gap: var(--crm-gap-xs);
	align-items: center;
}
</style>
