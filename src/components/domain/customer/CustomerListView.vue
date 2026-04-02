<template>
	<AppPage :title="pageTitle" :subtitle="subtitle" icon="user">
		<template #headerActions>
			<AppButton v-if="canCreateCustomer" size="sm" kind="primary" icon="plus" @click="onAdd">新增客户</AppButton>
			<AppButton size="sm" kind="neutral" icon="document" :loading="exporting" :disabled="loading" @click="onExport">导出</AppButton>
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
							placeholder="客户名/联系人/电话"
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
								<text class="suggestion-sub">{{ [item.contact, item.phone].filter(Boolean).join(' · ') }}</text>
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
						:status="item.is_active ? '启用中' : '已停用'"
						:status-kind="item.is_active ? 'success' : 'danger'"
						icon="user"
						:icon-class="item.is_active ? 'bg-customer' : 'bg-muted'"
						clickable
						@click="onPrimaryAction(item)"
					>
						<template #header>
							<view class="customer-heading">
								<text class="customer-heading__title">{{ item.name }}</text>
								<text class="customer-heading__contact">{{ item.contact || '暂无联系人' }}</text>
								<view class="customer-heading__deposit">
									<text class="customer-heading__deposit-count">存瓶 {{ Number(item.deposit_count || 0) }}</text>
									<text v-if="item.deposit_bottle_nos?.length" class="customer-heading__deposit-nos">{{ item.deposit_bottle_nos.join('、') }}</text>
									<text v-else class="customer-heading__deposit-empty">暂无存瓶</text>
								</view>
							</view>
						</template>
						<template #right>
							<view class="info-box">
								<text class="info-label">应收欠款</text>
								<view class="price-box">
									<text class="price-symbol">¥</text>
									<text class="price-value" :class="balanceValueClass(item)">{{ formatMoney(item.net_balance) }}</text>
								</view>
								<text class="balance-hint">应收 {{ formatMoney(item.receivable_balance) }} / 预付 {{ formatMoney(item.prepay_balance) }}</text>
							</view>
						</template>
						
						<template #meta>
							<view class="meta-tags">
								<AppTag v-if="item.phone" kind="soft" class="tag-item">
									<AppIcon name="calendar" size="24rpx" style="margin-right: 4rpx;" />
									{{ item.phone }}
								</AppTag>
								<AppTag kind="soft" class="tag-item">{{ item.default_price_unit || 'kg' }}</AppTag>
								<AppTag kind="soft" class="tag-item">应收 {{ formatMoney(item.receivable_balance) }}</AppTag>
								<AppTag kind="soft" class="tag-item">预付 {{ formatMoney(item.prepay_balance) }}</AppTag>
								<text v-if="item.short_name" class="mode-label">{{ item.short_name }}</text>
							</view>
						</template>
						
						<template #footer>
							<view class="footer-btns">
								<AppButton v-if="canViewStatement" kind="outline" size="sm" @click.stop="onStatement(item)">客户对账</AppButton>
								<AppButton v-if="canUpdateCustomer" kind="ghost" size="sm" @click.stop="onEdit(item)">编辑档案</AppButton>
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
import { listCustomersV1 } from '@/services/customer'
import { downloadWorkbookFile } from '@/components/domain/customer/statement/exportWorkbook'
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
	balanceIndex: 0,
	updatedDateStart: '',
	updatedDateEnd: ''
})
const showSuggestions = ref(false)
const suggestions = ref([])
const exporting = ref(false)
let searchTimer = null

const activeOptions = [
	{ label: '全部状态', value: 'all' },
	{ label: '启用中', value: 'true' },
	{ label: '已停用', value: 'false' }
]

const balanceOptions = [
	{ label: '全部余额', value: 'all' },
	{ label: '应收欠款', value: 'receivable' },
	{ label: '预付余额', value: 'prepay' },
	{ label: '已结清', value: 'settled' }
]

const { canPageAction, canViewPage } = useAuthGuard()
const canCreateCustomer = computed(() => canPageAction('/pages/customer/edit', 'create'))
const canUpdateCustomer = computed(() => canPageAction('/pages/customer/edit', 'update'))
const canViewStatement = computed(() => canViewPage('/pages/customer/statement'))
const normalizedEntryMode = computed(() => (props.entryMode === 'statement' ? 'statement' : 'default'))
const isStatementEntryMode = computed(() => normalizedEntryMode.value === 'statement')

