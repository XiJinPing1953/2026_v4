<template>
	<BottleListView
		ref="listRef"
		:initial-inspection-due-module="initialInspectionDueModule"
		:initial-inspection-due-state="initialInspectionDueState"
	/>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import BottleListView from '@/components/domain/bottle/BottleListView.vue'

const listRef = ref(null)
const initialInspectionDueModule = ref('')
const initialInspectionDueState = ref('')
let firstShow = true

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeInspectionDueModule(value) {
	const normalized = normalizeString(value).toLowerCase()
	return ['bottle', 'gauge', 'valve'].includes(normalized) ? normalized : ''
}

function normalizeInspectionDueState(value) {
	const normalized = normalizeString(value).toLowerCase()
	return ['overdue', 'due_60d'].includes(normalized) ? normalized : ''
}

onLoad((options = {}) => {
	const moduleValue = normalizeInspectionDueModule(options.inspection_due_module ?? options.inspectionDueModule)
	const stateValue = normalizeInspectionDueState(options.inspection_due_state ?? options.inspectionDueState)
	if (moduleValue && stateValue) {
		initialInspectionDueModule.value = moduleValue
		initialInspectionDueState.value = stateValue
		return
	}
	initialInspectionDueModule.value = ''
	initialInspectionDueState.value = ''
})

onShow(() => {
	if (firstShow) {
		firstShow = false
		return
	}
	listRef.value?.refresh?.()
})
</script>
