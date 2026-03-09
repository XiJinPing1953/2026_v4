<template>
	<AppPage title="追款任务" :subtitle="subtitle" icon="credit-card">
		<template #headerActions>
			<AppButton size="sm" kind="primary" :loading="creating" :disabled="creating" @click="onAutoCreate">
				生成任务
			</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading || loadingUsers" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="任务数" :value="summary.total" hint="条" icon="list" />
				<AppStatCard class="summary-card" label="待跟进" :value="summary.open" hint="条" icon="alert" />
				<AppStatCard class="summary-card" label="承诺回款" :value="summary.promised" hint="条" icon="check-circle" />
				<AppStatCard class="summary-card" label="未收金额" :value="summary.unpaid" hint="元" icon="wallet" />
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="筛选条件">
				<template #actions>
					<AppButton size="sm" kind="neutral" :loading="loadingUsers" :disabled="loadingUsers" @click="onSearchOwners">搜人</AppButton>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput v-model="filters.keyword" label="关键字" placeholder="客户/负责人/备注" size="sm" />
					<picker class="picker-block" mode="selector" :range="statusOptions" range-key="label" @change="onStatusChange">
						<view class="picker-trigger">
							<AppInput :model-value="statusLabel" label="任务状态" disabled size="sm" />
						</view>
					</picker>
					<AppInput
						v-model="ownerKeyword"
						label="负责人搜索"
						placeholder="姓名/账号（回车刷新）"
						size="sm"
						confirm-type="search"
						@confirm="onSearchOwners"
					/>
					<picker class="picker-block" mode="selector" :range="ownerOptions" range-key="label" @change="onOwnerChange">
						<view class="picker-trigger">
							<AppInput :model-value="ownerLabel" label="负责人" disabled size="sm" />
						</view>
					</picker>
					<AppInput v-model="filters.minUnpaid" label="最低欠款" placeholder="金额" size="sm" />
					<picker class="picker-block" mode="date" :value="filters.dateStart" @change="onDateStartChange">
						<view class="picker-trigger">
							<AppInput :model-value="filters.dateStart" label="开始日期" placeholder="YYYY-MM-DD" disabled size="sm" />
						</view>
					</picker>
					<picker class="picker-block" mode="date" :value="filters.dateEnd" @change="onDateEndChange">
						<view class="picker-trigger">
							<AppInput :model-value="filters.dateEnd" label="结束日期" placeholder="YYYY-MM-DD" disabled size="sm" />
						</view>
					</picker>
				</view>
			</AppSection>

			<AppSection title="任务列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无追款任务">
					<template #emptyAction>
						<AppButton size="sm" :loading="creating" :disabled="creating" @click="onAutoCreate">
							生成任务
						</AppButton>
					</template>

					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.customer_name"
						:subtitle="rangeText(item)"
						:status="statusText(item.status)"
						:status-kind="statusKind(item.status)"
						icon="credit-card"
						icon-class="bg-warning"
						clickable
						@click="onOpenTask(item)"
					>
						<template #meta>
							<view class="meta-tags">
								<AppTag kind="soft">{{ priorityText(item.priority) }}</AppTag>
								<text class="meta-text">未收 {{ formatMoney(item.amount_unpaid) }}</text>
								<text class="meta-text">负责人 {{ item.owner_name || '未分配' }}</text>
								<text v-if="item.next_followup_at" class="meta-text">
									下次跟进 {{ formatDate(item.next_followup_at) }}
								</text>
							</view>
						</template>
						<template #footer>
							<view class="footer-row">
								<text class="footer-text">
									应收 {{ formatMoney(item.amount_should) }} · 已收 {{ formatMoney(item.amount_received) }}
								</text>
								<text v-if="item.latest_note" class="footer-note">备注：{{ item.latest_note }}</text>
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
import { computed, onMounted, reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import AppTag from '@/components/base/AppTag.vue'
import { useQuery } from '@/composables/useQuery'
import { autoCreateCollectionTasksV1, listCollectionTasksV1 } from '@/services/collection'
import { searchUsersV1 } from '@/services/user'

const list = ref([])
const summary = ref({ total: 0, open: 0, promised: 0, unpaid: '0.00' })
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})
const users = ref([])
const creating = ref(false)
const ownerKeyword = ref('')

