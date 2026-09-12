<template>
	<view class="deposit-panel">
		<view class="deposit-head">
			<text class="deposit-hint">押金按资金凭据登记，存瓶数量不会自动产生押金。</text>
			<AppButton size="sm" kind="neutral" :loading="loading" :disabled="busy" @click="loadDepositStatement">刷新押金</AppButton>
		</view>
		<AppStatCard label="当前已登记押金余额" :value="statement?.account_initialized === false ? '尚未登记' : depositMoneyText(statement?.current_balance)" :hint="statement?.account_initialized === false ? '历史押金未核实' : '元 · 全部历史登记'" icon="wallet" />
		<text v-if="statement?.account_initialized === false" class="deposit-hint deposit-hint--warning">尚未登记，历史押金未核实。期间金额仅反映已登记资金；旧押金请凭原始依据办理期初转入。</text>
		<text v-else-if="statement?.history_status === 'not_confirmed'" class="deposit-hint deposit-hint--warning">历史押金未核实，当前余额仅反映已登记押金；旧押金请凭原始依据办理期初转入。</text>
		<text class="deposit-hint">所选期间：{{ dateFrom || '--' }} ~ {{ dateTo || '--' }}</text>
		<view class="deposit-summary">
			<view v-for="item in summaryItems" :key="item.key" class="deposit-summary-item">
				<text class="deposit-hint">{{ item.label }}</text>
				<text class="deposit-summary-value">¥{{ depositMoneyText(statement?.[item.key]) }}</text>
			</view>
		</view>
		<text v-if="loadIssue" class="deposit-hint deposit-hint--warning">{{ loadIssue }}</text>
		<text v-if="!canUpdate" class="deposit-hint">当前账号可查看押金，登记及作废需要客户对账修改权限。</text>

		<view v-if="canUpdate" class="deposit-form">
			<template v-if="!voidTarget">
				<view class="deposit-tabs"><AppTabs :model-value="form.kind" :items="kindOptions" @update:modelValue="onKindChange" /></view>
				<view class="deposit-grid">
					<AppInput v-model="form.amount" label="金额（元）" placeholder="0.00" size="sm" :disabled="fieldsLocked" />
					<picker mode="date" :value="form.bizDate" :disabled="fieldsLocked" @change="form.bizDate = $event.detail.value">
						<AppInput :model-value="form.bizDate" label="实际业务日期" placeholder="请选择日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<picker mode="selector" :range="CUSTOMER_DEPOSIT_CHANNELS" range-key="label" :value="channelIndex" :disabled="fieldsLocked || ['opening', 'transfer'].includes(form.kind)" @change="onChannelChange">
						<AppInput :model-value="['opening', 'transfer'].includes(form.kind) ? '内部转入（非新收款）' : depositChannelLabel(form.paymentMethod)" :label="['opening', 'transfer'].includes(form.kind) ? '登记来源' : '实际收退渠道'" readonly size="sm" />
					</picker>
					<AppInput v-model="form.voucherRef" label="凭据编号 / 依据" placeholder="收据、转账单或核准依据" size="sm" :disabled="fieldsLocked" />
					<AppInput v-model="form.note" class="deposit-span" :label="form.kind === 'transfer' ? '经确认的转款说明（必填）' : '备注'" :placeholder="form.kind === 'transfer' ? '请说明经确认的气款用途' : '可选'" size="sm" :disabled="fieldsLocked" />
				</view>
				<text v-if="form.kind === 'opening'" class="deposit-hint">期初转入登记经核准的旧押金余额，不代表本期收到现金。</text>
				<text v-else-if="form.kind === 'transfer'" class="deposit-hint">转气款后生成可用预付款；请到“收款单”使用分配入口核对气款目标。</text>
				<text v-else-if="form.paymentMethod === 'unknown'" class="deposit-hint deposit-hint--warning">当前渠道待核。已知实际渠道时请据实选择。</text>
				<view v-if="preview" class="deposit-preview">
					<text class="deposit-preview-title">{{ depositKindLabel(form.kind) }}预览 · ¥{{ depositMoneyText(operation?.input?.amount) }}</text>
					<text class="deposit-hint">日期 {{ operation?.input?.biz_date }} · {{ depositChannelLabel(operation?.input?.payment_method) }}</text>
					<text class="deposit-hint">{{ operation?.input?.voucher_ref ? `依据 ${operation.input.voucher_ref}` : '未填写凭据编号' }}{{ operation?.input?.note ? ` · ${operation.input.note}` : '' }}</text>
					<text>登记前 ¥{{ depositMoneyText(preview.before_balance) }} → 登记后 ¥{{ depositMoneyText(preview.after_balance) }}</text>
				</view>
				<view class="deposit-actions">
					<AppButton size="sm" kind="ghost" :disabled="busy || unresolved" @click="resetDraft">{{ operation?.status === 'saved' ? '新登记' : '重置' }}</AppButton>
					<AppButton size="sm" kind="neutral" :loading="actionLoading" :disabled="!canPreview" @click="previewEntry">预览登记</AppButton>
					<AppButton size="sm" kind="primary" :loading="actionLoading" :disabled="!canConfirm" @click="confirmEntry">{{ operation?.status === 'retryable' ? '使用原操作号重试登记' : '确认登记' }}</AppButton>
				</view>
			</template>
			<template v-else>
				<text class="deposit-preview-title">作废{{ depositKindLabel(voidTarget.kind) }}</text>
				<view class="deposit-grid">
					<AppInput :model-value="depositMoneyText(voidTarget.amount)" label="原单金额（元）" readonly size="sm" />
					<AppInput :model-value="voidTarget.biz_date" label="原单业务日期" readonly size="sm" />
					<AppInput v-model="voidReason" class="deposit-span" label="作废原因" placeholder="必填，请说明核对依据" size="sm" :disabled="fieldsLocked" />
				</view>
				<text class="deposit-hint">保留原单与作废留痕。已有气款分配的转款不能直接作废，请先核对原气款分配。</text>
				<view v-if="preview" class="deposit-preview">
					<text class="deposit-preview-title">作废余额预览</text>
					<text>作废前 ¥{{ depositMoneyText(preview.before_balance) }} → 作废后 ¥{{ depositMoneyText(preview.after_balance) }}</text>
				</view>
				<view class="deposit-actions">
					<AppButton size="sm" kind="ghost" :disabled="busy || unresolved" @click="resetDraft">{{ operation?.status === 'saved' ? '返回登记' : '取消作废' }}</AppButton>
					<AppButton size="sm" kind="neutral" :loading="actionLoading" :disabled="!canPreviewVoid" @click="previewVoid">预览作废</AppButton>
					<AppButton size="sm" kind="outline" :loading="actionLoading" :disabled="!canConfirmVoid" @click="confirmVoid">{{ operation?.status === 'retryable' ? '使用原操作号重试作废' : '确认作废' }}</AppButton>
				</view>
			</template>
			<view v-if="operation" class="deposit-operation">
				<text class="deposit-hint">操作号 {{ operation.operation_id }}{{ operation.status === 'saved' ? ' · 已保存' : '' }}</text>
				<AppButton size="sm" kind="neutral" :loading="queryLoading" :disabled="busy" @click="querySavedOperation">查询保存结果</AppButton>
			</view>
			<text v-if="actionIssue" class="deposit-hint deposit-hint--warning">{{ actionIssue }}</text>
		</view>

		<text class="deposit-preview-title">所选期间押金流水</text>
		<AppList :loading="loading" :empty="!!statement && statement.entries.length === 0" empty-title="所选期间暂无已登记押金流水">
			<AppListItem v-for="entry in statement?.entries || []" :key="entry.entry_id" :title="entry.kind === 'void' ? '作废留痕' : depositKindLabel(entry.kind)" :subtitle="`${entry.biz_date} · 单据 ${entry.entry_id}`" :status="entry.status === 'void' ? '已作废' : (entry.kind === 'void' ? '留痕' : '已登记')" :status-kind="entry.status === 'void' ? 'warning' : 'info'" icon="wallet">
				<template #right><text class="deposit-summary-value">¥{{ depositMoneyText(entry.amount) }}</text></template>
				<text class="deposit-hint">{{ depositChannelLabel(entry.payment_method) }}{{ entry.voucher_ref ? ` · 依据 ${entry.voucher_ref}` : '' }}{{ entry.note ? ` · ${entry.note}` : '' }}</text>
				<text v-if="entry.void_reason || entry.reason" class="deposit-hint">作废原因：{{ entry.void_reason || entry.reason }}</text>
				<text v-if="entry.kind === 'void'" class="deposit-hint">原单 {{ entry.original_entry_id }} · 作废登记 {{ formatDepositTime(entry.created_at) }}</text>
				<template #footer><AppButton v-if="canUpdate && entry.status === 'posted' && entry.kind !== 'void'" size="sm" kind="outline" :disabled="busy || unresolved || loading || !statement" @click="beginVoid(entry)">作废</AppButton></template>
			</AppListItem>
		</AppList>
	</view>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTabs from '@/components/base/AppTabs.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import { getRoleTemplate, getUser } from '@/services/auth'
