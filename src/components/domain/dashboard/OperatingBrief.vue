<template>
	<view class="brief">
		<view class="brief__heading">
			<view>
				<text class="brief__eyebrow">每天看经营，也看回款</text>
				<text class="brief__title">经营简报</text>
			</view>
			<AppButton role="button" size="sm" kind="ghost" :tabindex="(loading || currentLoading) ? -1 : 0" :aria-disabled="loading || currentLoading" :disabled="loading || currentLoading" @click="refreshAll" @keydown="activateOnKey($event, refreshAll, loading || currentLoading)">刷新</AppButton>
		</view>
		<view class="brief__toolbar">
			<view class="brief__periods" aria-label="经营简报统计期间">
				<button role="button" tabindex="0" v-for="item in periods" :key="item.value" class="brief__period" :class="{ 'brief__period--active': period === item.value }" :aria-pressed="period === item.value" @click="changePeriod(item.value)" @keydown="activateOnKey($event, changePeriod, false, item.value)">{{ item.label }}</button>
			</view>
			<text class="brief__meta">{{ rangeLabel }}</text>
		</view>
		<view v-if="error" class="brief__issue" role="alert">{{ error }}{{ stale ? '；以下为上次成功读取的数据。' : '；当前期间暂不可用。' }}</view>
		<text v-else-if="loading" class="brief__meta" role="status">{{ result ? '正在更新已登记记录…' : '正在读取经营简报…' }}</text>
		<text v-if="result" class="brief__lead">{{ leadText }}</text>
		<view class="brief__metrics">
			<button role="button" class="brief__metric" :disabled="!result" :aria-disabled="!result" :tabindex="result ? 0 : -1" :aria-expanded="expanded === 'business'" @click="toggleDetail('business')" @keydown="activateOnKey($event, toggleDetail, !result, 'business')">
				<text class="brief__label">已确认业务额</text>
				<text class="brief__amount">{{ money(result?.business?.total) }}</text>
				<text class="brief__meta">销售 {{ money(result?.business?.sales) }} · 流量结算 {{ money(result?.business?.flow) }}</text>
				<text class="brief__link">查看构成 <text aria-hidden="true">→</text></text>
			</button>
			<button role="button" class="brief__metric" :disabled="!result" :aria-disabled="!result" :tabindex="result ? 0 : -1" :aria-expanded="expanded === 'cash'" @click="toggleDetail('cash')" @keydown="activateOnKey($event, toggleDetail, !result, 'cash')">
				<text class="brief__label">气款净收</text>
				<text class="brief__amount">{{ money(result?.cash?.net) }}</text>
				<text class="brief__meta">收款 {{ money(result?.cash?.received) }} · 退款 {{ money(result?.cash?.refund) }}</text>
				<text class="brief__link">查看到账 <text aria-hidden="true">→</text></text>
			</button>
		</view>
		<view class="brief__operations brief__operations--sales">
			<button role="button" v-for="item in salesCards" :key="item.key" class="brief__operation" :disabled="!result" :aria-disabled="!result" :tabindex="result ? 0 : -1" :aria-expanded="expanded === item.key" @click="toggleDetail(item.key)" @keydown="activateOnKey($event, toggleDetail, !result, item.key)">
				<text class="brief__meta">{{ item.label }}</text>
				<text class="brief__operation-value">{{ item.value }}</text>
				<text class="brief__operation-sub">{{ item.sub }}</text>
			</button>
		</view>
		<view class="brief__outflow">
			<view class="brief__section-heading">
				<text class="brief__section-title">已登记出罐量</text>
				<button role="button" class="brief__outflow-total" :disabled="!result" :aria-disabled="!result" :tabindex="result ? 0 : -1" :aria-expanded="expanded === 'outflow'" @click="toggleDetail('outflow')" @keydown="activateOnKey($event, toggleDetail, !result, 'outflow')">{{ weight(result?.operations?.recorded_outflow_kg) }}</button>
			</view>
			<view class="brief__outflow-channels">
				<button role="button" v-for="item in outflowCards" :key="item.key" class="brief__operation" :disabled="!result" :aria-disabled="!result" :tabindex="result ? 0 : -1" :aria-expanded="expanded === item.key" @click="toggleDetail(item.key)" @keydown="activateOnKey($event, toggleDetail, !result, item.key)">
					<text class="brief__meta">{{ item.label }}</text>
					<text class="brief__operation-value">{{ item.value }}</text>
					<text class="brief__operation-sub">{{ item.sub }}</text>
				</button>
			</view>
			<button role="button" tabindex="0" class="brief__loss" :class="{ 'brief__loss--surplus': lossPresentation.label === '估算盈余' }" :aria-expanded="expanded === 'loss'" @click="toggleDetail('loss')" @keydown="activateOnKey($event, toggleDetail, false, 'loss')">
				<view><text class="brief__section-title">{{ lossPresentation.label }}</text><text class="brief__meta">液位换算 · {{ tankLossStale ? '上次读取' : '同周期核算' }}</text></view>
				<view class="brief__loss-amount"><text>{{ lossValueText }}</text><text class="brief__link">查看依据 →</text></view>
			</button>
			<text v-if="tankLossError" class="brief__loss-issue" role="alert">{{ tankLossError }}{{ tankLossStale ? '；保留上次读取结果。' : '；估算暂不可用。' }}</text>
			<text v-else-if="tankLoss?.status === 'insufficient_data'" class="brief__loss-issue">{{ lossIssueText }}</text>
			<text v-else-if="tankLossLoading" class="brief__meta" role="status">正在读取储罐估算依据…</text>
			<view v-if="expanded === 'loss'" class="brief__detail brief__loss-detail" aria-live="polite">
				<text class="brief__detail-title">{{ lossPresentation.label }}依据</text>
				<template v-if="tankLoss">
					<text class="brief__note">{{ dateRange(tankLoss.range) }} · 更新于 {{ dateTime(tankLoss.updated_at) }}</text>
					<view class="brief__detail-row"><view><text>期初估算重量</text><text class="brief__note">{{ tankSampleText(tankLoss.opening) }}</text></view><text>{{ evidenceWeight(tankLoss.opening?.weight_kg) }}</text></view>
					<view class="brief__detail-row"><text>期间入罐</text><text>{{ evidenceWeight(tankLoss.inbound_kg) }}</text></view>
					<view class="brief__detail-row"><view><text>期末估算重量</text><text class="brief__note">{{ tankSampleText(tankLoss.closing) }}</text></view><text>{{ evidenceWeight(tankLoss.closing?.weight_kg) }}</text></view>
					<view class="brief__detail-row"><text>已登记出罐</text><text>{{ evidenceWeight(tankLoss.recorded_outflow_kg) }}</text></view>
					<view class="brief__detail-row brief__loss-result"><text>{{ lossPresentation.label }}</text><text>{{ lossValueText }}</text></view>
					<text v-for="(issue, index) in tankLoss.issues" :key="`${issue.code}-${index}`" class="brief__loss-issue">{{ issue.message }}</text>
				</template>
				<text class="brief__note">估算损耗 = 期初估算 + 期间入罐 − 期末估算 − 已登记出罐。</text>
				<text class="brief__note">储罐重量按现有液位换算，同周期正差为损耗，负差为盈余；数值随液位和业务记录更新。</text>
				<AppButton role="button" :tabindex="tankLossLoading ? -1 : 0" :aria-disabled="tankLossLoading" :disabled="tankLossLoading" size="sm" kind="ghost" @click="refreshTankLoss" @keydown="activateOnKey($event, refreshTankLoss, tankLossLoading)">重新核算</AppButton>
			</view>
			<view class="brief__outflow-footer">
				<text class="brief__note">按液位估算，同周期差额计损耗</text>
				<button v-if="canView('/pages/gas-closure/index')" role="button" tabindex="0" class="brief__text-button" @click="navigateTo('/pages/gas-closure/index')" @keydown="activateOnKey($event, navigateTo, false, '/pages/gas-closure/index')">损耗核对 →</button>
			</view>
		</view>
		<view v-if="periodDetail" class="brief__detail" aria-live="polite">
			<text class="brief__detail-title">{{ periodDetail.title }}</text>
			<view v-for="row in periodDetail.rows" :key="row.label" class="brief__detail-row"><text>{{ row.label }}</text><text>{{ row.value }}</text></view>
			<text class="brief__note">{{ periodDetail.note }}</text>
			<AppButton role="button" tabindex="0" v-if="periodDetail.route && canView(periodDetail.route)" size="sm" kind="ghost" @click="emit('navigate', periodDetail.route)" @keydown="activateOnKey($event, navigateTo, false, periodDetail.route)">{{ periodDetail.action }}</AppButton>
		</view>
		<view v-if="canReadCurrent" class="brief__current">
			<view class="brief__section-heading"><text class="brief__section-title">当前客户资金</text><text class="brief__meta">{{ currentTimeLabel }}</text></view>
			<view v-if="currentError" class="brief__issue" role="alert">{{ currentError }}{{ currentStale ? '；以下为上次成功读取的数据。' : '；当前资金与待办暂不可用。' }}</view>
			<text v-else-if="currentLoading" class="brief__meta" role="status">正在核算当前客户资金…</text>
			<view class="brief__balances">
				<button role="button" class="brief__balance" :disabled="!current" :aria-disabled="!current" :tabindex="current ? 0 : -1" :aria-expanded="expanded === 'debt'" @click="toggleDetail('debt')" @keydown="activateOnKey($event, toggleDetail, !current, 'debt')"><text class="brief__meta">客户欠款合计</text><text class="brief__balance-value">{{ money(current?.current?.receivable) }}</text></button>
				<button role="button" class="brief__balance" :disabled="!current" :aria-disabled="!current" :tabindex="current ? 0 : -1" :aria-expanded="expanded === 'prepay'" @click="toggleDetail('prepay')" @keydown="activateOnKey($event, toggleDetail, !current, 'prepay')"><text class="brief__meta">{{ availableFundsLabel }}</text><text class="brief__balance-value">{{ money(current?.current?.prepay) }}</text></button>
			</view>
			<button role="button" tabindex="0" v-if="current && current.pending.count > 0" class="brief__pending" :aria-expanded="expanded === 'pending'" @click="toggleDetail('pending')" @keydown="activateOnKey($event, toggleDetail, false, 'pending')">
				<view><text class="brief__pending-title">{{ number(current.pending.count) }} 笔结账收款待分配</text><text class="brief__pending-sub">{{ money(current.pending.amount) }} · 已计入收款，待匹配账单</text></view><text class="brief__pending-action">查看 <text aria-hidden="true">→</text></text>
			</button>
			<text v-else-if="current" class="brief__note">{{ currentStale ? '上次读取时' : '' }}暂无结账收款待分配；正常预收款不计入提醒。</text>
			<view v-if="currentDetail" class="brief__detail" aria-live="polite">
				<text class="brief__detail-title">{{ currentDetail.title }}</text>
				<view v-for="row in currentDetail.rows" :key="row.label" class="brief__detail-row"><text>{{ row.label }}</text><text>{{ row.value }}</text></view>
				<text class="brief__note">{{ currentDetail.note }}</text>
				<AppButton role="button" tabindex="0" v-if="canView(currentDetail.route)" size="sm" kind="ghost" @click="emit('navigate', currentDetail.route)" @keydown="activateOnKey($event, navigateTo, false, currentDetail.route)">{{ currentDetail.action }}</AppButton>
			</view>
		</view>
		<view class="brief__footer">
			<text class="brief__meta">{{ result ? `业务数据更新于 ${dateTime(result.updated_at)}` : '业务数据尚未读取完成' }}</text>
			<button role="button" tabindex="0" class="brief__text-button" :aria-expanded="showScope" @click="showScope = !showScope" @keydown="activateOnKey($event, toggleScope)">{{ showScope ? '收起口径' : '统计口径' }}</button>
		</view>
		<view v-if="showScope" class="brief__scope">
			<text>业务额按独立计费销售与有效流量结算统计；流量客户送气只记业务量，结算时计金额。</text>
			<text>气款按正式收款单的到账日期归集，含历史欠款回款和预收款；扣除退款，不含押金、抹零及非现金冲抵。</text>
			<text>日期切换业务额、收退款、业务量和估算损耗。客户欠款、可用款及待分配收款按各自标注的读取时点展示，刷新后重新核算。</text>
			<text>销售客户按选定期间去重；车辆燃气加注单列重量与次数。充装按正重量记录计次。估算损耗按液位换算重量与同周期入罐、出罐量核算，正差为损耗，负差为盈余。补录或更正后，历史日期结果可能变化。</text>
		</view>
		<view class="brief__report">
			<button role="button" tabindex="0" class="brief__report-toggle" :aria-expanded="reportOpen" @click="toggleReport" @keydown="activateOnKey($event, toggleReport)"><text>业务日报明细与导出</text><text class="brief__link">{{ reportOpen ? '收起 −' : '展开 +' }}</text></button>
			<view v-if="reportOpen" class="brief__report-content">
				<view class="brief__report-toolbar">
					<view class="brief__report-periods"><button role="button" v-for="item in reportPeriods" :key="item.value" class="brief__text-button" :class="{ 'brief__text-button--active': reportPreset === item.value }" :aria-pressed="reportPreset === item.value" :tabindex="(exporting) ? -1 : 0" :aria-disabled="exporting" :disabled="exporting" @click="selectReportPreset(item.value)" @keydown="activateOnKey($event, selectReportPreset, exporting, item.value)">{{ item.label }}</button></view>
					<AppButton role="button" size="sm" kind="neutral" :tabindex="(!reportCanExport || downloading || !canView('/pages/sale/list')) ? -1 : 0" :aria-disabled="!reportCanExport || downloading || !canView('/pages/sale/list')" :disabled="!reportCanExport || downloading || !canView('/pages/sale/list')" :loading="exporting || downloading" @click="exportReport" @keydown="activateOnKey($event, exportReport, !reportCanExport || downloading || !canView('/pages/sale/list'))">导出完整日报</AppButton>
				</view>
				<text class="brief__meta">{{ dateRange(reportRange) }} · {{ report ? `${report.rows.length} 天完整数据` : '正在确认完整范围' }}</text>
				<view v-if="reportError || exportError || downloadError" class="brief__issue" role="alert">{{ reportError || exportError || downloadError }}{{ reportStale ? '；表格保留上次读取结果，暂不能导出。' : '' }}</view>
				<text v-if="reportLoading" class="brief__meta" role="status">正在读取完整日期范围…</text>
				<AppButton role="button" v-if="reportError" size="sm" kind="ghost" :tabindex="(reportLoading) ? -1 : 0" :aria-disabled="reportLoading" :disabled="reportLoading" @click="refreshReport" @keydown="activateOnKey($event, refreshReport, reportLoading)">重试日报</AppButton>
				<scroll-view v-if="report" scroll-x class="brief__report-scroll">
					<view class="brief__table">
						<view class="brief__table-row brief__table-head"><text>日期</text><text>销售</text><text>销售客户</text><text>钢瓶充装</text><text>地方车</text><text>车辆燃气加注</text></view>
						<view v-for="row in report.rows" :key="row.date" class="brief__table-row">
							<text>{{ row.date.slice(5) }}</text>
							<view><text>{{ weight(row.saleWeightKg) }}</text><text class="brief__meta">{{ number(row.saleBottleCount) }} 瓶</text></view>
							<text>{{ number(row.saleCustomerCount) }} 户</text>
							<view><text>{{ weight(row.fillBottleWeightKg) }}</text><text class="brief__meta">{{ number(row.fillBottleCount) }} 瓶次</text></view>
							<view><text>{{ weight(row.localWeightKg) }}</text><text class="brief__meta">{{ number(row.localCount) }} 次</text></view>
							<view><text>{{ weight(row.vehicleWeightKg) }}</text><text class="brief__meta">{{ number(row.vehicleCount) }} 次</text></view>
						</view>
					</view>
				</scroll-view>
				<text class="brief__note">按日展示客户去重数。导出包含完整日期汇总和销售明细；读取失败或范围不全时不可导出。</text>
			</view>
		</view>
	</view>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import AppButton from '@/components/base/AppButton.vue'