const filters = reactive({
	keyword: '',
	statusIndex: 0,
	ownerIndex: 0,
	minUnpaid: '',
	dateStart: '',
	dateEnd: ''
})

const statusOptions = [
	{ label: '全部状态', value: '' },
	{ label: '待跟进', value: 'open' },
	{ label: '跟进中', value: 'in_progress' },
	{ label: '承诺回款', value: 'promised' },
	{ label: '部分回款', value: 'partial_paid' },
	{ label: '已结清', value: 'paid' },
	{ label: '暂停', value: 'paused' },
	{ label: '已关闭', value: 'closed' }
]

const statusLabel = computed(() => statusOptions[filters.statusIndex]?.label || '全部状态')
const ownerOptions = computed(() => {
	const options = [{ label: '全部负责人', value: '' }]
	for (const user of users.value || []) {
		const id = normalizeId(user?._id || user?.id)
		if (!id) continue
		const name = normalizeString(user?.name || user?.username || '') || '未命名用户'
		const role = normalizeString(user?.role || '')
		const label = role ? `${name}（${role}）` : name
		options.push({ label, value: id, name })
	}
	return options
})
const ownerLabel = computed(() => ownerOptions.value[filters.ownerIndex]?.label || '全部负责人')

const subtitle = computed(() => {
	if (!pager.total) return '应收任务与跟进闭环'
	return `当前 ${pager.total} 条任务`
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listCollectionTasksV1({
			keyword: filters.keyword,
			status: statusOptions[filters.statusIndex]?.value || '',
			ownerId: ownerOptions.value[filters.ownerIndex]?.value || '',
			minUnpaid: filters.minUnpaid,
			dateFrom: filters.dateStart,
			dateTo: filters.dateEnd,
			page: pager.page,
			pageSize: pager.pageSize
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: { total: 0, open: 0, promised: 0, unpaid: 0 }
			}
		}
		return {
			items: Array.isArray(res.data) ? res.data : [],
			paging: res.paging || {
				page: pager.page,
				pageSize: pager.pageSize,
				total: Number(res.total || 0),
				hasMore: false
			},
			summary: res.summary || { total: 0, open: 0, promised: 0, unpaid: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, open: 0, promised: 0, unpaid: 0 }
		},
		cacheTTL: 8000,
		throttleMs: 300,
		cacheKey: () => `collection:tasks:${filters.keyword}:${filters.statusIndex}:${filters.ownerIndex}:${filters.minUnpaid}:${filters.dateStart}:${filters.dateEnd}:${pager.page}:${pager.pageSize}`
	}
)

const { loading: loadingUsers, run: fetchUsers } = useQuery(
	async () => {
		const res = await searchUsersV1({ keyword: ownerKeyword.value, limit: 50 })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '加载负责人失败', icon: 'none' })
			return []
		}
		return Array.isArray(res.data) ? res.data : []
	},
	{
		immediate: false,
		initialData: [],
		cacheTTL: 30000,
		throttleMs: 300,
		cacheKey: () => `collection:owner-users:${ownerKeyword.value}`
	}
)

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeId(value) {
	if (value == null) return ''
	if (typeof value === 'object' && value.$oid) return String(value.$oid).trim()
	return String(value).trim()
}

function initDateRange() {
	const end = new Date()
	const start = new Date()
	start.setMonth(start.getMonth() - 1)
	const fmt = (d) => {
		const y = d.getFullYear()
		const m = String(d.getMonth() + 1).padStart(2, '0')
		const day = String(d.getDate()).padStart(2, '0')
		return `${y}-${m}-${day}`
	}
	filters.dateStart = fmt(start)
	filters.dateEnd = fmt(end)
}

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
		open: Number(summaryData.open || 0),
		promised: Number(summaryData.promised || 0),
		unpaid: Number(summaryData.unpaid || 0).toFixed(2)
	}
}

