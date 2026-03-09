<template>
	<AppPage hideNav :bodyPadding="false">
		<view class="dashboard">
			<view class="dashboard__sidebar">
				<view class="sidebar-menu">
					<view class="brand">
						<view class="brand__icon">
							<AppIcon name="home" size="32rpx" />
						</view>
						<view class="brand__text">
							<text class="brand__name">2026 CRM</text>
							<text class="brand__desc">运营驾驶舱</text>
						</view>
					</view>

					<view class="nav-group">
						<text class="nav-title">主导航</text>
						<view class="nav-item nav-item--active" @click="go('/pages/index/index')">
							<AppIcon name="home" size="24rpx" />
							<text>工作台</text>
						</view>
						<view class="nav-item" @click="go('/pages/sale/list')">
							<AppIcon name="document" size="24rpx" />
							<text>销售记录</text>
						</view>
						<view class="nav-item" @click="go('/pages/customer/list')">
							<AppIcon name="user" size="24rpx" />
							<text>客户档案</text>
						</view>
						<view class="nav-item" @click="go('/pages/bottle/list')">
							<AppIcon name="bottle" size="24rpx" />
							<text>钢瓶档案</text>
						</view>
						<view class="nav-item" @click="go('/pages/vehicle/list')">
							<AppIcon name="truck" size="24rpx" />
							<text>车辆档案</text>
						</view>
						<view class="nav-item" @click="go('/pages/delivery/list')">
							<AppIcon name="user" size="24rpx" />
							<text>配送员档案</text>
						</view>
						<view class="nav-item" @click="go('/pages/filling/list')">
							<AppIcon name="list" size="24rpx" />
							<text>灌装记录</text>
						</view>
						<view class="nav-item" @click="go('/pages/bottle/loss')">
							<AppIcon name="chart" size="24rpx" />
							<text>损耗统计</text>
						</view>
						<view class="nav-item" @click="go('/pages/accounting/report-summary')">
							<AppIcon name="chart" size="24rpx" />
							<text>财务报表</text>
						</view>
						<view class="nav-item" @click="go('/pages/collection/task-list')">
							<AppIcon name="credit-card" size="24rpx" />
							<text>追款任务</text>
						</view>
						<view v-if="canViewOperationLog" class="nav-item" @click="go('/pages/log/list')">
							<AppIcon name="list" size="24rpx" />
							<text>操作日志</text>
						</view>
					</view>
				</view>
			</view>

			<view class="dashboard__main">
				<view class="dashboard__topbar">
					<view class="topbar-left">
						<text class="breadcrumb">CRM / 工作台</text>
						<text class="page-title">工作台</text>
					</view>
					<view class="topbar-search">
						<AppIcon name="search" size="24rpx" />
						<input class="topbar-search__input" placeholder="搜索业务、客户、单据" placeholder-style="color:#94a3b8;font-size:12px;" />
						<text class="topbar-search__hint">Ctrl + K</text>
					</view>
					<view class="topbar-actions">
						<view class="topbar-icon">
							<AppIcon name="alert" size="22rpx" />
						</view>
						<view class="topbar-icon">
							<AppIcon name="list" size="22rpx" />
						</view>
						<view class="avatar">WY</view>
					</view>
				</view>

				<view class="dashboard__content">
					<!-- KPI 横向一行 -->
					<view class="kpi-row">
						<AppStatCard
							class="kpi-card"
							label="异常监控"
							:value="stats.anomaly"
							hint="待处理"
							icon="alert"
							:delta="kpiDelta.anomaly"
							:trend="kpiTrend.anomaly"
							@click="go('/pages/bottle/anomaly')"
						/>
						<AppStatCard
							class="kpi-card"
							label="本月销售"
							:value="stats.sales"
							hint="元"
							icon="chart"
							:delta="kpiDelta.sales"
							:trend="kpiTrend.sales"
							@click="go('/pages/sale/list')"
						/>
						<AppStatCard
							class="kpi-card"
							label="在户资产"
							:value="stats.atCustomer"
							hint="瓶"
							icon="user"
							:delta="kpiDelta.atCustomer"
							:trend="kpiTrend.atCustomer"
						/>
						<AppStatCard
							class="kpi-card"
							label="在站库存"
							:value="stats.inStation"
							hint="瓶"
							icon="bottle"
							:delta="kpiDelta.inStation"
							:trend="kpiTrend.inStation"
						/>
					</view>

					<view class="overview-grid">
						<view class="overview-card">
							<view class="overview-header">
								<text class="overview-title">工作概览</text>
								<view class="overview-tabs">
									<text class="overview-tab overview-tab--active">本周</text>
									<text class="overview-tab">本月</text>
									<text class="overview-tab">成员</text>
								</view>
							</view>
							<view class="overview-chart">
								<view
									v-for="(height, index) in overviewHeights"
									:key="index"
									class="overview-bar"
									:style="{ height: `${height}%` }"
								/>
							</view>
						</view>

						<view class="overview-aside">
							<text class="overview-aside__title">本周优化方向</text>
							<view class="overview-chips">
								<text class="overview-chip">时效</text>
								<text class="overview-chip">流程</text>
								<text class="overview-chip">产出</text>
							</view>
							<text class="overview-aside__hint">聚焦高频异常与出入库节奏</text>
						</view>
					</view>

					<AppSection class="dashboard-card" title="业务管理">
						<view class="nav-grid">
							<view class="nav-grid-item" @click="go('/pages/sale/edit')">
								<view class="nav-icon bg-sales"><AppIcon name="plus" color="#fff" size="30rpx" /></view>
								<text class="nav-text">新增销售</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/sale/list')">
								<view class="nav-icon bg-sales"><AppIcon name="document" color="#fff" size="30rpx" /></view>
								<text class="nav-text">销售记录</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/customer/list')">
								<view class="nav-icon bg-customer"><AppIcon name="user" color="#fff" size="30rpx" /></view>
								<text class="nav-text">客户档案</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/bottle/list')">
								<view class="nav-icon bg-asset"><AppIcon name="bottle" color="#fff" size="30rpx" /></view>
								<text class="nav-text">钢瓶档案</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/vehicle/list')">
								<view class="nav-icon bg-asset"><AppIcon name="truck" color="#fff" size="30rpx" /></view>
								<text class="nav-text">车辆档案</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/delivery/list')">
								<view class="nav-icon bg-customer"><AppIcon name="user" color="#fff" size="30rpx" /></view>
								<text class="nav-text">配送员档案</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/filling/list')">
								<view class="nav-icon bg-asset"><AppIcon name="list" color="#fff" size="30rpx" /></view>
								<text class="nav-text">灌装记录</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/bottle/movement')">
								<view class="nav-icon bg-asset"><AppIcon name="search" color="#fff" size="30rpx" /></view>
								<text class="nav-text">流转明细</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/bottle/anomaly')">
								<view class="nav-icon bg-alert"><AppIcon name="alert" color="#fff" size="30rpx" /></view>
								<text class="nav-text">异常处理</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/bottle/loss')">
								<view class="nav-icon bg-alert"><AppIcon name="chart" color="#fff" size="30rpx" /></view>
								<text class="nav-text">损耗统计</text>
							</view>
						</view>
					</AppSection>

					<AppSection class="dashboard-card" title="财务核算">
						<view class="nav-grid">
							<view class="nav-grid-item" @click="go('/pages/accounting/voucher-list')">
								<view class="nav-icon bg-finance"><AppIcon name="document" color="#fff" size="30rpx" /></view>
								<text class="nav-text">凭证管理</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/accounting/account-list')">
								<view class="nav-icon bg-finance"><AppIcon name="list" color="#fff" size="30rpx" /></view>
								<text class="nav-text">会计科目</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/accounting/ledger-general')">
								<view class="nav-icon bg-finance"><AppIcon name="search" color="#fff" size="30rpx" /></view>
								<text class="nav-text">总账查询</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/accounting/ledger-sub')">
								<view class="nav-icon bg-finance"><AppIcon name="document" color="#fff" size="30rpx" /></view>
								<text class="nav-text">明细账</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/accounting/trial-balance')">
								<view class="nav-icon bg-finance"><AppIcon name="wallet" color="#fff" size="30rpx" /></view>
								<text class="nav-text">试算平衡</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/accounting/report-summary')">
								<view class="nav-icon bg-finance"><AppIcon name="chart" color="#fff" size="30rpx" /></view>
								<text class="nav-text">报表中心</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/accounting/receivable-detail')">
								<view class="nav-icon bg-finance"><AppIcon name="list" color="#fff" size="30rpx" /></view>
								<text class="nav-text">往来明细</text>
							</view>
							<view class="nav-grid-item" @click="go('/pages/accounting/period-list')">
								<view class="nav-icon bg-finance"><AppIcon name="calendar" color="#fff" size="30rpx" /></view>
								<text class="nav-text">账期管理</text>
							</view>
							<view v-if="canViewOperationLog" class="nav-grid-item" @click="go('/pages/log/list')">
								<view class="nav-icon bg-finance"><AppIcon name="list" color="#fff" size="30rpx" /></view>
								<text class="nav-text">操作日志</text>
							</view>
						</view>
					</AppSection>
				</view>
			</view>

			<view class="dashboard__rail">
				<view class="rail-card">
					<text class="rail-title">快捷操作</text>
					<view class="quick-actions">
						<view class="quick-btn bg-sales" @click="go('/pages/sale/edit')">
							<AppIcon name="plus" color="#fff" size="36rpx" />
							<text class="quick-btn-text">新增销售</text>
						</view>
						<view class="quick-btn bg-asset" @click="go('/pages/filling/list')">
							<AppIcon name="bottle" color="#fff" size="36rpx" />
							<text class="quick-btn-text">灌装入库</text>
						</view>
					</view>
				</view>

				<view class="rail-card">
					<text class="rail-title">7 天趋势</text>
						<view class="mini-chart mini-chart--full">
							<AppSparkline
								:points="sparklinePoints"
								:width="240"
								:height="90"
								stroke="var(--crm-primary)"
								fill="rgba(1, 118, 211, 0.18)"
								:show-area="true"
							/>
							<text class="mini-caption">本周订单</text>
						</view>
				</view>

				<view class="rail-card">
					<text class="rail-title">任务分布</text>
					<view class="mini-chart mini-chart--full">
						<AppMiniBars
							:values="barValues"
							:height="70"
							:bar-width="14"
							:gap="8"
							color="var(--crm-warning)"
						/>
						<text class="mini-caption">按类型统计</text>
					</view>
				</view>

				<view class="rail-card">
					<text class="rail-title">今日待办</text>
					<view class="todo-list">
						<view class="todo-item" @click="go('/pages/bottle/anomaly')">
							<view class="todo-dot bg-alert"></view>
							<text class="todo-text">异常待处理</text>
							<text class="todo-count">{{ stats.anomaly }}</text>
						</view>
						<view class="todo-item">
							<view class="todo-dot bg-asset"></view>
							<text class="todo-text">待回收钢瓶</text>
							<text class="todo-count">-</text>
						</view>
					</view>
				</view>

			</view>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppSparkline from '@/components/base/AppSparkline.vue'
