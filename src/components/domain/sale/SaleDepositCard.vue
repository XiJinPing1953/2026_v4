<template>
	<AppCard>
		<AppEmpty title="待接入存瓶录入" subtitle="后续替换为存瓶选择组件" />
		<AppButton kind="ghost" @click="$emit('add')">添加存瓶</AppButton>
	</AppCard>
</template>

<script setup>
import AppCard from '@/components/base/AppCard.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppButton from '@/components/base/AppButton.vue'

defineEmits(['add'])
</script>
