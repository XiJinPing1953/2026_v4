<template>
	<AppPage :title="pageTitle" :subtitle="subtitle" icon="user">
		<template #headerActions>
			<AppButton v-if="canCreateCustomer" size="sm" kind="primary" icon="plus" @click="onAdd">新增客户</AppButton>
			<AppButton size="sm" kind="neutral" icon="document" :loading="exporting" :disabled="loading" @click="onExport">导出</AppButton>
			<AppButton
				v-if="isStatementEntryMode && canViewStatement"
				size="sm"
				kind="neutral"
				icon="document"
				:loading="exportingDebtSnapshot"
				:disabled="loading || exporting || exportingAccounting"
				@click="onExportDebtSnapshot"
			>
				导出未结清欠款表
			</AppButton>
			<AppButton
				v-if="isStatementEntryMode && canViewStatement"
				size="sm"
				kind="neutral"
				icon="document"
				:loading="exportingAccounting"
				:disabled="loading || exporting"
				@click="onExportAccountingLedger"
			>
				会计导出
			</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard
					class="summary-card"
					label="筛选结果"
					:value="summary.total"
					hint="客户"
					icon="user"
					@click="onSummaryFilter('all')"
				/>
				<AppStatCard
					class="summary-card"
					label="启用客户"
					:value="summary.active"
					hint="客户"
					icon="check-circle"
					@click="onSummaryFilter('active')"
				/>
				<AppStatCard
					class="summary-card"
					label="停用客户"
					:value="summary.inactive"
					hint="客户"
					icon="minus-circle"
					@click="onSummaryFilter('inactive')"
				/>
				<AppStatCard
					class="summary-card"
					label="已配定价"
					:value="summary.priced"
					hint="客户"
					icon="list"
				/>
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="客户筛选">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<view class="search-field">
						<AppInput
							v-model="filters.keyword"
							label="关键词"
							placeholder="客户名/联系人/电话/二维码"
							prefix-icon="search"
							size="sm"
							@input="onKeywordInput"
							@focus="onKeywordFocus"
							@blur="onKeywordBlur"
							@confirm="onKeywordConfirm"
						/>
						<view v-if="showSuggestions && suggestions.length" class="suggestions">
							<view
								v-for="item in suggestions"
								:key="item._id || item.name"
								class="suggestion-item"
								@click.stop="selectSuggestion(item)"
								@tap.stop="selectSuggestion(item)"
							>
								<text class="suggestion-text">{{ item.name }}</text>
								<text class="suggestion-sub">{{ customerSuggestionSubText(item) }}</text>
							</view>
						</view>
					</view>
					<picker
						v-if="isStatementEntryMode"
						class="picker-block"
						mode="date"
						:value="filters.updatedDateStart"
						@change="onUpdatedDateStartChange"
					>
						<AppInput
							:model-value="filters.updatedDateStart"
							label="更新时间从"
							placeholder="YYYY-MM-DD"
							prefix-icon="calendar"
							disabled
							size="sm"
						/>
					</picker>
					<picker
						v-if="isStatementEntryMode"
						class="picker-block"
						mode="date"
						:value="filters.updatedDateEnd"
						@change="onUpdatedDateEndChange"
					>
						<AppInput
							:model-value="filters.updatedDateEnd"
							label="更新时间至"
							placeholder="YYYY-MM-DD"
							prefix-icon="calendar"
							disabled
							size="sm"
						/>
					</picker>
					<picker class="picker-block" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
						<AppInput
							:model-value="activeLabel"
							label="启用状态"
							placeholder="状态筛选"
							prefix-icon="list"
							disabled
							size="sm"
						/>
					</picker>
					<picker
						v-if="canManageHiddenCustomers"
						class="picker-block"
						mode="selector"
						:range="visibilityOptions"
						range-key="label"
						@change="onVisibilityChange"
					>
						<AppInput
							:model-value="visibilityLabel"
							label="显隐状态"
							placeholder="显隐筛选"
							prefix-icon="list"
							disabled
							size="sm"
						/>
					</picker>
					<picker
						v-if="isStatementEntryMode"
						class="picker-block"
						mode="selector"
						:range="balanceOptions"
						range-key="label"
						@change="onBalanceChange"
					>
						<AppInput
							:model-value="balanceLabel"
							label="余额方向"
							placeholder="余额方向筛选"
							prefix-icon="wallet"
							disabled
							size="sm"
						/>
					</picker>
					<picker
						v-if="isStatementEntryMode"
						class="picker-block"
						mode="selector"
						:range="cashierUnallocatedOptions"
						range-key="label"
						@change="onCashierUnallocatedChange"
					>
						<AppInput
							:model-value="cashierUnallocatedLabel"
							label="出纳未分配"
							placeholder="全部客户"
							prefix-icon="wallet"
							disabled
							size="sm"
						/>
					</picker>
					<picker
						v-if="isStatementEntryMode"
						class="picker-block"
						mode="date"
						:value="filters.cashierDateStart"
						@change="onCashierDateStartChange"
					>
						<AppInput
							:model-value="filters.cashierDateStart"
							label="出纳日期从"
							placeholder="YYYY-MM-DD"
							prefix-icon="calendar"
							disabled
							size="sm"
						/>
					</picker>
					<picker
						v-if="isStatementEntryMode"
						class="picker-block"
						mode="date"
						:value="filters.cashierDateEnd"
						@change="onCashierDateEndChange"
					>
						<AppInput
							:model-value="filters.cashierDateEnd"
							label="出纳日期至"
							placeholder="YYYY-MM-DD"
							prefix-icon="calendar"
							disabled
							size="sm"
						/>
					</picker>
				</view>

				<view v-if="filterChips.length" class="filter-chips">
					<view v-for="chip in filterChips" :key="chip.key" class="filter-chip" @click="clearFilterChip(chip.key)">
						<text class="filter-chip__label">{{ chip.label }}</text>
						<text class="filter-chip__close">×</text>
					</view>
				</view>
			</AppSection>

			<AppSection title="客户列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 客户 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无客户数据">
					<template #emptyAction>
						<AppButton size="sm" @click="onSearch">刷新重试</AppButton>
					</template>

					<AppListItem
						v-for="item in list"
						:key="item._id"
						:status="customerStatusText(item)"
						:status-kind="customerStatusKind(item)"
						icon="user"
						:icon-class="customerIconClass(item)"
						clickable
						@click="onPrimaryAction(item)"
					>
						<template #header>
							<view class="customer-heading">
								<text class="customer-heading__title">{{ item.name }}</text>
								<text class="customer-heading__contact">{{ item.contact || '暂无联系人' }}</text>
								<text v-if="isStatementEntryMode" class="customer-heading__price">{{ customerUnitPriceText(item) }}</text>
								<view class="customer-heading__deposit">
									<text class="customer-heading__deposit-count">存瓶 {{ Number(item.deposit_count || 0) }}</text>
									<text v-if="item.deposit_bottle_nos?.length" class="customer-heading__deposit-nos">{{ item.deposit_bottle_nos.join('、') }}</text>
									<text v-else class="customer-heading__deposit-empty">暂无存瓶</text>
									<text v-if="depositLocationText(item)" class="customer-heading__deposit-locations">{{ depositLocationText(item) }}</text>
								</view>
							</view>
						</template>
						<template #right>
							<view class="info-box">
								<text class="info-label">未结清欠款</text>
								<view class="price-box">
									<text class="price-symbol">¥</text>
									<text class="price-value" :class="balanceValueClass(item)">{{ formatMoney(item.receivable_balance) }}</text>
								</view>
								<view class="balance-hint">
									<text
										class="balance-hint__item"
										:class="{ 'balance-hint__item--danger': toNumber(item.receipt_unallocated_balance, 0) > 0.009 }"
									>
										待分配收款 {{ formatMoney(item.receipt_unallocated_balance) }}
									</text>
									<text class="balance-hint__item">预付款 {{ formatMoney(item.prepay_manual_balance) }}</text>
									<text class="balance-hint__item">冲抵池 {{ formatMoney(item.offset_credit_balance) }}</text>
									<text class="balance-hint__item">净额 {{ formatMoney(item.net_balance) }}</text>
								</view>
							</view>
						</template>
						
						<template #meta>
							<view class="meta-tags">
								<AppTag v-if="item.phone" kind="soft" class="tag-item">
									<AppIcon name="calendar" size="24rpx" style="margin-right: 4rpx;" />
									{{ item.phone }}
								</AppTag>
								<AppTag kind="soft" class="tag-item">{{ item.qr_code ? `码 ${item.qr_code}` : '无码' }}</AppTag>
								<AppTag v-if="!isStatementEntryMode" kind="soft" class="tag-item">{{ item.default_price_unit || 'kg' }}</AppTag>
								<AppTag v-if="matchedDeliveryText(item)" kind="soft" class="tag-item">匹配送达 {{ matchedDeliveryText(item) }}</AppTag>
								<AppTag v-if="item.is_hidden === true" kind="soft" class="tag-item">已隐藏</AppTag>
								<AppTag kind="soft" class="tag-item">未结清 {{ formatMoney(item.receivable_balance) }}</AppTag>
								<AppTag kind="soft" class="tag-item">可用款 {{ formatMoney(item.prepay_balance) }}</AppTag>
								<text v-if="item.short_name" class="mode-label">{{ item.short_name }}</text>
							</view>
						</template>
						
						<template #footer>
							<view class="footer-btns">
								<AppButton v-if="canViewStatement && !isStatementEntryMode" kind="outline" size="sm" @click.stop="onStatement(item)">客户对账</AppButton>
								<AppButton v-if="canUpdateCustomer" kind="ghost" size="sm" @click.stop="onEdit(item)">编辑档案</AppButton>
								<AppButton v-if="canManageHiddenCustomers && item.is_hidden !== true" kind="ghost" size="sm" @click.stop="onHideCustomer(item)">隐藏</AppButton>
								<AppButton v-if="canManageHiddenCustomers && item.is_hidden === true" kind="outline" size="sm" @click.stop="onUnhideCustomer(item)">恢复</AppButton>
							</view>
						</template>
					</AppListItem>
				</AppList>
				<view v-if="pager.total > 0" class="pager-row">
					<AppButton size="sm" kind="neutral" :disabled="loading || pager.page <= 1" @click="onPrevPage">上一页</AppButton>
					<AppButton size="sm" kind="neutral" :disabled="loading || !pager.hasMore" @click="onNextPage">下一页</AppButton>
				</view>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useQuery } from '@/composables/useQuery'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { getUser } from '@/services/auth'
