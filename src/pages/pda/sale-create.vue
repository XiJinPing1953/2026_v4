<template>
	<PdaSaleCreateView
		:initial-customer-id="initialCustomerId"
		:initial-customer-name="initialCustomerName"
		:initial-out-bottle-no="initialOutBottleNo"
	/>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PdaSaleCreateView from '@/components/domain/pda/PdaSaleCreateView.vue'

const initialCustomerId = ref('')
const initialCustomerName = ref('')
const initialOutBottleNo = ref('')

onLoad((options) => {
	initialCustomerId.value = String(options?.customer_id || '')
	initialCustomerName.value = String(options?.customer_name || '')
	initialOutBottleNo.value = String(options?.out_bottle_no || '')
})
</script>