import AppMiniBars from '@/components/base/AppMiniBars.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useQuery } from '@/composables/useQuery'
import { getUser } from '@/services/auth'
import { getDashboardSummaryV1 } from '@/services/dashboard'

const { requireLogin } = useAuthGuard()
requireLogin()

const stats = reactive({
	anomaly: '-',
	sales: '-',
	atCustomer: '-',
	inStation: '-'
})

const kpiDelta = reactive({
	anomaly: '',
	sales: '',
	atCustomer: '',
	inStation: ''
})

const kpiTrend = reactive({
	anomaly: '',
	sales: '',
	atCustomer: '',
	inStation: ''
})

const sparklinePoints = ref([0, 0, 0, 0, 0, 0, 0])
const overviewBars = ref([0, 0, 0, 0, 0, 0])
const barValues = ref([0, 0, 0])
const currentUser = ref(getUser() || null)

const overviewHeights = computed(() => {
	const values = overviewBars.value.length ? overviewBars.value : [0, 0, 0, 0, 0, 0]
	const max = Math.max(...values, 1)
	return values.map((value) => Math.max(Math.round((Number(value) / max) * 100), 6))
})

const canViewOperationLog = computed(() => {
	const role = normalizeRole(currentUser.value?.role)
	return ['superadmin', 'admin', 'finance'].includes(role)
})

