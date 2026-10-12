<template>
	<view class="adjustment-panel">
		<view class="panel-heading">
			<text class="muted">{{ kind === 'rounding_reversal' ? '按原抹零记录冲回，恢复对应应收。' : '结清经确认不再退款、也不再抵扣货款的多收余额。' }}</text>
			<AppButton size="sm" kind="ghost" :disabled="busy || unresolved" :loading="loading" @click="load">刷新来源</AppButton>
		</view>
		<text v-if="loadIssue" class="notice" role="alert">{{ loadIssue }}</text>
		<text v-if="pendingSources.length" class="notice">另有 {{ pendingSources.length }} 笔来源待核，未列入可用来源。</text>
		<text v-if="!canWrite" class="muted">当前账号可以查看记录，登记及作废需要财务修改权限。</text>
		<view v-if="canWrite && (ready || unresolved)" class="adjustment-form">
			<text class="form-title">{{ voidTarget ? '作废' + title : title }}</text>
			<template v-if="!voidTarget">
				<picker class="adjustment-picker" :range="sourceOptions" range-key="label" :value="sourceIndex" :disabled="locked" @change="selectSource">
					<AppInput :model-value="sourceOptions[sourceIndex]?.label || '请选择来源'" label="原始来源" readonly />
				</picker>
				<view v-if="selectedSource" class="source-facts">
					<text>{{ selectedSource.date || '日期待核' }} · {{ selectedSource.label }}</text>
					<text>原金额 ¥{{ money(selectedSource.amount) }} · 已处理 ¥{{ money(selectedSource.processed) }} · 可用 ¥{{ money(selectedSource.available) }}</text>
					<text class="reference" selectable>来源单据 {{ selectedSource.id }}</text>
				</view>
				<text v-else-if="ready && !sources.length" class="muted">暂无可用来源。</text>
			</template>
			<view v-else class="source-facts">
				<text>原登记 {{ voidTarget.date || voidTarget.biz_date || '—' }} · ¥{{ money(voidTarget.amount) }}</text>
				<text class="reference" selectable>原记录 {{ rowId(voidTarget) }}</text>
				<text>{{ kind === 'rounding_reversal' ? '可在下方选择同时解除本单后续分配，并在预览中核对。' : '请先核对后续处理；原分配发生变化时不能直接作废。' }}原始记录和作废记录会保留。</text>
			</view>
			<view class="form-grid">
				<AppInput v-if="!voidTarget" v-model="form.amount" :label="title + '金额（元）'" placeholder="0.00" inputmode="decimal" :disabled="locked" />
				<picker v-if="!voidTarget" class="adjustment-picker" mode="date" :value="form.biz_date" :disabled="locked" @change="form.biz_date = $event.detail.value"><AppInput :model-value="form.biz_date" label="业务日期" placeholder="请选择日期" readonly prefix-icon="calendar" /></picker>
				<AppInput v-else :model-value="voidTarget.biz_date || voidTarget.date || '—'" label="原业务日期" readonly />
				<AppInput v-model="form.note" :label="voidTarget ? '作废原因' : '调整原因'" placeholder="请说明本次处理原因" :disabled="locked" />
				<AppInput v-model="form.evidence" class="evidence-field" :label="voidTarget || kind === 'rounding_reversal' ? '确认依据（选填）' : '确认依据（必填）'" placeholder="客户确认、凭据编号或核准说明" :disabled="locked" />
			</view>
			<checkbox-group v-if="kind === 'prepay_writeoff' && !voidTarget" @change="form.confirm_no_refund_or_offset = $event.detail.value.includes('confirmed')">
				<label class="confirmation"><checkbox value="confirmed" :checked="form.confirm_no_refund_or_offset" :disabled="locked" /><text>已确认：本次金额不再退款，也不再抵扣以后货款。</text></label>
			</checkbox-group>
			<checkbox-group v-if="kind === 'rounding_reversal' && voidTarget" @change="form.release_dependent_allocations = $event.detail.value.includes('release')">
				<label class="confirmation"><checkbox value="release" :checked="form.release_dependent_allocations" :disabled="locked" /><text>先解除本冲回单的后续分配，再作废。请在预览中核对每笔来源变化。</text></label>
			</checkbox-group>
			<view v-if="preview" class="adjustment-preview" aria-live="polite">
				<text class="form-title">{{ voidTarget ? '作废' : '登记' }}后的变化</text>
				<view class="effect-grid"><view v-for="item in effectItems" :key="item.key"><text class="muted">{{ item.label }}</text><text class="effect-value">{{ signedMoney(preview.effects[item.key]) }}</text></view></view>
				<view v-if="previewBalances.length" class="balance-preview"><view v-for="item in previewBalances" :key="item.key" class="balance-preview-row"><text class="muted">{{ item.label }}</text><text>¥{{ money(item.before) }} → ¥{{ money(item.after) }}</text></view><text class="muted">客户当前余额：之前 → 之后</text></view>
				<view v-if="voidTarget && form.release_dependent_allocations" class="release-preview">
					<text class="form-title">将解除的后续分配</text>
					<text v-if="!preview.affected_allocations.length" class="muted">没有需要解除的分配。</text>
					<view v-for="row in preview.affected_allocations" :key="row.allocation_id" class="release-row"><text>{{ row.date || row.receipt_date || '—' }} · {{ row.allocate_kind === 'rounding' ? '抹零分配' : '收款分配' }} ¥{{ money(row.amount) }}</text><text class="reference" selectable>分配 {{ row.allocation_id }} · 收款单 {{ row.receipt_id }}</text></view>
					<view v-for="row in preview.receipt_effects" :key="row.receipt_id" class="release-row"><text>{{ row.date || '—' }} · 来源可用余额 {{ signedMoney(row.available_delta) }} · 收款抹零 {{ signedMoney(row.rounding_delta) }}</text><text v-if="Number.isFinite(row.available_before) && Number.isFinite(row.available_after)">来源可用余额：¥{{ money(row.available_before) }} → ¥{{ money(row.available_after) }}</text><text class="reference" selectable>收款单 {{ row.receipt_id }}</text></view>
				</view>
				<text class="muted">{{ voidTarget ? '撤销原调整，保留作废记录' : '业务日期 ' + preview.value.biz_date }} · 本次实际收付款不变</text>
			</view>
			<text v-if="issue" class="notice" role="status">{{ issue }}</text>
			<view class="form-actions">
				<AppButton size="sm" kind="neutral" :disabled="!canPreview" :loading="busy && !unresolved" @click="prepare">{{ voidTarget ? '预览作废' : '预览调整' }}</AppButton>
				<AppButton v-if="preview" size="sm" kind="primary" :disabled="!canConfirm" @click="submit">{{ voidTarget ? (form.release_dependent_allocations ? '解除所列分配并作废' : '确认作废') : '确认登记' }}</AppButton>
				<AppButton v-if="unresolved" size="sm" kind="neutral" :disabled="busy" @click="queryOperation">查询保存结果</AppButton>
				<AppButton v-if="operation?.status === 'retryable'" size="sm" kind="primary" :disabled="busy" @click="retry">使用原操作号重试</AppButton>
				<AppButton size="sm" kind="ghost" :disabled="locked" @click="reset">{{ voidTarget ? '取消作废' : '重置' }}</AppButton>
			</view>
			<text v-if="unresolved" class="muted reference" selectable>保存结果待确认 · 操作号 {{ operation.operation_id }}</text>
		</view>
		<text v-else-if="issue" class="notice" role="status">{{ issue }}</text>
		<view class="history-heading"><text class="form-title">{{ title }}记录</text><text class="muted">{{ adjustments.length }} 笔 · 全部日期</text></view>
		<text v-if="ready && !adjustments.length" class="muted">暂无{{ title }}记录</text>
		<view v-for="row in adjustments" :key="rowId(row)" class="history-row">
			<view class="history-main"><text>{{ row.biz_date || row.date || '—' }} · ¥{{ money(row.amount) }}</text><AppTag :kind="row.status === 'void' ? 'warning' : 'info'">{{ row.status === 'void' ? '已作废' : '已登记' }}</AppTag><AppButton size="sm" kind="ghost" @click="expandedId = expandedId === rowId(row) ? '' : rowId(row)">{{ expandedId === rowId(row) ? '收起详情' : '来源详情' }}</AppButton></view>
			<view v-if="expandedId === rowId(row)" class="history-detail">
				<text class="reference" selectable>记录 {{ rowId(row) }}</text>
				<text>{{ row.source?.label || row.source_label || '来源' }} · {{ row.source?.date || row.source_date || '' }}</text>
				<text class="reference" selectable>来源单据 {{ row.source?.id || row.source_id || row.source_key || '—' }}</text>
				<text>原因：{{ row.note || '—' }}</text><text>依据：{{ evidenceText(row.evidence) }}</text>
				<text v-if="row.void_note || row.void_reason">作废原因：{{ row.void_note || row.void_reason }}</text>
				<text v-if="row.operation_id" class="reference" selectable>操作号 {{ row.operation_id }}</text>
				<AppButton v-if="canWrite && row.status !== 'void'" size="sm" kind="outline" :disabled="!canPreview" @click="beginVoid(row)">作废此记录</AppButton>
			</view>
		</view>
	</view>
