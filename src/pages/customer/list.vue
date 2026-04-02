<template>
	<CustomerListView ref="listRef" :entry-mode="entryMode" />
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { onLoad } from '@dcloudio/uni-app'
import CustomerListView from '@/components/domain/customer/CustomerListView.vue'

const listRef = ref(null)
const entryMode = ref('default')
let firstShow = true

function normalizeEntryMode(value) {
	const text = String(value || '').trim().toLowerCase()
	if (text === 'statement') return 'statement'
	return 'default'
}

onLoad((options = {}) => {
	const scene = options.scene || options.entryMode || options.entry_mode || ''
	entryMode.value = normalizeEntryMode(scene)
})

onShow(() => {
	if (firstShow) {
		firstShow = false
		return
	}
	listRef.value?.refresh?.()
})
</script>
