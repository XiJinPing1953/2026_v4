<template>
	<view class="cashier-intake-records">
		<view class="cashier-intake-head">
			<view class="cashier-intake-head__copy">
				<text class="cashier-intake-title">出纳到账原单</text>
				<text class="cashier-intake-hint">每页 20 条独立查询，可继续翻页查看所选期间全部历史记录。用途仅展示出纳来源，不改变气款、押金或客户余额分类。</text>
			</view>
			<AppButton size="sm" kind="neutral" :loading="loading" @click="reloadCurrentPage">刷新到账</AppButton>
		</view>

		<view class="cashier-intake-filters">
			<picker mode="selector" :range="kindOptions" range-key="label" :value="kindIndex" :disabled="loading" @change="onKindChange">
				<AppInput :model-value="kindOptions[kindIndex]?.label || '全部类型'" label="到账类型" readonly size="sm" />
			</picker>
			<picker mode="selector" :range="purposeOptions" range-key="label" :value="purposeIndex" :disabled="loading" @change="onPurposeChange">
				<AppInput :model-value="purposeOptions[purposeIndex]?.label || '全部来源用途'" label="来源用途" readonly size="sm" />
			</picker>
			<view class="cashier-intake-filter-action">
				<text class="cashier-intake-filter-label">作废记录</text>
				<AppButton size="sm" :kind="filters.includeVoid ? 'primary' : 'neutral'" :disabled="loading" @click="toggleIncludeVoid">
					{{ filters.includeVoid ? '已包含' : '未包含' }}
				</AppButton>
			</view>
		</view>

		<text class="cashier-intake-hint">所选期间：{{ dateFrom || '--' }} ~ {{ dateTo || '--' }}</text>
		<text v-if="listIssue" class="cashier-intake-hint cashier-intake-hint--warning">{{ listIssue }}</text>

		<AppList :loading="loading" :empty="!loading && rows.length === 0" empty-title="所选条件暂无出纳到账记录">
			<AppListItem
				v-for="row in rows"
				:key="intakeId(row)"
				class="cashier-intake-item"
				:title="`${row.biz_date || '-'} · ${kindText(row.kind)}`"
				:subtitle="`到账单 ${intakeId(row) || '-'}`"
				:status="statusText(row)"
				:status-kind="isVoided(row) ? 'warning' : 'info'"
				icon="wallet"
				:icon-class="isVoided(row) ? 'bg-warning' : 'bg-info'"
			>
				<template #right>
					<view class="cashier-intake-amounts">
						<text class="cashier-intake-amounts__total">到账 ¥{{ moneyText(row.amount, rowMoneyScale(row)) }}</text>
						<text>气款 ¥{{ moneyText(row.gas_amount, rowMoneyScale(row)) }}</text>
						<text>押金 ¥{{ moneyText(row.deposit_amount, 2) }}</text>
					</view>
				</template>
				<template #meta>
					<view class="cashier-intake-meta">
						<text>来源用途（仅作来源记录）：{{ purposeText(row.purpose) }}</text>
						<text>出纳：{{ row.created_by_name || '待核' }} · 渠道：{{ paymentMethodText(row.payment_method) }}</text>
						<text>凭证：{{ proofCount(row) }} 张 · 备注：{{ row.note || '无' }}</text>
						<text v-if="row.receipt_id">气款收款单 {{ row.receipt_id }} · {{ row.allocation_status_text || allocationStatusText(row.allocation_status) }}</text>
						<text v-if="row.deposit_entry_id">押金流水 {{ row.deposit_entry_id }}</text>
					</view>
				</template>
				<view v-if="expandedId === intakeId(row)" class="cashier-intake-detail">
					<text v-if="detailLoading[intakeId(row)]" class="cashier-intake-hint">正在读取原单明细与凭证…</text>
					<text v-else-if="detailIssues[intakeId(row)]" class="cashier-intake-hint cashier-intake-hint--warning">{{ detailIssues[intakeId(row)] }}</text>
					<template v-else-if="details[intakeId(row)]">
						<text class="cashier-intake-detail__line">气款分配目标 {{ details[intakeId(row)].allocation_targets.length }} 项 · 押金流水 {{ details[intakeId(row)].deposit_entries.length }} 项</text>
						<text v-for="(target, index) in details[intakeId(row)].allocation_targets" :key="`allocation-${index}`" class="cashier-intake-detail__line">
							{{ allocationTargetText(target, row) }}
						</text>
						<text v-if="details[intakeId(row)].proof_images.length" class="cashier-intake-detail__line">凭证已读取，可点击“查看凭证”逐张核对。</text>
						<text v-else class="cashier-intake-detail__line">原单未返回可查看的凭证图片。</text>
					</template>
				</view>
				<template #footer>
					<view class="cashier-intake-actions">
						<AppButton size="sm" kind="ghost" :disabled="detailLoading[intakeId(row)]" @click="toggleDetail(row)">
							{{ expandedId === intakeId(row) ? '收起明细' : '查看明细' }}
						</AppButton>
						<AppButton v-if="proofCount(row) > 0" size="sm" kind="outline" :disabled="detailLoading[intakeId(row)]" @click="previewProofs(row)">查看凭证</AppButton>
						<AppButton
							v-if="hasGasReceipt(row)"
							size="sm"
							kind="primary"
							:disabled="!canAllocateGas(row) || detailLoading[intakeId(row)]"
							@click="allocateGas(row)"
						>
							{{ canAllocateGas(row) ? (Number(row.allocated_amount || 0) > 0 ? '继续分配气款' : '分配气款') : '气款已分配' }}
						</AppButton>
						<AppButton
							v-if="canReleaseAllocations(row)"
							size="sm"
							kind="outline"
							:loading="releaseLoading[intakeId(row)]"
							:disabled="detailLoading[intakeId(row)]"
							@click="releaseAllocations(row)"
						>
							解除分配（保留到账）
						</AppButton>
						<AppButton v-if="hasDepositEntry(row)" size="sm" kind="outline" @click="emit('open-deposit', row)">查看押金流水</AppButton>
					</view>
				</template>
			</AppListItem>
		</AppList>

		<view v-if="paging.total > 0 || page > 1" class="cashier-intake-pager">
			<AppButton size="sm" kind="neutral" :disabled="loading || page <= 1" @click="previousPage">上一页</AppButton>
			<text class="cashier-intake-hint">第 {{ page }} 页 · 共 {{ paging.total }} 条 · 每页 {{ paging.pageSize }} 条</text>
			<AppButton size="sm" kind="neutral" :disabled="loading || !paging.hasMore || !paging.nextCursorReady" @click="nextPage">下一页</AppButton>
		</view>
	</view>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import { getReceiptIntakeDetailV2, listReceiptIntakeV2, releaseReceiptAllocationsV2 } from '@/services/api/cashierIntake.js'
