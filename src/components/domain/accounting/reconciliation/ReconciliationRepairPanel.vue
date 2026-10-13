<template>
	<view class="repair-panel">
		<text class="hint">仅用于已核实的同笔收款。先查看逐项变化，再确认修正。</text>
		<text v-if="loading" class="hint">正在读取原收款和销售单…</text>
		<view class="fields">
			<picker :range="types" range-key="label" :value="typeIndex" :disabled="locked" @change="form.type = types[Number($event.detail.value)].value"><AppInput class="picker-trigger" label="修正类型" :model-value="types[typeIndex].label" readonly /></picker>
			<picker :range="receiptOptions" range-key="label" :disabled="locked" :value="receiptIndex" @change="selectReceipt"><AppInput class="picker-trigger" label="原收款" :model-value="receiptOptions[receiptIndex]?.label" readonly /></picker>
			<picker mode="date" :value="form.biz_date" :disabled="locked" @change="form.biz_date = $event.detail.value"><AppInput class="picker-trigger" label="确认的收款日期" :model-value="form.biz_date" readonly placeholder="请选择日期" /></picker>
			<AppInput v-model="form.basis" label="核实依据" placeholder="到账凭据、双方确认记录等" :disabled="locked" />
			<template v-if="form.type === 'complete_receipt_backing'">
				<AppInput v-model="form.confirmed_total_amount" label="确认的同笔到账总额（元）" inputmode="decimal" :disabled="locked" />
				<text class="hint">将销售单中的旧实收补齐到这笔已存在的收款；不能据此登记一笔新的到账。</text>
				<view v-for="(target, index) in form.targets" :key="index" class="target">
					<picker :range="saleOptions" range-key="label" :disabled="locked" :value="saleIndex(target.sale_id)" @change="target.sale_id = saleOptions[Number($event.detail.value)].id"><AppInput class="picker-trigger" :label="'销售单 ' + (index + 1)" :model-value="saleOptions[saleIndex(target.sale_id)].label" readonly /></picker>
					<AppInput v-model="target.cash_amount" label="补齐收款依据金额（元）" inputmode="decimal" :disabled="locked" />
					<AppInput v-model="target.move_sale_rounding" label="同时重分类的原销售抹零（元）" inputmode="decimal" placeholder="0.00" :disabled="locked" />
					<AppButton size="sm" kind="ghost" :disabled="locked" @click="form.targets.splice(index, 1)">移除此销售单</AppButton>
				</view>
				<AppButton size="sm" kind="neutral" :disabled="locked || form.targets.length >= 50" @click="form.targets.push({ sale_id: '', cash_amount: '', move_sale_rounding: '0' })">添加销售单</AppButton>
			</template>
		</view>
		<view v-if="operation?.preview" class="preview">
			<text class="title">确认以下 {{ operation.preview.writes.length }} 条记录变化</text>
			<view v-for="write in operation.preview.writes" :key="write.table + write.id" class="write">
				<text class="reference" selectable>{{ tableName(write.table) }} · {{ write.id }}</text>
				<text v-if="!write.before" class="hint">新增关联记录</text>
				<view v-for="change in changes(write)" :key="change.key" class="change"><text>{{ change.label }}</text><text>{{ display(change.before) }} → {{ display(change.after) }}</text></view>
			</view>
		</view>
		<text v-if="issue" class="notice" role="status">{{ issue }}</text>
		<view class="actions">
			<AppButton size="sm" kind="neutral" :disabled="locked || !sources" @click="prepare">预览修正</AppButton>
			<AppButton v-if="operation?.status === 'not_prepared'" size="sm" kind="neutral" :disabled="busy" @click="retryPreparation">原操作号原样重试</AppButton>
			<AppButton v-if="operation?.preview" size="sm" :disabled="!canConfirm" @click="submit">确认以上修正</AppButton>
			<AppButton v-if="unresolved" size="sm" kind="neutral" :disabled="busy" @click="query">查询原操作结果</AppButton>
			<AppButton v-if="operation?.status === 'committed_pending'" size="sm" :disabled="busy" @click="resumeVerification">继续写后复核</AppButton>
		</view>
		<text v-if="operation" class="reference" selectable>操作号 {{ operation.operation_id }}</text>
	</view>
