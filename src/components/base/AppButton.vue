<template>
	<button class="btn" :class="[kindClass, sizeClass]" :disabled="disabled || loading" @click="$emit('click')">
		<view class="btn__inner">
			<AppIcon v-if="icon" :name="icon" size="28rpx" class="btn__icon" />
			<text v-if="!loading"><slot /></text>
			<text v-else>处理中…</text>
		</view>
	</button>
</template>

<script setup>
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
	kind: { type: String, default: 'primary' }, // primary (brand), neutral, outline, ghost
	size: { type: String, default: 'md' }, // sm, md
	disabled: { type: Boolean, default: false },
	loading: { type: Boolean, default: false },
	icon: { type: String, default: '' }
})

defineEmits(['click'])

const kindClass = computed(() => `btn--${props.kind}`)
const sizeClass = computed(() => `btn--${props.size}`)
</script>

<style scoped>
.btn {
	border-radius: var(--crm-radius-sm);
	display: flex;
	align-items: center;
	justify-content: center;
	font-weight: 500;
	transition: all 0.2s;
	line-height: 1;
	border: 1rpx solid transparent;
}
.btn::after {
	border: none;
}
.btn__inner {
	display: flex;
	align-items: center;
	gap: 8rpx;
}
.btn--md {
	height: 80rpx;
	padding: 0 32rpx;
	font-size: 28rpx;
}
.btn--sm {
	height: 64rpx;
	padding: 0 24rpx;
	font-size: 24rpx;
}

/* SLDS Button Kinds */
.btn--primary {
	background: var(--crm-primary);
	color: #fff;
	border-color: var(--crm-primary);
}
.btn--primary:active {
	background: #005fb2;
}

.btn--neutral {
	background: #fff;
	color: var(--crm-primary);
	border-color: var(--crm-border);
}
.btn--neutral:active {
	background: #f3f3f3;
}

.btn--outline {
	background: transparent;
	color: var(--crm-primary);
	border-color: var(--crm-primary);
}

.btn--ghost {
	background: transparent;
	color: var(--crm-primary);
	border-color: transparent;
}
.btn--ghost:active {
	background: #f3f3f3;
}

.btn[disabled] {
	opacity: 0.5;
	cursor: not-allowed;
}
</style>
