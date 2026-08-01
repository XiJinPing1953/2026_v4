<template>
	<AppPage title="操作日志" :subtitle="subtitle" icon="list">
		<template #headerActions>
			<AppButton v-if="authorized" size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template v-if="authorized" #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="日志条数" :value="summary.total" hint="条" icon="list" />
				<AppStatCard class="summary-card" label="当前页写操作" :value="summary.writeOps" hint="条" icon="document" />
				<AppStatCard class="summary-card" label="当前页拒绝" :value="summary.forbidden" hint="条" icon="alert" />
				<AppStatCard class="summary-card" label="当前页管理角色" :value="summary.adminOps" hint="条" icon="user" />
			</view>
		</template>

		<view class="list-shell">
			<AppSection v-if="authorized" title="筛选条件">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput
						v-model="filters.keyword"
						label="关键字"
						placeholder="用户/动作编码/request_id"
						size="sm"
						confirm-type="search"
						@confirm="onSearch"
					/>
					<AppInput
						v-model="filters.action"
						label="动作编码（高级）"
						placeholder="可留空，按中文动作优先浏览"
						size="sm"
						confirm-type="search"
						@confirm="onSearch"
					/>
					<picker
						class="picker-block"
						mode="selector"
						:range="categoryOptions"
						range-key="label"
						@change="onCategoryChange"
					>
						<view class="picker-trigger">
							<AppInput :model-value="categoryLabel" label="动作分类" disabled size="sm" />
						</view>
					</picker>
					<picker class="picker-block" mode="selector" :range="roleOptions" range-key="label" @change="onRoleChange">
						<view class="picker-trigger">
							<AppInput :model-value="roleLabel" label="角色" disabled size="sm" />
						</view>
					</picker>
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

			<AppSection v-if="authorized" title="日志列表">
				<template #actions>
					<text class="section-hint">共 {{ paging.total }} 条</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无日志">
					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="actionTitle(item.action)"
						:subtitle="`${item.username || '系统'} · ${roleText(item.role)}`"
						:status="formatDateTime(item.created_at)"
						:status-kind="statusKind(item.action)"
						icon="document"
						:icon-class="iconClass(item.action)"
						clickable
						@click="openDetail(item)"
					>
						<template #meta>
							<view class="meta-tags">
								<AppTag kind="soft">{{ actionCategoryText(item.action) }}</AppTag>
								<text v-if="item.request_id" class="meta-text">请求: {{ item.request_id }}</text>
							</view>
						</template>
						<template #footer>
							<text class="footer-text">{{ businessSummary(item) }}</text>
						</template>
					</AppListItem>
				</AppList>

				<view v-if="list.length > 0" class="pager">
					<AppButton size="sm" kind="neutral" :disabled="loading || paging.page <= 1" @click="onPrevPage">上一页</AppButton>
					<text class="pager-text">第 {{ paging.page }} / {{ totalPages }} 页</text>
					<AppButton size="sm" kind="neutral" :disabled="loading || paging.page >= totalPages" @click="onNextPage">下一页</AppButton>
				</view>
			</AppSection>

			<AppSection v-if="!authorized" title="访问限制">
				<AppEmpty title="无权限查看操作日志" subtitle="仅 superadmin / admin / finance 可见" />
			</AppSection>
		</view>

		<view v-if="detailVisible" class="detail-mask" @click="closeDetail">
			<view class="detail-panel" @click.stop>
				<view class="detail-head">
					<view>
						<text class="detail-title">{{ actionTitle(activeLog?.action) }}</text>
						<text class="detail-sub">{{ actionCategoryText(activeLog?.action) }}</text>
					</view>
					<view class="detail-close" @click="closeDetail">关闭</view>
				</view>

				<view class="detail-grid">
					<view class="detail-row">
						<text class="detail-label">操作描述</text>
						<text class="detail-value">{{ detailBusinessText }}</text>
					</view>
					<view class="detail-row">
						<text class="detail-label">操作时间</text>
						<text class="detail-value">{{ formatDateTime(activeLog?.created_at) }}</text>
					</view>
					<view class="detail-row">
						<text class="detail-label">操作人</text>
						<text class="detail-value">{{ activeLog?.username || '系统' }}</text>
					</view>
					<view class="detail-row">
						<text class="detail-label">角色</text>
						<text class="detail-value">{{ roleText(activeLog?.role) }}</text>
					</view>
					<view v-if="showTechnical" class="detail-row">
						<text class="detail-label">系统动作码</text>
						<text class="detail-value">{{ activeLog?.action || '-' }}</text>
					</view>
					<view v-if="showTechnical" class="detail-row">
						<text class="detail-label">请求号</text>
						<text class="detail-value">{{ activeLog?.request_id || '-' }}</text>
					</view>
				</view>

				<view class="detail-tools">
					<AppButton size="sm" kind="ghost" @click="toggleTechnical">
						{{ showTechnical ? '隐藏技术信息' : '显示技术信息' }}
					</AppButton>
				</view>

				<view v-if="showTechnical">
					<text class="detail-json-title">详情参数（技术）</text>
					<scroll-view scroll-y class="detail-json-wrap">
						<text class="detail-json">{{ detailFullText }}</text>
					</scroll-view>
				</view>
			</view>
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
import AppEmpty from '@/components/base/AppEmpty.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useQuery } from '@/composables/useQuery'
import { getUser } from '@/services/auth'
import { listOperationLogsV1 } from '@/services/log'
import {
	LOG_ACTION_CATEGORY_OPTIONS,
	getLogActionCategory,
	getLogActionCategoryLabel,
	getLogActionLabel
} from '@/services/models/log'