import { normalizeCashierMoney, normalizeCashierMoneyScale } from '@/services/mappers/cashierIntake.js'

const PAGE_SIZE = 20
const props = defineProps({
	customerId: { type: String, default: '' },
	dateFrom: { type: String, default: '' },
	dateTo: { type: String, default: '' }
})
const emit = defineEmits(['continue-receipt', 'open-deposit'])
const rows = ref([])
const loading = ref(false)
const listIssue = ref('')
const page = ref(1)
const pageCursors = ref([''])
const paging = reactive({ total: 0, pageSize: PAGE_SIZE, hasMore: false, nextCursor: null, nextCursorReady: false, snapshot: null })
const filters = reactive({ kind: '', purpose: '', includeVoid: true })
const expandedId = ref('')
const details = reactive({})
const detailLoading = reactive({})
const detailIssues = reactive({})
const releaseLoading = reactive({})
const releaseOperationIds = reactive({})
let requestSerial = 0
let detailGeneration = 0
let destroyed = false

const kindOptions = [
	{ label: '全部类型', value: '' },
	{ label: '气款', value: 'gas' },
	{ label: '押金', value: 'deposit' },
	{ label: '气款 + 押金', value: 'mixed' }
]
const purposeOptions = [
	{ label: '全部来源用途', value: '' },
	{ label: '未注明', value: 'unspecified' },
	{ label: '预付', value: 'prepay' },
	{ label: '结账', value: 'settlement' }
]
const kindIndex = computed(() => Math.max(0, kindOptions.findIndex(item => item.value === filters.kind)))
const purposeIndex = computed(() => Math.max(0, purposeOptions.findIndex(item => item.value === filters.purpose)))

function intakeId(row) {
	return String(row?.intake_id || row?._id || '').trim()
}

function scopeKey() {
	return JSON.stringify([props.customerId, props.dateFrom, props.dateTo, filters.kind, filters.purpose, filters.includeVoid])
}

function resetDetails() {
	expandedId.value = ''
	detailGeneration += 1
	for (const key of Object.keys(details)) delete details[key]
	for (const key of Object.keys(detailLoading)) delete detailLoading[key]
	for (const key of Object.keys(detailIssues)) delete detailIssues[key]
}