import { useOperatingBrief } from '@/composables/dashboard/useOperatingBrief'
import { tankLossPresentation } from '@/services/mappers/operatingBrief'
import { buildDailyReportWorkbookXml, buildDailyReportExportFileName, downloadWorkbookFile } from './exportDailyReportWorkbook'

const props = defineProps({ canView: { type: Function, required: true } })
const emit = defineEmits(['navigate'])
const canReadCurrent = computed(() => props.canView('/pages/customer/list'))
const {
	period, result, loading, error, stale, selectPeriod, setVisible, refreshAll,
	current, currentLoading, currentError, currentStale,
	tankLoss, tankLossLoading, tankLossError, tankLossStale, refreshTankLoss,
	reportOpen, reportPreset, reportRange, report, reportLoading, reportError, reportStale,
	reportCanExport, exporting, exportError, toggleReport, selectReportPreset, refreshReport, prepareExport
} = useOperatingBrief({ canReadCurrent: () => canReadCurrent.value })
const periods = [{ value: 'yesterday', label: '昨天' }, { value: 'today', label: '今天' }, { value: 'month', label: '本月' }]
const reportPeriods = [{ value: 'today', label: '今天' }, { value: 'yesterday', label: '昨天' }, { value: 'last3', label: '近三日' }, { value: 'last5', label: '近五日' }, { value: 'lastMonth', label: '上月' }, { value: 'month', label: '本月' }]
const expanded = ref('')
const showScope = ref(false)
const downloading = ref(false)
const downloadError = ref('')
let pageVisible = true

