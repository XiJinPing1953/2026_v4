<template>
	<AppPage title="流转异常" subtitle="扫描并处理瓶子流转异常" icon="alert">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard
					class="summary-card"
					label="待处理"
					:value="summary.open"
					hint="条"
					icon="alert"
					@click="onSummaryFilter('open')"
				/>
				<AppStatCard
					class="summary-card"
					label="已修复"
					:value="summary.resolved"
					hint="条"
					icon="check-circle"
					@click="onSummaryFilter('resolved')"
				/>
				<AppStatCard
					class="summary-card"
					label="全部异常"
					:value="summary.total"
					hint="条"
					icon="list"
					@click="onSummaryFilter('all')"
				/>
			</view>
		</template>

		<view class="view-body">
			<AppSection title="扫描检测">
				<view class="scan-card">
					<AppInput v-model="scanBottleNo" placeholder="输入或扫描瓶号" prefix-icon="search" size="sm" class="scan-input" />
					<view class="scan-actions">
						<AppButton size="sm" :loading="scanning" @click="onScan">开始扫描</AppButton>
						<AppButton v-if="isSuperAdmin" size="sm" kind="outline" :loading="rebuilding" @click="onRebuild">
							全量扫描异常
						</AppButton>
					</view>
				</view>
			</AppSection>

			<AppSection title="异常筛选">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>
				<view class="filter-grid">
					<AppInput v-model="filters.bottleNo" label="瓶号" placeholder="搜索瓶号" size="sm" />
					<picker class="picker-block" mode="selector" :range="statusOptions" range-key="label" @change="onStatusChange">
						<AppInput :model-value="statusLabel" label="状态" disabled size="sm" />
					</picker>
				</view>
			</AppSection>

			<AppSection title="异常列表">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>
				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无异常记录">
					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.bottle_no + ' (' + item.anomaly_type + ')'"
						:subtitle="item.date + ' • ' + (item.note || '无备注')"
						:status="item.status === 'resolved' ? '已修复' : '待处理'"
						:status-kind="item.status === 'resolved' ? 'success' : 'danger'"
						icon="alert"
						:icon-class="item.status === 'resolved' ? 'bg-success' : 'bg-danger'"
					>
						<template #footer>
							<AppButton
								v-if="item.status === 'open'"
								size="sm"
								:loading="resolvingId === item._id"
								@click="onResolve(item)"
							>
								修复
							</AppButton>
						</template>
					</AppListItem>
				</AppList>
				<view v-if="pager.total > 0" class="pager-row">
					<AppButton size="sm" kind="neutral" :disabled="loading || pager.page <= 1" @click="onPrevPage">
						上一页
					</AppButton>
					<AppButton size="sm" kind="neutral" :disabled="loading || !pager.hasMore" @click="onNextPage">
						下一页
					</AppButton>
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
import { useQuery } from '@/composables/useQuery'
import {
	listBottleAnomaliesV1,
	scanBottleAnomaliesSafeV2,
	rebuildBottleAnomaliesSafeV2,
	resolveBottleAnomalyV1
} from '@/services/bottleAnomaly'
import { getUser } from '@/services/auth'

const scanBottleNo = ref('')
const scanning = ref(false)
const rebuilding = ref(false)
const resolvingId = ref('')
const list = ref([])
const summary = ref({ total: 0, open: 0, resolved: 0 })
const currentUser = ref(getUser() || null)
const pager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})

const statusOptions = [
	{ label: '全部', value: '' },
	{ label: '待处理', value: 'open' },
	{ label: '已修复', value: 'resolved' }
]
const statusIndex = ref(1)
const statusLabel = computed(() => statusOptions[statusIndex.value]?.label || '全部')

const filters = reactive({
	bottleNo: '',
	status: 'open'
})
const totalPages = computed(() => {
	const pages = Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 50))
	return pages > 0 ? pages : 1
})

const isSuperAdmin = computed(() => normalizeRole(currentUser.value?.role) === 'superadmin')

function normalizeRole(value) {
	if (value == null) return ''
	return String(value).trim().toLowerCase()
}

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listBottleAnomaliesV1({
			bottleNo: filters.bottleNo,
			status: filters.status,
			page: pager.page,
			pageSize: pager.pageSize,
			summaryIgnoreStatus: true
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: { total: 0, open: 0, resolved: 0 }
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
			summary: res.summary || { total: 0, open: 0, resolved: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 50, total: 0, hasMore: false },
			summary: { total: 0, open: 0, resolved: 0 }
		}
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
		open: Number(summaryData.open || 0),
		resolved: Number(summaryData.resolved || 0)
	}
}

