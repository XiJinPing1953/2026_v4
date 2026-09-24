<template>
	<view class="fill-preview">
		<text class="preview-title">待新增明细 · {{ items.length }} / {{ total }} 条 · 异常优先</text>
		<view class="preview-head">
			<text>行 / 瓶号</text><text>上秤 kg</text><text>灌完 kg</text><text>净重 kg</text><text>上秤差 kg</text><text>核查状态</text><text>来源</text>
		</view>
		<view v-for="item in items" :key="`${item.line_no}-${item.bottle_no}`" class="preview-entry">
			<view class="preview-row" :class="{ 'has-warning': item.warning_reason }">
				<view class="bottle-cell"><text class="line-number">{{ item.line_no }} 行</text><text class="bottle-number">{{ item.bottle_no }}</text></view>
				<view class="weight-cell"><text class="mobile-label">上秤</text><text>{{ weight(item.weight_start) }}</text></view>
				<view class="weight-cell"><text class="mobile-label">灌完</text><text>{{ weight(item.weight_end) }}</text></view>
				<view class="weight-cell"><text class="mobile-label">净重</text><text>{{ weight(item.fill_weight) }}</text></view>
				<view class="weight-cell"><text class="mobile-label">上秤差</text><text>{{ weight(item.start_loss_weight) }}</text></view>
				<view class="status-cell">
					<text :class="item.warning_reason ? 'warning-text' : 'normal-text'">{{ flowStatus(item) }}</text>
					<text v-if="item.loss_match_status === 'pending'" class="pending-text">重量待补算</text>
				</view>
				<button class="detail-button" :aria-expanded="Boolean(expanded[item.line_no])" @click="toggle(item.line_no)">{{ expanded[item.line_no] ? '收起' : '详情' }}</button>
			</view>
			<view v-if="expanded[item.line_no]" class="preview-detail">
				<text v-if="item.warning_reason" class="warning-text">{{ item.warning_reason }}</text>
				<text v-if="hasWeight(item.basis_value)">回瓶日期 {{ item.basis_date || '—' }} · {{ item.basis_source === 'back_tare_plus_net' ? '皮重＋余气' : '回瓶总重' }} {{ weight(item.basis_value) }} kg</text>
				<text v-else>{{ item.loss_match_status === 'pending' ? '待销售回瓶记录补齐后，自动补算上秤差。' : '本行无回瓶重量依据。' }}</text>
				<text v-if="item.basis_ref" class="source-reference">来源单号 {{ item.basis_ref }}</text>
			</view>
		</view>
		<text v-if="total > items.length" class="preview-note">仅展示前 {{ items.length }} 条，流转核查覆盖全部 {{ total }} 条。</text>
	</view>
</template>

<script setup>
import { ref, watch } from 'vue'
const props = defineProps({ items: { type: Array, default: () => [] }, total: { type: Number, default: 0 }, flowChecked: { type: Boolean, default: false } })
const expanded = ref({})
watch(() => props.items, () => { expanded.value = {} })
function toggle(line) { expanded.value = { ...expanded.value, [line]: !expanded.value[line] } }
function hasWeight(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) }
function weight(value) { return hasWeight(value) ? String(Number(Number(value).toFixed(3))) : '—' }
function flowStatus(item) {
	if (item.warning_status_code === 'waiting_next_action') return '同日待确认'
	if (item.warning_status_code === 'out') return '未回瓶'
	if (item.warning_reason) return '需核对'
	return props.flowChecked ? '无流转预警' : '不涉及瓶流转'
}
</script>

<style scoped>
.fill-preview { margin-top: 12px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; color: #334155; font-size: 13px; }
.preview-title { display: block; padding: 12px; font-weight: 600; background: #f8fafc; }
.preview-head, .preview-row { display: grid; grid-template-columns: 1.1fr repeat(4, .85fr) 1.4fr 54px; align-items: center; gap: 10px; padding: 10px 12px; }
.preview-head { color: #64748b; background: #f8fafc; font-size: 12px; }
.preview-entry { border-top: 1px solid #e2e8f0; }
.has-warning { background: #fffbeb; }
.bottle-cell { display: flex; gap: 10px; align-items: center; }
.line-number { color: #94a3b8; font-size: 11px; }
.bottle-number { font-weight: 600; }
.weight-cell { font-variant-numeric: tabular-nums; }
.mobile-label { display: none; }
.status-cell { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.warning-text { color: #b45309; }
.normal-text { color: #475569; }
.pending-text { color: #9a6700; }
.detail-button { margin: 0; padding: 2px 4px; background: transparent; color: #2563eb; font-size: 12px; line-height: 26px; border: 0; }
.detail-button::after { border: 0; }
.preview-detail { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: #f8fafc; font-size: 12px; }
.source-reference { overflow-wrap: anywhere; color: #64748b; }
.preview-note { display: block; padding: 10px 12px; color: #64748b; font-size: 12px; }
@media (max-width: 680px) {
	.preview-head { display: none; }
	.preview-row { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 8px; }
	.bottle-cell { grid-column: 1 / 3; grid-row: 1; }
	.status-cell { grid-column: 3 / 5; grid-row: 1; align-items: flex-end; }
	.weight-cell { display: flex; flex-direction: column; gap: 4px; grid-row: 2; }
	.weight-cell:nth-child(2) { grid-column: 1; }
	.weight-cell:nth-child(3) { grid-column: 2; }
	.weight-cell:nth-child(4) { grid-column: 3; }
	.weight-cell:nth-child(5) { grid-column: 4; }
	.mobile-label { display: block; font-size: 11px; color: #64748b; }
	.detail-button { grid-column: 4; grid-row: 3; justify-self: end; }
}
</style>
