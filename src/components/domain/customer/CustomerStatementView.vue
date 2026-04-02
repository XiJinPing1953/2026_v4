<template>
	<CustomerStatementModule :record-id="recordId" :scene="scene" :sale-id="saleId" />
</template>

<script setup>
import { toRef } from 'vue'
import CustomerStatementModule from '@/components/domain/customer/statement/CustomerStatementModule.vue'

const props = defineProps({
	recordId: { type: String, default: '' },
	scene: { type: String, default: '' },
	saleId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')
const scene = toRef(props, 'scene')
const saleId = toRef(props, 'saleId')
</script>