const ROLE_ALLOWED = ['superadmin', 'admin', 'finance']
const { requireLogin } = useAuthGuard()
requireLogin()

const list = ref([])
const activeLog = ref(null)
const detailVisible = ref(false)
const showTechnical = ref(false)

const paging = reactive({
	page: 1,
	pageSize: 30,
	total: 0,
	hasMore: false
})

const user = ref(getUser() || null)

const filters = reactive({
	keyword: '',
	action: '',
	categoryIndex: 0,
	roleIndex: 0,
	dateStart: '',
	dateEnd: ''
})

const categoryOptions = LOG_ACTION_CATEGORY_OPTIONS
const roleOptions = [
	{ label: '全部角色', value: '' },
	{ label: 'superadmin', value: 'superadmin' },
	{ label: 'admin', value: 'admin' },
	{ label: 'finance', value: 'finance' },
	{ label: 'user', value: 'user' },
	{ label: 'pda_operator', value: 'pda_operator' },
	{ label: '安全巡检员', value: 'safety_inspector' }
]

const roleLabel = computed(() => roleOptions[filters.roleIndex]?.label || '全部角色')
const categoryLabel = computed(() => categoryOptions[filters.categoryIndex]?.label || '全部分类')
const currentRole = computed(() => normalizeRole(user.value?.role))
const authorized = computed(() => ROLE_ALLOWED.includes(currentRole.value))
const totalPages = computed(() => {
	const pages = Math.ceil(Number(paging.total || 0) / Number(paging.pageSize || 1))
	return Math.max(pages || 1, 1)
})

const subtitle = computed(() => {
	if (!authorized.value) return '权限控制'
	if (!paging.total) return '关键操作审计'
	return `共 ${paging.total} 条操作日志`
})

const summary = computed(() => {
	const total = paging.total
	const forbidden = list.value.filter((item) => normalizeString(item.action).includes('forbidden')).length
	const adminOps = list.value.filter((item) => ROLE_ALLOWED.includes(normalizeRole(item.role))).length
	const writeOps = list.value.filter((item) => {
		const action = normalizeString(item.action)
		if (!action) return false
		return ['create', 'update', 'delete', 'remove', 'post', 'unpost', 'close', 'reopen', 'add', 'resolve'].some((key) =>
			action.includes(key)
		)
	}).length
	return { total, forbidden, adminOps, writeOps }
})

const detailFullText = computed(() => {
	const detail = activeLog.value?.detail
	if (!detail || typeof detail !== 'object') return '{}'
	const text = JSON.stringify(detail, null, 2)
	return text || '{}'
})

const detailBusinessText = computed(() => businessSummary(activeLog.value))

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listOperationLogsV1({
			keyword: filters.keyword,
			action: filters.action,
			actionCategory: categoryOptions[filters.categoryIndex]?.value || '',
			role: roleOptions[filters.roleIndex]?.value || '',
			dateStart: filters.dateStart,
			dateEnd: filters.dateEnd,
			page: paging.page,
			pageSize: paging.pageSize
		})
		if (res?.code === 403) {
			uni.showToast({ title: '无权限', icon: 'none' })
			return { list: [], paging: { page: 1, total: 0, hasMore: false } }
		}
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return { list: [], paging: { page: 1, total: 0, hasMore: false } }
		}
		return {
			list: Array.isArray(res.data) ? res.data : [],
			paging: res.paging || { page: 1, total: 0, hasMore: false }
		}
	},
	{
		immediate: false,
		initialData: { list: [], paging: { page: 1, total: 0, hasMore: false } },
		cacheTTL: 6000,
		throttleMs: 300,
		cacheKey: () =>
			`operation-log:${filters.keyword}:${filters.action}:${filters.categoryIndex}:${filters.roleIndex}:${filters.dateStart}:${filters.dateEnd}:${paging.page}:${paging.pageSize}`
	}
)

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
}

