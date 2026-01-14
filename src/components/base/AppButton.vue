<template>
	<button class="btn" :class="kindClass" :disabled="disabled || loading" @click="$emit('click')">
		<text v-if="!loading"><slot /></text>
		<text v-else>处理中…</text>
	</button>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
	kind: { type: String, default: 'primary' },
	disabled: { type: Boolean, default: false },
	loading: { type: Boolean, default: false }
})

defineEmits(['click'])

const kindClass = computed(() => `btn--${props.kind}`)
</script>

<style scoped>
.btn {
	height: 88rpx;
	border-radius: 16rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 30rpx;
}
.btn--primary {
	background: #2563eb;
	color: #fff;
}
.btn--ghost {
	background: #fff;
	color: #2563eb;
	border: 1rpx solid #bfdbfe;
}
.btn[disabled] {
	opacity: 0.6;
}
</style>
