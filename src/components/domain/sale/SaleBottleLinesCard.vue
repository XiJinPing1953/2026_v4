<template>
	<AppCard>
		<view class="card-body">
			<view v-if="rows.length === 0">
				<AppEmpty title="暂无明细" subtitle="点击下方按钮新增" />
			</view>
			<view v-else class="rows">
				<view v-for="(row, index) in rows" :key="index" class="row">
					<view class="row-grid">
						<AppInput :model-value="row.bottle_no" label="瓶号" placeholder="瓶号" @update:modelValue="(v) => updateRow(index, 'bottle_no', v)" />
						<AppInput :model-value="row.gross" label="毛重" placeholder="kg" @update:modelValue="(v) => updateRow(index, 'gross', v)" />
						<AppInput :model-value="row.tare" label="皮重" placeholder="kg" @update:modelValue="(v) => updateRow(index, 'tare', v)" />
						<view class="net-cell">
							<AppInput :model-value="row.net" label="净重" placeholder="kg（可自动计算）" @update:modelValue="(v) => updateRow(index, 'net', v)" />
							<AppButton v-if="index === rows.length - 1" class="inline-add" kind="ghost" size="sm" @click="addRow">新增</AppButton>
						</view>
					</view>
					<view v-if="row.suggestions && row.suggestions.length" class="suggestions">
						<view v-for="(item, idx) in row.suggestions" :key="idx" class="suggestion-item">
							<text class="suggestion-no">{{ item.number || item.bottle_no || item }}</text>
							<text class="suggestion-sub">{{ item.desc || '' }}</text>
						</view>
					</view>
					<view class="row-actions">
						<AppButton kind="ghost" size="sm" @click="removeRow(index)">删除</AppButton>
					</view>
				</view>
			</view>
			<view class="summary">
				<text class="summary-label">净重合计</text>
				<text class="summary-value">{{ totalNet }} kg</text>
			</view>
			<view class="actions">
				<AppButton kind="ghost" @click="addRow">新增行</AppButton>
			</view>
		</view>
	</AppCard>
</template>

<script setup>
import { computed } from 'vue'
import AppCard from '@/components/base/AppCard.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'

const props = defineProps({
	modelValue: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue'])

const rows = computed(() => props.modelValue || [])

const totalNet = computed(() => {
	return rows.value.reduce((sum, row) => {
		const value = Number(row?.net)
		return sum + (Number.isNaN(value) ? 0 : value)
	}, 0).toFixed(2)
})

function updateRow(index, key, value) {
	const next = rows.value.map((row, idx) => (idx === index ? { ...row, [key]: value } : row))
	emit('update:modelValue', next)
}

function addRow() {
	emit('update:modelValue', [...rows.value, { bottle_no: '', gross: '', tare: '', net: '' }])
}

function removeRow(index) {
	const next = rows.value.filter((_, idx) => idx !== index)
	emit('update:modelValue', next)
}
</script>

<style scoped>
.card-body {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}
.rows {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}
.row {
	display: flex;
	flex-direction: column;
	gap: 10rpx;
}
.row-grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 12rpx;
}
.net-cell {
	display: flex;
	gap: 8rpx;
	align-items: flex-end;
}
.inline-add {
	padding: 0 16rpx;
}
.suggestions {
	margin-top: 8rpx;
	border: 1rpx solid var(--crm-border-weak);
	border-radius: 12rpx;
	padding: 12rpx;
	background: #fff;
}
.suggestion-item {
	display: flex;
	justify-content: space-between;
	gap: 12rpx;
	padding: 6rpx 0;
}
.suggestion-no {
	font-weight: 600;
	color: var(--crm-text);
}
.suggestion-sub {
	color: var(--crm-text-muted);
	font-size: var(--crm-font-sm);
}
.summary {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 10rpx 14rpx;
	background: rgba(37, 99, 235, 0.08);
	border-radius: 12rpx;
}
.summary-label {
	color: var(--crm-text-muted);
}
.summary-value {
	font-weight: 600;
	color: var(--crm-text);
}
.row-actions {
	display: flex;
	justify-content: flex-end;
}
.actions {
	display: flex;
	justify-content: flex-end;
}
@media (max-width: 600px) {
	.row-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.net-cell {
		flex-direction: column;
		align-items: stretch;
	}
}
</style>