function formatDateInput(date) {
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function initDateRange() {
	const end = new Date()
	const start = new Date()
	start.setDate(start.getDate() - 7)
	filters.dateStart = formatDateInput(start)
	filters.dateEnd = formatDateInput(end)
}

function formatDateTime(value) {
	const timestamp = Number(value)
	if (!Number.isFinite(timestamp) || timestamp <= 0) return '-'
	const date = new Date(timestamp)
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const hh = String(date.getHours()).padStart(2, '0')
	const mm = String(date.getMinutes()).padStart(2, '0')
	const ss = String(date.getSeconds()).padStart(2, '0')
	return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function roleText(role) {
	const value = normalizeRole(role)
	if (!value) return '未知角色'
	if (value === 'superadmin') return '超级管理员'
	if (value === 'admin') return '管理员'
	if (value === 'finance') return '财务'
	if (value === 'user') return '普通用户'
	if (value === 'pda_operator') return 'PDA 操作员'
	if (value === 'safety_inspector') return '安全巡检员'
	return value
}

function actionTitle(action) {
	return getLogActionLabel(action)
}

function actionCategoryText(action) {
	const category = getLogActionCategory(action)
	return getLogActionCategoryLabel(category)
}

function statusKind(action) {
	const normalized = normalizeString(action)
	if (!normalized) return 'info'
	if (normalized.includes('forbidden')) return 'danger'
	if (normalized.includes('remove') || normalized.includes('delete')) return 'warning'
	return 'info'
}

function iconClass(action) {
	const normalized = normalizeString(action)
	if (normalized.includes('forbidden')) return 'bg-danger'
	if (normalized.includes('remove') || normalized.includes('delete')) return 'bg-warning'
	if (normalized.includes('create') || normalized.includes('add')) return 'bg-success'
	return 'bg-info'
}

function formatFieldValue(value) {
	if (value == null || value === '') return ''
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value)
		} catch (err) {
			void err
			return ''
		}
	}
	return String(value)
}

function businessSummary(logItem) {
	if (!logItem) return '暂无业务信息'
	const detail = logItem.detail
	if (!detail || typeof detail !== 'object') return '暂无业务信息'
	const parts = []
	const commonKeys = ['id', 'target', 'username', 'role', 'period', 'customer_name', 'customer_id', 'sale_id', 'voucher_id']
	for (const key of commonKeys) {
		const value = formatFieldValue(detail[key])
		if (!value) continue
		const labelMap = {
			id: '对象ID',
			target: '目标对象',
			username: '用户名',
			role: '角色',
			period: '账期',
			customer_name: '客户',
			customer_id: '客户ID',
			sale_id: '销售单ID',
			voucher_id: '凭证ID'
		}
		const label = labelMap[key] || key
		parts.push(`${label}：${value}`)
	}

	const countKeys = [
		['created', '新增'],
		['updated', '更新'],
		['total', '总计'],
		['resolved', '处理'],
		['open', '待处理']
	]
	for (const [key, label] of countKeys) {
		if (detail[key] == null) continue
		parts.push(`${label}：${detail[key]}`)
	}

	const dateFrom = formatFieldValue(detail.date_from || detail.dateFrom || detail.date_start || detail.dateStart)
	const dateTo = formatFieldValue(detail.date_to || detail.dateTo || detail.date_end || detail.dateEnd)
	if (dateFrom || dateTo) {
		parts.push(`范围：${dateFrom || '-'} 至 ${dateTo || '-'}`)
	}

	if (!parts.length) return '点击“显示技术信息”查看完整详情'
	return parts.join('；')
}

function onRoleChange(event) {
	const value = Number(event?.detail?.value || 0)
	filters.roleIndex = Number.isFinite(value) ? value : 0
}

function onCategoryChange(event) {
	const value = Number(event?.detail?.value || 0)
	filters.categoryIndex = Number.isFinite(value) ? value : 0
}

