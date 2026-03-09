<template>
	<view class="bars" :style="{ height: `${height}rpx`, gap: `${gap}rpx` }">
		<view
			v-for="(value, index) in displayValues"
			:key="index"
			class="bar"
			:style="{
				height: `${barHeights[index]}%`,
				width: `${barWidth}rpx`,
				background: color
			}"
		/>
	</view>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
	values: { type: Array, default: () => [] },
	height: { type: Number, default: 80 },
	barWidth: { type: Number, default: 16 },
	gap: { type: Number, default: 10 },
	color: { type: String, default: 'var(--crm-warning)' }
})

const displayValues = computed(() => {
	if (Array.isArray(props.values) && props.values.length > 0) return props.values
	return [0, 0, 0, 0, 0, 0]
})

const maxValue = computed(() => Math.max(...displayValues.value, 0))

const barHeights = computed(() => {
	const max = maxValue.value
	return displayValues.value.map((value) => {
		if (max <= 0) return 6
		const percent = (value / max) * 100
		return Math.max(percent, value === 0 ? 6 : 0)
	})
})
</script>

<style scoped>
.bars {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	width: 100%;
}

.bar {
	border-radius: 6rpx 6rpx 0 0;
	opacity: 0.85;
	transition: height 0.3s ease;
}
</style>
