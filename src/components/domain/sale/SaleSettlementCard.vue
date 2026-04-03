<template>
	<AppCard :padding="size === 'sm' ? '24rpx' : '32rpx'">
		<view class="settlement-grid" :class="{ 'settlement-grid--sm': size === 'sm' }">
			<view class="form-item span-full">
				<view class="summary-box">
					<view class="summary-row">
						<text class="summary-label">应收金额</text>
						<text class="summary-value">¥{{ shouldReceiveText }}</text>
					</view>
					<text v-if="formula" class="summary-formula">{{ formula }}</text>
				</view>
			</view>

			<view class="form-item">
				<picker
					class="picker-full"
					mode="selector"
					:range="paymentStatusOptions"
					range-key="label"
					:value="paymentStatusIndex"
					@change="onPaymentStatusChange"
				>
					<AppInput
						:model-value="paymentStatusLabel"
						label="付款状态"
						placeholder="请选择状态"
						prefix-icon="check-circle"
						:size="size"
						class="picker-input"
						disabled
					/>
				</picker>
			</view>

			<view class="form-item">
				<AppInput 
					:model-value="modelValue.amountReceived" 
					label="实收金额" 
					placeholder="0.00" 
					prefix-icon="wallet"
					:size="size"
					@update:modelValue="(v) => update('amountReceived', v)" 
				/>
			</view>

			<view class="form-item">
				<AppInput 
					:model-value="modelValue.roundingAmount" 
					label="抹零金额" 
					placeholder="0.00" 
					prefix-icon="minus-circle"
					:size="size"
					@update:modelValue="(v) => update('roundingAmount', v)" 
				/>
			</view>

			<view v-if="showOffsetToggle" class="form-item span-full">
				<view class="offset-toggle">
					<view class="offset-toggle__meta">
						<text class="offset-toggle__label">是否冲抵</text>
						<text class="offset-toggle__hint">多收 ¥{{ offsetDeltaText }} 可入冲抵池，需在客户对账手工分配</text>
					</view>
					<switch :checked="offsetEnabled" color="#1677ff" @change="onOffsetEnabledChange" />
				</view>
			</view>

			<view class="form-item span-full">
				<AppInput 
					:model-value="modelValue.paymentNote" 
					label="收款备注" 
					placeholder="请输入相关备注说明" 
					:size="size"
					@update:modelValue="(v) => update('paymentNote', v)" 
				/>
			</view>
		</view>
	</AppCard>
</template>

<script setup>
import { computed } from 'vue'
import AppCard from '@/components/base/AppCard.vue'
import AppInput from '@/components/base/AppInput.vue'
import { normalizePaymentMethod, normalizePaymentStatus } from '@/services/models'

const props = defineProps({
	modelValue: {
		type: Object,
		default: () => ({})
	},
	shouldReceive: { type: [Number, String], default: '' },
	formula: { type: String, default: '' },
	size: { type: String, default: 'md' }
})

const emit = defineEmits(['update:modelValue'])

const paymentStatusOptions = [
	{ label: '未付款', value: 'unpaid' },
	{ label: '部分付', value: 'partial' },
	{ label: '已结清', value: 'paid' }
]

const normalizedPaymentStatus = computed(() => normalizePaymentStatus(props.modelValue?.paymentStatus))
const normalizedPaymentMethod = computed(() =>
	normalizePaymentMethod(props.modelValue?.paymentMethod, {
		paymentStatus: normalizedPaymentStatus.value,
		fallback: normalizedPaymentStatus.value === 'unpaid' ? 'on_account' : 'cash'
	})
)

const paymentStatusIndex = computed(() => {
	const idx = paymentStatusOptions.findIndex((item) => item.value === normalizedPaymentStatus.value)
	return idx >= 0 ? idx : 0
})

const paymentStatusLabel = computed(() => {
	return paymentStatusOptions[paymentStatusIndex.value]?.label || '未付款'
})

const shouldReceiveText = computed(() => {
	const value = props.shouldReceive
	if (value === '' || value == null) return '--'
	const num = Number(value)
	if (Number.isNaN(num)) return '--'
	return num.toFixed(2)
})

const offsetDelta = computed(() => {
	const shouldReceive = Number(props.shouldReceive)
	if (!Number.isFinite(shouldReceive)) return 0
	const rounding = Math.max(Number(props.modelValue?.roundingAmount), 0)
	const amountReceived = Number(props.modelValue?.amountReceived)
	if (!Number.isFinite(amountReceived)) return 0
	const effectiveShouldReceive = shouldReceive > 0
		? shouldReceive - (Number.isFinite(rounding) ? rounding : 0)
		: shouldReceive < 0
			? shouldReceive + (Number.isFinite(rounding) ? rounding : 0)
			: 0
	const delta = Number((amountReceived - effectiveShouldReceive).toFixed(2))
	return delta > 0 ? delta : 0
})

const showOffsetToggle = computed(() => offsetDelta.value > 0)
const offsetDeltaText = computed(() => offsetDelta.value.toFixed(2))
const offsetEnabled = computed(() => Boolean(props.modelValue?.offsetEnabled))

function onPaymentStatusChange(e) {
	const idx = Number(e?.detail?.value)
	const item = paymentStatusOptions[idx]
	if (!item) return
	const patch = { paymentStatus: item.value }
	if (item.value === 'unpaid') patch.paymentMethod = 'on_account'
	else if (normalizedPaymentMethod.value === 'on_account') patch.paymentMethod = 'cash'
	patchModel(patch)
}

function update(key, value) {
	patchModel({ [key]: value })
}

function onOffsetEnabledChange(e) {
	patchModel({ offsetEnabled: Boolean(e?.detail?.value) })
}

function patchModel(patch) {
	emit('update:modelValue', { ...props.modelValue, ...patch })
}
</script>

<style scoped>
.settlement-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 24rpx;
}

.settlement-grid--sm {
	grid-template-columns: repeat(3, 1fr);
	gap: 16rpx;
}

.form-item {
	display: flex;
	flex-direction: column;
}

.span-2 {
	grid-column: span 2;
}

.settlement-grid--sm .span-2 {
	grid-column: span 3;
}

.span-full {
	grid-column: 1 / -1;
}

.summary-box {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
	background: #f8fafc;
	border: 1rpx solid #eef2f7;
	border-radius: 16rpx;
	padding: 18rpx 20rpx;
}

.summary-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16rpx;
}

.summary-label {
	font-size: 24rpx;
	color: #0f172a;
	font-weight: 700;
}

.summary-value {
	font-size: 30rpx;
	font-weight: 700;
	color: #0f172a;
}

.summary-formula {
	font-size: 22rpx;
	color: #0f172a;
	font-weight: 700;
	line-height: 1.4;
}

.picker-full {
	width: 100%;
}

.picker-input {
	pointer-events: none;
}

.offset-toggle {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 24rpx;
	padding: 16rpx 18rpx;
	border: 1rpx solid #dbeafe;
	border-radius: 14rpx;
	background: #eff6ff;
}

.offset-toggle__meta {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	min-width: 0;
}

.offset-toggle__label {
	font-size: 24rpx;
	font-weight: 700;
	color: #0f172a;
}

.offset-toggle__hint {
	font-size: 22rpx;
	color: #475569;
}

@media (max-width: 600px) {
	.settlement-grid {
		grid-template-columns: 1fr;
	}
	.span-2 {
		grid-column: auto;
	}
}
</style>