</template>
<script setup>
import { computed, toRef } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import { getUser } from '@/services/auth'
import { reconciliationApi } from '@/services/api/reconciliation'
import { useReconciliationRepair } from '@/composables/useReconciliationRepair'
const props = defineProps({ customerId: { type: String, required: true }, batchId: { type: String, required: true }, resultHash: { type: String, required: true } })
const emit = defineEmits(['changed'])
const { form, sources, operation, loading, busy, issue, locked, unresolved, canConfirm, prepare, retryPreparation, submit, resumeVerification, query } = useReconciliationRepair({
	customerId: toRef(props, 'customerId'), batchId: toRef(props, 'batchId'), resultHash: toRef(props, 'resultHash'), api: reconciliationApi,
	storage: { getStorageSync: key => uni.getStorageSync(key), setStorageSync: (key, value) => uni.setStorageSync(key, value) },
	actorId: getUser()?._id || getUser()?.id || 'current', onChanged: () => emit('changed')
})
const types = [{ value: 'correct_receipt_date', label: '收款日期修正' }, { value: 'complete_receipt_backing', label: '同笔收款依据补齐' }]
const typeIndex = computed(() => Math.max(0, types.findIndex(type => type.value === form.type)))
const money = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '待核'
const receiptOptions = computed(() => [{ id: '', label: '请选择原收款' }, ...(sources.value?.receipts || []).map(row => ({ id: row._id, label: `${row.biz_date || '日期待核'} · ¥${money(row.amount)} · ${row._id}` }))])
const receiptIndex = computed(() => Math.max(0, receiptOptions.value.findIndex(row => row.id === form.receipt_id)))
const saleOptions = computed(() => [{ id: '', label: '请选择销售单' }, ...(sources.value?.sales || []).map(row => ({ id: row._id, label: `${row.date || '日期待核'} · 已收 ¥${money(row.amount_received)} · ${row._id}` }))])
const saleIndex = id => Math.max(0, saleOptions.value.findIndex(row => row.id === id))
function selectReceipt(event) {
	form.receipt_id = receiptOptions.value[Number(event.detail.value)].id
	form.biz_date = sources.value?.receipts.find(row => row._id === form.receipt_id)?.biz_date || ''
}
const labels = { biz_date: '业务日期', receipt_biz_date: '原收款日期', amount: '收款金额', allocated_amount: '已分配', unallocated_amount: '可分配', rounding_amount: '原抹零', receipt_rounding_amount: '收款抹零', rounding_allocated_amount: '已分配抹零', allocate_amount: '分配金额', allocate_kind: '分配类型', sale_id: '销售单', receipt_id: '收款单', target_id: '目标单据', allocation_targets: '分配目标', amount_received: '销售已收', note: '说明' }
function changes(write) {
	return Object.keys(write.after || {}).filter(key => !['_id', 'updated_at', 'created_at', 'accounting_reconciliation', 'created_by', 'created_by_name', 'request_id'].includes(key) && JSON.stringify(write.before?.[key]) !== JSON.stringify(write.after[key])).map(key => ({ key, label: labels[key] || key, before: write.before?.[key], after: write.after[key] }))
}
function display(value) { return value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value) }
function tableName(table) { return ({ crm_customer_receipts: '收款', crm_sale_records: '销售', crm_customer_allocations: '分配', crm_customers: '客户版本' })[table] || table }
</script>
<style scoped>
.picker-trigger { pointer-events:none; }
.repair-panel,.fields,.target,.preview,.write { display:flex; flex-direction:column; gap:14px; min-width:0; }
.hint,.reference { color:var(--crm-text-muted); font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
.title { font-weight:600; }
.target,.preview { padding:14px; border:1px solid var(--crm-border); border-radius:8px; }
.write { padding-bottom:12px; border-bottom:1px solid var(--crm-border); gap:8px; }
.change { display:grid; grid-template-columns:minmax(90px,1fr) minmax(0,2fr); gap:10px; font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
.actions { display:flex; flex-wrap:wrap; gap:10px; }
.notice { color:#9c4c0b; line-height:1.6; }
</style>