function formatNumber(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '-'
	if (Math.abs(num) >= 10000) return `${Math.round(num / 100) / 10}w`
	return Math.round(num).toString()
}

function normalizeRole(value) {
	if (value == null) return ''
	return String(value).trim().toLowerCase()
}

function applyDashboard(data) {
	if (!data) return
	const kpi = data.kpi || {}
	stats.anomaly = formatNumber(kpi.anomaly_open)
	stats.sales = formatNumber(kpi.sales_month)
	stats.atCustomer = formatNumber(kpi.at_customer)
	stats.inStation = formatNumber(kpi.in_station)

	const delta = kpi.delta || {}
	kpiDelta.sales = delta.sales || ''
	kpiTrend.sales = delta.salesTrend || ''

	const trend = data.trend || {}
	if (Array.isArray(trend.week)) sparklinePoints.value = trend.week

	const overview = data.overview || {}
	if (Array.isArray(overview.bars) && overview.bars.length) {
		overviewBars.value = overview.bars
	} else if (Array.isArray(trend.week)) {
		overviewBars.value = trend.week.slice(-6)
	}

	const distribution = data.distribution || {}
	if (Array.isArray(distribution.values)) barValues.value = distribution.values
}

useQuery(
	async () => {
		const res = await getDashboardSummaryV1({ days: 7 })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '工作台数据加载失败', icon: 'none' })
			return null
		}
		return res.data || null
	},
	{
		immediate: true,
		cacheTTL: 8000,
		throttleMs: 300,
		onSuccess: applyDashboard
	}
)

