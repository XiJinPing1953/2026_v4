<template>
	<AppCard :padding="size === 'sm' ? '24rpx' : '32rpx'">
		<view class="truck-stack">
			<view class="truck-section">
				<text class="truck-section__title">出厂依据（参考）</text>
				<view class="truck-grid" :class="{ 'truck-grid--sm': size === 'sm' }">
					<AppInput :model-value="modelValue.truckNo" label="车牌号 / 罐车号" placeholder="例如 冀A396VN" :size="size" @update:modelValue="(v) => update('truckNo', v)" />
					<AppInput :model-value="modelValue.truckOutGross" label="出厂毛重" placeholder="kg" :size="size" @update:modelValue="(v) => update('truckOutGross', v)" />
					<AppInput :model-value="modelValue.truckBackGross" label="回厂毛重" placeholder="kg" :size="size" @update:modelValue="(v) => update('truckBackGross', v)" />
					<AppInput :model-value="resolvedTruckWeightDiff" label="参考净重" placeholder="自动=出厂毛重-回厂毛重" :size="size" readonly />
				</view>
			</view>
			<view v-if="showSettlementBasis" class="truck-section truck-section--settle">
				<text class="truck-section__title">结算依据（kg）</text>
				<view class="truck-grid" :class="{ 'truck-grid--sm': size === 'sm' }">
					<AppInput :model-value="modelValue.truckSettleTare" label="车皮重" placeholder="kg" :size="size" @update:modelValue="(v) => update('truckSettleTare', v)" />
					<AppInput :model-value="modelValue.truckSettleGross" label="灌装后车毛重" placeholder="kg" :size="size" @update:modelValue="(v) => update('truckSettleGross', v)" />
					<AppInput :model-value="resolvedTruckSettleNet" label="结算净重" placeholder="自动=灌装后车毛重-车皮重" :size="size" readonly />
					<view class="truck-net-diff" :class="{ 'truck-net-diff--warn': hasNetDiff }">
						<text class="truck-net-diff__title">净重误差</text>
						<text class="truck-net-diff__value">{{ netDiffText }}</text>
					</view>
				</view>
			</view>
		</view>
	</AppCard>
</template>

<script setup>
import AppCard from '@/components/base/AppCard.vue'
import AppInput from '@/components/base/AppInput.vue'
import { computed } from 'vue'

const props = defineProps({
	modelValue: {
		type: Object,
		default: () => ({})
	},
	priceUnit: { type: String, default: 'kg' },
	size: { type: String, default: 'md' }
})

const emit = defineEmits(['update:modelValue'])

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function formatTruckWeight(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return ''
	if (Number.isInteger(num)) return String(num)
	return num.toFixed(6).replace(/\.?0+$/, '')
}

function calcTruckReferenceNet(outGross, backGross) {
	const outNum = toNumber(outGross, null)
	const backNum = toNumber(backGross, null)
	if (outNum == null || backNum == null) return ''
	const diff = outNum - backNum
	return formatTruckWeight(diff > 0 ? diff : 0)
}

function calcTruckSettlementNet(settleGross, settleTare) {
	const grossNum = toNumber(settleGross, null)
	const tareNum = toNumber(settleTare, null)
	if (grossNum == null || tareNum == null) return ''
	const diff = grossNum - tareNum
	return formatTruckWeight(diff > 0 ? diff : 0)
}

function parseWeight(value) {
	const num = toNumber(value, null)
	if (num == null) return null
	return Number(num.toFixed(6))
}

const showSettlementBasis = computed(() => normalizeString(props.priceUnit).toLowerCase() === 'kg')
const resolvedTruckWeightDiff = computed(() => calcTruckReferenceNet(props.modelValue?.truckOutGross, props.modelValue?.truckBackGross))
const resolvedTruckSettleNet = computed(() =>
	calcTruckSettlementNet(props.modelValue?.truckSettleGross, props.modelValue?.truckSettleTare)
)
const netDiffValue = computed(() => {
	const settlement = parseWeight(resolvedTruckSettleNet.value)
	const reference = parseWeight(resolvedTruckWeightDiff.value)
	if (settlement == null || reference == null) return null
	return Number((settlement - reference).toFixed(6))
})
const hasNetDiff = computed(() => {
	const diff = netDiffValue.value
	return diff != null && Math.abs(diff) > 0.000001
})
const netDiffText = computed(() => {
	const diff = netDiffValue.value
	if (diff == null) return '待计算'
	const sign = diff > 0 ? '+' : ''
	const base = `${sign}${formatTruckWeight(diff)} kg（结算净重-参考净重）`
	if (diff < 0) return `${base}；已计入损耗 ${formatTruckWeight(Math.abs(diff))} kg`
	return base
})

function update(key, value) {
	const next = { ...props.modelValue, [key]: value }
	const referenceNet = calcTruckReferenceNet(next.truckOutGross, next.truckBackGross)
	const settlementNet = calcTruckSettlementNet(next.truckSettleGross, next.truckSettleTare)
	next.truckGrossDiff = referenceNet
	next.truckSaleNet = showSettlementBasis.value ? settlementNet : referenceNet
	emit('update:modelValue', next)
}
</script>

<style scoped>
.truck-stack {
	display: flex;
	flex-direction: column;
	gap: 20rpx;
}

.truck-section {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.truck-section--settle {
	padding-top: 16rpx;
	border-top: 1rpx dashed #dbe4f0;
}

.truck-section__title {
	font-size: 22rpx;
	font-weight: 600;
	color: #475569;
}

.truck-grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 24rpx;
}

.truck-grid--sm {
	gap: 16rpx;
}

@media (max-width: 960px) {
	.truck-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

.truck-net-diff {
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 6rpx;
	padding: 14rpx 16rpx;
	border-radius: 14rpx;
	background: #f8fafc;
	border: 1rpx solid #dbe6f4;
}

.truck-net-diff__title {
	font-size: 22rpx;
	color: #64748b;
}

.truck-net-diff__value {
	font-size: 24rpx;
	color: #1e293b;
	line-height: 1.35;
}

.truck-net-diff--warn {
	background: #fff7ed;
	border-color: #f59e0b;
}

.truck-net-diff--warn .truck-net-diff__value {
	color: #b45309;
}

@media (max-width: 600px) {
	.truck-grid {
		grid-template-columns: 1fr;
	}
}
</style>