async function loadPage(cursor = '', targetPage = 1) {
	const serial = ++requestSerial
	const scope = scopeKey()
	if (!props.customerId) {
		rows.value = []
		Object.assign(paging, { total: 0, pageSize: PAGE_SIZE, hasMore: false, nextCursor: null, nextCursorReady: false, snapshot: null })
		return false
	}
	loading.value = true
	listIssue.value = ''
	try {
		const result = await listReceiptIntakeV2({
			customer_id: props.customerId,
			date_from: props.dateFrom,
			date_to: props.dateTo,
			include_void: filters.includeVoid,
			kind: filters.kind,
			purpose: filters.purpose,
			cursor,
			page_size: PAGE_SIZE
		})
		if (destroyed || serial !== requestSerial || scope !== scopeKey()) return false
		if (result?.code !== 0 || !Array.isArray(result.data) || !result.paging) {
			listIssue.value = result?.msg || '出纳到账查询未完成，请刷新后核对。'
			return false
		}
		rows.value = result.data
		page.value = targetPage
		const hasMore = result.paging.hasMore === true
		const nextCursorReady = hasMore && Object.prototype.hasOwnProperty.call(result.paging, 'next_cursor') && result.paging.next_cursor !== null && result.paging.next_cursor !== undefined
		Object.assign(paging, {
			total: Math.max(0, Number(result.paging.total) || 0),
			pageSize: Math.max(1, Number(result.paging.pageSize) || PAGE_SIZE),
			hasMore,
			nextCursor: nextCursorReady ? result.paging.next_cursor : null,
			nextCursorReady,
			snapshot: result.paging.snapshot ?? null
		})
		return true
	} catch {
		if (!destroyed && serial === requestSerial && scope === scopeKey()) listIssue.value = '出纳到账查询未完成，请刷新后核对。'
		return false
	} finally {
		if (!destroyed && serial === requestSerial && scope === scopeKey()) loading.value = false
	}
}

async function resetAndLoad() {
	requestSerial += 1
	page.value = 1
	pageCursors.value = ['']
	rows.value = []
	resetDetails()
	await loadPage('', 1)
}

async function reloadCurrentPage() {
	const cursor = pageCursors.value[page.value - 1] ?? ''
	resetDetails()
	return loadPage(cursor, page.value)
}

async function nextPage() {
	if (loading.value || !paging.hasMore || !paging.nextCursorReady) return
	const targetPage = page.value + 1
	const cursor = paging.nextCursor
	if (pageCursors.value.some(existing => existing === cursor)) {
		listIssue.value = '出纳到账分页游标未前进，已停止继续翻页，请刷新后核对。'
		return
	}
	const ok = await loadPage(cursor, targetPage)
	if (ok) pageCursors.value[targetPage - 1] = cursor
}

async function previousPage() {
	if (loading.value || page.value <= 1) return
	const targetPage = page.value - 1
	await loadPage(pageCursors.value[targetPage - 1] ?? '', targetPage)
}

function onKindChange(event) {
	const option = kindOptions[Number(event?.detail?.value)]
	if (!option || option.value === filters.kind) return
	filters.kind = option.value
	void resetAndLoad()
}

function onPurposeChange(event) {
	const option = purposeOptions[Number(event?.detail?.value)]
	if (!option || option.value === filters.purpose) return
	filters.purpose = option.value
	void resetAndLoad()
}

function toggleIncludeVoid() {
	filters.includeVoid = !filters.includeVoid
	void resetAndLoad()
}

async function ensureDetail(row) {
	const id = intakeId(row)
	if (!id) return null
	if (details[id]) return details[id]
	if (detailLoading[id]) return null
	const generation = detailGeneration
	detailLoading[id] = true
	detailIssues[id] = ''
	try {
		const result = await getReceiptIntakeDetailV2({ intake_id: id })
		if (destroyed || generation !== detailGeneration) return null
		const data = result?.code === 0 && result.data && typeof result.data === 'object' ? result.data : null
		if (!data || intakeId(data.row) !== id) {
			detailIssues[id] = result?.msg || '到账原单明细未完成，请稍后重试。'
			return null
		}
		details[id] = {
			...data,
			proof_images: Array.isArray(data.proof_images) ? data.proof_images : [],
			allocation_targets: Array.isArray(data.allocation_targets) ? data.allocation_targets : [],
			deposit_entries: Array.isArray(data.deposit_entries) ? data.deposit_entries : []
		}
		return details[id]
	} catch {
		if (!destroyed && generation === detailGeneration) detailIssues[id] = '到账原单明细未完成，请稍后重试。'
		return null
	} finally {
		if (!destroyed && generation === detailGeneration) detailLoading[id] = false
	}
}