function number(value, digits = 3) {
	if (value == null || value === '' || !Number.isFinite(Number(value))) return '—'
	return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits })
}
function money(value) { return value == null ? '—' : `¥${number(value)}` }
function weight(value) { return value == null ? '—' : `${number(value)} kg` }
function evidenceWeight(value) { return value == null ? '待补数据' : weight(value) }
function tankSampleText(row) { return row ? `接收 ${dateTime(row.observed_at)} · 液位 ${number(row.level_kpa)} kPa` : '缺少采样记录' }
function dateRange(range) { return range?.start === range?.end ? range?.start || '' : `${range?.start || ''} — ${range?.end || ''}` }
function dateTime(value) {
	if (value == null || value === '') return '时间待确认'
	const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value)
	if (!Number.isFinite(date.getTime())) return '时间待确认'
	return new Date(date.getTime() + 8 * 3600000).toISOString().slice(5, 16).replace('T', ' ')
}
const rangeLabel = computed(() => result.value ? `${dateRange(result.value.range)}${period.value === 'yesterday' ? ' · 按当前已登记记录' : ' · 截至当前已登记'}` : (period.value === 'month' ? '本月已登记记录' : `${period.value === 'today' ? '今天' : '昨天'}已登记记录`))
const leadText = computed(() => {
	const name = period.value === 'today' ? '今日截至目前' : period.value === 'month' ? '本月至今' : '昨日'
	return `${name}登记销售客户 ${number(result.value?.operations?.customer_count)} 户。业务与回款分别查看，历史回款计入到账日。`
})
const availableFundsLabel = computed(() => current.value?.current?.prepay_label || '可用款（不含退气抵款）')
const lossPresentation = computed(() => tankLossPresentation(tankLoss.value))
const lossValueText = computed(() => {
	if (lossPresentation.value.amount != null) return weight(lossPresentation.value.amount)
	if (tankLoss.value?.status === 'insufficient_data') return '待补数据'
	return tankLossLoading.value ? '读取中…' : '读取未完成'
})
const lossIssueText = computed(() => {
	const issues = tankLoss.value?.issues || []
	return issues.length ? `${issues[0].message}${issues.length > 1 ? `等 ${issues.length} 项` : ''}` : '期初、入罐或期末估算依据不足'
})
const currentTimeLabel = computed(() => current.value ? `截至 ${dateTime(current.value.updated_at)}${currentStale.value ? ' · 上次读取' : ''}` : '按当前时点核算')
const operationCards = computed(() => {
	const op = result.value?.operations
	return [
		{ key: 'sales', label: '销售重量', value: weight(op?.sale_weight_kg), sub: `${number(op?.sale_bottle_count)} 瓶` },
		{ key: 'customers', label: '销售客户', value: op ? `${number(op.customer_count)} 户` : '—', sub: '期间去重' },
		{ key: 'bottle', label: '钢瓶充装', value: weight(op?.fill_bottle_weight_kg), sub: `${number(op?.fill_bottle_count)} 瓶次` },
		{ key: 'local', label: '地方车', value: weight(op?.local_weight_kg), sub: `${number(op?.local_count)} 次` },
		{ key: 'vehicle', label: '车辆燃气加注', value: weight(op?.vehicle_weight_kg), sub: `${number(op?.vehicle_count)} 次` }
	]
})
const salesCards = computed(() => operationCards.value.slice(0, 2))
const outflowCards = computed(() => operationCards.value.slice(2))
const periodDetail = computed(() => {
	const data = result.value
	if (!data) return null
	const op = data.operations
	const entries = {
		business: { title: '已确认业务额构成', rows: [{ label: '独立计费销售', value: money(data.business.sales) }, { label: '有效流量结算', value: money(data.business.flow) }, { label: '业务额合计', value: money(data.business.total) }], note: '流量客户送气只记业务量，在流量结算时计金额；不代表选定期间实际用气收入。' },
		cash: { title: '气款到账构成', rows: [{ label: '气款收款', value: money(data.cash.received) }, { label: '气款退款', value: money(data.cash.refund) }, { label: '气款净收', value: money(data.cash.net) }], note: '正式收款单，按到账日期；含历史回款和预收，不含押金、抹零、非现金冲抵。', route: '/pages/cashier/receipt-intake', action: '打开收款登记' },
		sales: { title: '销售业务量', rows: [{ label: '销售重量', value: weight(op.sale_weight_kg) }, { label: '销售瓶数', value: `${number(op.sale_bottle_count)} 瓶` }], note: '按选定日期的销售记录归集，流量客户送气计入业务量。', route: '/pages/sale/list', action: '打开销售记录' },
		customers: { title: '销售客户', rows: [{ label: '期间去重客户', value: `${number(op.customer_count)} 户` }], note: '同一客户在选定期间多日销售只计一户，不能把每日户数相加当作期间客户数。', route: '/pages/sale/list', action: '打开销售记录' },
		outflow: { title: '已登记出罐量构成', rows: [{ label: '钢瓶充装', value: weight(op.fill_bottle_weight_kg) }, { label: '地方车', value: weight(op.local_weight_kg) }, { label: '车辆燃气加注', value: weight(op.vehicle_weight_kg) }, { label: '已登记出罐量合计', value: weight(op.recorded_outflow_kg) }], note: '按充装记录汇总。储罐按液位换算重量，与同周期入罐、出罐量核算估算损耗；正差为损耗，负差为盈余。', route: '/pages/gas-closure/index', action: '打开损耗核对' },
		bottle: { title: '钢瓶充装', rows: [{ label: '充装重量', value: weight(op.fill_bottle_weight_kg) }, { label: '充装瓶次', value: `${number(op.fill_bottle_count)} 瓶次` }], note: '按正重量充装记录计次；同一钢瓶多次充装可计多次。', route: '/pages/filling/list', action: '打开灌装记录' },
		local: { title: '地方车充装', rows: [{ label: '充装重量', value: weight(op.local_weight_kg) }, { label: '充装次数', value: `${number(op.local_count)} 次` }], note: '按地方车渠道的正重量记录统计。', route: '/pages/filling/list', action: '打开灌装记录' },
		vehicle: { title: '车辆燃气加注', rows: [{ label: '加注重量', value: weight(op.vehicle_weight_kg) }, { label: '加注次数', value: `${number(op.vehicle_count)} 次` }], note: '按车辆燃气加注渠道的正重量记录统计，与钢瓶和地方车分列。', route: '/pages/filling/list', action: '打开灌装记录' }
	}
	return entries[expanded.value] || null
})
const currentDetail = computed(() => {
	const data = current.value
	if (!data) return null
	const entries = {
		debt: { title: '当前客户欠款', rows: [{ label: '客户欠款合计', value: money(data.current.receivable) }], note: '按各客户核算欠款后汇总，其他客户的预收款不冲减此金额。', route: '/pages/customer/list?scene=statement', action: '打开客户对账' },
		prepay: { title: availableFundsLabel.value, rows: [{ label: '可用款合计', value: money(data.current.prepay) }], note: '按客户资金账本核算的可用款，不代表新增现金，不含退气抵款；具体来源在客户对账中查看。', route: '/pages/customer/list?scene=statement', action: '打开客户对账' },
		pending: { title: '结账收款待分配', rows: [{ label: '待分配收款', value: `${number(data.pending.count)} 笔` }, { label: '待分配金额', value: money(data.pending.amount) }], note: '只提示用于结账且尚有待分配金额的收款，正常预付款不作为异常。进入收款登记核对对应账单。', route: '/pages/cashier/receipt-intake', action: '打开收款登记' }
	}
	return entries[expanded.value] || null
})
function activateOnKey(event, action, disabled = false, value) {
	if (disabled || !['Enter', ' '].includes(event?.key)) return
	event.preventDefault()
	if (!event.repeat) action(value)
}
function navigateTo(route) { emit('navigate', route) }
function toggleScope() { showScope.value = !showScope.value }
function toggleDetail(value) { expanded.value = expanded.value === value ? '' : value }
function changePeriod(value) { expanded.value = ''; selectPeriod(value) }
async function exportReport() {
	if (downloading.value) return
	downloadError.value = ''
	const prepared = await prepareExport()
	if (!prepared || !prepared.isCurrent()) return
	downloading.value = true
	try {
		const workbook = buildDailyReportWorkbookXml({ summaryRows: prepared.summaryRows, salesRows: prepared.salesRows, periodLabel: dateRange(prepared.range) })
		if (!prepared.isCurrent()) return
		const downloaded = await downloadWorkbookFile(workbook, buildDailyReportExportFileName({ dateStart: prepared.range.start, dateEnd: prepared.range.end }))
		if (!downloaded && prepared.isCurrent()) downloadError.value = '当前端不支持文件下载，请在网页版导出'
	} catch (err) {
		if (prepared.isCurrent()) downloadError.value = err?.message || '导出失败'
	} finally { downloading.value = false }
}
function updateVisibility() { setVisible(pageVisible && (typeof document === 'undefined' || !document.hidden)) }
onShow(() => { pageVisible = true; updateVisibility() })
onHide(() => { pageVisible = false; updateVisibility() })
onMounted(() => {
	updateVisibility()
	if (typeof document !== 'undefined') document.addEventListener('visibilitychange', updateVisibility)
})
onBeforeUnmount(() => {
	pageVisible = false
	setVisible(false)
	if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', updateVisibility)
})
</script>

