<template>
	<AppCard>
		<AppEmpty title="待接入代理出站" subtitle="后续替换为代理出站行组件" />
		<AppButton kind="ghost" @click="$emit('add')">添加代理行</AppButton>
	</AppCard>
</template>

<script setup>
import AppCard from '@/components/base/AppCard.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppButton from '@/components/base/AppButton.vue'

defineEmits(['add'])
</script>