async function toggleDetail(row) {
	const id = intakeId(row)
	if (!id) return
	if (expandedId.value === id) {
		expandedId.value = ''
		return
	}
	expandedId.value = id
	await ensureDetail(row)
}

function proofUrl(value) {
	if (typeof value === 'string') return value.trim()
	if (!value || typeof value !== 'object') return ''
	return String(value.url || value.tempFileURL || value.file_url || value.src || '').trim()
}

async function previewProofs(row) {
	const detail = await ensureDetail(row)
	const urls = (detail?.proof_images || []).map(proofUrl).filter(Boolean)
	if (!urls.length) {
		uni.showToast({ title: '原单未返回可查看的凭证图片', icon: 'none' })
		return
	}
	uni.previewImage({ current: urls[0], urls })
}

async function allocateGas(row) {
	if (!canAllocateGas(row)) return
	const detail = await ensureDetail(row)
	const receipt = detail?.receipt
	const expectedReceiptId = String(row?.receipt_id || '').trim()
	if (!receipt || String(receipt._id || '').trim() !== expectedReceiptId) {
		uni.showToast({ title: '既有气款收款单明细未完成，暂不能分配', icon: 'none' })
		return
	}
	if (!(Number(receipt.unallocated_amount) > 0)) {
		uni.showToast({ title: '该气款收款单已无待分配余额', icon: 'none' })
		return
	}
	emit('continue-receipt', receipt)
}

function canReleaseAllocations(row) {
	return hasGasReceipt(row) && !isVoided(row) && (
		Number(row?.allocated_amount || 0) > 0 || Number(row?.rounding_allocated_amount || 0) > 0
	)
}

