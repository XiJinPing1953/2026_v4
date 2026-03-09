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
				<picker class="picker-full" mode="selector" :range="paymentMethodOptions" range-key="label" @change="onPaymentMethodChange">
					<AppInput 
						:model-value="paymentMethodLabel" 
						label="收款方式" 
						placeholder="请选择结算方式" 
						prefix-icon="credit-card"
						:size="size"
						class="picker-input"
						disabled 
					/>
				</picker>
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
import { normalizePaymentStatus } from '@/services/models/sale'

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

const paymentMethodOptions = [
	{ label: '挂账', value: 'on_account' },
	{ label: '现金', value: 'cash' },
	{ label: '银行转账', value: 'bank' },
	{ label: '微信', value: 'wechat' },
	{ label: '支付宝', value: 'alipay' }
]

const paymentStatusOptions = [
	{ label: '未付款', value: 'unpaid' },
	{ label: '部分付', value: 'partial' },
	{ label: '已结清', value: 'paid' }
]

const paymentMethodLabel = computed(() => {
	const value = props.modelValue?.paymentMethod || ''
	return paymentMethodOptions.find((item) => item.value === value)?.label || '挂账'
})

const normalizedPaymentStatus = computed(() => normalizePaymentStatus(props.modelValue?.paymentStatus))

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

function onPaymentMethodChange(e) {
	const idx = Number(e?.detail?.value)
	const item = paymentMethodOptions[idx]
	if (!item) return
	update('paymentMethod', item.value)
}

function onPaymentStatusChange(e) {
	const idx = Number(e?.detail?.value)
	const item = paymentStatusOptions[idx]
	if (!item) return
	update('paymentStatus', item.value)
}

function update(key, value) {
	emit('update:modelValue', { ...props.modelValue, [key]: value })
}
</script>

<style scoped>
.settlement-grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 24rpx;
}

.settlement-grid--sm {
	grid-template-columns: repeat(4, 1fr);
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
	color: #64748b;
}

.summary-value {
	font-size: 30rpx;
	font-weight: 700;
	color: #0f172a;
}

.summary-formula {
	font-size: 22rpx;
	color: #94a3b8;
	line-height: 1.4;
}

.picker-full {
	width: 100%;
}

.picker-input {
	pointer-events: none;
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
