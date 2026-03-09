<template>
	<AppCard :padding="size === 'sm' ? '20rpx' : '32rpx'">
		<view class="card-body">
			<view v-if="rows.length === 0">
				<AppEmpty title="暂无存瓶" subtitle="点击下方按钮新增" />
				<view class="empty-action">
					<AppButton kind="ghost" size="sm" @click="addRow" icon="plus">添加存瓶行</AppButton>
				</view>
			</view>
			<view v-else class="rows">
				<view v-for="(row, index) in rows" :key="index" class="row-item">
					<view class="row-grid">
						<AppInput :model-value="row.bottle_no" label="存入瓶号" placeholder="请输入瓶号" :size="size" @update:modelValue="(v) => updateRow(index, v)" />
						<view class="btn-del" @click="removeRow(index)">
							<AppIcon name="close" size="28rpx" color="#ef4444" />
						</view>
					</view>
				</view>
			</view>
			
			<view class="footer-row">
				<view class="summary-box">
					<text class="summary-label">本次存瓶数:</text>
					<text class="summary-value">{{ rows.length }}</text>
				</view>
				<AppButton v-if="rows.length" kind="ghost" size="sm" @click="addRow" icon="plus">添加存瓶行</AppButton>
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
	gap: 16rpx;
}

.rows {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.row-item {
	padding: 12rpx;
	background: #f8fafc;
	border: 1rpx solid #eef2f7;
	border-radius: 16rpx;
}

.row-grid {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 12rpx;
	align-items: flex-end;
}

.btn-del {
	width: 36rpx;
	height: 36rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	background: #fef2f2;
	border-radius: 50%;
	border: 1rpx solid #fee2e2;
	margin-bottom: 20rpx;
}

.footer-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-top: 12rpx;
	padding-top: 16rpx;
	border-top: 1rpx solid #f1f5f9;
}

.empty-action {
	display: flex;
	justify-content: flex-start;
	margin-top: 12rpx;
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
</style>
