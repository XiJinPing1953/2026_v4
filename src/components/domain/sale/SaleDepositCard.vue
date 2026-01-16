<template>
	<AppCard>
		<view class="card-body">
			<view v-if="rows.length === 0">
				<AppEmpty title="暂无存瓶" subtitle="点击下方按钮新增" />
			</view>
			<view v-else class="rows">
				<view v-for="(row, index) in rows" :key="index" class="row">
					<view class="row-grid">
						<AppInput :model-value="row.bottle_no" label="瓶号" placeholder="瓶号" @update:modelValue="(v) => updateRow(index, v)" />
						<AppButton kind="ghost" size="sm" @click="removeRow(index)">删除</AppButton>
					</view>
				</view>
			</view>
			<view class="summary">
				<text class="summary-label">本次存瓶数</text>
				<text class="summary-value">{{ rows.length }}</text>
			</view>
			<view class="actions">
				<AppButton kind="ghost" @click="addRow">添加存瓶</AppButton>
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

function updateRow(index, value) {
	const next = rows.value.map((row, idx) => (idx === index ? { ...row, bottle_no: value } : row))
	emit('update:modelValue', next)
}

function addRow() {
	emit('update:modelValue', [...rows.value, { bottle_no: '' }])
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
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 12rpx;
	align-items: end;
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
.actions {
	display: flex;
	justify-content: flex-end;
}
</style>
