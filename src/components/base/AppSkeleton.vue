<template>
	<view class="skeleton" :class="{ 'skeleton--card': card }">
		<view
			v-for="(width, index) in widths"
			:key="index"
			class="skeleton__line"
			:style="{ width, height: lineHeight, borderRadius: radius }"
		/>
	</view>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
	rows: { type: Number, default: 3 },
	card: { type: Boolean, default: false },
	lineHeight: { type: String, default: '24rpx' },
	radius: { type: String, default: '12rpx' },
	gap: { type: String, default: '14rpx' }
})

const widths = computed(() => {
	const count = Math.max(props.rows, 1)
	return Array.from({ length: count }).map((_, index) => {
		if (index === count - 1 && count > 1) return '70%'
		if (index === count - 2 && count > 2) return '85%'
		return '100%'
	})
})
</script>

<style scoped>
.skeleton {
	display: flex;
	flex-direction: column;
	gap: v-bind(gap);
}

.skeleton--card {
	background: var(--crm-surface);
	border-radius: var(--crm-radius-lg);
	padding: 20rpx;
	box-shadow: var(--crm-shadow-sm);
}

.skeleton__line {
	background: linear-gradient(90deg, rgba(226, 232, 240, 0.9), rgba(241, 245, 249, 0.9), rgba(226, 232, 240, 0.9));
	background-size: 200% 100%;
	animation: shimmer 1.3s ease-in-out infinite;
}

@keyframes shimmer {
	0% {
		background-position: 0% 0;
	}
	100% {
		background-position: -200% 0;
	}
}
</style>