import { hideCustomerV1, listCustomersV1, unhideCustomerV1 } from '@/services/customer'
import { exportCustomerAccountingLedgerV1, exportCustomerDebtSnapshotV1, exportCustomerStatementV1 } from '@/services/customerSettlement'
import {
	buildCustomerDebtSnapshotExportFileName,
	buildCustomerDebtSnapshotWorkbookXml,
	buildCustomerAccountingLedgerBatchExportFileName,
	buildCustomerAccountingLedgerBatchWorkbookXml,
	downloadWorkbookFile
} from '@/components/domain/customer/statement/exportWorkbook'
import {
	buildCustomerListWorkbookXml,
	buildCustomerListExportFileName
} from '@/components/domain/customer/exportCustomerListWorkbook'

const props = defineProps({
	entryMode: { type: String, default: 'default' }
})

const list = ref([])
const summary = ref({ total: 0, active: 0, inactive: 0, priced: 0 })
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})

const filters = reactive({
	keyword: '',
	activeIndex: 0,
	visibilityIndex: 0,
	balanceIndex: 0,
	updatedDateStart: '',
	updatedDateEnd: '',
	cashierUnallocatedIndex: 0,
	cashierDateStart: '',
	cashierDateEnd: ''
})
const showSuggestions = ref(false)
const suggestions = ref([])
const exporting = ref(false)
const exportingAccounting = ref(false)
const exportingDebtSnapshot = ref(false)
let searchTimer = null