</template>

<script setup>
import { computed, ref, toRef, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import { getRoleTemplate, getUser } from '@/services/auth'
import { canPageAction } from '@/services/pageAcl'
import { getCustomerAdjustmentSourcesV1, previewCustomerAdjustmentV1, postCustomerAdjustmentV1, getCustomerAdjustmentOperationV1, voidCustomerAdjustmentV1 } from '@/services/customerSettlement'
import { CUSTOMER_ADJUSTMENT_KINDS, adjustmentMoney, adjustmentPreviewBalances, useCustomerAdjustment } from '@/composables/useCustomerAdjustment'

const props = defineProps({ customerId: { type: String, default: '' }, kind: { type: String, default: 'rounding_reversal' } })
const emit = defineEmits(['changed'])
const canWrite = computed(() => ['superadmin', 'admin', 'finance'].includes(getRoleTemplate()) && canPageAction('/pages/customer/statement', 'update'))
const title = computed(() => CUSTOMER_ADJUSTMENT_KINDS[props.kind])
const { form, sources, adjustments, pendingSources, scale, selectedSource, loading, busy, issue, loadIssue, preview, operation, voidTarget, unresolved, locked, ready, canPreview, canConfirm, load, reset, prepare, submit, retry, queryOperation, beginVoid } = useCustomerAdjustment({
	customerId: toRef(props, 'customerId'), kind: toRef(props, 'kind'), canWrite,
	storage: { getStorageSync: key => uni.getStorageSync(key), setStorageSync: (key, value) => uni.setStorageSync(key, value) },
	actorId: getUser()?._id || getUser()?.id || 'current',
	api: { sources: getCustomerAdjustmentSourcesV1, preview: previewCustomerAdjustmentV1, post: postCustomerAdjustmentV1, query: getCustomerAdjustmentOperationV1, void: voidCustomerAdjustmentV1 },
	onChanged: () => emit('changed')
})
const sourceOptions = computed(() => [{ source_key: '', label: '请选择来源' }, ...sources.value.filter(row => row.available > 0).map(row => ({ ...row, label: `${row.date || '日期待核'} · ${row.label} · 可用 ¥${money(row.available)}` }))])
const sourceIndex = computed(() => Math.max(0, sourceOptions.value.findIndex(row => row.source_key === form.source_key)))
const expandedId = ref('')
const effectItems = [{ key: 'receivable_delta', label: '应收余额' }, { key: 'available_delta', label: '可抵扣余额' }, { key: 'income_delta', label: '结清收益' }]
const previewBalances = computed(() => adjustmentPreviewBalances(preview.value))
const money = value => adjustmentMoney(value, scale.value)
const signedMoney = value => typeof value === 'number' && value > 0 ? `+¥${money(value)}` : `¥${money(value)}`
const rowId = row => row?.id || row?._id || row?.adjustment_id || ''
const evidenceText = value => typeof value === 'string' ? value || '—' : value?.note || value?.reference || '—'
function selectSource(event) { form.source_key = sourceOptions.value[Number(event?.detail?.value)]?.source_key || '' }
watch(() => [props.customerId, props.kind], () => { expandedId.value = '' })
</script>

<style scoped>
.adjustment-panel { display:flex; flex-direction:column; gap:16px; color:var(--crm-text); font-size:14px; min-width:0; }
.panel-heading,.history-heading,.history-main,.form-actions { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
.panel-heading { justify-content:space-between; }
.form-title { font-weight:600; font-size:15px; }
.muted { font-size:12px; color:var(--crm-text-muted); line-height:1.6; }
.adjustment-form { display:flex; flex-direction:column; gap:18px; padding:20px; border:1px solid var(--crm-border); border-radius:8px; }
.form-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
.form-grid > * { min-width:0; }
.evidence-field { grid-column:1 / -1; }
.source-facts,.history-detail { display:flex; flex-direction:column; gap:7px; line-height:1.6; font-size:13px; }
.source-facts { background:#f8fafc; border-radius:6px; padding:12px; }
.reference { overflow-wrap:anywhere; color:var(--crm-text-muted); font-size:12px; }
.confirmation { display:flex; align-items:flex-start; gap:8px; line-height:1.7; }
.adjustment-preview { background:#eef6ff; padding:16px; border-radius:8px; display:flex; flex-direction:column; gap:12px; }
.release-preview,.release-row { display:flex; flex-direction:column; gap:8px; font-size:13px; line-height:1.6; }
.release-preview { border-top:1px solid #d8e7f6; padding-top:12px; }
.release-row { border-bottom:1px solid #d8e7f6; padding:8px 0; }
.effect-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
.effect-grid > view { display:flex; flex-direction:column; gap:5px; }
.effect-value { font-size:18px; font-variant-numeric:tabular-nums; }
.notice { padding:12px; background:#fff8eb; color:#8a5a14; border-radius:6px; font-size:13px; line-height:1.6; }
.history-row { border-bottom:1px solid var(--crm-border); padding:8px 0 14px; }
.history-main :deep(.btn) { margin-left:auto; }
.history-detail { padding-top:12px; }
.history-detail :deep(.btn) { align-self:flex-start; }
.adjustment-panel :deep(.btn) { height:36px; min-height:36px; font-size:13px; padding:0 14px; }
.adjustment-panel :deep(.field__label) { font-size:12px; }
.adjustment-panel :deep(.field__control) { height:40px; padding:0 12px; }
.adjustment-panel :deep(.field__input) { font-size:14px; }
.adjustment-picker :deep(.field__control--readonly .field__input) { pointer-events:none; }
.balance-preview { display:flex; flex-direction:column; gap:8px; border-top:1px solid #d8e7f6; padding-top:12px; }
.balance-preview-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 16px; font-size:13px; font-variant-numeric:tabular-nums; }
@media(max-width:680px) {
	.adjustment-form { padding:14px; }
	.form-grid { grid-template-columns:minmax(0,1fr); }
	.effect-grid { gap:10px; }
	.effect-value { font-size:15px; }
	.adjustment-panel :deep(.btn) { min-height:44px; height:auto; padding:8px 12px; }
	.adjustment-panel :deep(.field__control) { height:44px; }
}
</style>
