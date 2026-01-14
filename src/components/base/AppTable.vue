<template>
	<view class="table">
		<view v-if="title || subtitle || $slots.actions" class="table__header">
			<view>
				<text v-if="title" class="table__title">{{ title }}</text>
				<text v-if="subtitle" class="table__subtitle">{{ subtitle }}</text>
			</view>
			<view v-if="$slots.actions" class="table__actions">
				<slot name="actions" />
			</view>
		</view>

		<view v-if="loading" class="table__body">
			<AppSkeleton :rows="skeletonRows" card />
		</view>
		<view v-else-if="resolvedEmpty" class="table__body">
			<AppEmpty :title="emptyTitle" :subtitle="emptySubtitle">
				<template v-if="$slots.emptyAction" #action>
					<slot name="emptyAction" />
				</template>
			</AppEmpty>
		</view>
		<view v-else class="table__body">
			<view class="table__row table__row--head" :style="gridStyle">
				<view
					v-for="col in columns"
					:key="col.key"
					class="table__cell table__cell--head"
					:style="{ textAlign: col.align || 'left' }"
				>
					{{ col.label }}
				</view>
			</view>
			<view
				v-for="row in rows"
				:key="row[rowKey] || row._id || row.id"
				class="table__row"
				:style="gridStyle"
			>
				<view
					v-for="col in columns"
					:key="col.key"
					class="table__cell"
					:style="{ textAlign: col.align || 'left' }"
				>
					<slot
						:name="`cell-${col.key}`"
						:row="row"
						:column="col"
						:value="row[col.key]"
					>
						{{ formatCell(row, col) }}
					</slot>
				</view>
			</view>
		</view>
	</view>
</template>

<script setup>
import { computed } from 'vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppSkeleton from '@/components/base/AppSkeleton.vue'

const props = defineProps({
	title: { type: String, default: '' },
	subtitle: { type: String, default: '' },
	columns: { type: Array, default: () => [] },
	rows: { type: Array, default: () => [] },
	loading: { type: Boolean, default: false },
	empty: { type: Boolean, default: false },
	emptyTitle: { type: String, default: '暂无数据' },
	emptySubtitle: { type: String, default: '' },
	skeletonRows: { type: Number, default: 4 },
	rowKey: { type: String, default: 'id' }
})

const gridStyle = computed(() => {
	const columns = props.columns.length ? props.columns : [{ key: 'default', label: '' }]
	const template = columns
		.map((col) => {
			if (col.width) return col.width
			return '1fr'
		})
		.join(' ')
	return { gridTemplateColumns: template }
})

const resolvedEmpty = computed(() => props.empty || props.rows.length === 0)

function formatCell(row, col) {
	if (typeof col.format === 'function') {
		return col.format(row[col.key], row)
	}
	const value = row[col.key]
	return value == null ? '-' : value
}
</script>

<style scoped>
.table {
	display: flex;
	flex-direction: column;
	gap: var(--crm-gap-sm);
}

.table__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--crm-gap-sm);
}

.table__title {
	font-size: var(--crm-font-md);
	font-weight: 700;
	color: var(--crm-text);
}

.table__subtitle {
	margin-top: 6rpx;
	display: block;
	font-size: var(--crm-font-sm);
	color: var(--crm-text-muted);
}

.table__actions {
	display: flex;
	gap: var(--crm-gap-xs);
	align-items: center;
}

.table__body {
	display: flex;
	flex-direction: column;
	gap: var(--crm-gap-xs);
}

.table__row {
	display: grid;
	gap: var(--crm-gap-xs);
	background: var(--crm-surface);
	border-radius: var(--crm-radius-md);
	padding: 14rpx 16rpx;
	border: 1rpx solid var(--crm-border-weak);
	box-shadow: var(--crm-shadow-sm);
}

.table__row--head {
	background: rgba(37, 99, 235, 0.08);
	border-color: rgba(37, 99, 235, 0.2);
	box-shadow: none;
}

.table__cell {
	font-size: var(--crm-font-sm);
	color: var(--crm-text);
}

.table__cell--head {
	font-weight: 700;
	color: var(--crm-text);
}
</style>