const activeOptions = [
	{ label: '全部状态', value: 'all' },
	{ label: '启用中', value: 'true' },
	{ label: '已停用', value: 'false' }
]

const visibilityOptions = [
	{ label: '可见客户', value: 'visible' },
	{ label: '隐藏客户', value: 'hidden' },
	{ label: '全部客户', value: 'all' }
]

const balanceOptions = [
	{ label: '全部余额', value: 'all' },
	{ label: '未结清欠款', value: 'receivable' },
	{ label: '净预收客户', value: 'prepay' },
	{ label: '已结清', value: 'settled' }
]
const cashierUnallocatedOptions = [
	{ label: '全部客户', value: 'all' },
	{ label: '有未分配出纳款', value: 'unallocated' }
]

const { canPageAction, canViewPage } = useAuthGuard()
const canCreateCustomer = computed(() => canPageAction('/pages/customer/edit', 'create'))
const canUpdateCustomer = computed(() => canPageAction('/pages/customer/edit', 'update'))
const canViewStatement = computed(() => canViewPage('/pages/customer/statement'))
function isSuperAdminUser(user) {
	const role = normalizeString(user?.role).toLowerCase()
	const roleTemplate = normalizeString(user?.role_template).toLowerCase()
	return role === 'superadmin' || roleTemplate === 'superadmin'
}
const isSuperAdmin = computed(() => isSuperAdminUser(getUser()))
const canManageHiddenCustomers = computed(() => isSuperAdmin.value)
const normalizedEntryMode = computed(() => (props.entryMode === 'statement' ? 'statement' : 'default'))
const isStatementEntryMode = computed(() => normalizedEntryMode.value === 'statement')

const pageTitle = computed(() => (isStatementEntryMode.value ? '客户对账' : '客户档案'))

const activeLabel = computed(() => {
	return activeOptions[filters.activeIndex]?.label || '全部状态'
})

const visibilityLabel = computed(() => {
	return visibilityOptions[filters.visibilityIndex]?.label || '可见客户'
})

const balanceLabel = computed(() => {
	return balanceOptions[filters.balanceIndex]?.label || '全部余额'
})

const updatedDateRangeLabel = computed(() => {
	const start = filters.updatedDateStart
	const end = filters.updatedDateEnd
	if (!start && !end) return '全部时间'
	return `${start || '不限'}~${end || '不限'}`
})
const cashierUnallocatedLabel = computed(() => {
	return cashierUnallocatedOptions[filters.cashierUnallocatedIndex]?.label || '全部客户'
})
const cashierDateRangeLabel = computed(() => {
	const start = filters.cashierDateStart
	const end = filters.cashierDateEnd
	if (!start && !end) return '全部时间'
	return `${start || '不限'}~${end || '不限'}`
})

const subtitle = computed(() => {
	if (isStatementEntryMode.value) {
		if (!pager.total) return '按客户进入对账流水'
		return `选择客户进入对账 · 当前 ${pager.total} 客户`
	}
	if (!pager.total) return '维护客户资料与定价策略'
	return `当前筛选 ${pager.total} 客户`
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})

const filterChips = computed(() => {
	const chips = []
	if (filters.keyword) chips.push({ key: 'keyword', label: `关键词: ${filters.keyword}` })
	if (filters.activeIndex > 0) chips.push({ key: 'active', label: `状态: ${activeLabel.value}` })
	if (canManageHiddenCustomers.value && filters.visibilityIndex > 0) chips.push({ key: 'visibility', label: `显隐: ${visibilityLabel.value}` })
	if (isStatementEntryMode.value && filters.balanceIndex > 0) chips.push({ key: 'balance', label: `余额: ${balanceLabel.value}` })
	if (isStatementEntryMode.value && (filters.updatedDateStart || filters.updatedDateEnd)) {
		chips.push({ key: 'updatedDateRange', label: `时间: ${updatedDateRangeLabel.value}` })
	}
	if (isStatementEntryMode.value && filters.cashierUnallocatedIndex > 0) {
		chips.push({ key: 'cashierUnallocated', label: `出纳未分配: ${cashierUnallocatedLabel.value}` })
	}
	if (isStatementEntryMode.value && filters.cashierUnallocatedIndex > 0 && (filters.cashierDateStart || filters.cashierDateEnd)) {
		chips.push({ key: 'cashierDateRange', label: `出纳日期: ${cashierDateRangeLabel.value}` })
	}
	return chips
})

function clearFilterChip(key) {
	if (key === 'keyword') filters.keyword = ''
	if (key === 'active') filters.activeIndex = 0
	if (key === 'visibility') filters.visibilityIndex = 0
	if (key === 'balance') filters.balanceIndex = 0
	if (key === 'updatedDateRange') {
		filters.updatedDateStart = ''
		filters.updatedDateEnd = ''
	}
	if (key === 'cashierUnallocated') filters.cashierUnallocatedIndex = 0
	if (key === 'cashierDateRange') {
		filters.cashierDateStart = ''
		filters.cashierDateEnd = ''
	}
	onSearch(true)
}

