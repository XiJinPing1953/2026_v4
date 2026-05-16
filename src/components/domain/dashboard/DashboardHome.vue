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
						<text class="brand__name">新拓能源</text>
					</view>
					</view>

					<view class="nav-group">
						<text class="nav-title">主导航</text>
						<view v-if="canView('/pages/index/index')" class="nav-item nav-item--active" @click="go('/pages/index/index')">
							<AppIcon name="home" size="24rpx" />
							<text>工作台</text>
						</view>
						<view v-if="canView('/pages/sale/list')" class="nav-item" @click="go('/pages/sale/list')">
							<AppIcon name="document" size="24rpx" />
							<text>销售记录</text>
						</view>
						<view v-if="canView('/pages/customer/list')" class="nav-item" @click="go('/pages/customer/list?scene=statement')">
							<AppIcon name="wallet" size="24rpx" />
							<text>客户对账</text>
						</view>
						<view v-if="canView('/pages/cashier/receipt-intake')" class="nav-item" @click="go('/pages/cashier/receipt-intake')">
							<AppIcon name="wallet" size="24rpx" />
							<text>出纳收款登记</text>
						</view>
						<view v-if="canView('/pages/bottle/list')" class="nav-item" @click="go('/pages/bottle/list')">
							<AppIcon name="bottle" size="24rpx" />
							<text>钢瓶档案</text>
						</view>
						<view v-if="canView('/pages/vehicle/list')" class="nav-item" @click="go('/pages/vehicle/list')">
							<AppIcon name="truck" size="24rpx" />
							<text>车辆档案</text>
						</view>
						<view v-if="canView('/pages/delivery/list')" class="nav-item" @click="go('/pages/delivery/list')">
							<AppIcon name="user" size="24rpx" />
							<text>配送员档案</text>
						</view>
						<view v-if="canView('/pages/filling/list')" class="nav-item" @click="go('/pages/filling/list')">
							<AppIcon name="list" size="24rpx" />
							<text>灌装记录</text>
						</view>
						<view v-if="canView('/pages/gas-in/list')" class="nav-item" @click="go('/pages/gas-in/list')">
							<AppIcon name="truck" size="24rpx" />
							<text>天然气库存</text>
						</view>
						<view v-if="canView('/pages/bottle/loss')" class="nav-item" @click="go('/pages/bottle/loss')">
							<AppIcon name="chart" size="24rpx" />
							<text>损耗统计</text>
						</view>
						<view v-if="canView('/pages/accounting/report-summary')" class="nav-item" @click="go('/pages/accounting/report-summary')">
							<AppIcon name="chart" size="24rpx" />
							<text>财务报表</text>
						</view>
						<view v-if="canView('/pages/collection/task-list')" class="nav-item" @click="go('/pages/collection/task-list')">
							<AppIcon name="credit-card" size="24rpx" />
							<text>追款任务</text>
						</view>
						<view v-if="canView('/pages/log/list')" class="nav-item" @click="go('/pages/log/list')">
							<AppIcon name="list" size="24rpx" />
							<text>操作日志</text>
						</view>
						<view v-if="canView('/pages/user/list')" class="nav-item" @click="go('/pages/user/list')">
							<AppIcon name="user" size="24rpx" />
							<text>用户管理</text>
						</view>
					</view>
				</view>
			</view>

			<view class="dashboard__main">
				<view class="dashboard__topbar">
					<view class="topbar-left">
						<text class="breadcrumb">新拓能源 / 工作台</text>
						<text class="page-title">工作台</text>
					</view>
					<view class="topbar-right">
						<view class="session-chip">
							<text class="session-chip__name">{{ currentUsername }}</text>
							<text class="session-chip__role">{{ currentRoleLabel }}</text>
						</view>
						<AppButton size="sm" kind="outline" @click="onLogout">退出登录</AppButton>
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
								label="检验到期提醒"
								:value="stats.inspectionDue"
								hint="项"
								icon="calendar"
								:delta="kpiDelta.inspectionDue"
								@click="go('/pages/bottle/list')"
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

					<view class="tank-card tank-card--main">
						<view class="tank-card__head">
							<text class="rail-title">储罐监控</text>
							<text :class="['tank-status', tankStatusClass]">{{ tankStatusLabel }}</text>
						</view>
						<view class="tank-card__body">
							<view class="tank-gauge">
								<view class="tank-gauge__shell">
									<view class="tank-gauge__fill" :style="{ height: tankLevelFillHeight }"></view>
									<text class="tank-gauge__percent">{{ tankPercentText }}</text>
								</view>
								<view class="tank-gauge__legs">
									<view></view>
									<view></view>
								</view>
							</view>
							<view class="tank-metrics">
								<view class="tank-metric">
									<text class="tank-metric__label">储罐压力</text>
									<text class="tank-metric__value">{{ tankPressureText }}</text>
								</view>
								<view class="tank-metric">
									<text class="tank-metric__label">储罐液位</text>
									<text class="tank-metric__value">{{ tankLevelText }}</text>
								</view>
								<view class="tank-meta">
									<text>{{ tankSampledAtText }}</text>
									<text>{{ tankMessageText }}</text>
								</view>
							</view>
						</view>
					</view>

						<view class="overview-grid">
							<view class="overview-card">
								<view class="overview-header">
									<view class="overview-header__left">
										<text class="overview-title">业务日报</text>
										<text class="overview-meta">充装与销售按业务日期汇总 · {{ dailyReportRangeLabel }}</text>
									</view>
									<view class="overview-header__right">
										<scroll-view scroll-x class="daily-range-scroll">
											<view class="daily-range-cards">
												<view
													v-for="item in dailyReportRangeOptions"
													:key="item.value"
													:class="['daily-range-card', dailyReportRangePreset === item.value ? 'daily-range-card--active' : '']"
													@click="onDailyReportRangeChange(item.value)"
												>
													<text class="daily-range-card__label">{{ item.label }}</text>
												</view>
											</view>
										</scroll-view>
										<view class="daily-export-wrap">
											<AppButton
												size="sm"
												kind="neutral"
												:loading="dailyReportExporting"
												:disabled="!dailyReportCanExport"
												@click="onExportDailyReport"
											>
												导出
											</AppButton>
										</view>
									</view>
								</view>
								<scroll-view scroll-x class="daily-report-scroll">
									<view class="daily-report-table">
										<view class="daily-report-head daily-report-row">
											<text class="daily-report-cell daily-report-cell--date">日期</text>
											<text class="daily-report-cell">充装瓶数</text>
											<text class="daily-report-cell">充装重量</text>
											<text class="daily-report-cell">地方车次</text>
											<text class="daily-report-cell">地方车重</text>
											<text class="daily-report-cell">车辆次</text>
											<text class="daily-report-cell">车辆重</text>
											<text class="daily-report-cell">客户数</text>
											<text class="daily-report-cell">销售瓶数</text>
											<text class="daily-report-cell">销售重量</text>
										</view>
										<view v-for="row in dailyReportDisplayRows" :key="row.date" class="daily-report-row">
											<text class="daily-report-cell daily-report-cell--date">{{ row.date }}</text>
											<text class="daily-report-cell">{{ row.fillBottleCount }}</text>
											<text class="daily-report-cell">{{ formatCompactWeight(row.fillBottleWeightKg) }}</text>
											<text class="daily-report-cell">{{ row.localCount }}</text>
											<text class="daily-report-cell">{{ formatCompactWeight(row.localWeightKg) }}</text>
											<text class="daily-report-cell">{{ row.vehicleCount }}</text>
											<text class="daily-report-cell">{{ formatCompactWeight(row.vehicleWeightKg) }}</text>
											<text class="daily-report-cell">{{ row.saleCustomerCount }}</text>
											<text class="daily-report-cell">{{ row.saleBottleCount }}</text>
											<text class="daily-report-cell">{{ formatCompactWeight(row.saleWeightKg) }}</text>
										</view>
									</view>
								</scroll-view>
							</view>

							<view class="overview-aside">
								<text class="overview-aside__title">业务摘要</text>
								<view class="overview-summary">
									<view class="overview-summary__item">
										<text class="overview-summary__label">充装瓶数合计</text>
										<text class="overview-summary__value">{{ dailyReportDisplaySummary.fillBottleCount }}</text>
									</view>
									<view class="overview-summary__item">
										<text class="overview-summary__label">充装重量合计</text>
										<text class="overview-summary__value">{{ formatCompactWeight(dailyReportDisplaySummary.fillTotalWeightKg) }}</text>
									</view>
									<view class="overview-summary__item">
										<text class="overview-summary__label">销售瓶数合计</text>
										<text class="overview-summary__value">{{ dailyReportDisplaySummary.saleBottleCount }}</text>
									</view>
									<view class="overview-summary__item">
										<text class="overview-summary__label">销售重量合计</text>
										<text class="overview-summary__value">{{ formatCompactWeight(dailyReportDisplaySummary.saleWeightKg) }}</text>
									</view>
									<view class="overview-summary__item">
										<text class="overview-summary__label">客户数合计</text>
										<text class="overview-summary__value">{{ dailyReportDisplaySummary.saleCustomerCount }}</text>
									</view>
								</view>
								<view class="overview-mini-chart">
									<view class="overview-mini-chart__head">
										<text class="overview-mini-chart__title">近5日销售重量</text>
										<text class="overview-mini-chart__value">{{ formatCompactWeight(dailyReportDisplaySummary.saleWeightKg) }}</text>
									</view>
									<AppMiniBars :values="dailyReportBarValues" :height="68" :bar-width="18" :gap="10" color="#2563eb" />
									<view class="overview-mini-chart__labels">
										<text v-for="row in dailyReportDisplayRows" :key="`label-${row.date}`" class="overview-mini-chart__label">{{ shortDateLabel(row.date) }}</text>
									</view>
								</view>
							</view>
						</view>

					<AppSection class="dashboard-card" title="业务管理">
						<view class="nav-grid">
							<view v-if="canAction('/pages/sale/edit', 'create')" class="nav-grid-item" @click="go('/pages/sale/edit')">
								<view class="nav-icon bg-sales"><AppIcon name="plus" color="#fff" size="30rpx" /></view>
								<text class="nav-text">新增销售</text>
							</view>
							<view v-if="canView('/pages/sale/list')" class="nav-grid-item" @click="go('/pages/sale/list')">
								<view class="nav-icon bg-sales"><AppIcon name="document" color="#fff" size="30rpx" /></view>
								<text class="nav-text">销售记录</text>
							</view>
							<view v-if="canView('/pages/customer/list')" class="nav-grid-item" @click="go('/pages/customer/list?scene=statement')">
								<view class="nav-icon bg-finance"><AppIcon name="wallet" color="#fff" size="30rpx" /></view>
								<text class="nav-text">客户对账</text>
							</view>
							<view v-if="canView('/pages/cashier/receipt-intake')" class="nav-grid-item" @click="go('/pages/cashier/receipt-intake')">
								<view class="nav-icon bg-finance"><AppIcon name="wallet" color="#fff" size="30rpx" /></view>
								<text class="nav-text">出纳收款登记</text>
							</view>
							<view v-if="canView('/pages/bottle/list')" class="nav-grid-item" @click="go('/pages/bottle/list')">
								<view class="nav-icon bg-asset"><AppIcon name="bottle" color="#fff" size="30rpx" /></view>
								<text class="nav-text">钢瓶档案</text>
							</view>
							<view v-if="canView('/pages/vehicle/list')" class="nav-grid-item" @click="go('/pages/vehicle/list')">
								<view class="nav-icon bg-asset"><AppIcon name="truck" color="#fff" size="30rpx" /></view>
								<text class="nav-text">车辆档案</text>
							</view>
							<view v-if="canView('/pages/delivery/list')" class="nav-grid-item" @click="go('/pages/delivery/list')">
								<view class="nav-icon bg-customer"><AppIcon name="user" color="#fff" size="30rpx" /></view>
								<text class="nav-text">配送员档案</text>
							</view>
							<view v-if="canView('/pages/filling/list')" class="nav-grid-item" @click="go('/pages/filling/list')">
								<view class="nav-icon bg-asset"><AppIcon name="list" color="#fff" size="30rpx" /></view>
								<text class="nav-text">灌装记录</text>
							</view>
							<view v-if="canView('/pages/gas-in/list')" class="nav-grid-item" @click="go('/pages/gas-in/list')">
								<view class="nav-icon bg-asset"><AppIcon name="truck" color="#fff" size="30rpx" /></view>
								<text class="nav-text">天然气库存</text>
							</view>
							<view v-if="canView('/pages/bottle/movement')" class="nav-grid-item" @click="go('/pages/bottle/movement')">
								<view class="nav-icon bg-asset"><AppIcon name="search" color="#fff" size="30rpx" /></view>
								<text class="nav-text">流转明细</text>
							</view>
							<view v-if="canView('/pages/bottle/anomaly')" class="nav-grid-item" @click="go('/pages/bottle/anomaly')">
								<view class="nav-icon bg-alert"><AppIcon name="alert" color="#fff" size="30rpx" /></view>
								<text class="nav-text">异常处理</text>
							</view>
							<view v-if="canView('/pages/bottle/loss')" class="nav-grid-item" @click="go('/pages/bottle/loss')">
								<view class="nav-icon bg-alert"><AppIcon name="chart" color="#fff" size="30rpx" /></view>
								<text class="nav-text">损耗统计</text>
							</view>
							<view v-if="canView('/pages/user/list')" class="nav-grid-item" @click="go('/pages/user/list')">
								<view class="nav-icon bg-customer"><AppIcon name="user" color="#fff" size="30rpx" /></view>
								<text class="nav-text">用户管理</text>
							</view>
						</view>
					</AppSection>

					<AppSection class="dashboard-card" title="财务核算">
						<view class="nav-grid">
							<view v-if="canView('/pages/accounting/voucher-list')" class="nav-grid-item" @click="go('/pages/accounting/voucher-list')">
								<view class="nav-icon bg-finance"><AppIcon name="document" color="#fff" size="30rpx" /></view>
								<text class="nav-text">凭证管理</text>
							</view>
							<view v-if="canView('/pages/accounting/account-list')" class="nav-grid-item" @click="go('/pages/accounting/account-list')">
								<view class="nav-icon bg-finance"><AppIcon name="list" color="#fff" size="30rpx" /></view>
								<text class="nav-text">会计科目</text>
							</view>
							<view v-if="canView('/pages/accounting/ledger-general')" class="nav-grid-item" @click="go('/pages/accounting/ledger-general')">
								<view class="nav-icon bg-finance"><AppIcon name="search" color="#fff" size="30rpx" /></view>
								<text class="nav-text">总账查询</text>
							</view>
							<view v-if="canView('/pages/accounting/ledger-sub')" class="nav-grid-item" @click="go('/pages/accounting/ledger-sub')">
								<view class="nav-icon bg-finance"><AppIcon name="document" color="#fff" size="30rpx" /></view>
								<text class="nav-text">明细账</text>
							</view>
							<view v-if="canView('/pages/accounting/trial-balance')" class="nav-grid-item" @click="go('/pages/accounting/trial-balance')">
								<view class="nav-icon bg-finance"><AppIcon name="wallet" color="#fff" size="30rpx" /></view>
								<text class="nav-text">试算平衡</text>
							</view>
							<view v-if="canView('/pages/accounting/report-summary')" class="nav-grid-item" @click="go('/pages/accounting/report-summary')">
								<view class="nav-icon bg-finance"><AppIcon name="chart" color="#fff" size="30rpx" /></view>
								<text class="nav-text">报表中心</text>
							</view>
							<view v-if="canView('/pages/accounting/receivable-detail')" class="nav-grid-item" @click="go('/pages/accounting/receivable-detail')">
								<view class="nav-icon bg-finance"><AppIcon name="list" color="#fff" size="30rpx" /></view>
								<text class="nav-text">往来明细</text>
							</view>
							<view v-if="canView('/pages/accounting/period-list')" class="nav-grid-item" @click="go('/pages/accounting/period-list')">
								<view class="nav-icon bg-finance"><AppIcon name="calendar" color="#fff" size="30rpx" /></view>
								<text class="nav-text">账期管理</text>
							</view>
							<view v-if="canView('/pages/log/list')" class="nav-grid-item" @click="go('/pages/log/list')">
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
						<view v-if="canAction('/pages/sale/edit', 'create')" class="quick-btn bg-sales" @click="go('/pages/sale/edit')">
							<AppIcon name="plus" color="#fff" size="36rpx" />
							<text class="quick-btn-text">新增销售</text>
						</view>
						<view v-if="canAction('/pages/filling/list', 'create')" class="quick-btn bg-asset" @click="go('/pages/filling/list')">
							<AppIcon name="bottle" color="#fff" size="36rpx" />
							<text class="quick-btn-text">灌装入库</text>
						</view>
					</view>
				</view>

				<view class="rail-card">
					<text class="rail-title">近 7 日新增应收 vs 实收</text>
					<view class="receivable-chart">
						<view v-for="row in receivableChartRows" :key="row.date" class="receivable-day">
							<view class="receivable-bars">
								<view class="receivable-bar receivable-bar--receivable" :style="{ height: `${row.receivableHeight}%` }"></view>
								<view class="receivable-bar receivable-bar--received" :style="{ height: `${row.receivedHeight}%` }"></view>
							</view>
							<text class="receivable-label">{{ row.label }}</text>
						</view>
					</view>
					<view class="receivable-legend">
						<view class="shipment-legend__item">
							<view class="shipment-legend__dot receivable-legend__dot--receivable"></view>
							<text class="shipment-legend__label">新增应收</text>
							<text class="shipment-legend__value">{{ formatCompactAmount(receivableSummary.totalReceivable) }}</text>
						</view>
						<view class="shipment-legend__item">
							<view class="shipment-legend__dot receivable-legend__dot--received"></view>
							<text class="shipment-legend__label">实收</text>
							<text class="shipment-legend__value">{{ formatCompactAmount(receivableSummary.totalReceived) }}</text>
						</view>
						<view class="shipment-legend__item">
							<view class="shipment-legend__dot receivable-legend__dot--gap"></view>
							<text class="shipment-legend__label">差额</text>
							<text class="shipment-legend__value">{{ formatCompactAmount(receivableSummary.gapAmount) }}</text>
						</view>
						<view class="shipment-legend__item">
							<view class="shipment-legend__dot receivable-legend__dot--rate"></view>
							<text class="shipment-legend__label">回款率</text>
							<text class="shipment-legend__value">{{ formatPercent(receivableSummary.collectionRate) }}</text>
						</view>
					</view>
					<text class="mini-caption">按业务日期统计应收与当日实收</text>
				</view>

				<view class="rail-card tank-card">
					<view class="tank-card__head">
						<text class="rail-title">储罐监控</text>
						<text :class="['tank-status', tankStatusClass]">{{ tankStatusLabel }}</text>
					</view>
					<view class="tank-card__body">
						<view class="tank-gauge">
							<view class="tank-gauge__shell">
								<view class="tank-gauge__fill" :style="{ height: tankLevelFillHeight }"></view>
								<text class="tank-gauge__percent">{{ tankPercentText }}</text>
							</view>
							<view class="tank-gauge__legs">
								<view></view>
								<view></view>
							</view>
						</view>
						<view class="tank-metrics">
							<view class="tank-metric">
								<text class="tank-metric__label">储罐压力</text>
								<text class="tank-metric__value">{{ tankPressureText }}</text>
							</view>
							<view class="tank-metric">
								<text class="tank-metric__label">储罐液位</text>
								<text class="tank-metric__value">{{ tankLevelText }}</text>
							</view>
							<view class="tank-meta">
								<text>{{ tankSampledAtText }}</text>
								<text>{{ tankMessageText }}</text>
							</view>
						</view>
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
							<view class="todo-item" @click="goInspectionDue('bottle')">
								<view class="todo-dot bg-asset"></view>
								<text class="todo-text">瓶检到期</text>
								<text class="todo-count">{{ formatInspectionDueCount(inspectionDue.bottle) }}</text>
							</view>
							<view class="todo-item" @click="goInspectionDue('gauge')">
								<view class="todo-dot bg-asset"></view>
								<text class="todo-text">表检到期</text>
								<text class="todo-count">{{ formatInspectionDueCount(inspectionDue.gauge) }}</text>
							</view>
							<view class="todo-item" @click="goInspectionDue('valve')">
								<view class="todo-dot bg-asset"></view>
								<text class="todo-text">阀检到期</text>
								<text class="todo-count">{{ formatInspectionDueCount(inspectionDue.valve) }}</text>
							</view>
						</view>
					</view>

			</view>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppMiniBars from '@/components/base/AppMiniBars.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'
