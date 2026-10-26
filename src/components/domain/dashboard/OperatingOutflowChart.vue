<template>
	<view class="outflow-chart" aria-label="登记出罐分类">
		<view v-for="row in rows" :key="row.key" class="outflow-chart__row">
			<view class="outflow-chart__labels"><text>{{ row.label }}</text><text>{{ row.complete ? number(row.weight_kg) + ' kg · ' + row.count + ' ' + row.count_unit : '待核' }}</text></view>
			<view class="outflow-chart__track" aria-hidden="true"><view v-if="row.complete && row.weight_kg > 0" class="outflow-chart__bar" :style="{ width: (row.weight_kg / maximum * 100) + '%' }" /></view>
		</view>
		<text class="outflow-chart__note">各渠道共用比例尺，同一截止时点；{{ outflow?.complete ? '四项合计为登记出罐量。' : '部分来源待核，暂不计算完整总量与占比。' }}</text>
	</view>
</template>
<script setup>
import { computed } from 'vue'
const props = defineProps({ outflow: { type: Object, default: null } })
const rows = computed(() => props.outflow?.channels || [
	{ key: 'bottle', label: '钢瓶充装' }, { key: 'local', label: '地方车' }, { key: 'vehicle', label: '车辆燃气加注' }, { key: 'other', label: '整车补气及其他' }
])
const maximum = computed(() => Math.max(1, ...rows.value.filter(row => row.complete).map(row => row.weight_kg)))
const number = value => Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 })
</script>
<style scoped>
.outflow-chart { margin-top: 12px; }
.outflow-chart__row { margin-bottom: 10px; }
.outflow-chart__labels { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 12px; font-variant-numeric: tabular-nums; }
.outflow-chart__track { height: 5px; background: var(--crm-bg); margin-top: 5px; border-radius: 2px; }
.outflow-chart__bar { height: 5px; background: var(--crm-primary); border-radius: 2px; }
.outflow-chart__note { font-size: 12px; color: var(--crm-text-muted); line-height: 1.6; }
</style>