function nextReleaseOperationId() {
	return `account-release-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function confirmReleaseAllocations() {
	return new Promise((resolve) => {
		uni.showModal({
			title: '解除气款分配',
			content: '仅撤销这张气款收款单的会计分配。原到账金额、日期、渠道、凭证和备注都会保留，到账不会被删除或作废。确认继续吗？',
			confirmText: '解除分配',
			cancelText: '取消',
			success: (result) => resolve(Boolean(result?.confirm)),
			fail: () => resolve(false)
		})
	})
}

async function releaseAllocations(row) {
	const id = intakeId(row)
	const receiptId = String(row?.receipt_id || '').trim()
	if (!id || !receiptId || !canReleaseAllocations(row) || releaseLoading[id]) return
	releaseLoading[id] = true
	try {
		const detail = await ensureDetail(row)
		const expectedReceipt = detail?.receipt
		if (!expectedReceipt || String(expectedReceipt._id || '').trim() !== receiptId) {
			uni.showToast({ title: '既有气款收款单原值未完成，暂不能解除分配', icon: 'none' })
			return
		}
		if (!(Number(expectedReceipt.allocated_amount || 0) > 0 || Number(expectedReceipt.rounding_allocated_amount || 0) > 0)) {
			uni.showToast({ title: '该气款收款单已无可解除的分配，请刷新核对', icon: 'none' })
			return
		}
		if (!(await confirmReleaseAllocations())) return
		const operationId = releaseOperationIds[id] || nextReleaseOperationId()
		releaseOperationIds[id] = operationId
		const result = await releaseReceiptAllocationsV2({
			receipt_id: receiptId,
			customer_id: props.customerId,
			operation_id: operationId,
			expected_receipt: expectedReceipt
		})
		if (result?.code !== 0) {
			if (!result?.data?.commit_status_unknown) delete releaseOperationIds[id]
			if (!result?.data?.commit_status_unknown) delete details[id]
			uni.showToast({
				title: result?.msg || '解除分配未完成，请保留当前页面后重试',
				icon: 'none',
				duration: 3000
			})
			return
		}
		delete releaseOperationIds[id]
		uni.showToast({ title: result?.msg || '分配已解除，原到账仍保留', icon: 'success' })
		const refreshed = await reloadCurrentPage()
		if (!refreshed) {
			uni.showToast({ title: '分配已解除；到账列表刷新失败，请手动刷新核对', icon: 'none', duration: 3000 })
		}
	} catch {
		uni.showToast({ title: '提交结果待查询，请在当前页面用同一操作重试', icon: 'none', duration: 3000 })
	} finally {
		releaseLoading[id] = false
	}
}

function rowMoneyScale(row) {
	return normalizeCashierMoneyScale(row?.money_scale, 2)
}

function moneyText(value, scale = 2) {
	return normalizeCashierMoney(value, scale) || '待核'
}

function kindText(value) {
	return kindOptions.find(item => item.value === value)?.label || String(value || '到账')
}

function purposeText(value) {
	return purposeOptions.find(item => item.value === value)?.label || String(value || '未注明')
}

function paymentMethodText(value) {
	const labels = { cash: '现金', bank: '银行转账', wechat: '微信', alipay: '支付宝', check: '支票', unknown: '渠道待核' }
	return labels[String(value || '').trim()] || String(value || '渠道待核')
}

function allocationStatusText(value) {
	const labels = { unallocated: '待分配', partial: '部分分配', allocated: '已分配', none: '无需分配' }
	return labels[String(value || '').trim()] || String(value || '分配状态待核')
}

function isVoided(row) {
	return ['void', 'voided', 'cancelled'].includes(String(row?.status || '').trim().toLowerCase())
}

function statusText(row) {
	if (isVoided(row)) return '已作废'
	return row?.allocation_status_text || allocationStatusText(row?.allocation_status)
}

function proofCount(row) {
	return Math.max(0, Math.floor(Number(row?.proof_images_count) || 0))
}

function gasAmount(row) {
	return Math.max(0, Number(row?.gas_amount) || 0)
}

function depositAmount(row) {
	return Math.max(0, Number(row?.deposit_amount) || 0)
}

function hasGasReceipt(row) {
	return gasAmount(row) > 0 && Boolean(String(row?.receipt_id || '').trim())
}

function canAllocateGas(row) {
	return hasGasReceipt(row) && !isVoided(row) && Number(row?.unallocated_amount) > 0
}

function hasDepositEntry(row) {
	return depositAmount(row) > 0 && Boolean(String(row?.deposit_entry_id || '').trim())
}

function allocationTargetText(target, row) {
	const targetId = String(target?.target_id || target?.sale_id || target?._id || '').trim() || '目标待核'
	const amount = target?.allocated_amount ?? target?.allocate_amount ?? target?.amount
	return `分配目标 ${targetId} · ¥${moneyText(amount, rowMoneyScale(row))}`
}

watch(() => [props.customerId, props.dateFrom, props.dateTo], () => { void resetAndLoad() }, { immediate: true })
onBeforeUnmount(() => {
	destroyed = true
	requestSerial += 1
	detailGeneration += 1
})
</script>

<style scoped>
.cashier-intake-records { display:flex; flex-direction:column; gap:20rpx; }
.cashier-intake-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20rpx; }
.cashier-intake-head__copy, .cashier-intake-meta, .cashier-intake-detail { display:flex; flex-direction:column; gap:8rpx; min-width:0; }
.cashier-intake-title { font-size:30rpx; line-height:1.4; font-weight:700; color:var(--crm-text); }
.cashier-intake-hint, .cashier-intake-meta, .cashier-intake-detail__line { font-size:24rpx; line-height:1.55; color:var(--crm-text-muted); overflow-wrap:anywhere; }
.cashier-intake-hint--warning { color:#9d5e00; }
.cashier-intake-filters { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16rpx; align-items:end; }
.cashier-intake-filter-action { display:flex; flex-direction:column; align-items:flex-start; gap:8rpx; }
.cashier-intake-filter-label { font-size:24rpx; color:var(--crm-text-muted); }
.cashier-intake-amounts { display:flex; flex-direction:column; align-items:flex-end; gap:4rpx; white-space:nowrap; font-size:24rpx; color:var(--crm-text-muted); }
.cashier-intake-amounts__total { font-size:28rpx; font-weight:700; color:var(--crm-text); }
.cashier-intake-actions, .cashier-intake-pager { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:12rpx; }
.cashier-intake-detail { padding:18rpx; border:1rpx solid var(--crm-border); border-radius:var(--crm-radius-sm); background:#f8fafc; }
@media (max-width:720px) {
	.cashier-intake-filters { grid-template-columns:repeat(2,minmax(0,1fr)); }
	.cashier-intake-item :deep(.item__row) { flex-direction:column; }
	.cashier-intake-item :deep(.item__right), .cashier-intake-amounts { align-items:flex-start; }
}
@media (max-width:420px) {
	.cashier-intake-head { flex-direction:column; }
	.cashier-intake-filters { grid-template-columns:minmax(0,1fr); }
	.cashier-intake-actions, .cashier-intake-pager { justify-content:flex-start; }
}
</style>
