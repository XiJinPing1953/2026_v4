<template>
	<AppCard>
		<AppEmpty title="待接入明细" subtitle="后续替换为出/回瓶行组件" />
		<AppButton kind="ghost" @click="$emit('add')">新增行</AppButton>
	</AppCard>
</template>

<script setup>
import AppCard from '@/components/base/AppCard.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppButton from '@/components/base/AppButton.vue'

defineEmits(['add'])
</script>