function onSummaryFilter(type) {
	if (type === 'active') filters.activeIndex = 1
	else if (type === 'inactive') filters.activeIndex = 2
	else filters.activeIndex = 0
	onSearch(true)
}

function buildIsActiveParam() {
	const value = activeOptions[filters.activeIndex]?.value
	if (value === 'true') return true
	if (value === 'false') return false
	return undefined
}

function buildBalanceTypeParam() {
	if (!isStatementEntryMode.value) return undefined
	const value = balanceOptions[filters.balanceIndex]?.value
	if (value === 'receivable' || value === 'prepay' || value === 'settled') return value
	return undefined
}

function buildVisibilityParam() {
	if (!canManageHiddenCustomers.value) return 'visible'
	const value = visibilityOptions[filters.visibilityIndex]?.value
	return value === 'hidden' || value === 'all' ? value : 'visible'
}

function toNumber(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function normalizeString(value) {
	return value == null ? '' : String(value).trim()
}

function normalizePriceUnit(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'm3' || text === 'm³') return 'm³'
	if (text) return text
	return 'kg'
}

function formatMoney(value) {
	return toNumber(value, 0).toFixed(2)
}

function customerUnitPriceText(item) {
	const unit = normalizePriceUnit(item?.default_price_unit)
	const unitPrice = Number(item?.default_unit_price)
	if (!Number.isFinite(unitPrice)) return `单价 -/${unit}`
	return `单价 ${formatMoney(unitPrice)}/${unit}`
}

function depositLocationText(item) {
	const locations = Array.isArray(item?.deposit_locations) ? item.deposit_locations : []
	const useful = locations
		.filter((row) => Number(row?.count || 0) > 0)
		.map((row) => `${row.customer_name || '未命名'} ${Number(row.count || 0)}`)
	if (useful.length <= 1) return ''
	return useful.join(' / ')
}

function matchedDeliveryText(item) {
	const sites = Array.isArray(item?.matched_delivery_sites) ? item.matched_delivery_sites : []
	const names = sites
		.map((row) => normalizeString(row?.name))
		.filter(Boolean)
	if (!names.length) return ''
	return names.slice(0, 3).join(' / ')
}

function customerSuggestionSubText(item) {
	return [
		matchedDeliveryText(item) ? `匹配送达地点：${matchedDeliveryText(item)}` : '',
		item?.contact,
		item?.phone
	].filter(Boolean).join(' · ')
}

function buildListParams(page = 1, pageSize = 50, options = {}) {
	const shouldFilterCashierUnallocated = isStatementEntryMode.value && filters.cashierUnallocatedIndex > 0
	const forceVisible = options?.forceVisible === true
	return {
		keyword: filters.keyword,
		is_active: buildIsActiveParam(),
		visibility: forceVisible ? 'visible' : buildVisibilityParam(),
		settlementOnly: isStatementEntryMode.value,
		balance_type: buildBalanceTypeParam(),
		updated_date_start: isStatementEntryMode.value ? filters.updatedDateStart : '',
		updated_date_end: isStatementEntryMode.value ? filters.updatedDateEnd : '',
		cashier_unallocated_only: shouldFilterCashierUnallocated,
		cashier_unallocated_date_start: shouldFilterCashierUnallocated ? filters.cashierDateStart : '',
		cashier_unallocated_date_end: shouldFilterCashierUnallocated ? filters.cashierDateEnd : '',
		page,
		pageSize,
		summaryIgnoreActive: true
	}
}

function balanceValueClass(item) {
	const receivable = toNumber(item?.receivable_balance, 0)
	if (receivable > 0.009) return 'price-value--danger'
	return 'price-value--neutral'
}

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listCustomersV1(buildListParams(pager.page, pager.pageSize))
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: { total: 0, active: 0, inactive: 0, priced: 0 }
			}
		}
		return {
			items: Array.isArray(res.data) ? res.data : [],
			paging: res.paging || {
				page: pager.page,
				pageSize: pager.pageSize,
				total: 0,
				hasMore: false
			},
			summary: res.summary || { total: 0, active: 0, inactive: 0, priced: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, active: 0, inactive: 0, priced: 0 }
		},
		cacheTTL: 15000,
		throttleMs: 300,
		cacheKey: () =>
			`customer:list:${normalizedEntryMode.value}:${filters.keyword}:${filters.activeIndex}:${filters.visibilityIndex}:${filters.balanceIndex}:${filters.updatedDateStart}:${filters.updatedDateEnd}:${filters.cashierUnallocatedIndex}:${filters.cashierDateStart}:${filters.cashierDateEnd}:${pager.page}:${pager.pageSize}`
	}
)

function applyResult(payload) {
	const data = payload || {}
	list.value = Array.isArray(data.items) ? data.items : []
	const paging = data.paging || {}
	pager.page = Number(paging.page || pager.page || 1)
	pager.pageSize = Number(paging.pageSize || pager.pageSize || 50)
	pager.total = Number(paging.total || 0)
	pager.hasMore = Boolean(paging.hasMore)
	const summaryData = data.summary || {}
	summary.value = {
		total: Number(summaryData.total || 0),
		active: Number(summaryData.active || 0),
		inactive: Number(summaryData.inactive || 0),
		priced: Number(summaryData.priced || 0)
	}
}

async function onSearch(resetPage = false, options = {}) {
	if (resetPage) pager.page = 1
	const data = await fetchList({ force: Boolean(options.force) })
	applyResult(data)
}