const pageTitle = computed(() => (isStatementEntryMode.value ? '客户对账' : '客户档案'))

const activeLabel = computed(() => {
	return activeOptions[filters.activeIndex]?.label || '全部状态'
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
	if (isStatementEntryMode.value && filters.balanceIndex > 0) chips.push({ key: 'balance', label: `余额: ${balanceLabel.value}` })
	if (isStatementEntryMode.value && (filters.updatedDateStart || filters.updatedDateEnd)) {
		chips.push({ key: 'updatedDateRange', label: `时间: ${updatedDateRangeLabel.value}` })
	}
	return chips
})

function clearFilterChip(key) {
	if (key === 'keyword') filters.keyword = ''
	if (key === 'active') filters.activeIndex = 0
	if (key === 'balance') filters.balanceIndex = 0
	if (key === 'updatedDateRange') {
		filters.updatedDateStart = ''
		filters.updatedDateEnd = ''
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

function toNumber(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function formatMoney(value) {
	return toNumber(value, 0).toFixed(2)
}

function buildListParams(page = 1, pageSize = 50) {
	return {
		keyword: filters.keyword,
		is_active: buildIsActiveParam(),
		balance_type: buildBalanceTypeParam(),
		updated_date_start: isStatementEntryMode.value ? filters.updatedDateStart : '',
		updated_date_end: isStatementEntryMode.value ? filters.updatedDateEnd : '',
		page,
		pageSize,
		summaryIgnoreActive: true
	}
}

function balanceValueClass(item) {
	const net = toNumber(item?.net_balance, 0)
	if (net > 0.009) return 'price-value--danger'
	if (net < -0.009) return 'price-value--success'
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
			`customer:list:${normalizedEntryMode.value}:${filters.keyword}:${filters.activeIndex}:${filters.balanceIndex}:${filters.updatedDateStart}:${filters.updatedDateEnd}:${pager.page}:${pager.pageSize}`
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

async function onSearch(resetPage = false) {
	if (resetPage) pager.page = 1
	const data = await fetchList()
	applyResult(data)
}

async function fetchAllRowsForExport() {
	const rows = []
	let page = 1
	let hasMore = true
	let guard = 0
	while (hasMore) {
		if (guard > 500) throw new Error('导出分页异常，请缩小筛选后重试')
		const res = await listCustomersV1(buildListParams(page, 50))
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
		const workbookText = buildCustomerListWorkbookXml({
			rows,
			filters: {
				keyword: filters.keyword,
				activeLabel: activeLabel.value,
				balanceLabel: balanceLabel.value,
				updatedDateStart: filters.updatedDateStart,
				updatedDateEnd: filters.updatedDateEnd,
				updatedDateRangeLabel: updatedDateRangeLabel.value
			}
		})
		const fileName = buildCustomerListExportFileName({
			filters: {
				keyword: filters.keyword,
				activeLabel: activeLabel.value,
				balanceLabel: balanceLabel.value,
				updatedDateStart: filters.updatedDateStart,
				updatedDateEnd: filters.updatedDateEnd,
				updatedDateRangeLabel: updatedDateRangeLabel.value
			}
		})
		const downloaded = await downloadWorkbookFile(workbookText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持导出，请联系管理员', icon: 'none', duration: 2800 })
			return
		}
		uni.showToast({ title: `已导出${rows.length}条`, icon: 'success' })
	} catch (err) {
		uni.showToast({ title: err?.message || '导出失败', icon: 'none', duration: 2800 })
	} finally {
		uni.hideLoading()
		exporting.value = false
	}
}

function onReset() {
	filters.keyword = ''
	filters.activeIndex = 0
	filters.balanceIndex = 0
	filters.updatedDateStart = ''
	filters.updatedDateEnd = ''
	suggestions.value = []
	showSuggestions.value = false
	onSearch(true)
}

function onActiveChange(e) {
	const idx = Number(e?.detail?.value)
	filters.activeIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onBalanceChange(e) {
	if (!isStatementEntryMode.value) return
	const idx = Number(e?.detail?.value)
	filters.balanceIndex = Number.isFinite(idx) ? idx : 0
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
			const res = await listCustomersV1({ keyword, page: 1, pageSize: 8 })
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
	uni.navigateTo({ url: `/pages/customer/statement?_id=${encodeURIComponent(item._id)}` })
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
	font-size: 20rpx;
	color: var(--crm-text-muted);
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