import { canPageAction } from '@/services/pageAcl'
import { getDepositStatementV1, previewDepositEntryV1, createDepositEntryV1, voidDepositEntryV1, getDepositOperationV1 } from '@/services/api/customerDeposit.js'
import { CUSTOMER_DEPOSIT_KINDS, CUSTOMER_DEPOSIT_CHANNELS, buildDepositEntryInput, depositKindLabel, depositChannelLabel, depositMoneyText, depositOperationFingerprint, normalizeCustomerDepositStatement, normalizeDepositPreview, normalizeDepositOperation } from '@/services/mappers/customerDeposit.js'

const props = defineProps({
	customerId: { type: String, default: '' },
	dateFrom: { type: String, default: '' },
	dateTo: { type: String, default: '' }
})
const emit = defineEmits(['changed'])
const form = reactive({ kind: 'receive', amount: '', bizDate: '', paymentMethod: 'unknown', voucherRef: '', note: '' })
const statement = ref(null)
const operation = ref(null)
const preview = ref(null)
const voidTarget = ref(null)
const voidReason = ref('')
const loading = ref(false)
const actionLoading = ref(false)
const queryLoading = ref(false)
const storageReady = ref(true)
const loadIssue = ref('押金查询未完成，暂不能登记。')
const actionIssue = ref('')
let requestSerial = 0
let scopeGeneration = 0
let draftCustomerId = ''
let destroyed = false