async function fetchAllRowsForExport() {
	const rows = []
	let page = 1
	let hasMore = true
	let guard = 0
	while (hasMore) {
		if (guard > 500) throw new Error('导出分页异常，请缩小筛选后重试')
		const res = await listCustomersV1(buildListParams(page, 50, { forceVisible: true }))
		if (res?.code !== 0) throw new Error(res?.msg || '导出查询失败')
		const pageRows = Array.isArray(res.data) ? res.data : []
		rows.push(...pageRows)
		hasMore = Boolean(res?.paging?.hasMore)
		if (!pageRows.length) break
		page += 1
		guard += 1
	}
	return rows
}

async function onExport() {
	if (exporting.value) return
	exporting.value = true
	uni.showLoading({ title: '正在导出...', mask: true })
	try {
		const rows = await fetchAllRowsForExport()
		if (!rows.length) {
			uni.showToast({ title: '没有可导出的数据', icon: 'none' })
			return
		}
		const statementPeriod = resolveStatementExportPeriod()
		const statementExportEnabled = isStatementEntryMode.value && canViewStatement.value
		const { statementSheets, statementSheetErrors } = statementExportEnabled
			? await fetchCustomerStatementSheetsForExport(rows, statementPeriod)
			: { statementSheets: [], statementSheetErrors: [] }
		const workbookText = buildCustomerListWorkbookXml({
			rows,
			statementSheets,
			statementSheetErrors,
			filters: {
				keyword: filters.keyword,
				activeLabel: activeLabel.value,
				visibilityLabel: '可见客户',
				balanceLabel: balanceLabel.value,
				updatedDateStart: filters.updatedDateStart,
				updatedDateEnd: filters.updatedDateEnd,
				updatedDateRangeLabel: updatedDateRangeLabel.value,
				cashierUnallocatedLabel: cashierUnallocatedLabel.value,
				cashierDateRangeLabel: cashierDateRangeLabel.value,
				statementDateStart: statementPeriod.dateFrom,
				statementDateEnd: statementPeriod.dateTo
			}
		})
		const fileName = buildCustomerListExportFileName({
			filters: {
				keyword: filters.keyword,
				activeLabel: activeLabel.value,
				visibilityLabel: '可见客户',
				balanceLabel: balanceLabel.value,
				updatedDateStart: filters.updatedDateStart,
				updatedDateEnd: filters.updatedDateEnd,
				updatedDateRangeLabel: updatedDateRangeLabel.value,
				cashierUnallocatedLabel: cashierUnallocatedLabel.value,
				cashierDateRangeLabel: cashierDateRangeLabel.value,
				statementDateStart: statementPeriod.dateFrom,
				statementDateEnd: statementPeriod.dateTo
			}
		})
		const downloaded = await downloadWorkbookFile(workbookText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持导出，请联系管理员', icon: 'none', duration: 2800 })
			return
		}
		const errorCount = Number(statementSheetErrors?.length || 0)
		if (errorCount > 0) {
			uni.showToast({ title: `已导出${rows.length}客户，${errorCount}个客户明细失败（见失败sheet）`, icon: 'none', duration: 3000 })
		} else {
			uni.showToast({ title: `已导出${rows.length}条`, icon: 'success' })
		}
	} catch (err) {
		uni.showToast({ title: err?.message || '导出失败', icon: 'none', duration: 2800 })
	} finally {
		uni.hideLoading()
		exporting.value = false
	}
}

async function onExportDebtSnapshot() {
	if (exportingDebtSnapshot.value) return
	if (!isStatementEntryMode.value || !canViewStatement.value) {
		uni.showToast({ title: '当前账号没有客户对账导出权限', icon: 'none' })
		return
	}
	exportingDebtSnapshot.value = true
	uni.showLoading({ title: '正在导出欠款表...', mask: true })
	try {
		const statementPeriod = resolveStatementExportPeriod()
		const res = await exportCustomerDebtSnapshotV1({
			dateFrom: statementPeriod.dateFrom,
			dateTo: statementPeriod.dateTo
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '未结清欠款表导出失败', icon: 'none' })
			return
		}
		const payload = res?.data || {}
		const summaryRows = Array.isArray(payload.summary_rows) ? payload.summary_rows : []
		if (!summaryRows.length) {
			uni.showToast({ title: '当前没有未结清欠款客户', icon: 'none' })
			return
		}
		const workbookText = buildCustomerDebtSnapshotWorkbookXml(payload)
		const fileName = buildCustomerDebtSnapshotExportFileName(payload)
		const downloaded = await downloadWorkbookFile(workbookText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持导出，请联系管理员', icon: 'none', duration: 2800 })
			return
		}
		uni.showToast({ title: `已导出${summaryRows.length}个欠款客户`, icon: 'success' })
	} catch (err) {
		uni.showToast({ title: err?.message || '未结清欠款表导出失败', icon: 'none', duration: 2800 })
	} finally {
		uni.hideLoading()
		exportingDebtSnapshot.value = false
	}
}

