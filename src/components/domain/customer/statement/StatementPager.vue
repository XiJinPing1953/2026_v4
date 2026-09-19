<template>
	<view v-if="total > 0" class="statement-pager">
		<text class="statement-pager__label">共 {{ total }} 条 · 每页 {{ size }} 条</text>
		<AppButton size="sm" kind="neutral" :disabled="disabled || page <= 1" @click="$emit('update:page', page - 1)">上一页</AppButton>
		<text class="statement-pager__label">第 {{ page }} / {{ pages }} 页</text>
		<AppButton size="sm" kind="neutral" :disabled="disabled || page >= pages" @click="$emit('update:page', page + 1)">下一页</AppButton>
	</view>
</template>
<script setup>
import { computed } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
const props = defineProps({ page: { type: Number, default: 1 }, total: { type: Number, default: 0 }, size: { type: Number, default: 10 }, disabled: Boolean })
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.size)))
defineEmits(['update:page'])
</script>
<style scoped>
.statement-pager { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:10px; padding-top:14px; }
.statement-pager__label { font-size:12px; color:var(--crm-text-muted); }
</style>
