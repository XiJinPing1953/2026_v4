<template>
	<AppCard>
		<view class="card-body">
			<view v-if="rows.length === 0">
				<AppEmpty title="暂无代理出站" subtitle="点击下方按钮新增" />
			</view>
			<view v-else class="rows">
				<view v-for="(row, index) in rows" :key="index" class="row">
					<view class="row-grid">
						<AppInput :model-value="row.bottle_no" label="瓶号" placeholder="瓶号" @update:modelValue="(v) => updateRow(index, 'bottle_no', v)" />
						<AppInput :model-value="row.fill_weight" label="灌装重量" placeholder="kg" @update:modelValue="(v) => updateRow(index, 'fill_weight', v)" />
						<AppInput :model-value="row.address" label="配送地址" placeholder="客户地址" @update:modelValue="(v) => updateRow(index, 'address', v)" />
					</view>
					<view class="row-actions">
						<AppButton v-if="index === rows.length - 1" class="inline-add" kind="ghost" size="sm" @click="addRow">新增</AppButton>
						<AppButton kind="ghost" size="sm" @click="removeRow(index)">删除</AppButton>
					</view>
				</view>
			</view>
			<view class="summary">
				<text class="summary-label">灌装合计</text>
				<text class="summary-value">{{ totalFillWeight }} kg</text>
			</view>
			<view class="actions">
				<AppButton kind="ghost" @click="addRow">添加代理行</AppButton>
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

const totalFillWeight = computed(() => {
	return rows.value.reduce((sum, row) => {
		const value = Number(row?.fill_weight)
		return sum + (Number.isNaN(value) ? 0 : value)
	}, 0).toFixed(2)
})

function updateRow(index, key, value) {
	const next = rows.value.map((row, idx) => (idx === index ? { ...row, [key]: value } : row))
	emit('update:modelValue', next)
}

function addRow() {
	emit('update:modelValue', [...rows.value, { bottle_no: '', fill_weight: '', address: '' }])
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
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 12rpx;
}
.row-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8rpx;
}
.inline-add {
	padding: 0 16rpx;
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
@media (max-width: 600px) {
	.row-grid {
		grid-template-columns: 1fr;
	}
}
</style>