import { useQuery } from '@/composables/useQuery'
import { getDashboardSummaryV1 } from '@/services/dashboard'
import { listSalesV2 } from '@/services/sale'
import { clearAuth, getUser } from '@/services/auth'
import { goLogin } from '@/services/navigation'
import { normalizeRoleTemplate } from '@/services/pageAclRegistry'
import {
	buildDailyReportWorkbookXml,
	buildDailyReportExportFileName,
	downloadWorkbookFile as downloadDailyReportWorkbookFile
} from '@/components/domain/dashboard/exportDailyReportWorkbook'

const { requireLogin, canPageAction, canViewPage } = useAuthGuard()
requireLogin()
const currentUser = ref(getUser() || null)

const stats = reactive({
	anomaly: '-',
	inspectionDue: '-',
	sales: '-',
	atCustomer: '-',
	inStation: '-'
})

const kpiDelta = reactive({
	anomaly: '',
	inspectionDue: '',
	sales: '',
	atCustomer: '',
	inStation: ''
})

const kpiTrend = reactive({
	anomaly: '',
	inspectionDue: '',
	sales: '',
	atCustomer: '',
	inStation: ''
})

const inspectionDue = reactive({
	bottle: { overdue: 0, due_60d: 0 },
	gauge: { overdue: 0, due_60d: 0 },
	valve: { overdue: 0, due_60d: 0 }
})
const dailyReportSummary = reactive({
	fillTotalWeightKg: 0,
	saleTotalWeightKg: 0,
	customerCount: 0,
	bottleFillWeightKg: 0,
	localWeightKg: 0,
	vehicleWeightKg: 0
})
const receivableSummary = reactive({
	totalReceivable: 0,
	totalReceived: 0,
	gapAmount: 0,
	collectionRate: null
})
const tankTelemetry = reactive({
	levelM: null,
	levelPercent: null,
	pressureMpa: null,
	status: 'empty',
	sampledAt: null,
	updatedAt: null,
	message: ''
})