async function onSearch(resetPage = false) {
	if (resetPage) pager.page = 1
	const data = await fetchList()
	applyResult(data)
}

function onReset() {
	filters.bottleNo = ''
	statusIndex.value = 1
	filters.status = 'open'
	onSearch(true)
}

function onStatusChange(e) {
	const idx = Number(e?.detail?.value)
	statusIndex.value = Number.isFinite(idx) ? idx : 0
	filters.status = statusOptions[statusIndex.value]?.value || ''
	onSearch(true)
}

function onSummaryFilter(type) {
	if (type === 'open') {
		statusIndex.value = 1
		filters.status = 'open'
	} else if (type === 'resolved') {
		statusIndex.value = 2
		filters.status = 'resolved'
	} else {
		statusIndex.value = 0
		filters.status = ''
	}
	onSearch(true)
}

async function onScan() {
	if (scanning.value) return
	scanning.value = true
	try {
		const bottleNo = String(scanBottleNo.value || '').trim()
		if (!bottleNo) {
			uni.showToast({ title: '请输入瓶号', icon: 'none' })
			return
		}
		const res = await scanBottleAnomaliesSafeV2({
			bottleNo,
			reconcileAnomalies: true,
			reconcileTypes: ['missing_back', 'missing_fill', 'continuous_out'],
			maxRounds: 12
		})
		if (res?.code === 0) {
			const created = Number(res.data?.created || 0)
			const resolvedStale = Number(res.data?.resolved_stale || 0)
			const done = Boolean(res.data?.done)
			const rounds = Number(res.data?.rounds || 0)
			uni.showToast({
				title: done
					? `扫描完成，新增 ${created} 条，自动关闭 ${resolvedStale} 条`
					: `已扫描 ${rounds} 轮，新增 ${created} 条，自动关闭 ${resolvedStale} 条`,
				icon: 'none'
			})
			onSearch(true)
		} else {
			uni.showToast({ title: res?.msg || '扫描失败', icon: 'none' })
		}
	} finally {
		scanning.value = false
	}
}

async function onRebuild() {
	if (!isSuperAdmin.value || rebuilding.value) return
	const confirmRes = await uni.showModal({
		title: '全量扫描异常',
		content: '将按多轮安全方式重建异常。是否立即开始？',
		showCancel: true
	})
	if (!confirmRes.confirm) return

	rebuilding.value = true
	try {
		const res = await rebuildBottleAnomaliesSafeV2({
			maxRounds: 20,
			batchBottlesPerRound: 25,
			maxMsPerRound: 2800,
			maxEventsPerRound: 900,
			maxWritesPerRound: 220,
			batchSize: 180
		})
		if (res?.code === 0) {
			const rounds = Number(res.data?.rounds || 0)
			const bottles = Number(res.data?.bottles || 0)
			const created = Number(res.data?.created || 0)
			const resolvedStale = Number(res.data?.resolved_stale || 0)
			const done = Boolean(res.data?.done)
			uni.showToast({
				title: done
					? `全量扫描完成：${bottles}瓶，新增${created}，自动关闭${resolvedStale}`
					: `已扫描${rounds}轮/${bottles}瓶，新增${created}，自动关闭${resolvedStale}`,
				icon: 'none'
			})
			onSearch(true)
		} else {
			uni.showToast({ title: res?.msg || '全量扫描失败', icon: 'none' })
		}
	} finally {
		rebuilding.value = false
	}
}

async function onResolve(item) {
	if (resolvingId.value) return

	if (item.anomaly_type === 'missing_fill') {
		const res = await uni.showModal({
			title: '修复缺灌装',
			content: '将按±10kg规则修复：仅非增重场景可直接修复并记损耗；增重需先补灌装。确认执行？',
			showCancel: true
		})
		if (!res.confirm) return
	} else {
		const res = await uni.showModal({
			title: '标记修复',
			content: '确认标记为已修复？',
			showCancel: true
		})
		if (!res.confirm) return
	}

	resolvingId.value = item._id
	try {
		const res = await resolveBottleAnomalyV1(item._id)
		if (res?.code === 0) {
			uni.showToast({ title: '已修复', icon: 'success' })
			onSearch()
		} else {
			uni.showToast({ title: res?.msg || '修复失败', icon: 'none' })
		}
	} finally {
		resolvingId.value = ''
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
	onSearch()
})
</script>

<style scoped>
.view-body {
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

.scan-card {
	background: #ffffff;
	border-radius: var(--crm-radius-sm);
	padding: 20rpx;
	border: 1rpx solid var(--crm-border);
	display: flex;
	gap: 16rpx;
	align-items: center;
}

.scan-input {
	flex: 1;
}

.scan-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.filter-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
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
