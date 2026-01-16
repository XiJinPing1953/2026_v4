<template>
	<AppCard>
		<view v-if="rows.length === 0">
			<AppEmpty title="暂无明细" subtitle="点击下方按钮新增" />
		</view>
		<view v-else class="rows">
			<view v-for="(row, index) in rows" :key="index" class="row">
				<AppInput :model-value="row.bottle_no" label="瓶号" placeholder="瓶号" @update:modelValue="(v) => updateRow(index, 'bottle_no', v)" />
				<AppInput :model-value="row.gross" label="毛重" placeholder="kg" @update:modelValue="(v) => updateRow(index, 'gross', v)" />
				<AppInput :model-value="row.tare" label="皮重" placeholder="kg" @update:modelValue="(v) => updateRow(index, 'tare', v)" />
				<AppInput :model-value="row.net" label="净重" placeholder="kg" @update:modelValue="(v) => updateRow(index, 'net', v)" />
				<AppButton kind="ghost" size="sm" @click="removeRow(index)">删除</AppButton>
			</view>
		</view>
		<AppButton kind="ghost" @click="addRow">新增行</AppButton>
	</AppCard>
</template>

<script setup>
import { computed } from 'vue'
import AppCard from '@/components/base/AppCard.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'

const props = defineProps({
	modelValue: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue'])

const rows = computed(() => props.modelValue || [])

function updateRow(index, key, value) {
	const next = rows.value.map((row, idx) => (idx === index ? { ...row, [key]: value } : row))
	emit('update:modelValue', next)
}

function addRow() {
	emit('update:modelValue', [...rows.value, { bottle_no: '', gross: '', tare: '', net: '' }])
}

function removeRow(index) {
	const next = rows.value.filter((_, idx) => idx !== index)
	emit('update:modelValue', next)
}
</script>

<style scoped>
.rows {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}
.row {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}
</style>