const dailyReportRows = ref([])
const receivableRows = ref([])
const dailyReportExporting = ref(false)
const dailyReportRangeOptions = [
	{ value: 'today', label: '当日' },
	{ value: 'yesterday', label: '前一日' },
	{ value: 'last3', label: '前三日' },
	{ value: 'last5', label: '前五日' },
	{ value: 'lastMonth', label: '上月' },
	{ value: 'thisMonth', label: '当月' }
]
const dailyReportRangePreset = ref('last5')
const DAILY_REPORT_MAX_VISIBLE_DAYS = 5
const MONTH_EXPORT_PRESET_SET = new Set(['lastMonth', 'thisMonth'])
const DASHBOARD_REFRESH_MS = 15000
const isDashboardPolling = ref(false)
let dashboardRefreshTimer = null

const dailyReportDateRange = computed(() => resolveDailyReportDateRange(dailyReportRangePreset.value))
const dailyReportRangeLabel = computed(() => {
	const { start, end } = dailyReportDateRange.value
	if (!start || !end) return '-'
	return start === end ? start : `${start}~${end}`
})
const dailyReportExportRows = computed(() => {
	const { start, end } = dailyReportDateRange.value
	if (!start || !end) return []
	return dailyReportRows.value.filter((row) => {
		const date = String(row?.date || '')
		return date >= start && date <= end
	})
})
const dailyReportDisplayRows = computed(() => dailyReportExportRows.value.slice(0, DAILY_REPORT_MAX_VISIBLE_DAYS))
const dailyReportCanExport = computed(() => {
	if (MONTH_EXPORT_PRESET_SET.has(dailyReportRangePreset.value)) return true
	return dailyReportExportRows.value.length > 0
})
const dailyReportBarValues = computed(() => dailyReportDisplayRows.value.map((row) => Number(row.saleWeightKg || 0)))
const dailyReportDisplaySummary = computed(() => {
	const summary = {
		fillBottleCount: 0,
		fillBottleWeightKg: 0,
		localCount: 0,
		localWeightKg: 0,
		vehicleCount: 0,
		vehicleWeightKg: 0,
		saleCustomerCount: 0,
		saleBottleCount: 0,
		saleWeightKg: 0,
		fillTotalWeightKg: 0
	}
	dailyReportDisplayRows.value.forEach((row) => {
		summary.fillBottleCount += Number(row.fillBottleCount || 0)
		summary.fillBottleWeightKg = fix2(summary.fillBottleWeightKg + Number(row.fillBottleWeightKg || 0))
		summary.localCount += Number(row.localCount || 0)
		summary.localWeightKg = fix2(summary.localWeightKg + Number(row.localWeightKg || 0))
		summary.vehicleCount += Number(row.vehicleCount || 0)
		summary.vehicleWeightKg = fix2(summary.vehicleWeightKg + Number(row.vehicleWeightKg || 0))
		summary.saleCustomerCount += Number(row.saleCustomerCount || 0)
		summary.saleBottleCount += Number(row.saleBottleCount || 0)
		summary.saleWeightKg = fix2(summary.saleWeightKg + Number(row.saleWeightKg || 0))
	})
	summary.fillTotalWeightKg = fix2(summary.fillBottleWeightKg + summary.localWeightKg + summary.vehicleWeightKg)
	return summary
})

