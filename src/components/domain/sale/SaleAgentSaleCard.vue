<template>
	<AppCard :padding="size === 'sm' ? '20rpx' : '32rpx'">
		<view class="card-body">
			<view v-if="rows.length === 0">
				<AppEmpty title="暂无代理出站" subtitle="点击下方按钮新增" />
			</view>
			<view v-else class="rows">
				<view v-for="(row, index) in rows" :key="index" class="row-item">
					<view class="row-grid">
						<view class="grid-item">
							<AppInput :model-value="row.bottle_no" label="瓶号" placeholder="瓶号" :size="size" @update:modelValue="(v) => updateRow(index, 'bottle_no', v)" />
						</view>
						<view class="grid-item">
							<AppInput :model-value="row.fill_weight" label="灌装重量" placeholder="kg" :size="size" @update:modelValue="(v) => updateRow(index, 'fill_weight', v)" />
						</view>
						<view class="grid-item address-cell">
							<AppInput :model-value="row.address" label="配送地址" placeholder="客户地址" :size="size" @update:modelValue="(v) => updateRow(index, 'address', v)" />
							<view class="btn-del" @click="removeRow(index)">
								<AppIcon name="close" size="28rpx" color="#ef4444" />
							</view>
						</view>
					</view>
				</view>
			</view>
			
			<view class="footer-row">
				<view class="summary-box">
					<text class="summary-label">灌装合计:</text>
					<text class="summary-value">{{ totalFillWeight }} kg</text>
				</view>
				<AppButton kind="ghost" size="sm" @click="addRow" icon="plus">添加代理行</AppButton>
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
import AppIcon from '@/components/base/AppIcon.vue'

const props = defineProps({
	modelValue: { type: Array, default: () => [] },
	size: { type: String, default: 'md' }
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
	gap: 16rpx;
}

.rows {
	display: flex;
	flex-direction: column;
	gap: 20rpx;
}

.row-item {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
	padding-bottom: 16rpx;
	border-bottom: 1rpx dashed #f1f5f9;
}

.row-item:last-child {
	border-bottom: none;
	padding-bottom: 0;
}

.row-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 12rpx;
	align-items: flex-end;
}

.address-cell {
	position: relative;
	padding-right: 48rpx;
}

.btn-del {
	position: absolute;
	right: 0;
	bottom: 24rpx;
	width: 40rpx;
	height: 40rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	background: #fef2f2;
	border-radius: 50%;
}

.footer-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-top: 12rpx;
	padding-top: 16rpx;
	border-top: 1rpx solid #f1f5f9;
}

.summary-box {
	display: flex;
	align-items: center;
	gap: 8rpx;
}

.summary-label {
	font-size: 24rpx;
	color: #64748b;
}

.summary-value {
	font-size: 30rpx;
	font-weight: 700;
	color: #0f172a;
}

@media (max-width: 600px) {
	.row-grid {
		grid-template-columns: 1fr;
	}
	.address-cell {
		padding-right: 0;
	}
	.btn-del {
		top: -40rpx;
		right: 0;
		bottom: auto;
	}
}
</style>