const canUpdate = computed(() => canPageAction('/pages/customer/statement', 'update'))
const canOpening = computed(() => ['superadmin', 'admin', 'finance'].includes(getRoleTemplate()))
const kindOptions = computed(() => CUSTOMER_DEPOSIT_KINDS.filter(item => item.value !== 'opening' || canOpening.value))
const busy = computed(() => actionLoading.value || queryLoading.value)
const unresolved = computed(() => ['submitting', 'unknown', 'retryable'].includes(operation.value?.status))
const fieldsLocked = computed(() => busy.value || unresolved.value || operation.value?.status === 'saved')
const readReady = computed(() => canUpdate.value && !!statement.value && !loading.value && !busy.value)
const writeReady = computed(() => readReady.value && storageReady.value)
const canPreview = computed(() => readReady.value && !unresolved.value && operation.value?.status !== 'saved' && (form.kind !== 'opening' || canOpening.value))
const canConfirm = computed(() => writeReady.value && !voidTarget.value && !!preview.value && ['previewed', 'retryable'].includes(operation.value?.status) && operation.value?.fingerprint === depositOperationFingerprint(currentInput() || {}))
const canPreviewVoid = computed(() => readReady.value && !!voidTarget.value && !!String(voidReason.value).trim() && !unresolved.value && operation.value?.status !== 'saved' && (voidTarget.value.kind !== 'opening' || canOpening.value))
const canConfirmVoid = computed(() => writeReady.value && !!voidTarget.value && !!preview.value && ['previewed', 'retryable'].includes(operation.value?.status) && operation.value?.fingerprint === depositOperationFingerprint(currentInput() || {}))
const channelIndex = computed(() => Math.max(CUSTOMER_DEPOSIT_CHANNELS.findIndex(item => item.value === form.paymentMethod), 0))
const summaryItems = [
	{ key: 'opening_balance', label: '期间期初余额' },
	{ key: 'received_total', label: '期间收取押金' },
	{ key: 'refunded_total', label: '期间退还押金' },
	{ key: 'opening_transferred_total', label: '期间期初转入' },
	{ key: 'transferred_total', label: '期间转气款' },
	{ key: 'closing_balance', label: '期间结余' }
]

function scopeKey() {
	return JSON.stringify([props.customerId, props.dateFrom, props.dateTo])
}

function captureScope() {
	return { key: scopeKey(), generation: scopeGeneration }
}

function isCurrentScope(scope) {
	return !destroyed && scope.key === scopeKey() && scope.generation === scopeGeneration
}

function draftKey(customerId = props.customerId) {
	const user = getUser()
	return `crm_customer_deposit_draft:${user?._id || user?.id || 'current'}:${customerId}`
}