const receivableChartRows = computed(() => {
	const rows = receivableRows.value.length ? receivableRows.value : []
	const max = Math.max(
		...rows.map((row) => Math.max(Number(row.receivable || 0), Number(row.received || 0))),
		1
	)
	return rows.map((row) => ({
		date: row.date,
		label: shortDateLabel(row.date),
		receivableHeight: Number(row.receivable || 0) > 0 ? Math.max(Math.round((Number(row.receivable || 0) / max) * 100), 8) : 0,
		receivedHeight: Number(row.received || 0) > 0 ? Math.max(Math.round((Number(row.received || 0) / max) * 100), 8) : 0
	}))
})

const tankLevelPercent = computed(() => {
	const num = Number(tankTelemetry.levelPercent)
	if (!Number.isFinite(num)) return 0
	return Math.min(Math.max(num, 0), 100)
})
const tankLevelFillHeight = computed(() => `${tankLevelPercent.value}%`)
const tankPercentText = computed(() => {
	if (!Number.isFinite(Number(tankTelemetry.levelPercent))) return '--%'
	return `${Math.round(tankLevelPercent.value)}%`
})
const tankLevelText = computed(() => formatTankValue(tankTelemetry.levelM, '米'))
const tankPressureText = computed(() => formatTankValue(tankTelemetry.pressureMpa, 'MPa'))
const tankSampledAtText = computed(() =>
	tankTelemetry.sampledAt ? `采集 ${formatDateTime(tankTelemetry.sampledAt)}` : '暂无采集时间'
)
const tankStatusLabel = computed(() => {
	if (tankTelemetry.status === 'online') return '在线'
	if (tankTelemetry.status === 'stale') return '数据延迟'
	if (tankTelemetry.status === 'error') return '异常'
	return '等待采集'
})
const tankStatusClass = computed(() => `tank-status--${tankTelemetry.status || 'empty'}`)
const tankMessageText = computed(() => {
	if (tankTelemetry.message) return tankTelemetry.message
	if (tankTelemetry.status === 'online') return '现场网关在线'
	if (tankTelemetry.status === 'stale') return '超过60秒未收到新数据'
	if (tankTelemetry.status === 'error') return '采集异常'
	return '等待现场网关上报'
})

