<template>
	<view class="filter" :class="{ 'filter--compact': compact }">
		<text v-if="title" class="filter__title">{{ title }}</text>
		<view class="filter__fields">
			<slot />
		</view>
		<view v-if="showActions" class="filter__actions">
			<slot name="actions">
				<AppButton kind="ghost" @click="$emit('reset')">{{ resetLabel }}</AppButton>
				<AppButton @click="$emit('search')">{{ searchLabel }}</AppButton>
			</slot>
		</view>
	</view>
</template>

<script setup>
import AppButton from '@/components/base/AppButton.vue'

defineProps({
	title: { type: String, default: '' },
	searchLabel: { type: String, default: '查询' },
	resetLabel: { type: String, default: '重置' },
	showActions: { type: Boolean, default: true },
	compact: { type: Boolean, default: false }
})

defineEmits(['search', 'reset'])
</script>

<style scoped>
.filter {
	background: var(--crm-surface);
	border-radius: var(--crm-radius-lg);
	border: 1rpx solid var(--crm-border-weak);
	box-shadow: var(--crm-shadow-sm);
	padding: 18rpx;
	display: flex;
	flex-direction: column;
	gap: var(--crm-gap-sm);
}

.filter__title {
	font-size: var(--crm-font-sm);
	font-weight: 700;
	color: var(--crm-text);
}

.filter__fields {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: var(--crm-gap-sm);
}

.filter__actions {
	display: flex;
	gap: var(--crm-gap-sm);
	justify-content: flex-end;
}

.filter--compact .filter__fields {
	grid-template-columns: 1fr;
}
</style>