function persistOperation() {
	try {
		if (!props.customerId) return false
		uni.setStorageSync(draftKey(), { operation: operation.value, preview: preview.value, form: { ...form }, voidTarget: voidTarget.value, voidReason: voidReason.value })
		storageReady.value = true
		return true
	} catch {
		storageReady.value = false
		actionIssue.value = '操作号保存未完成，暂不能登记。请检查设备存储后重新预览。'
		return false
	}
}

function restoreDraft() {
	operation.value = null
	preview.value = null
	voidTarget.value = null
	voidReason.value = ''
	Object.assign(form, { kind: 'receive', amount: '', bizDate: '', paymentMethod: 'unknown', voucherRef: '', note: '' })
	actionIssue.value = ''
	storageReady.value = true
	try {
		const saved = uni.getStorageSync(draftKey())
		if (!saved?.operation || saved.operation.input?.customer_id !== props.customerId || !saved.operation.operation_id) return
		operation.value = saved.operation
		preview.value = normalizeDepositPreview(saved.preview)
		Object.assign(form, saved.form || {})
		voidTarget.value = saved.voidTarget || null
		voidReason.value = saved.voidReason || ''
		if (operation.value.status === 'submitting') operation.value.status = 'unknown'
		if (['unknown', 'retryable'].includes(operation.value.status)) actionIssue.value = '上次登记的保存结果仍需核对。请先查询；重试会继续使用原操作号。'
	} catch {
		storageReady.value = false
		actionIssue.value = '操作号读取未完成，暂不能登记。'
	}
}

function resetDraft() {
	if (busy.value || unresolved.value) return
	operation.value = null
	preview.value = null
	voidTarget.value = null
	voidReason.value = ''
	Object.assign(form, { kind: 'receive', amount: '', bizDate: '', paymentMethod: 'unknown', voucherRef: '', note: '' })
	actionIssue.value = ''
	persistOperation()
}

function onKindChange(value) {
	if (fieldsLocked.value || !kindOptions.value.some(item => item.value === value)) return
	form.kind = value
	if (['opening', 'transfer'].includes(value)) form.paymentMethod = 'unknown'
}

function onChannelChange(event) {
	if (fieldsLocked.value || ['opening', 'transfer'].includes(form.kind)) return
	const channel = CUSTOMER_DEPOSIT_CHANNELS[Number(event?.detail?.value)]
	if (channel) form.paymentMethod = channel.value
}

function ensureOperation(input, action) {
	const fingerprint = depositOperationFingerprint(input)
	if (operation.value?.fingerprint === fingerprint) return operation.value
	if (unresolved.value) return null
	operation.value = {
		operation_id: `dep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`,
		fingerprint, input: { ...input }, action, status: 'draft', expected_version: statement.value.version
	}
	preview.value = null
	return operation.value
}

function currentInput() {
	return voidTarget.value
		? { customer_id: props.customerId, entry_id: voidTarget.value.entry_id, reason: String(voidReason.value).trim() }
		: buildDepositEntryInput(form, props.customerId)
}

async function loadDepositStatement() {
	const serial = ++requestSerial
	const scope = captureScope()
	statement.value = null
	loadIssue.value = '押金查询未完成，暂不能登记。'
	if (!props.customerId) return
	loading.value = true
	try {
		const result = await getDepositStatementV1({ customerId: props.customerId, dateFrom: props.dateFrom, dateTo: props.dateTo })
		if (!isCurrentScope(scope) || serial !== requestSerial) return
		const data = result?.code === 0 ? normalizeCustomerDepositStatement(result.data, { customerId: props.customerId, dateFrom: props.dateFrom, dateTo: props.dateTo }) : null
		statement.value = data
		loadIssue.value = data ? '' : (result?.code !== 0 && result?.msg ? result.msg : '押金数据未完成或期间不一致，暂不能登记。')
	} catch {
		if (isCurrentScope(scope) && serial === requestSerial) loadIssue.value = '押金查询未完成，请刷新后核对。'
	} finally {
		if (isCurrentScope(scope) && serial === requestSerial) loading.value = false
	}
}

async function previewEntry() {
	if (!canPreview.value) return
	const input = buildDepositEntryInput(form, props.customerId)
	if (!input) {
		actionIssue.value = '请填写大于0、最多两位小数的金额，并明确选择实际业务日期和渠道。'
		return
	}
	await previewInput(input, 'create')
}

