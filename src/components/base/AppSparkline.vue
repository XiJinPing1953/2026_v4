<template>
	<view class="sparkline" :style="{ width: `${width}rpx`, height: `${height}rpx` }">
		<svg class="sparkline__svg" :viewBox="`0 0 ${vbWidth} ${vbHeight}`">
			<path v-if="showArea" class="sparkline__area" :d="areaPath" :fill="fill" />
			<polyline
				class="sparkline__line"
				:points="polylinePoints"
				:stroke="stroke"
				fill="none"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<circle
				v-if="lastPoint"
				class="sparkline__dot"
				:cx="lastPoint.x"
				:cy="lastPoint.y"
				r="2.5"
				:fill="stroke"
			/>
		</svg>
	</view>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
	points: { type: Array, default: () => [] },
	width: { type: Number, default: 220 },
	height: { type: Number, default: 80 },
	stroke: { type: String, default: 'var(--crm-primary)' },
	fill: { type: String, default: 'rgba(1, 118, 211, 0.15)' },
	showArea: { type: Boolean, default: true }
})

const vbWidth = 100
const vbHeight = 40
const padding = 4

const normalizedPoints = computed(() => {
	const raw = Array.isArray(props.points) ? props.points : []
	if (raw.length < 2) {
		return [
			{ x: padding, y: vbHeight / 2 },
			{ x: vbWidth - padding, y: vbHeight / 2 }
		]
	}
	const min = Math.min(...raw)
	const max = Math.max(...raw)
	const span = max - min || 1
	const usableWidth = vbWidth - padding * 2
	const usableHeight = vbHeight - padding * 2
	return raw.map((value, index) => {
		const x = padding + (index / (raw.length - 1)) * usableWidth
		const ratio = (value - min) / span
		const y = padding + (1 - ratio) * usableHeight
		return { x, y }
	})
})

const polylinePoints = computed(() =>
	normalizedPoints.value.map((point) => `${point.x},${point.y}`).join(' ')
)

const areaPath = computed(() => {
	if (!props.showArea || normalizedPoints.value.length < 2) return ''
	const baseline = vbHeight - padding
	const points = normalizedPoints.value
	const first = points[0]
	const last = points[points.length - 1]
	const line = points.map((point) => `L ${point.x} ${point.y}`).join(' ')
	return `M ${first.x} ${baseline} ${line} L ${last.x} ${baseline} Z`
})

const lastPoint = computed(() => normalizedPoints.value[normalizedPoints.value.length - 1])
</script>

<style scoped>
.sparkline {
	display: flex;
	align-items: center;
	justify-content: center;
}

.sparkline__svg {
	width: 100%;
	height: 100%;
}

.sparkline__area {
	opacity: 0.8;
}

.sparkline__line {
	transition: all 0.3s ease;
}
</style>
