<template>
	<view class="stat" @click="$emit('click')">
		<view class="stat__meta">
			<text class="stat__label">{{ label }}</text>
			<view class="stat__meta-right">
				<text v-if="hint" class="stat__hint">{{ hint }}</text>
				<text v-if="delta" class="stat__delta" :class="trendClass">{{ delta }}</text>
			</view>
		</view>
		<view class="stat__content">
			<view class="stat__value-wrap">
				<text class="stat__value">{{ value }}</text>
				<text v-if="trendLabel" class="stat__trend" :class="trendClass">{{ trendLabel }}</text>
			</view>
			<view v-if="icon" class="stat__icon">
				<AppIcon :name="icon" size="32rpx" stroke-width="1.6" />
			</view>
		</view>
	</view>
</template>

<script setup>
import { computed } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'

const props = defineProps({
	label: { type: String, required: true },
	value: { type: [String, Number], default: '-' },
	hint: { type: String, default: '' },
	icon: { type: String, default: '' },
	delta: { type: String, default: '' },
	trend: { type: String, default: '' } // up | down | flat
})

defineEmits(['click'])

const trendClass = computed(() => {
	if (props.trend === 'up') return 'stat__delta--up'
	if (props.trend === 'down') return 'stat__delta--down'
	if (props.trend === 'flat') return 'stat__delta--flat'
	return ''
})

const trendLabel = computed(() => {
	if (props.trend === 'up') return 'UP'
	if (props.trend === 'down') return 'DOWN'
	if (props.trend === 'flat') return 'FLAT'
	return ''
})
</script>

<style scoped>
.stat {
	background: #fff;
	border: 1px solid #eef1f5;
	border-radius: 16px;
	padding: 14px 16px;
	position: relative;
	overflow: hidden;
	box-shadow: 0 10px 20px rgba(15, 23, 42, 0.05);
	transition: all var(--crm-duration-fast) var(--crm-easing);
}
.stat:active {
	background: #f8fafc;
}
@media (hover: hover) {
	.stat:hover {
		background: #f8fafc;
	}
}
.stat__meta {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	margin-bottom: 10px;
}

.stat__meta-right {
	display: flex;
	align-items: center;
	gap: 6px;
}
.stat__label {
	font-size: 12px;
	color: #64748b;
	font-weight: 500;
}
.stat__hint {
	font-size: 11px;
	color: #475569;
	background: #eef2ff;
	padding: 2px 8px;
	border-radius: 999px;
}

.stat__delta {
	font-size: 11px;
	padding: 2px 8px;
	border-radius: 999px;
	background: #f1f5f9;
	color: #64748b;
}

.stat__delta--up {
	background: rgba(22, 163, 74, 0.12);
	color: #166534;
}

.stat__delta--down {
	background: rgba(220, 38, 38, 0.12);
	color: #991b1b;
}

.stat__delta--flat {
	background: rgba(148, 163, 184, 0.2);
	color: #475569;
}
.stat__content {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
}

.stat__value-wrap {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	flex: 1;
	gap: 4px;
}

.stat__value {
	font-size: 26px;
	font-weight: 800;
	color: #0f172a;
	line-height: 1;
	text-align: right;
	width: 100%;
}

.stat__trend {
	font-size: 10px;
	padding: 2px 6px;
	border-radius: 999px;
	background: #f1f5f9;
	color: #64748b;
	letter-spacing: 0.5px;
}
.stat__icon {
	width: 36px;
	height: 36px;
	border-radius: 12px;
	background: rgba(37, 99, 235, 0.12);
	color: var(--crm-primary);
	display: flex;
	align-items: center;
	justify-content: center;
}
</style>
