<template>
	<AppCard>
		<view class="card-body">
			<view v-if="rows.length === 0">
				<AppEmpty title="暂无代理出站" subtitle="点击下方按钮新增" />
			</view>
			<view v-else class="rows">
				<view v-for="(row, index) in rows" :key="index" class="row">
					<AppInput :model-value="row.bottle_no" label="瓶号" placeholder="瓶号" @update:modelValue="(v) => updateRow(index, 'bottle_no', v)" />
					<AppInput :model-value="row.fill_weight" label="灌装重量" placeholder="kg" @update:modelValue="(v) => updateRow(index, 'fill_weight', v)" />
					<AppInput :model-value="row.address" label="配送地址" placeholder="客户地址" @update:modelValue="(v) => updateRow(index, 'address', v)" />
					<AppButton kind="ghost" size="sm" @click="removeRow(index)">删除</AppButton>
				</view>
			</view>
			<AppButton kind="ghost" @click="addRow">添加代理行</AppButton>
		</view>
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
	emit('update:modelValue', [...rows.value, { bottle_no: '', fill_weight: '', address: '' }])
}

function removeRow(index) {
	const next = rows.value.filter((_, idx) => idx !== index)
	emit('update:modelValue', next)
}
</script>

<style scoped>
.card-body {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}
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
