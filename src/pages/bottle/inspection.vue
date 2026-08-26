<template>
	<BottleInspectionView
		:initial-inspection-due-module="initialInspectionDueModule"
		:initial-inspection-due-state="initialInspectionDueState"
	/>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import BottleInspectionView from '@/components/domain/bottle/BottleInspectionView.vue'

const initialInspectionDueModule = ref('')
const initialInspectionDueState = ref('')

function normalizeInspectionDueModule(value) {
	const normalized = String(value || '').trim().toLowerCase()
	return ['bottle', 'gauge', 'valve'].includes(normalized) ? normalized : ''
}

function normalizeInspectionDueState(value) {
	const normalized = String(value || '').trim().toLowerCase()
	return ['overdue', 'due_60d'].includes(normalized) ? normalized : ''
}

onLoad((options = {}) => {
	initialInspectionDueModule.value = normalizeInspectionDueModule(options.inspection_due_module ?? options.inspectionDueModule)
	initialInspectionDueState.value = normalizeInspectionDueState(options.inspection_due_state ?? options.inspectionDueState)
})
</script>
