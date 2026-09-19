<template>
	<view class="record-table" role="table" :aria-label="label">
		<view class="record-table__head" role="row">
			<text v-for="column in columns" :key="column.key" role="columnheader">{{ column.label }}</text>
			<text role="columnheader">操作</text>
		</view>
		<text v-if="loading" class="record-table__empty">正在加载…</text>
		<text v-else-if="!rows.length" class="record-table__empty">{{ emptyTitle }}</text>
		<view v-for="row in rows" v-else :key="rowKey(row)" class="record-table__record" role="rowgroup">
			<view class="record-table__row" role="row">
				<view v-for="column in columns" :key="column.key" class="record-table__cell" role="cell">
					<text class="record-table__mobile-label">{{ column.label }}</text>
					<slot :name="column.key" :row="row"><text>{{ column.value(row) }}</text></slot>
				</view>
				<view class="record-table__actions" role="cell">
					<AppButton size="sm" kind="ghost" :aria-expanded="expanded === rowKey(row)" @click="expanded = expanded === rowKey(row) ? '' : rowKey(row)">{{ expanded === rowKey(row) ? '收起详情' : '详情' }}</AppButton>
				</view>
			</view>
			<view v-if="expanded === rowKey(row)" class="record-table__detail" role="row">
				<view role="cell"><slot name="detail" :row="row" /><view class="record-table__actions record-table__detail-actions"><slot name="actions" :row="row" /></view></view>
			</view>
		</view>
	</view>
</template>
<script setup>
import { ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
const props = defineProps({ rows: { type: Array, default: () => [] }, columns: { type: Array, default: () => [] }, rowKey: { type: Function, required: true }, loading: Boolean, label: String, emptyTitle: { type: String, default: '暂无记录' } })
const expanded = ref('')
watch(() => props.rows, rows => { if (!rows.some(row => props.rowKey(row) === expanded.value)) expanded.value = '' })
</script>
<style scoped>
.record-table { width:100%; min-width:0; }
.record-table__head,.record-table__row { display:grid; grid-template-columns:100px minmax(100px,1.2fr) repeat(3,minmax(80px,1fr)) minmax(85px,0.8fr) 80px; gap:12px; align-items:center; }
.record-table__head { padding:12px; background:#f8fafc; color:#64748b; font-size:12px; border-bottom:1px solid #e7ecf2; }
.record-table__row { padding:6px 12px; font-size:13px; color:#243247; border-bottom:1px solid #edf0f4; }
.record-table__cell { min-width:0; overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
.record-table__actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
.record-table__detail { padding:14px; background:#f8fafc; border-bottom:1px solid #e7ecf2; overflow-wrap:anywhere; }
.record-table__detail-actions { margin-top:12px; }
.record-table__empty { display:block; padding:30px; text-align:center; color:#64748b; }
.record-table__mobile-label { display:none; }
@media(max-width:1100px) {
	.record-table__head { display:none; }
	.record-table__record { border:1px solid #e7ecf2; border-radius:8px; margin-bottom:10px; overflow:hidden; }
	.record-table__row { grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
	.record-table__mobile-label { display:block; font-size:12px; color:#64748b; margin-bottom:3px; }
	.record-table__actions { grid-column:1 / -1; }
}
</style>