const currentUsername = computed(() =>
	String(currentUser.value?.nickname || currentUser.value?.username || '当前账号')
)
const currentRoleLabel = computed(() => {
	const role = normalizeRoleTemplate(currentUser.value?.role_template || currentUser.value?.role || 'user')
	if (role === 'superadmin') return '超级管理员'
	if (role === 'admin') return '管理员'
	if (role === 'finance') return '财务'
	return '普通用户'
})

function canView(pagePath) {
	return canViewPage(pagePath)
}

function canAction(pagePath, action) {
	return canPageAction(pagePath, action)
}

function formatLocalDateYmd(date = new Date()) {
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function addDaysYmd(baseYmd, days) {
	const text = String(baseYmd || '').trim()
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
	const [year, month, day] = text.split('-').map((item) => Number(item))
	const date = new Date(year, month - 1, day)
	date.setDate(date.getDate() + Number(days || 0))
	return formatLocalDateYmd(date)
}

function getMonthRange(monthOffset = 0) {
	const now = new Date()
	const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
	const last = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
	return {
		start: formatLocalDateYmd(first),
		end: formatLocalDateYmd(last)
	}
}

function resolveDailyReportDateRange(preset) {
	const today = formatLocalDateYmd(new Date())
	if (preset === 'today') return { start: today, end: today }
	if (preset === 'yesterday') {
		const y = addDaysYmd(today, -1)
		return { start: y, end: y }
	}
	if (preset === 'last3') return { start: addDaysYmd(today, -2), end: today }
	if (preset === 'thisMonth') return getMonthRange(0)
	if (preset === 'lastMonth') return getMonthRange(-1)
	return { start: addDaysYmd(today, -4), end: today }
}

function onDailyReportRangeChange(value) {
	const text = String(value || '')
	if (!dailyReportRangeOptions.some((item) => item.value === text)) return
	dailyReportRangePreset.value = text
}

function formatNumber(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '-'
	if (Math.abs(num) >= 10000) return `${(Math.round((num / 10000) * 10) / 10).toFixed(1)}w`
	return Math.round(num).toString()
}

function formatCompactAmount(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num === 0) return '¥0'
	if (Math.abs(num) >= 10000) return `¥${(Math.round((num / 10000) * 10) / 10).toFixed(1)}w`
	return `¥${Math.round(num)}`
}

function formatCompactWeight(value) {
	const num = Number(value)
	if (!Number.isFinite(num) || num === 0) return '0kg'
	if (Math.abs(num) >= 1000) return `${formatFixedNoRound(num / 1000, 3)}吨`
	return `${Math.round(num)}kg`
}

function formatFixedNoRound(value, digits = 3) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '0'
	const factor = 10 ** Math.max(0, Number(digits) || 0)
	const sign = num < 0 ? '-' : ''
	const abs = Math.abs(num)
	const truncated = Math.trunc(abs * factor) / factor
	return `${sign}${truncated.toFixed(Math.max(0, Number(digits) || 0))}`
}

function formatPercent(value) {
	const num = Number(value)
	if (!Number.isFinite(num)) return '-'
	return `${num.toFixed(1)}%`
}