async function previewVoid() {
	if (!canPreviewVoid.value) return
	await previewInput(currentInput(), 'void')
}

async function previewInput(input, action) {
	const op = ensureOperation(input, action)
	if (!op) return
	op.expected_version = statement.value.version
	if (!persistOperation()) return
	const scope = captureScope()
	actionLoading.value = true
	actionIssue.value = ''
	preview.value = null
	try {
		const result = await previewDepositEntryV1({ ...op.input, operation_id: op.operation_id, expected_version: op.expected_version })
		if (!isCurrentScope(scope) || operation.value !== op) return
		const data = result?.code === 0 ? normalizeDepositPreview(result.data) : null
		const submission = data?.submission
		if (!data || !submission || submission.operation_id !== op.operation_id || submission.expected_version !== data.current_version || depositOperationFingerprint(submission) !== op.fingerprint) {
			actionIssue.value = result?.code !== 0 && result?.msg ? result.msg : '押金预览未完成，暂不能确认登记。'
			op.status = 'draft'
			persistOperation()
			return
		}
		if (op.fingerprint !== depositOperationFingerprint(currentInput() || {})) return
		op.expected_version = data.current_version
		op.status = 'previewed'
		preview.value = data
		persistOperation()
	} catch {
		if (isCurrentScope(scope)) actionIssue.value = '预览查询未完成，可继续使用原操作号重新预览。'
	} finally {
		if (isCurrentScope(scope)) actionLoading.value = false
	}
}

async function markSaved(op, data, scope) {
	if (!isCurrentScope(scope) || operation.value !== op) return
	op.status = 'saved'
	op.result = data
	actionIssue.value = '押金操作已保存。请核对余额和流水；转气款仍需按既有入口分配。'
	persistOperation()
	await loadDepositStatement()
	if (isCurrentScope(scope)) emit('changed')
}

async function recoverOperation(op, scope) {
	const result = await getDepositOperationV1({ customer_id: op.input.customer_id, operation_id: op.operation_id })
	if (!isCurrentScope(scope) || operation.value !== op) return
	const data = result?.code === 0 ? normalizeDepositOperation(result.data, { customerId: op.input.customer_id, operationId: op.operation_id }) : null
	if (!data) {
		actionIssue.value = result?.msg || '保存结果查询未完成，请继续使用原操作号查询。'
		return
	}
	if (data.found === false) {
		if (['submitting', 'unknown', 'retryable'].includes(op.status)) op.status = 'retryable'
		actionIssue.value = '暂未找到保存结果。可再次查询，或使用原操作号重试；核对完成前请保留本次内容。'
		persistOperation()
		return
	}
	await markSaved(op, data, scope)
}

async function submitOperation(op) {
	const scope = captureScope()
	op.status = 'submitting'
	if (!persistOperation()) { op.status = 'draft'; return }
	actionLoading.value = true
	actionIssue.value = ''
	try {
		const params = { ...op.input, operation_id: op.operation_id, expected_version: op.expected_version }
		const result = op.action === 'void' ? await voidDepositEntryV1(params) : await createDepositEntryV1(params)
		if (!isCurrentScope(scope) || operation.value !== op) return
		if (result?.code === 0) {
			const data = normalizeDepositOperation(result.data, { customerId: op.input.customer_id, operationId: op.operation_id })
			if (!data || data.found === false) throw new Error('保存回执未完成')
			await markSaved(op, data, scope)
			return
		}
		if (result?.data?.commit_status_unknown === true || ![400, 401, 403, 409].includes(result?.code)) throw new Error('保存状态未知')
		op.status = 'draft'
		preview.value = null
		actionIssue.value = result?.msg || '登记未完成，请重新预览核对。'
		persistOperation()
		if (result?.code === 409) await loadDepositStatement()
	} catch {
		if (!isCurrentScope(scope) || operation.value !== op) return
		op.status = 'unknown'
		actionIssue.value = '保存回执未完成，正在查询原操作号的保存结果。'
		persistOperation()
		try { await recoverOperation(op, scope) } catch {
			if (isCurrentScope(scope)) actionIssue.value = '保存结果仍未完成。请保留本次内容并查询原操作号，避免重复登记。'
		}
	} finally {
		if (isCurrentScope(scope)) actionLoading.value = false
	}
}

async function confirmEntry() {
	if (!canConfirm.value) return
	await submitOperation(operation.value)
}