async function onExportAccountingLedger() {
	if (exportingAccounting.value) return
	if (!isStatementEntryMode.value || !canViewStatement.value) {
		uni.showToast({ title: '当前账号没有客户对账导出权限', icon: 'none' })
		return
	}
	exportingAccounting.value = true
	uni.showLoading({ title: '正在导出会计明细...', mask: true })
	try {
		const rows = await fetchAllRowsForExport()
		if (!rows.length) {
			uni.showToast({ title: '没有可导出的数据', icon: 'none' })
			return
		}
		const statementPeriod = resolveStatementExportPeriod()
		const { ledgerSheets, ledgerSheetErrors } = await fetchCustomerAccountingLedgerSheetsForExport(rows, statementPeriod)
		const workbookPayload = {
			ledgerSheets,
			ledgerSheetErrors,
			total: rows.length,
			filters: {
				dateStart: statementPeriod.dateFrom,
				dateEnd: statementPeriod.dateTo,
				customerLabel: normalizeString(filters.keyword) || '当前筛选客户'
			}
		}
		const workbookText = buildCustomerAccountingLedgerBatchWorkbookXml(workbookPayload)
		const fileName = buildCustomerAccountingLedgerBatchExportFileName(workbookPayload)
		const downloaded = await downloadWorkbookFile(workbookText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持导出，请联系管理员', icon: 'none', duration: 2800 })
			return
		}
		const errorCount = Number(ledgerSheetErrors?.length || 0)
		if (errorCount > 0) {
			uni.showToast({ title: `已导出${ledgerSheets.length}客户，${errorCount}个客户失败（见失败sheet）`, icon: 'none', duration: 3000 })
		} else {
			uni.showToast({ title: `已导出${ledgerSheets.length}个客户会计明细`, icon: 'success' })
		}
	} catch (err) {
		uni.showToast({ title: err?.message || '会计导出失败', icon: 'none', duration: 2800 })
	} finally {
		uni.hideLoading()
		exportingAccounting.value = false
	}
}

function onReset() {
	filters.keyword = ''
	filters.activeIndex = 0
	filters.visibilityIndex = 0
	filters.balanceIndex = 0
	filters.updatedDateStart = ''
	filters.updatedDateEnd = ''
	filters.cashierUnallocatedIndex = 0
	filters.cashierDateStart = ''
	filters.cashierDateEnd = ''
	suggestions.value = []
	showSuggestions.value = false
	onSearch(true)
}