function formatTankValue(value, unit) {
	const num = Number(value)
	if (!Number.isFinite(num)) return `-- ${unit}`
	return `${num.toFixed(2)} ${unit}`
}

function formatDateTime(value) {
	const num = Number(value)
	const date = Number.isFinite(num) ? new Date(num < 1000000000000 ? num * 1000 : num) : new Date(value)
	const time = date.getTime()
	if (!Number.isFinite(time)) return '-'
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const h = String(date.getHours()).padStart(2, '0')
	const min = String(date.getMinutes()).padStart(2, '0')
	const s = String(date.getSeconds()).padStart(2, '0')
	return `${y}-${m}-${d} ${h}:${min}:${s}`
}

function normalizeTankStatus(value) {
	const text = String(value || '').trim()
	if (text === 'online' || text === 'stale' || text === 'error' || text === 'empty') return text
	return 'empty'
}

function fix2(value) {
	const num = Number(value || 0)
	return Math.round(num * 100) / 100
}

function shortDateLabel(value) {
	const text = String(value || '').trim()
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || '-'
	return text.slice(5)
}

function normalizeDailyReportRows(rawRows) {
	if (!Array.isArray(rawRows)) return []
	return rawRows.map((row) => ({
		date: String(row?.date || ''),
		fillBottleCount: Number((row?.fillBottleCount ?? row?.fill_bottle_count) || 0),
		fillBottleWeightKg: Number((row?.fillBottleWeightKg ?? row?.fill_bottle_weight) || 0),
		localCount: Number((row?.localCount ?? row?.local_count) || 0),
		localWeightKg: Number((row?.localWeightKg ?? row?.local_weight) || 0),
		vehicleCount: Number((row?.vehicleCount ?? row?.vehicle_count) || 0),
		vehicleWeightKg: Number((row?.vehicleWeightKg ?? row?.vehicle_weight) || 0),
		saleCustomerCount: Number((row?.saleCustomerCount ?? row?.sale_customer_count) || 0),
		saleBottleCount: Number((row?.saleBottleCount ?? row?.sale_bottle_count) || 0),
		saleWeightKg: Number((row?.saleWeightKg ?? row?.sale_weight) || 0)
	}))
}

function applyTankTelemetry(raw) {
	const tank = raw && typeof raw === 'object' ? raw : {}
	const toNullableNumber = (value) => {
		const num = Number(value)
		return Number.isFinite(num) ? num : null
	}
	tankTelemetry.levelM = toNullableNumber(tank.level_m ?? tank.levelM)
	tankTelemetry.levelPercent = toNullableNumber(tank.level_percent ?? tank.levelPercent)
	tankTelemetry.pressureMpa = toNullableNumber(tank.pressure_mpa ?? tank.pressureMpa)
	tankTelemetry.status = normalizeTankStatus(tank.status)
	tankTelemetry.sampledAt = toNullableNumber(tank.sampled_at ?? tank.sampledAt)
	tankTelemetry.updatedAt = toNullableNumber(tank.updated_at ?? tank.updatedAt)
	tankTelemetry.message = String(tank.message || '').trim()
}

function applyDashboard(data) {
	if (!data) return
	const kpi = data.kpi || {}
	stats.anomaly = formatNumber(kpi.anomaly_open)
	stats.sales = formatNumber(kpi.sales_month)
	stats.atCustomer = formatNumber(kpi.at_customer)
	stats.inStation = formatNumber(kpi.in_station)
	const dueData = data.inspection_due || {}
	const dueTotal = dueData.total || {}
	const dueOverdue = Number(dueTotal.overdue || 0)
	const due60 = Number(dueTotal.due_60d || 0)
	stats.inspectionDue = formatNumber(Number(dueTotal.total || dueOverdue + due60))
	kpiDelta.inspectionDue = `过${dueOverdue}/近${due60}`
	inspectionDue.bottle = {
		overdue: Number(dueData.bottle?.overdue || 0),
		due_60d: Number(dueData.bottle?.due_60d || 0)
	}
	inspectionDue.gauge = {
		overdue: Number(dueData.gauge?.overdue || 0),
		due_60d: Number(dueData.gauge?.due_60d || 0)
	}
	inspectionDue.valve = {
		overdue: Number(dueData.valve?.overdue || 0),
		due_60d: Number(dueData.valve?.due_60d || 0)
	}

	const delta = kpi.delta || {}
	kpiDelta.sales = delta.sales || ''
	kpiTrend.sales = delta.salesTrend || ''

	const dailyReport = data.daily_report || {}
	dailyReportRows.value = normalizeDailyReportRows(dailyReport.rows)
	dailyReportSummary.fillTotalWeightKg = Number(dailyReport.fill_total_weight_kg || 0)
	dailyReportSummary.saleTotalWeightKg = Number(dailyReport.sale_total_weight_kg || 0)
	dailyReportSummary.customerCount = Number(dailyReport.customer_count || 0)
	dailyReportSummary.bottleFillWeightKg = Number(dailyReport.channel_totals?.bottle || 0)
	dailyReportSummary.localWeightKg = Number(dailyReport.channel_totals?.local || 0)
	dailyReportSummary.vehicleWeightKg = Number(dailyReport.channel_totals?.vehicle || 0)

	const receivable = data.receivable || {}
	receivableRows.value = Array.isArray(receivable.rows) ? receivable.rows : []
	receivableSummary.totalReceivable = Number(receivable.total_receivable || 0)
	receivableSummary.totalReceived = Number(receivable.total_received || 0)
	receivableSummary.gapAmount = Number(receivable.gap_amount || 0)
	receivableSummary.collectionRate =
		receivable.collection_rate == null || receivable.collection_rate === '' ? null : Number(receivable.collection_rate)

	applyTankTelemetry(data.tank)
}

const { run: fetchDashboardSummary } = useQuery(
	async (options = {}) => {
		const res = await getDashboardSummaryV1({ days: 7 })
		if (res?.code !== 0) {
			if (!options.silent) uni.showToast({ title: res?.msg || '工作台数据加载失败', icon: 'none' })
			return null
		}
		return res.data || null
	},
	{
		immediate: true,
		cacheTTL: 8000,
		throttleMs: 300,
		onSuccess: applyDashboard,
		onError(err) {
			if (!isDashboardPolling.value) uni.showToast({ title: err?.message || '工作台数据加载失败', icon: 'none' })
		}
	}
)

