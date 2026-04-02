<template>
	<AppCard :padding="size === 'sm' ? '24rpx' : '32rpx'">
		<view class="flow-grid" :class="{ 'flow-grid--sm': size === 'sm' }">
			<AppInput :model-value="modelValue.flowPrev" label="上次表数" placeholder="0.000" :size="size" @update:modelValue="(v) => update('flowPrev', v)" />
			<AppInput :model-value="modelValue.flowCurr" label="本次表数" placeholder="0.000" :size="size" @update:modelValue="(v) => update('flowCurr', v)" />
			<AppInput :model-value="modelValue.flowVolume" label="用气量" placeholder="m3" :size="size" @update:modelValue="(v) => update('flowVolume', v)" />
			<AppInput :model-value="modelValue.flowRatio" label="理论系数" placeholder="可选" :size="size" @update:modelValue="(v) => update('flowRatio', v)" />
		</view>
	</AppCard>
</template>

<script setup>
import AppCard from '@/components/base/AppCard.vue'
import AppInput from '@/components/base/AppInput.vue'

const props = defineProps({
	modelValue: {
		type: Object,
		default: () => ({})
	},
	size: { type: String, default: 'md' }
})

const emit = defineEmits(['update:modelValue'])

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function countDecimalPlaces(text) {
	const source = normalizeString(text)
	const dotIndex = source.indexOf('.')
	if (dotIndex < 0) return 0
	return Math.max(source.length - dotIndex - 1, 0)
}

function parseScaledBigInt(text, scaleDigits) {
	const source = normalizeString(text)
	if (!source) return null
	const match = source.match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
	if (!match) return null
	const sign = match[1] === '-' ? -1n : 1n
	const integerPart = match[2] || '0'
	const decimalPart = (match[3] || '').padEnd(scaleDigits, '0').slice(0, scaleDigits)
	const combined = `${integerPart}${decimalPart}`.replace(/^0+(?=\d)/, '') || '0'
	return sign * BigInt(combined)
}

function formatScaledBigInt(value, scaleDigits) {
	const negative = value < 0n
	const absValue = negative ? -value : value
	const source = absValue.toString().padStart(scaleDigits + 1, '0')
	if (scaleDigits <= 0) return `${negative ? '-' : ''}${source}`
	const integerPart = source.slice(0, -scaleDigits) || '0'
	const decimalPart = source.slice(-scaleDigits).replace(/0+$/, '')
	return `${negative ? '-' : ''}${integerPart}${decimalPart ? `.${decimalPart}` : ''}`
}

function calcFlowVolume(prevValue, currValue) {
	const prevText = normalizeString(prevValue)
	const currText = normalizeString(currValue)
	if (!prevText || !currText) return ''
	const scaleDigits = Math.max(countDecimalPlaces(prevText), countDecimalPlaces(currText))
	const prev = parseScaledBigInt(prevText, scaleDigits)
	const curr = parseScaledBigInt(currText, scaleDigits)
	if (prev == null || curr == null) return ''
	const diff = curr - prev
	return formatScaledBigInt(diff > 0n ? diff : 0n, scaleDigits)
}

function update(key, value) {
	const next = { ...props.modelValue, [key]: value }
	if (key === 'flowPrev' || key === 'flowCurr') {
		const prevText = key === 'flowPrev' ? value : next.flowPrev
		const currText = key === 'flowCurr' ? value : next.flowCurr
		next.flowVolume = calcFlowVolume(normalizeString(prevText), normalizeString(currText))
	}
	emit('update:modelValue', next)
}
</script>

<style scoped>
.flow-grid {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: 24rpx;
}

.flow-grid--sm {
	gap: 16rpx;
}

@media (max-width: 600px) {
	.flow-grid {
		grid-template-columns: 1fr;
	}
}
</style>
