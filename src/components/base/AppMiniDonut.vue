<template>
	<view class="donut" :style="{ width: `${size}rpx`, height: `${size}rpx` }">
		<svg class="donut__svg" viewBox="0 0 100 100">
			<circle
				class="donut__bg"
				cx="50"
				cy="50"
				:r="radius"
				:stroke-width="thickness"
			/>
			<circle
				class="donut__fg"
				cx="50"
				cy="50"
				:r="radius"
				:stroke="color"
				:stroke-width="thickness"
				:stroke-dasharray="dashArray"
				:stroke-dashoffset="dashOffset"
				transform="rotate(-90 50 50)"
			/>
		</svg>
		<view class="donut__center">
			<text class="donut__value">{{ percentage }}%</text>
			<text v-if="label" class="donut__label">{{ label }}</text>
			<text v-if="subtitle" class="donut__subtitle">{{ subtitle }}</text>
		</view>
	</view>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
	value: { type: Number, default: 0 },
	max: { type: Number, default: 100 },
	size: { type: Number, default: 180 },
	thickness: { type: Number, default: 10 },
	color: { type: String, default: 'var(--crm-primary)' },
	label: { type: String, default: '' },
	subtitle: { type: String, default: '' }
})

const safeMax = computed(() => (props.max > 0 ? props.max : 100))
const progress = computed(() => {
	const ratio = props.value / safeMax.value
	if (Number.isNaN(ratio)) return 0
	return Math.min(Math.max(ratio, 0), 1)
})
const percentage = computed(() => Math.round(progress.value * 100))
const radius = computed(() => 50 - props.thickness / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const dashArray = computed(() => `${circumference.value} ${circumference.value}`)
const dashOffset = computed(() => (1 - progress.value) * circumference.value)
</script>

<style scoped>
.donut {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
}

.donut__svg {
	width: 100%;
	height: 100%;
}

.donut__bg {
	fill: none;
	stroke: rgba(0, 0, 0, 0.08);
}

.donut__fg {
	fill: none;
	stroke-linecap: round;
	transition: stroke-dashoffset 0.3s ease;
}

.donut__center {
	position: absolute;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4rpx;
	text-align: center;
}

.donut__value {
	font-size: 32rpx;
	font-weight: 800;
	color: var(--crm-text);
}

.donut__label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.donut__subtitle {
	font-size: 20rpx;
	color: var(--crm-text-muted);
}
</style>