function go(url) {
	uni.navigateTo({ url })
}
</script>

<style scoped>
/* 全局布局 */
.dashboard {
	min-height: 100vh;
	background: #f5f7fb;
	display: grid;
	grid-template-columns: 280px minmax(0, 1fr) 280px;
	gap: 20px;
	padding: 24px;
	box-sizing: border-box;
}

.dashboard__sidebar {
	background: #fff;
	border: 1px solid #eef1f5;
	border-radius: 20px;
	padding: 20px;
	display: flex;
	flex-direction: column;
	gap: 24px;
	box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
}

.dashboard__main {
	display: flex;
	flex-direction: column;
	gap: 20px;
	min-width: 0;
}

.dashboard__rail {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

/* 品牌与导航 */
.sidebar-menu {
	display: flex;
	flex-direction: column;
	gap: 24px;
}

.brand {
	display: flex;
	gap: 12px;
	align-items: center;
}

.brand__icon {
	width: 40px;
	height: 40px;
	border-radius: 12px;
	background: #eef2ff;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--crm-primary);
}

.brand__text {
	display: flex;
	flex-direction: column;
}

.brand__name {
	font-size: 18px;
	font-weight: 700;
	color: #0f172a;
}

.brand__desc {
	font-size: 12px;
	color: #94a3b8;
}

.nav-group {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.nav-title {
	font-size: 12px;
	color: #94a3b8;
	margin-bottom: 6px;
	text-transform: uppercase;
	letter-spacing: 1px;
}

.nav-item {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 12px;
	border-radius: 12px;
	color: #475569;
	font-size: 14px;
	transition: all 0.2s ease;
}

.nav-item:active {
	background: rgba(15, 23, 42, 0.06);
}

.nav-item--active {
	background: rgba(1, 118, 211, 0.12);
	color: var(--crm-primary);
	font-weight: 600;
}

/* 顶栏 */
.dashboard__topbar {
	background: #fff;
	border: 1px solid #eef1f5;
	border-radius: 18px;
	padding: 16px 20px;
	display: flex;
	align-items: center;
	gap: 16px;
	justify-content: space-between;
	box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
}

.topbar-left {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.breadcrumb {
	font-size: 12px;
	color: #94a3b8;
}

.page-title {
	font-size: 22px;
	font-weight: 700;
	color: #0f172a;
}

.topbar-search {
	flex: 1;
	max-width: 360px;
	background: #f1f5f9;
	border-radius: 999px;
	padding: 8px 14px;
	display: flex;
	align-items: center;
	gap: 8px;
	color: #64748b;
}

.topbar-search__input {
	flex: 1;
	font-size: 14px;
	color: #0f172a;
}

.topbar-search__hint {
	font-size: 12px;
	color: #94a3b8;
}

.topbar-actions {
	display: flex;
	align-items: center;
	gap: 12px;
}

.topbar-icon {
	width: 32px;
	height: 32px;
	border-radius: 10px;
	background: #f1f5f9;
	display: flex;
	align-items: center;
	justify-content: center;
	color: #64748b;
}

.avatar {
	width: 36px;
	height: 36px;
	border-radius: 50%;
	background: #e2e8f0;
	color: #1e293b;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 12px;
	font-weight: 600;
}

/* 内容区 */
.dashboard__content {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

/* KPI 横向一行 */
.kpi-row {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 16px;
}

:deep(.kpi-card .stat__content) {
	align-items: center;
	gap: 16px;
}

:deep(.kpi-card .stat__value-wrap) {
	align-items: flex-start;
}

:deep(.kpi-card .stat__value) {
	text-align: left;
	font-size: 24px;
}

:deep(.kpi-card .stat__icon) {
	margin-left: 12px;
}

.overview-grid {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 220px;
	gap: 16px;
}

.overview-card {
	background: #fff;
	border: 1px solid #eef1f5;
	border-radius: 18px;
	padding: 16px;
	display: flex;
	flex-direction: column;
	gap: 12px;
	box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
}

.overview-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.overview-title {
	font-size: 16px;
	font-weight: 600;
	color: #0f172a;
}

.overview-tabs {
	display: flex;
	gap: 10px;
	font-size: 12px;
}

.overview-tab {
	padding: 4px 8px;
	border-radius: 999px;
	color: #94a3b8;
	background: #f1f5f9;
}

.overview-tab--active {
	color: #1e293b;
	background: #e0f2fe;
}

.overview-chart {
	display: grid;
	grid-template-columns: repeat(6, 1fr);
	align-items: end;
	gap: 10px;
	height: 120px;
	padding: 8px 6px;
	background: #f8fafc;
	border-radius: 14px;
}

.overview-bar {
	background: linear-gradient(180deg, rgba(37, 99, 235, 0.9), rgba(37, 99, 235, 0.4));
	border-radius: 10px 10px 6px 6px;
}

.overview-aside {
	background: #fff;
	border: 1px solid #eef1f5;
	border-radius: 18px;
	padding: 16px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
}

.overview-aside__title {
	font-size: 14px;
	font-weight: 600;
	color: #0f172a;
}

.overview-chips {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.overview-chip {
	padding: 4px 10px;
	border-radius: 999px;
	font-size: 12px;
	color: #2563eb;
	background: rgba(37, 99, 235, 0.12);
}

.overview-aside__hint {
	font-size: 12px;
	color: #94a3b8;
	line-height: 1.4;
}

/* 导航网格 */
.nav-grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 16px;
}

.nav-grid-item {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
	padding: 12px;
	border-radius: 14px;
	background: #f8fafc;
	transition: all var(--crm-duration-fast) var(--crm-easing);
}

.nav-grid-item:active {
	background: #eef2ff;
	transform: scale(0.96);
}

@media (hover: hover) {
	.nav-grid-item:hover {
		background: #eef2ff;
	}
}

.nav-icon {
	width: 48px;
	height: 48px;
	border-radius: 12px;
	display: flex;
	align-items: center;
	justify-content: center;
}

.nav-text {
	font-size: 13px;
	color: #1e293b;
	text-align: center;
}

/* 快捷操作按钮 */
.quick-actions {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.quick-btn {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px 16px;
	border-radius: 14px;
	color: #fff;
	transition: all var(--crm-duration-fast) var(--crm-easing);
}

.quick-btn:active {
	opacity: 0.8;
	transform: scale(0.98);
}

.quick-btn-text {
	font-size: 14px;
	font-weight: 600;
}

/* 右侧迷你图表 */
.mini-chart {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	min-height: 140px;
}

.mini-chart--full {
	align-items: stretch;
	min-height: 110px;
}

.mini-caption {
	font-size: 12px;
	color: #94a3b8;
	text-align: center;
}

/* 右侧栏卡片 */
.rail-card {
	background: #fff;
	border: 1px solid #eef1f5;
	border-radius: 16px;
	padding: 14px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
}

.rail-title {
	font-size: 14px;
	font-weight: 600;
	color: #0f172a;
}

/* 待办列表 */
.todo-list {
	background: transparent;
	overflow: hidden;
}

.todo-item {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 0;
	border-bottom: 1px solid #eef2f7;
}

.todo-item:last-child {
	border-bottom: none;
}

.todo-dot {
	width: 10px;
	height: 10px;
	border-radius: 50%;
}

.todo-text {
	flex: 1;
	font-size: 14px;
	color: #1e293b;
}

.todo-count {
	font-size: 14px;
	font-weight: 600;
	color: #64748b;
}

/* SLDS 语义色 */
.bg-sales { background: var(--crm-action-sales); }
.bg-customer { background: var(--crm-action-customer); }
.bg-asset { background: var(--crm-action-asset); }
.bg-alert { background: var(--crm-action-alert); }
.bg-finance { background: var(--crm-action-finance); }

/* 仪表盘卡片覆写 */
.dashboard-card {
	border-radius: 18px;
	border: 1px solid #eef1f5;
	box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
}

.dashboard-card :deep(.section__header) {
	background: transparent;
	padding: 16px 20px;
	border-bottom: 1px solid #f1f5f9;
}

.dashboard-card :deep(.section__title) {
	font-size: 16px;
}

.dashboard-card :deep(.section__body) {
	padding: 20px;
}

/* 响应式 */
@media (max-width: 1280px) {
	.dashboard {
		grid-template-columns: 240px minmax(0, 1fr);
	}
	.dashboard__rail {
		display: none;
	}
}

@media (max-width: 1024px) {
	.dashboard {
		grid-template-columns: 1fr;
		padding: 16px;
	}
	.dashboard__sidebar {
		display: none;
	}
	.kpi-row {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.overview-grid {
		grid-template-columns: 1fr;
	}
	.topbar-search {
		display: none;
	}
}

@media (max-width: 768px) {
	.kpi-row {
		grid-template-columns: 1fr;
	}
	.nav-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