function refreshDashboardSilently() {
	if (isDashboardPolling.value) return
	isDashboardPolling.value = true
	Promise.resolve(fetchDashboardSummary({ force: true, silent: true })).finally(() => {
		isDashboardPolling.value = false
	})
}

onMounted(() => {
	dashboardRefreshTimer = setInterval(refreshDashboardSilently, DASHBOARD_REFRESH_MS)
})

onBeforeUnmount(() => {
	if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer)
	dashboardRefreshTimer = null
})

function go(url) {
	uni.navigateTo({ url })
}

async function fetchAllSalesRowsForDailyReportExport({ dateStart, dateEnd }) {
	const rows = []
	let page = 1
	let hasMore = true
	let guard = 0
	while (hasMore) {
		if (guard > 500) throw new Error('导出分页异常，请缩小范围后重试')
		const res = await listSalesV2({
			dateStart,
			dateEnd,
			keyword: '',
			priceUnit: '',
			bizMode: '',
			paymentStatus: '',
			settlementScope: '',
			hasRemark: '',
			remarkTag: '',
			page,
			pageSize: 50
		})
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

function filterDailyReportRowsByRange(rows, start, end) {
	return (Array.isArray(rows) ? rows : []).filter((row) => {
		const date = String(row?.date || '')
		return date >= start && date <= end
	})
}

async function resolveSummaryRowsForDailyReportExport(start, end) {
	const localRows = filterDailyReportRowsByRange(dailyReportRows.value, start, end)
	if (!MONTH_EXPORT_PRESET_SET.has(dailyReportRangePreset.value)) return localRows
	try {
		const res = await getDashboardSummaryV1({ days: 31 })
		if (res?.code !== 0) return localRows
		const rows = normalizeDailyReportRows(res?.data?.daily_report?.rows)
		const filtered = filterDailyReportRowsByRange(rows, start, end)
		return filtered.length ? filtered : localRows
	} catch (_) {
		return localRows
	}
}

async function onExportDailyReport() {
	if (dailyReportExporting.value) return
	dailyReportExporting.value = true
	uni.showLoading({ title: '导出中...', mask: true })
	try {
		const { start, end } = dailyReportDateRange.value
		const rows = await resolveSummaryRowsForDailyReportExport(start, end)
		if (!rows.length) {
			uni.showToast({ title: '暂无可导出数据', icon: 'none' })
			return
		}
		const salesRows = await fetchAllSalesRowsForDailyReportExport({ dateStart: start, dateEnd: end })
		const workbookText = buildDailyReportWorkbookXml({
			summaryRows: rows,
			salesRows,
			periodLabel: dailyReportRangeLabel.value
		})
		const fileName = buildDailyReportExportFileName({ dateStart: start, dateEnd: end })
		const downloaded = await downloadDailyReportWorkbookFile(workbookText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端不支持导出下载', icon: 'none', duration: 2600 })
			return
		}
		uni.showToast({ title: `已导出${rows.length}天`, icon: 'success' })
	} catch (err) {
		uni.showToast({ title: err?.message || '导出失败', icon: 'none', duration: 2600 })
	} finally {
		uni.hideLoading()
		dailyReportExporting.value = false
	}
}

async function onLogout() {
	const confirmed = await new Promise((resolve) => {
		uni.showModal({
			title: '退出登录',
			content: '确认退出当前账号吗？',
			success: (res) => resolve(Boolean(res.confirm)),
			fail: () => resolve(false)
		})
	})
	if (!confirmed) return
	clearAuth()
	goLogin()
}

function formatInspectionDueCount(row) {
	const overdue = Number(row?.overdue || 0)
	const due60 = Number(row?.due_60d || 0)
	return `过${overdue}/近${due60}`
}

function goInspectionDue(module) {
	const row = inspectionDue[module] || {}
	const overdue = Number(row.overdue || 0)
	const state = overdue > 0 ? 'overdue' : 'due_60d'
	go(`/pages/bottle/list?inspection_due_module=${encodeURIComponent(module)}&inspection_due_state=${encodeURIComponent(state)}`)
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
	gap: 2px;
}

.brand__name {
	font-size: 18px;
	font-weight: 700;
	color: #0f172a;
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

.topbar-right {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 12px;
	flex-wrap: wrap;
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

.session-chip {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 2px;
	padding: 6px 12px;
	border-radius: 12px;
	border: 1px solid #e2e8f0;
	background: #f8fafc;
}

.session-chip__name {
	font-size: 13px;
	font-weight: 600;
	color: #0f172a;
}

.session-chip__role {
	font-size: 11px;
	color: #64748b;
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
	grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
	grid-template-columns: minmax(0, 1fr) 280px;
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
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
}

.overview-header__left {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}

.overview-header__right {
	display: flex;
	flex-direction: row;
	align-items: center;
	gap: 10px;
	flex: 0 0 auto;
	max-width: 100%;
	margin-top: 8px;
}

.overview-title {
	font-size: 16px;
	font-weight: 600;
	color: #0f172a;
}

.overview-meta {
	font-size: 12px;
	color: #94a3b8;
}

.daily-range-scroll {
	width: auto;
	max-width: 560px;
}

.daily-range-cards {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	min-width: auto;
}

.daily-range-card {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 6px 14px;
	border-radius: 999px;
	background: #f1f5f9;
	border: 1px solid #e2e8f0;
	color: #475569;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
	white-space: nowrap;
}

.daily-range-card--active {
	background: #2563eb;
	border-color: #2563eb;
	color: #fff;
}

.daily-export-wrap {
	width: auto;
	display: flex;
	justify-content: center;
}

.daily-report-scroll {
	width: 100%;
	display: flex;
	justify-content: center;
}

.daily-report-table {
	width: 100%;
	min-width: 0;
	border: 1px solid #e2e8f0;
	border-radius: 14px;
	overflow: hidden;
	background: #f8fafc;
}

.daily-report-row {
	display: grid;
	grid-template-columns: 140px repeat(9, minmax(0, 1fr));
}

.daily-report-head {
	background: #eff6ff;
}

.daily-report-row + .daily-report-row {
	border-top: 1px solid #e2e8f0;
}

.daily-report-cell {
	padding: 12px 10px;
	font-size: 12px;
	color: #334155;
	text-align: center;
	white-space: nowrap;
	min-width: 0;
}

.daily-report-head .daily-report-cell {
	font-weight: 700;
	color: #0f172a;
}

.daily-report-cell--date {
	text-align: left;
	font-weight: 600;
	color: #0f172a;
}

.shipment-legend {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 10px 12px;
}

.shipment-legend__item {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}

.shipment-legend__dot {
	width: 10px;
	height: 10px;
	border-radius: 999px;
	flex: none;
}

.shipment-legend__dot--bottle {
	background: #2563eb;
}

.shipment-legend__dot--local {
	background: #0ea5e9;
}

.shipment-legend__dot--vehicle {
	background: #10b981;
}

.shipment-legend__label {
	flex: 1;
	font-size: 12px;
	color: #94a3b8;
	white-space: nowrap;
}

.shipment-legend__value {
	font-size: 12px;
	font-weight: 600;
	color: #0f172a;
	white-space: nowrap;
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

.overview-summary {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px 12px;
}

.overview-summary__item {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 4px;
	padding: 10px 12px;
	border-radius: 14px;
	background: #f8fafc;
	border: 1px solid #eef2f7;
	min-width: 0;
}

.overview-summary__item:last-child {
	grid-column: 1 / -1;
}

.overview-summary__label {
	font-size: 12px;
	color: #94a3b8;
}

.overview-summary__value {
	font-size: 15px;
	font-weight: 600;
	color: #0f172a;
}

.overview-mini-chart {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px;
	border-radius: 16px;
	background: linear-gradient(180deg, #f8fbff 0%, #f1f6ff 100%);
	border: 1px solid #dbeafe;
}

.overview-mini-chart__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.overview-mini-chart__title {
	font-size: 12px;
	font-weight: 600;
	color: #475569;
}

.overview-mini-chart__value {
	font-size: 14px;
	font-weight: 700;
	color: #0f172a;
}

.overview-mini-chart__labels {
	display: grid;
	grid-template-columns: repeat(5, minmax(0, 1fr));
	gap: 8px;
}

.overview-mini-chart__label {
	font-size: 11px;
	color: #94a3b8;
	text-align: center;
	white-space: nowrap;
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

.mini-caption {
	font-size: 12px;
	color: #94a3b8;
	text-align: center;
}

.tank-card {
	gap: 12px;
}

.tank-card--main {
	display: none;
	background: #fff;
	border: 1px solid #eef1f5;
	border-radius: 18px;
	padding: 16px;
	box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
}

.tank-card__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.tank-status {
	flex-shrink: 0;
	padding: 4px 8px;
	border-radius: 999px;
	font-size: 12px;
	font-weight: 600;
	background: #f1f5f9;
	color: #64748b;
}

.tank-status--online {
	background: #dcfce7;
	color: #166534;
}

.tank-status--stale {
	background: #fef3c7;
	color: #92400e;
}

.tank-status--error {
	background: #fee2e2;
	color: #991b1b;
}

.tank-card__body {
	display: grid;
	grid-template-columns: 110px minmax(0, 1fr);
	align-items: center;
	gap: 14px;
}

.tank-gauge {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
}

.tank-gauge__shell {
	position: relative;
	width: 88px;
	height: 150px;
	overflow: hidden;
	border: 5px solid #1d4ed8;
	border-radius: 44px 44px 22px 22px;
	background: #f8fafc;
	box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.tank-gauge__fill {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	min-height: 0;
	background: linear-gradient(180deg, #60a5fa 0%, #2563eb 100%);
	transition: height 0.3s ease;
}

.tank-gauge__percent {
	position: absolute;
	inset: 0;
	z-index: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 20px;
	font-weight: 700;
	color: #0f172a;
	text-shadow: 0 1px 2px rgba(255, 255, 255, 0.72);
}

.tank-gauge__legs {
	display: flex;
	justify-content: space-between;
	width: 58px;
}

.tank-gauge__legs view {
	width: 10px;
	height: 18px;
	border-radius: 0 0 6px 6px;
	background: #94a3b8;
}

.tank-metrics {
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-width: 0;
}

.tank-metric {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px;
	border-radius: 12px;
	background: #f8fafc;
	border: 1px solid #eef2f7;
	min-width: 0;
}

.tank-metric__label {
	font-size: 12px;
	color: #94a3b8;
}

.tank-metric__value {
	font-size: 20px;
	font-weight: 700;
	color: #1d4ed8;
	line-height: 1.2;
}

.tank-meta {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 12px;
	line-height: 1.45;
	color: #64748b;
}

.receivable-chart {
	display: grid;
	grid-template-columns: repeat(7, minmax(0, 1fr));
	align-items: end;
	gap: 8px;
	height: 150px;
	padding: 8px 0 0;
}

.receivable-day {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
}

.receivable-bars {
	height: 104px;
	width: 100%;
	display: flex;
	align-items: flex-end;
	justify-content: center;
	gap: 4px;
}

.receivable-bar {
	width: 12px;
	border-radius: 8px 8px 4px 4px;
	min-height: 2px;
}

.receivable-bar--receivable {
	background: linear-gradient(180deg, rgba(37, 99, 235, 0.92), rgba(96, 165, 250, 0.68));
}

.receivable-bar--received {
	background: linear-gradient(180deg, rgba(245, 158, 11, 0.95), rgba(251, 191, 36, 0.72));
}

.receivable-label {
	font-size: 11px;
	color: #94a3b8;
	white-space: nowrap;
}

.receivable-legend {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px 12px;
}

.receivable-legend__dot--receivable {
	background: #2563eb;
}

.receivable-legend__dot--received {
	background: #f59e0b;
}

.receivable-legend__dot--gap {
	background: #64748b;
}

.receivable-legend__dot--rate {
	background: #8b5cf6;
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
	.tank-card--main {
		display: flex;
		flex-direction: column;
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
	.overview-header {
		flex-direction: column;
	}
	.overview-header__right {
		width: 100%;
		align-items: flex-start;
		margin-top: 4px;
		flex-direction: column;
	}
	.daily-report-scroll {
		display: block;
		overflow-x: auto;
	}
	.daily-range-scroll {
		max-width: 100%;
	}
	.daily-export-wrap {
		justify-content: flex-start;
	}
	.daily-report-table {
		min-width: 980px;
	}
	.topbar-right {
		width: 100%;
		justify-content: space-between;
	}
	.session-chip {
		align-items: flex-start;
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