function onActiveChange(e) {
	const idx = Number(e?.detail?.value)
	filters.activeIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onVisibilityChange(e) {
	if (!canManageHiddenCustomers.value) return
	const idx = Number(e?.detail?.value)
	filters.visibilityIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onBalanceChange(e) {
	if (!isStatementEntryMode.value) return
	const idx = Number(e?.detail?.value)
	filters.balanceIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onCashierUnallocatedChange(e) {
	if (!isStatementEntryMode.value) return
	const idx = Number(e?.detail?.value)
	filters.cashierUnallocatedIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function normalizeDateInput(value) {
	const text = String(value || '').trim()
	return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function normalizeUpdatedDateRangeOrder() {
	if (!filters.updatedDateStart || !filters.updatedDateEnd) return
	if (filters.updatedDateStart <= filters.updatedDateEnd) return
	const from = filters.updatedDateStart
	filters.updatedDateStart = filters.updatedDateEnd
	filters.updatedDateEnd = from
	uni.showToast({ title: '已自动调整时间范围', icon: 'none' })
}

function onUpdatedDateStartChange(e) {
	if (!isStatementEntryMode.value) return
	filters.updatedDateStart = normalizeDateInput(e?.detail?.value)
	normalizeUpdatedDateRangeOrder()
	onSearch(true)
}

function onUpdatedDateEndChange(e) {
	if (!isStatementEntryMode.value) return
	filters.updatedDateEnd = normalizeDateInput(e?.detail?.value)
	normalizeUpdatedDateRangeOrder()
	onSearch(true)
}

function normalizeCashierDateRangeOrder() {
	if (!filters.cashierDateStart || !filters.cashierDateEnd) return
	if (filters.cashierDateStart <= filters.cashierDateEnd) return
	const from = filters.cashierDateStart
	filters.cashierDateStart = filters.cashierDateEnd
	filters.cashierDateEnd = from
	uni.showToast({ title: '已自动调整出纳日期范围', icon: 'none' })
}

function onCashierDateStartChange(e) {
	if (!isStatementEntryMode.value) return
	filters.cashierDateStart = normalizeDateInput(e?.detail?.value)
	normalizeCashierDateRangeOrder()
	onSearch(true)
}

function onCashierDateEndChange(e) {
	if (!isStatementEntryMode.value) return
	filters.cashierDateEnd = normalizeDateInput(e?.detail?.value)
	normalizeCashierDateRangeOrder()
	onSearch(true)
}

function todayYmd() {
	const now = new Date()
	const y = now.getFullYear()
	const m = String(now.getMonth() + 1).padStart(2, '0')
	const d = String(now.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function currentYearStartYmd() {
	const now = new Date()
	return `${now.getFullYear()}-01-01`
}

function resolveStatementExportPeriod() {
	const today = todayYmd()
	const cashierStart = normalizeDateInput(filters.cashierDateStart)
	const cashierEnd = normalizeDateInput(filters.cashierDateEnd)
	if (cashierStart || cashierEnd) {
		return {
			dateFrom: cashierStart || currentYearStartYmd(),
			dateTo: cashierEnd || today
		}
	}
	const updatedStart = normalizeDateInput(filters.updatedDateStart)
	const updatedEnd = normalizeDateInput(filters.updatedDateEnd)
	if (updatedStart || updatedEnd) {
		return {
			dateFrom: updatedStart || currentYearStartYmd(),
			dateTo: updatedEnd || today
		}
	}
	return {
		dateFrom: currentYearStartYmd(),
		dateTo: today
	}
}

async function fetchCustomerStatementSheetsForExport(rows = [], period = { dateFrom: '', dateTo: '' }) {
	const source = Array.isArray(rows) ? rows : []
	const statementSheets = []
	const statementSheetErrors = []
	for (const row of source) {
		const customerId = normalizeString(row?._id)
		if (!customerId) continue
		try {
			const res = await exportCustomerStatementV1({
				customerId,
				dateFrom: period.dateFrom,
				dateTo: period.dateTo
			})
			if (res?.code !== 0 || !res?.data) {
				statementSheetErrors.push({
					customer_id: customerId,
					customer_name: normalizeString(row?.name),
					msg: normalizeString(res?.msg) || '导出接口失败'
				})
				continue
			}
			statementSheets.push({
				customer: res.data.customer || { _id: customerId, name: normalizeString(row?.name) },
				period: res.data.period || { date_from: period.dateFrom, date_to: period.dateTo },
				opening_balance: res.data.opening_balance,
				opening_rounding: res.data.opening_rounding,
				rows: Array.isArray(res.data.rows) ? res.data.rows : [],
				totals: res.data.totals || {},
				closing_balance: res.data.closing_balance
			})
		} catch (err) {
			statementSheetErrors.push({
				customer_id: customerId,
				customer_name: normalizeString(row?.name),
				msg: normalizeString(err?.message) || '导出请求异常'
			})
		}
	}
	return { statementSheets, statementSheetErrors }
}

async function fetchCustomerAccountingLedgerSheetsForExport(rows = [], period = { dateFrom: '', dateTo: '' }) {
	const source = Array.isArray(rows) ? rows : []
	const ledgerSheets = []
	const ledgerSheetErrors = []
	for (const row of source) {
		const customerId = normalizeString(row?._id)
		if (!customerId) continue
		try {
			const res = await exportCustomerAccountingLedgerV1({
				customerId,
				dateFrom: period.dateFrom,
				dateTo: period.dateTo
			})
			if (res?.code !== 0 || !res?.data) {
				ledgerSheetErrors.push({
					customer_id: customerId,
					customer_name: normalizeString(row?.name),
					msg: normalizeString(res?.msg) || '会计导出接口失败'
				})
				continue
			}
			ledgerSheets.push(res.data)
		} catch (err) {
			ledgerSheetErrors.push({
				customer_id: customerId,
				customer_name: normalizeString(row?.name),
				msg: normalizeString(err?.message) || '会计导出请求异常'
			})
		}
	}
	return { ledgerSheets, ledgerSheetErrors }
}

function onKeywordInput(value) {
	if (searchTimer) clearTimeout(searchTimer)
	const keyword = String(value || '').trim()
	if (!keyword) {
		suggestions.value = []
		showSuggestions.value = false
		return
	}
	showSuggestions.value = true
	searchTimer = setTimeout(async () => {
		try {
			const res = await listCustomersV1({
				keyword,
				page: 1,
				pageSize: 8,
				settlementOnly: isStatementEntryMode.value
			})
			suggestions.value = res?.code === 0 ? res.data || [] : []
		} catch (err) {
			console.error(err)
		}
	}, 250)
}

function onKeywordFocus() {
	if (filters.keyword && suggestions.value.length) showSuggestions.value = true
}

function onKeywordBlur() {
	setTimeout(() => {
		showSuggestions.value = false
	}, 200)
}

function selectSuggestion(item) {
	filters.keyword = String(item?.name || '').trim()
	showSuggestions.value = false
	onSearch(true)
}

function onKeywordConfirm() {
	if (suggestions.value.length) {
		selectSuggestion(suggestions.value[0])
		return
	}
	onSearch(true)
}

function onAdd() {
	uni.navigateTo({ url: '/pages/customer/edit' })
}

function onEdit(item) {
	if (!item?._id) return
	uni.navigateTo({ url: `/pages/customer/edit?_id=${encodeURIComponent(item._id)}` })
}

function onStatement(item) {
	if (!item?._id) return
	if (!canViewStatement.value) {
		uni.showToast({ title: '当前账号没有客户对账权限', icon: 'none' })
		return
	}
	const statementCustomerId = String(item.effective_settlement_customer_id || item._id || '').trim()
	uni.navigateTo({ url: `/pages/customer/statement?_id=${encodeURIComponent(statementCustomerId)}` })
}

function customerStatusText(item) {
	if (item?.is_hidden === true) return '已隐藏'
	return item?.is_active === false ? '已停用' : '启用中'
}

function customerStatusKind(item) {
	if (item?.is_hidden === true) return 'danger'
	return item?.is_active === false ? 'danger' : 'success'
}

function customerIconClass(item) {
	if (item?.is_hidden === true) return 'bg-hidden'
	return item?.is_active === false ? 'bg-muted' : 'bg-customer'
}

function extractAffectedText(res) {
	const data = res?.data || {}
	const count = Number(data.affected_count || data.affected || 0)
	return count > 1 ? `，影响 ${count} 个客户` : ''
}

async function onHideCustomer(item) {
	if (!item?._id || !canManageHiddenCustomers.value) return
	const confirmed = await new Promise((resolve) => {
		uni.showModal({
			title: '隐藏客户',
			content: `隐藏后普通入口将不再显示「${item.name || '该客户'}」及相关业务数据。是否继续？`,
			confirmText: '隐藏',
			cancelText: '取消',
			success: (res) => resolve(Boolean(res.confirm)),
			fail: () => resolve(false)
		})
	})
	if (!confirmed) return
	const res = await hideCustomerV1({ customer_id: item._id })
	if (res?.code !== 0) {
		uni.showToast({ title: res?.msg || '隐藏失败', icon: 'none' })
		return
	}
	uni.showToast({ title: `已隐藏${extractAffectedText(res)}`, icon: 'success' })
	await onSearch(true, { force: true })
}

async function onUnhideCustomer(item) {
	if (!item?._id || !canManageHiddenCustomers.value) return
	const confirmed = await new Promise((resolve) => {
		uni.showModal({
			title: '恢复客户',
			content: `恢复后「${item.name || '该客户'}」会重新出现在普通入口，子客户不会自动恢复。是否继续？`,
			confirmText: '恢复',
			cancelText: '取消',
			success: (res) => resolve(Boolean(res.confirm)),
			fail: () => resolve(false)
		})
	})
	if (!confirmed) return
	const res = await unhideCustomerV1({ customer_id: item._id })
	if (res?.code !== 0) {
		uni.showToast({ title: res?.msg || '恢复失败', icon: 'none' })
		return
	}
	uni.showToast({ title: '已恢复', icon: 'success' })
	await onSearch(true, { force: true })
}

function onPrimaryAction(item) {
	if (isStatementEntryMode.value) {
		onStatement(item)
		return
	}
	onEdit(item)
}

function onPrevPage() {
	if (pager.page <= 1) return
	pager.page -= 1
	onSearch()
}

function onNextPage() {
	if (!pager.hasMore) return
	pager.page += 1
	onSearch()
}

onMounted(() => {
	onSearch()
})

onUnmounted(() => {
	if (searchTimer) clearTimeout(searchTimer)
})

defineExpose({
	refresh: onSearch
})
</script>

<style scoped>
.list-shell {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.summary-row {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220rpx, 1fr));
	gap: 16rpx;
	width: 100%;
}

:deep(.summary-card .stat__content) {
	align-items: center;
	gap: 16rpx;
}

:deep(.summary-card .stat__value-wrap) {
	align-items: flex-start;
}

:deep(.summary-card .stat__value) {
	text-align: left;
	font-size: 24px;
}

:deep(.summary-card .stat__icon) {
	margin-left: 12rpx;
}

.filter-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

:deep(.section) {
	overflow: visible;
}

:deep(.section__body) {
	overflow: visible;
}

.search-field {
	position: relative;
	z-index: 20;
}

.suggestions {
	position: absolute;
	left: 0;
	right: 0;
	top: calc(100% + 8rpx);
	z-index: 20;
	background: #fff;
	border: 1rpx solid #dbeafe;
	border-radius: 20rpx;
	box-shadow: 0 10rpx 30rpx rgba(15, 23, 42, 0.08);
	overflow: hidden;
}

.suggestion-item {
	padding: 16rpx 20rpx;
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	border-bottom: 1rpx solid #eef2ff;
	background: #fff;
}

.suggestion-item:last-child {
	border-bottom: none;
}

.suggestion-text {
	font-size: 28rpx;
	font-weight: 600;
	color: #0f172a;
}

.suggestion-sub {
	font-size: 22rpx;
	color: #64748b;
}

.customer-heading {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
}

.customer-heading__title {
	font-size: 28rpx;
	font-weight: 700;
	color: #0f172a;
	line-height: 1.4;
}

.customer-heading__contact {
	font-size: 24rpx;
	color: #64748b;
}

.customer-heading__price {
	font-size: 22rpx;
	color: #2563eb;
	font-weight: 600;
}

.customer-heading__deposit {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	margin-top: 4rpx;
}

.customer-heading__deposit-count {
	font-size: 22rpx;
	font-weight: 600;
	color: #1d4ed8;
}

.customer-heading__deposit-nos,
.customer-heading__deposit-empty {
	font-size: 22rpx;
	line-height: 1.5;
	color: #475569;
	word-break: break-all;
}

.customer-heading__deposit-empty {
	color: #94a3b8;
}

.customer-heading__deposit-locations {
	font-size: 22rpx;
	line-height: 1.5;
	color: #0f766e;
	font-weight: 700;
	word-break: break-all;
}

.filter-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	margin-top: 16rpx;
}

.filter-chip {
	display: inline-flex;
	align-items: center;
	gap: 8rpx;
	padding: 6rpx 14rpx;
	border-radius: 999rpx;
	background: #f1f5f9;
	color: #475569;
	font-size: 22rpx;
}

.filter-chip__close {
	font-size: 24rpx;
	color: #94a3b8;
}

.section-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.pager-row {
	margin-top: 12rpx;
	display: flex;
	justify-content: flex-end;
	gap: 12rpx;
}

.info-box {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 4rpx;
}

.info-label {
	font-size: 20rpx;
	color: var(--crm-text-muted);
}

.price-box {
	display: flex;
	align-items: baseline;
	gap: 6rpx;
}

.price-symbol {
	font-size: 22rpx;
	color: var(--crm-text);
	font-weight: 600;
}

.price-value {
	font-size: 36rpx;
	font-weight: 800;
	color: var(--crm-text);
}

.price-value--danger {
	color: #b91c1c;
}

.price-value--success {
	color: #166534;
}

.price-value--neutral {
	color: var(--crm-text);
}

.balance-hint {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: 6rpx 18rpx;
	max-width: 720rpx;
	margin-top: 36rpx;
	font-size: 30rpx;
	font-weight: 650;
	text-align: right;
	color: var(--crm-text);
}

.balance-hint__item {
	color: inherit;
}

.balance-hint__item--danger {
	color: #b91c1c;
	font-weight: 800;
}

.price-unit {
	font-size: 20rpx;
	color: var(--crm-text-muted);
}

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.mode-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	background: #f1f5f9;
	padding: 4rpx 12rpx;
	border-radius: 8rpx;
}

.footer-btns {
	display: flex;
	gap: 12rpx;
}

.bg-customer {
	background: var(--crm-action-customer);
}

.bg-muted {
	background: #94a3b8;
}

.bg-hidden {
	background: #dc2626;
}

@media (max-width: 680px) {
	.summary-row {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

@media (max-width: 420px) {
	.summary-row {
		grid-template-columns: 1fr;
	}
}
</style>