<style scoped>
.brief { min-width: 0; padding: 24px; color: var(--crm-text); background: var(--crm-surface); border: 1px solid var(--crm-border); border-radius: var(--crm-radius-lg); }
.brief button { margin: 0; line-height: 1.5; font: inherit; color: inherit; cursor: pointer; box-sizing: border-box; }
.brief button::after { border: 0; }
.brief button:focus-visible { outline: 2px solid var(--crm-primary); outline-offset: 3px; }
.brief button[disabled] { cursor: default; }
.brief__heading, .brief__toolbar, .brief__section-heading, .brief__footer, .brief__report-toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.brief__heading > view { display: flex; flex-direction: column; gap: 4px; }
.brief__eyebrow { font-size: 12px; color: var(--crm-text-muted); }
.brief__title { font-size: 22px; font-weight: 600; }
.brief__toolbar { margin-top: 20px; margin-bottom: 16px; }
.brief__periods { display: flex; padding: 3px; gap: 3px; background: var(--crm-bg); border-radius: 8px; }
.brief__period { min-height: 36px; padding: 7px 20px; border: 0; border-radius: 5px; background: transparent; color: var(--crm-text-muted) !important; font-size: 14px !important; }
.brief__period--active { color: var(--crm-primary) !important; background: var(--crm-surface); box-shadow: var(--crm-shadow-sm); }
.brief__meta { font-size: 12px; color: var(--crm-text-muted); line-height: 1.6; }
.brief__lead { display: block; margin: 0 0 18px; font-size: 14px; line-height: 1.7; }
.brief__issue { margin: 10px 0; padding: 10px 12px; border-left: 3px solid var(--crm-warning); background: #fff8ed; color: #8b5014; font-size: 13px; line-height: 1.6; }
.brief__metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.brief__metric { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; padding: 20px; border: 1px solid var(--crm-border-weak); border-radius: var(--crm-radius-md); background: #f5f8fc; text-align: left; }
.brief__label { font-size: 14px; }
.brief__amount { max-width: 100%; overflow-wrap: anywhere; font-size: clamp(24px, 2.4vw, 34px); font-weight: 600; line-height: 1.3; font-variant-numeric: tabular-nums; letter-spacing: -0.5px; }
.brief__link { color: var(--crm-primary); font-size: 12px; }
.brief__operations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 20px 0; }
.brief__outflow { padding: 16px; margin-bottom: 18px; border: 1px solid var(--crm-border-weak); border-radius: var(--crm-radius-md); }
.brief__outflow-total { min-height: 36px; padding: 0; border: 0; background: transparent; text-align: right; color: var(--crm-primary) !important; font-size: 19px !important; font-weight: 500 !important; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.brief__outflow-channels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding-top: 12px; }
.brief__outflow-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0 8px; padding-top: 10px; }
.brief__outflow-footer .brief__text-button { padding-right: 0; }
.brief__loss { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 16px !important; padding: 12px; border: 1px solid #f1e1c5; border-radius: var(--crm-radius-sm); background: #fffbf3; text-align: left; }
.brief__loss > view { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.brief__loss-amount { align-items: flex-end; font-size: 22px; font-weight: 600; color: #86500f; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.brief__loss--surplus { background: #f2f8fc; border-color: #d7e8f5; }
.brief__loss--surplus .brief__loss-amount { color: var(--crm-primary); }
.brief__loss-issue { display: block; color: #86500f; font-size: 12px; line-height: 1.7; margin-top: 6px; }
.brief__loss-detail { margin-top: 12px; margin-bottom: 0 !important; }
.brief__loss-detail .brief__detail-row > text:last-child { flex-shrink: 0; }
.brief__loss-result { padding-top: 10px; border-top: 1px solid var(--crm-border); font-weight: 600; }
.brief__operation { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 5px; padding: 0; border: 0; border-radius: 4px; background: transparent; text-align: left; }
.brief__operation-value { font-size: 16px; line-height: 1.4; font-weight: 500; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.brief__operation-sub { font-size: 11px; color: var(--crm-text-muted); }
.brief__current { border-top: 1px solid var(--crm-border); padding-top: 18px; }
.brief__section-title, .brief__detail-title { font-size: 14px; font-weight: 600; }
.brief__balances { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 12px 0 16px; }
.brief__balance { display: flex; min-width: 0; align-items: flex-start; flex-direction: column; gap: 4px; padding: 0; border: 0; background: transparent; text-align: left; }
.brief__balance-value { font-size: 20px; font-weight: 500; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.brief__pending { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid #f3e4c9; border-radius: var(--crm-radius-sm); background: #fffbf3; color: #86500f !important; text-align: left; }
.brief__pending > view { display: flex; flex-direction: column; gap: 3px; }
.brief__pending-title { font-size: 14px; font-weight: 500; }
.brief__pending-sub, .brief__pending-action { font-size: 12px; }
.brief__pending-action { white-space: nowrap; }
.brief__detail { display: flex; flex-direction: column; align-items: stretch; gap: 10px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--crm-border-weak); border-radius: var(--crm-radius-sm); background: var(--crm-bg); }
.brief__current .brief__detail { margin: 12px 0 0; }
.brief__detail-row { display: flex; justify-content: space-between; gap: 16px; font-size: 13px; font-variant-numeric: tabular-nums; }
.brief__detail :deep(.btn) { align-self: flex-start; padding-left: 0; }
.brief__note { display: block; color: var(--crm-text-muted); font-size: 12px; line-height: 1.7; }
.brief__footer { margin-top: 16px; }
.brief__text-button { min-height: 36px; padding: 5px 8px; border: 0; background: transparent; color: var(--crm-primary) !important; font-size: 12px !important; }
.brief__scope { display: flex; flex-direction: column; gap: 7px; margin: 10px 0 16px; color: var(--crm-text-muted); font-size: 12px; line-height: 1.7; }
.brief__report { margin-top: 12px; border-top: 1px solid var(--crm-border); }
.brief__report-toggle { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 0 0; border: 0; background: transparent; text-align: left; font-size: 13px !important; }
.brief__report-content { display: flex; flex-direction: column; align-items: stretch; gap: 12px; padding-top: 16px; }
.brief__report-periods { display: flex; flex-wrap: wrap; gap: 3px; }
.brief__report-periods .brief__text-button { color: var(--crm-text-muted) !important; }
.brief__report-periods .brief__text-button--active { background: var(--crm-primary-weak); border-radius: var(--crm-radius-sm); color: var(--crm-primary) !important; }
.brief__report-scroll { width: 100%; min-width: 0; }
.brief__table { min-width: 650px; border: 1px solid var(--crm-border); border-radius: var(--crm-radius-sm); overflow: hidden; }
.brief__table-row { display: grid; grid-template-columns: 70px minmax(100px, 1fr) 75px repeat(3, minmax(120px, 1fr)); align-items: center; min-height: 58px; font-size: 12px; text-align: center; font-variant-numeric: tabular-nums; }
.brief__table-row + .brief__table-row { border-top: 1px solid var(--crm-border-weak); }
.brief__table-row > view { display: flex; flex-direction: column; gap: 2px; padding: 8px 5px; }
.brief__table-head { min-height: 36px; background: var(--crm-bg); color: var(--crm-text-muted); }
@media (hover: hover) { .brief__metric:not([disabled]):hover, .brief__operation:not([disabled]):hover, .brief__balance:not([disabled]):hover { background: var(--crm-primary-weak); } }
@media (max-width: 600px) {
	.brief { padding: 18px 16px; }
	.brief__heading { gap: 6px; }
	.brief__title { font-size: 21px; }
	.brief__metrics { gap: 10px; }
	.brief__metric { padding: 14px 12px; }
	.brief__amount { font-size: 25px; }
	.brief__outflow { padding: 12px; }
	.brief__outflow-channels { gap: 8px; }
	.brief__outflow-channels .brief__operation-value { font-size: 14px; }
	.brief__outflow-total { min-height: 44px; font-size: 18px !important; }
	.brief__loss-amount { font-size: 20px; }
	.brief__pending { align-items: flex-start; padding: 12px; }
	.brief__balance-value { font-size: 19px; }
	.brief__period, .brief__text-button, .brief__operation, .brief__balance, .brief__report-toggle { min-height: 44px; }
}
@media (max-width: 380px) { .brief__metrics { grid-template-columns: 1fr; } .brief__balances { grid-template-columns: 1fr; } }
</style>
