<template>
	<view class="sources" aria-label="原单依据">
		<view class="sources__head"><text class="sources__title">{{ title }} · 原单依据</text><button role="button" tabindex="0" class="sources__button" @click="$emit('close')" @keydown="activateOnKey($event, () => $emit('close'))">收起</button></view>
		<text v-if="error" role="alert" class="sources__warning">{{ error }}</text>
		<text v-if="loading" role="status" class="sources__note">正在读取原始来源…</text>
		<template v-if="data">
			<text class="sources__note">{{ data.range?.start }} 至 {{ data.range?.end }} · 已列 {{ data.items.length }} / {{ data.total }} 条</text>
			<text v-if="data.note" class="sources__note">{{ data.note }}</text>
			<text v-if="data.status === 'unavailable'" class="sources__warning">{{ data.issues?.[0]?.message || '来源待核，以下记录不能代表完整合计。' }}</text>
			<view v-for="row in data.items" :key="row.source_type + ':' + row.source_id" class="sources__row">
				<view><text>{{ row.date }} · {{ row.customer_name || row.label || sourceName(row.source_type) }}</text><text class="sources__note">{{ sourceName(row.source_type) }} · {{ row.source_id }}</text></view>
				<text v-if="row.value != null" class="sources__value">{{ number(row.value) }} {{ row.unit }}</text>
				<text v-else class="sources__warning">{{ row.issues?.[0]?.message || '该原单待核' }}</text>
				<button v-if="route(row)" role="button" tabindex="0" class="sources__button" @click="$emit('navigate', route(row))" @keydown="activateOnKey($event, () => $emit('navigate', route(row)))">查看原单 →</button>
			</view>
			<text v-if="!data.items.length && data.status === 'available'" class="sources__note">该范围没有符合口径的原单。</text>
			<button v-if="data.next_cursor != null" role="button" :tabindex="loading ? -1 : 0" :disabled="loading" class="sources__button" @click="$emit('more')" @keydown="activateOnKey($event, () => $emit('more'), loading)">继续读取来源</button>
		</template>
		<text class="sources__note">明细分页仅用于查看；合计来自完整取数。读取不是跨表事务快照。</text>
	</view>
</template>
<script setup>
import { computed } from 'vue'
const props = defineProps({ data: { type: Object, default: null }, query: { type: Object, default: null }, loading: Boolean, error: { type: String, default: '' }, canView: { type: Function, default: () => false } })
defineEmits(['close', 'more', 'navigate'])
const title = computed(() => ({ sale_weight_kg: '销售净气量', business_net: '货款', cash_net: '净收款', customer_count: '交易客户' }[props.query?.metric] || '业务'))
const number = value => Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 })
const sourceName = type => ({ crm_sale_records: '销售单', crm_customer_flow_settlements: '流量结算', crm_customer_receipts: '收退款凭据' }[type] || '业务记录')
function route(row) {
	let value = ''
	if (row.source_type === 'crm_sale_records') value = `/pages/sale/detail?_id=${encodeURIComponent(row.source_id)}`
	else if (row.customer_id) value = `/pages/customer/statement?_id=${encodeURIComponent(row.customer_id)}`
	return value && props.canView(value.split('?')[0]) ? value : ''
}
function activateOnKey(event, action, disabled = false) {
	if (disabled || !['Enter', ' '].includes(event?.key)) return
	event.preventDefault(); if (!event.repeat) action()
}
</script>
<style scoped>
.sources { padding: 12px; margin-top: 14px; background: var(--crm-bg); border-radius: 6px; font-size: 12px; }
.sources__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sources__title { font-size: 14px; font-weight: 600; }
.sources__row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 8px 0; border-bottom: 1px solid var(--crm-border); overflow-wrap: anywhere; }
.sources__row > view { min-width: 0; flex: 1 1 180px; }
.sources__note { color: var(--crm-text-muted); font-size: 12px; display: block; line-height: 1.6; }
.sources__value { font-variant-numeric: tabular-nums; }
.sources__warning { color: var(--crm-warning); display: block; }
.sources__button { display: inline-flex; align-items: center; min-height: 44px; border: 0; padding: 6px 0; margin: 0; background: transparent; color: var(--crm-primary); font: inherit; cursor: pointer; }
.sources__button::after { border: 0; }
.sources__button:focus-visible { outline: 2px solid var(--crm-primary); }
</style>