async function onSearch(resetPage = false) {
	if (resetPage) pager.page = 1
	const data = await fetchList()
	applyResult(data)
}

function onReset() {
	filters.keyword = ''
	filters.statusIndex = 0
	filters.ownerIndex = 0
	filters.minUnpaid = ''
	ownerKeyword.value = ''
	initDateRange()
	onSearchOwners()
	onSearch(true)
}

function onStatusChange(e) {
	const idx = Number(e?.detail?.value)
	filters.statusIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onOwnerChange(e) {
	const idx = Number(e?.detail?.value)
	filters.ownerIndex = Number.isFinite(idx) ? idx : 0
	onSearch(true)
}

function onDateStartChange(e) {
	filters.dateStart = e?.detail?.value || ''
}

function onDateEndChange(e) {
	filters.dateEnd = e?.detail?.value || ''
}

function formatMoney(value) {
	const num = Number(value || 0)
	return Number.isFinite(num) ? num.toFixed(2) : '0.00'
}

function formatDate(timestamp) {
	const time = Number(timestamp)
	if (!Number.isFinite(time) || time <= 0) return '-'
	const d = new Date(time)
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}-${m}-${day}`
}

function rangeText(item) {
	const from = item?.date_from || '-'
	const to = item?.date_to || '-'
	return `${from} ~ ${to}`
}

function statusText(status) {
	const map = {
		open: '待跟进',
		in_progress: '跟进中',
		promised: '承诺回款',
		partial_paid: '部分回款',
		paid: '已结清',
		paused: '暂停',
		closed: '已关闭'
	}
	return map[status] || '待跟进'
}

function statusKind(status) {
	const map = {
		open: 'warning',
		in_progress: 'info',
		promised: 'warning',
		partial_paid: 'warning',
		paid: 'success',
		paused: 'danger',
		closed: 'soft'
	}
	return map[status] || 'info'
}

function priorityText(value) {
	if (value === 'P0') return '高优先'
	if (value === 'P2') return '低优先'
	return '常规'
}

function onOpenTask(item) {
	if (!item?._id) return
	uni.navigateTo({ url: `/pages/collection/task-detail?_id=${encodeURIComponent(item._id)}` })
}

async function onSearchOwners() {
	const currentOwnerId = ownerOptions.value[filters.ownerIndex]?.value || ''
	const data = await fetchUsers()
	users.value = data || []
	const idx = ownerOptions.value.findIndex((item) => item.value === currentOwnerId)
	filters.ownerIndex = idx >= 0 ? idx : 0
}

async function onAutoCreate() {
	if (!filters.dateStart || !filters.dateEnd) {
		uni.showToast({ title: '请先选择日期范围', icon: 'none' })
		return
	}
	if (creating.value) return
	creating.value = true
	try {
		const res = await autoCreateCollectionTasksV1({
			dateFrom: filters.dateStart,
			dateTo: filters.dateEnd,
			minUnpaid: filters.minUnpaid
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '生成失败', icon: 'none' })
			return
		}
		const created = res?.data?.created ?? 0
		const updated = res?.data?.updated ?? 0
		uni.showToast({ title: `已生成 ${created} 条，更新 ${updated} 条`, icon: 'success' })
		await onSearch(true)
	} finally {
		creating.value = false
	}
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
	initDateRange()
	onSearchOwners()
	onSearch()
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

.picker-block {
	display: block;
	width: 100%;
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

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.meta-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.footer-row {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	align-items: flex-end;
}

.footer-text {
	font-size: 22rpx;
	color: var(--crm-text);
}

.footer-note {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.picker-trigger {
	pointer-events: none;
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