function onDateStartChange(event) {
	filters.dateStart = normalizeString(event?.detail?.value)
}

function onDateEndChange(event) {
	filters.dateEnd = normalizeString(event?.detail?.value)
}

async function runSearch({ resetPage } = {}) {
	if (!authorized.value) return
	if (resetPage) paging.page = 1
	const result = await fetchList()
	list.value = result?.list || []
	paging.page = Number(result?.paging?.page || paging.page || 1)
	paging.total = Number(result?.paging?.total || 0)
	paging.hasMore = !!result?.paging?.hasMore
}

async function onSearch() {
	await runSearch({ resetPage: true })
}

async function onPrevPage() {
	if (loading.value || paging.page <= 1) return
	paging.page -= 1
	await runSearch({ resetPage: false })
}

async function onNextPage() {
	if (loading.value || paging.page >= totalPages.value) return
	paging.page += 1
	await runSearch({ resetPage: false })
}

function onReset() {
	filters.keyword = ''
	filters.action = ''
	filters.categoryIndex = 0
	filters.roleIndex = 0
	initDateRange()
	onSearch()
}

function openDetail(item) {
	activeLog.value = item || null
	showTechnical.value = false
	detailVisible.value = true
}

function closeDetail() {
	detailVisible.value = false
}

function toggleTechnical() {
	showTechnical.value = !showTechnical.value
}

onMounted(() => {
	if (!authorized.value) {
		uni.showToast({ title: '无权限', icon: 'none' })
		return
	}
	initDateRange()
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
}

.picker-block {
	display: block;
	width: 100%;
	padding: 4rpx 0;
	box-sizing: border-box;
}

.picker-trigger {
	display: block;
	width: 100%;
	min-height: 120rpx;
	border-radius: 12rpx;
}

/* 让整个字段（含标签）都交给 picker 响应，避免只点中局部才生效 */
.picker-trigger :deep(.field),
.picker-trigger :deep(.field__label),
.picker-trigger :deep(.field__control),
.picker-trigger :deep(.field__input) {
	pointer-events: none;
}

.section-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12rpx;
}

.meta-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.footer-text {
	display: block;
	width: 100%;
	font-size: 22rpx;
	color: var(--crm-text-muted);
	text-align: left;
	word-break: break-all;
}

.pager {
	margin-top: 16rpx;
	display: flex;
	justify-content: flex-end;
	align-items: center;
	gap: 12rpx;
	flex-wrap: wrap;
}

.pager-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.detail-mask {
	position: fixed;
	top: 0;
	right: 0;
	bottom: 0;
	left: 0;
	background: rgba(15, 23, 42, 0.45);
	z-index: 90;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 24rpx;
	box-sizing: border-box;
}

.detail-panel {
	width: 920rpx;
	max-width: 100%;
	max-height: calc(100vh - 120rpx);
	background: #fff;
	border-radius: 20rpx;
	padding: 24rpx;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.detail-head {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	gap: 16rpx;
}

.detail-title {
	display: block;
	font-size: 30rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.detail-sub {
	margin-top: 8rpx;
	display: block;
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.detail-close {
	font-size: 24rpx;
	color: var(--crm-primary);
	padding: 8rpx 12rpx;
}

.detail-grid {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.detail-row {
	display: flex;
	align-items: flex-start;
	gap: 12rpx;
}

.detail-label {
	width: 128rpx;
	font-size: 22rpx;
	color: var(--crm-text-muted);
	flex-shrink: 0;
}

.detail-value {
	font-size: 24rpx;
	color: var(--crm-text);
	word-break: break-all;
}

.detail-json-title {
	font-size: 24rpx;
	font-weight: 600;
	color: var(--crm-text);
}

.detail-tools {
	display: flex;
	justify-content: flex-end;
}

.detail-json-wrap {
	max-height: 420rpx;
	background: #f8fafc;
	border: 1rpx solid var(--crm-border);
	border-radius: 12rpx;
	padding: 16rpx;
	box-sizing: border-box;
}

.detail-json {
	font-size: 22rpx;
	line-height: 1.5;
	color: #334155;
	font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
	white-space: pre-wrap;
	word-break: break-all;
}

@media (max-width: 680px) {
	.summary-row {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.detail-panel {
		width: 100%;
		max-height: calc(100vh - 64rpx);
	}
}

@media (max-width: 420px) {
	.summary-row {
		grid-template-columns: 1fr;
	}
	.pager {
		justify-content: center;
	}
}
</style>