function beginVoid(entry) {
	if (!writeReady.value || unresolved.value || entry.status !== 'posted' || entry.kind === 'void') return
	if (entry.kind === 'opening' && !canOpening.value) {
		actionIssue.value = '期初押金转入的作废需要管理员或财务权限。'
		return
	}
	voidTarget.value = { ...entry }
	voidReason.value = ''
	preview.value = null
	operation.value = null
	actionIssue.value = ''
}

async function confirmVoid() {
	if (!canConfirmVoid.value || !voidTarget.value) return
	const op = operation.value
	const input = op.input
	if (!persistOperation()) return
	const scope = captureScope()
	const confirmed = await new Promise(resolve => uni.showModal({ title: '确认作废押金单', content: `${depositKindLabel(voidTarget.value.kind)} ¥${depositMoneyText(voidTarget.value.amount)}，业务日期 ${voidTarget.value.biz_date}。原因：${input.reason}`, confirmText: '确认作废', success: result => resolve(!!result.confirm), fail: () => resolve(false) }))
	if (!confirmed || !isCurrentScope(scope) || operation.value !== op || op.fingerprint !== depositOperationFingerprint({ customer_id: props.customerId, entry_id: voidTarget.value?.entry_id, reason: String(voidReason.value).trim() })) return
	await submitOperation(op)
}

async function querySavedOperation() {
	const op = operation.value
	if (!op || busy.value) return
	const scope = captureScope()
	queryLoading.value = true
	try { await recoverOperation(op, scope) } catch {
		if (isCurrentScope(scope)) actionIssue.value = '保存结果查询未完成，请继续查询原操作号。'
	} finally {
		if (isCurrentScope(scope)) queryLoading.value = false
	}
}

function formatDepositTime(value) {
	if (!value) return '时间待核'
	const date = new Date(value)
	return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '时间待核'
}

watch(() => [props.customerId, props.dateFrom, props.dateTo], () => {
	scopeGeneration += 1
	actionLoading.value = false
	queryLoading.value = false
	loading.value = false
	if (draftCustomerId !== props.customerId) {
		draftCustomerId = props.customerId
		restoreDraft()
	} else if (!unresolved.value && operation.value?.status !== 'saved') {
		preview.value = null
		if (operation.value) operation.value.status = 'draft'
	}
	void loadDepositStatement()
}, { immediate: true })

watch(() => [form.kind, form.amount, form.bizDate, form.paymentMethod, form.voucherRef, form.note], () => {
	if (!fieldsLocked.value) {
		preview.value = null
		if (operation.value?.status === 'previewed') operation.value.status = 'draft'
	}
})

watch(() => voidReason.value, () => {
	if (!fieldsLocked.value) {
		preview.value = null
		if (operation.value?.status === 'previewed') operation.value.status = 'draft'
	}
})

onBeforeUnmount(() => { destroyed = true; scopeGeneration += 1; requestSerial += 1 })
</script>

<style scoped>
.deposit-panel { display: flex; flex-direction: column; gap: 24rpx; }
.deposit-head, .deposit-operation { display: flex; justify-content: space-between; align-items: center; gap: 16rpx; flex-wrap: wrap; }
.deposit-hint { display: block; font-size: 24rpx; line-height: 1.6; color: var(--crm-text-muted); overflow-wrap: anywhere; }
.deposit-hint--warning { color: #9d5e00; }
.deposit-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16rpx; }
.deposit-summary-item { padding: 20rpx; border: 1rpx solid var(--crm-border); border-radius: var(--crm-radius-sm); background: #f9fafb; display: flex; flex-direction: column; gap: 8rpx; }
.deposit-summary-value { font-size: 28rpx; font-weight: 700; color: var(--crm-text); }
.deposit-form { display: flex; flex-direction: column; gap: 20rpx; padding: 24rpx; border: 1rpx solid var(--crm-border); border-radius: var(--crm-radius-sm); }
.deposit-tabs { overflow-x: auto; white-space: nowrap; }
.deposit-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20rpx; }
.deposit-span { grid-column: 1 / -1; }
.deposit-preview { display: flex; flex-direction: column; gap: 12rpx; padding: 24rpx; background: #eef6ff; border-radius: var(--crm-radius-sm); }
.deposit-preview-title { display: block; font-size: 28rpx; font-weight: 700; color: var(--crm-text); }
.deposit-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 16rpx; }
@media (max-width: 720px) { .deposit-grid, .deposit-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .deposit-form { padding: 20rpx; } }
@media (max-width: 420px) { .deposit-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
