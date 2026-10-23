<template>
	<view class="brief">
		<view class="brief__heading"><view><text class="brief__eyebrow">业务 · 货款 · 回款</text><text class="brief__title">经营简报</text></view><AppButton role="button" size="sm" kind="ghost" :tabindex="loading || currentLoading ? -1 : 0" :disabled="loading || currentLoading" :aria-disabled="loading || currentLoading" @click="refreshAll" @keydown="activateOnKey($event, refreshAll, loading || currentLoading)">刷新</AppButton></view>
		<view class="brief__toolbar"><view class="brief__periods" aria-label="经营简报统计期间"><button role="button" tabindex="0" v-for="item in periods" :key="item.value" class="brief__period" :class="{ 'brief__period--active': period === item.value }" :aria-pressed="period === item.value" @click="changePeriod(item.value)" @keydown="activateOnKey($event, changePeriod, false, item.value)">{{ item.label }}</button></view><text class="brief__meta">{{ rangeLabel }}</text></view>
		<view v-if="error" class="brief__issue" role="alert">{{ error }}{{ stale ? '；以下为上次成功读取的数据。' : '；货款与收款暂不可用。' }}</view>
		<text v-else-if="loading" class="brief__meta" role="status">{{ result ? '正在更新已登记记录…' : '正在读取经营简报…' }}</text>
		<view v-if="reviewItems.length" class="brief__review">
			<button role="button" tabindex="0" class="brief__review-toggle" :aria-expanded="expanded === 'review'" @click="toggleDetail('review')" @keydown="activateOnKey($event, toggleDetail, false, 'review')"><view><text class="brief__section-title">业务数据有待核事项</text><text class="brief__note">{{ reviewItems[0].label }}：{{ reviewItems[0].message }}</text></view><text class="brief__link">{{ expanded === 'review' ? '收起' : '查看' }}</text></button>
			<view v-if="expanded === 'review'" class="brief__review-list"><view v-for="item in reviewItems" :key="item.key" class="brief__review-item"><view><text v-if="item.context" class="brief__label">{{ item.context }}</text><text class="brief__note">{{ item.label }} · {{ item.message }}</text><text v-if="item.sourceId" class="brief__note brief__reference" selectable>来源 {{ item.sourceId }}</text><text v-if="item.hint" class="brief__note">{{ item.hint }}</text></view><view class="brief__review-actions"><button v-for="action in allowedActions(item)" :key="action.route" role="button" tabindex="0" class="brief__text-button" @click="navigateTo(action.route)" @keydown="activateOnKey($event, navigateTo, false, action.route)">{{ action.label }} →</button></view></view></view>
		</view>
		<view class="brief__ledger brief__gas">
			<view class="brief__section-heading"><text class="brief__section-title">业务概况</text><text class="brief__meta">{{ periodNoun }}已登记</text></view>
			<view class="brief__sales-strip"><text>销售出货 {{ weight(result?.operations?.sale_weight_kg) }}</text><text>{{ number(result?.operations?.sale_bottle_count) }} 瓶 · {{ number(result?.operations?.customer_count) }} 户</text></view>
			<text v-if="tankLossError" class="brief__loss-issue" role="alert">{{ tankLossError }}{{ tankLossStale ? '；保留上次读取结果。' : '；估算暂不可用。' }}</text><text v-else-if="tankLoss?.status === 'insufficient_data'" class="brief__loss-issue">{{ lossIssueText }}</text><text v-else-if="tankLossLoading" class="brief__meta" role="status">正在读取储罐估算依据…</text><text v-if="tankLossStale" class="brief__note">气量为上次读取结果，更新于 {{ dateTime(tankLoss?.updated_at) }}</text>
			<view class="brief__outflow-channels"><view v-for="item in outflowCards" :key="item.key" class="brief__operation"><text class="brief__meta">{{ item.label }}</text><text class="brief__operation-value">{{ item.complete ? weight(item.weight_kg) : '待核' }}</text><text class="brief__operation-sub">{{ item.complete ? number(item.count) + ' ' + item.count_unit : '记录待核' }}</text></view></view>
			<text v-if="otherOutflow && (!otherOutflow.complete || otherOutflow.weight_kg > 0)" class="brief__note brief__other">整车补气及其他 {{ otherOutflow.complete ? weight(otherOutflow.weight_kg) : '待核' }} · {{ number(otherOutflow.count) }} 次</text>
			<button role="button" tabindex="0" class="brief__gas-summary" :aria-expanded="expanded === 'loss'" @click="toggleDetail('loss')" @keydown="activateOnKey($event, toggleDetail, false, 'loss')"><view><text class="brief__meta">已登记出罐</text><text class="brief__subamount">{{ weight(tankLoss?.outflow?.weight_kg) }}</text></view><view><text class="brief__meta">{{ lossPresentation.label }}</text><text class="brief__subamount">{{ lossValueText }}</text></view><text class="brief__link">核对依据 →</text></button>
			<text v-if="lossPresentation.needsReview" class="brief__loss-issue">{{ lossIssueText }}；损耗暂无法确认。</text>
			<view v-if="expanded === 'loss'" class="brief__detail brief__loss-detail"><text class="brief__detail-title">气量核对依据</text><template v-if="tankLoss"><text class="brief__note">{{ dateRange(tankLoss.range) }} · 更新于 {{ dateTime(tankLoss.updated_at) }}</text><view class="brief__detail-row"><view><text>期初估算重量</text><text class="brief__note">{{ tankSampleText(tankLoss.opening) }}</text></view><text>{{ evidenceWeight(tankLoss.opening?.weight_kg) }}</text></view><view class="brief__detail-row"><text>期间入罐</text><text>{{ evidenceWeight(tankLoss.inbound_kg) }}</text></view><view class="brief__detail-row"><view><text>期末估算重量</text><text class="brief__note">{{ tankSampleText(tankLoss.closing) }}</text></view><text>{{ evidenceWeight(tankLoss.closing?.weight_kg) }}</text></view><view class="brief__detail-row"><text>储罐耗气（液位估算）</text><text>{{ evidenceWeight(tankConsumption) }}</text></view><view class="brief__detail-row"><text>已登记出罐</text><text>{{ evidenceWeight(tankLoss.recorded_outflow_kg) }}</text></view><view class="brief__detail-row"><text>{{ lossPresentation.needsReview ? '气量差额（待核）' : '估算损耗' }}</text><text>{{ evidenceWeight(tankLoss.estimated_loss_kg) }}</text></view><text v-for="(issue, index) in tankLoss.issues" :key="index" class="brief__loss-issue">{{ issue.message }}</text></template><text class="brief__note">期初估算 + 期间入罐 − 期末估算 − 已登记出罐。正差作为估算损耗；负差需核对液位与入库、出罐记录，暂不确认损耗。保留小数用于核对，不代表仪表精度。</text><AppButton role="button" :tabindex="tankLossLoading ? -1 : 0" :disabled="tankLossLoading" size="sm" kind="ghost" @click="refreshTankLoss" @keydown="activateOnKey($event, refreshTankLoss, tankLossLoading)">重新核算</AppButton>
			<view class="brief__outflow-footer"><button v-if="lossPresentation.needsReview && canView('/pages/gas-in/list')" role="button" tabindex="0" class="brief__text-button" @click="navigateTo('/pages/gas-in/list')" @keydown="activateOnKey($event, navigateTo, false, '/pages/gas-in/list')">核对入库记录 →</button><button v-if="canView('/pages/gas-closure/index')" role="button" tabindex="0" class="brief__text-button" @click="navigateTo('/pages/gas-closure/index')" @keydown="activateOnKey($event, navigateTo, false, '/pages/gas-closure/index')">损耗核对 →</button></view></view>
		</view>
		<view class="brief__ledger">
			<view class="brief__section-heading"><text class="brief__section-title">{{ periodNoun }}货款</text><text class="brief__meta">销售 + 流量结算</text></view>
			<view class="brief__hero"><view><text class="brief__label">货款净额</text><text class="brief__amount">{{ amountFor(result?.business, 'net') }}</text></view><button role="button" :tabindex="result ? 0 : -1" :disabled="!result" :aria-expanded="expanded === 'business'" class="brief__text-button" @click="toggleDetail('business')" @keydown="activateOnKey($event, toggleDetail, !result, 'business')">明细 →</button></view>
			<view v-if="result?.business?.negative !== 0" class="brief__net-equation"><text>正向货款 {{ amountFor(result?.business, 'positive') }}</text><text>− 负向货款 {{ amountFor(result?.business, 'negative') }}</text></view>
			<view class="brief__settlement">
				<view class="brief__section-heading"><text class="brief__label">这批货款的当前结算</text><text class="brief__meta">截至 {{ result ? dateTime(result.updated_at) : '本次读取' }}</text></view>
				<view class="brief__settlement-grid"><view><text class="brief__meta">已抵货款</text><text class="brief__subamount">{{ amountFor(settlement, 'allocated') }}</text></view><view><text class="brief__meta">抹零</text><text class="brief__subamount">{{ amountFor(settlement, 'rounding') }}</text></view><view><text class="brief__meta">还欠</text><text class="brief__subamount">{{ amountFor(settlement, 'outstanding') }}</text></view></view>
				<text class="brief__note">只拆正向货款；已抵货款含预收款、抵款。</text>
				<text v-if="settlement?.complete === false" class="brief__loss-issue">结算进度待核，暂不显示拆分金额。</text>
			</view>
			<view v-if="expanded === 'business' && result" class="brief__detail"><text class="brief__detail-title">货款明细</text><view class="brief__detail-row"><text>正向货款</text><text>{{ amountFor(result.business, 'positive') }}</text></view><view class="brief__detail-row"><text>负向货款</text><text>{{ amountFor(result.business, 'negative') }}</text></view><view class="brief__detail-row"><text>独立计费销售</text><text>{{ amountFor(result.business, 'sales') }}</text></view><view class="brief__detail-row"><text>有效流量结算</text><text>{{ amountFor(result.business, 'flow') }}</text></view><view class="brief__detail-row"><text>销售抹零 / 收款抹零</text><text>{{ amountFor(settlement, 'sale_rounding') }} / {{ amountFor(settlement, 'receipt_rounding') }}</text></view><text class="brief__note">货款净额＝正向货款－负向货款，抹零单列。已抵货款指已核销金额，可含预收款、退气抵款等，不代表当天收款。流量客户送气记业务量，结算时计货款；结算状态按当前记录核算。</text><button v-if="canView('/pages/sale/list')" role="button" tabindex="0" class="brief__text-button" @click="navigateTo('/pages/sale/list')" @keydown="activateOnKey($event, navigateTo, false, '/pages/sale/list')">查看销售记录 →</button></view>
		</view>
		<view class="brief__ledger">
			<view class="brief__section-heading"><view><text class="brief__section-title">{{ periodNoun }}收款</text><text class="brief__meta brief__inline-note">按到账日</text></view><button role="button" :tabindex="result ? 0 : -1" :disabled="!result" class="brief__text-button" :aria-expanded="expanded === 'cash'" @click="toggleDetail('cash')" @keydown="activateOnKey($event, toggleDetail, !result, 'cash')">收款去向 {{ expanded === 'cash' ? '−' : '+' }}</button></view>
			<view class="brief__cash-grid"><view><text class="brief__label">到账</text><text class="brief__subamount">{{ amountFor(result?.cash, 'received') }}</text></view><view v-if="!noCashRefund"><text class="brief__label">退款</text><text class="brief__subamount">{{ amountFor(result?.cash, 'refund') }}</text></view><view v-if="!noCashRefund"><text class="brief__label">净到账</text><text class="brief__subamount">{{ amountFor(result?.cash, 'net') }}</text></view></view>
			<text class="brief__note">{{ noCashRefund ? '无退款，到账即净到账。' : '' }}含往期回款和预收，不含押金、抵款。</text>
			<text v-if="result?.cash?.evidence?.complete === false" class="brief__loss-issue">收款依据待核，请查看上方提示。</text>
			<view v-if="expanded === 'cash'" class="brief__detail"><template v-if="destinations?.complete"><view v-for="row in destinationRows" :key="row.key" class="brief__detail-row"><text>{{ row.label }}</text><text>{{ money(row.amount) }}</text></view></template><text v-else class="brief__loss-issue">收款去向待核，暂不显示部分分配结果。</text><text class="brief__note">按当前有效分配追踪这批收款，合计等于上方实际收款。后续已退款也保留在去向中；当日退款单独按退款日期统计。</text><button v-if="canView('/pages/cashier/receipt-intake')" role="button" tabindex="0" class="brief__text-button" @click="navigateTo('/pages/cashier/receipt-intake')" @keydown="activateOnKey($event, navigateTo, false, '/pages/cashier/receipt-intake')">打开收款登记 →</button></view>
		</view>
		<view v-if="canReadCurrent" class="brief__ledger brief__current">
			<view class="brief__section-heading"><text class="brief__section-title">当前客户资金</text><text class="brief__meta">不随日期切换</text></view>
			<text class="brief__meta">{{ currentTimeLabel }}</text>
			<view v-if="currentError" class="brief__issue" role="alert">读取失败：{{ currentError }}{{ currentStale ? '；以下保留上次读取结果。' : '；请刷新重试。' }}</view><text v-else-if="currentLoading" class="brief__meta" role="status">{{ current ? '正在更新客户资金…' : '正在读取客户资金…' }}</text>
			<view v-if="currentMetrics.length" class="brief__balances"><view v-for="item in currentMetrics" :key="item.key"><view><text class="brief__meta">{{ item.label }}</text><text v-if="item.coverage" class="brief__note">{{ item.coverage }}</text></view><text class="brief__balance-value">{{ money(item.amount) }}</text></view></view>
			<text v-if="currentMetrics.some(item => item.key === 'funds')" class="brief__note brief__funds-note">可用款不含退气抵款</text>
			<view v-if="currentReviewItems.length" class="brief__current-review">
				<button role="button" tabindex="0" class="brief__review-toggle" :aria-expanded="expanded === 'current-review'" @click="toggleDetail('current-review')" @keydown="activateOnKey($event, toggleDetail, false, 'current-review')"><view><text class="brief__label">{{ currentMetrics.length ? '客户账款有待核事项' : '客户资金暂不可汇总' }}</text><text class="brief__note">{{ currentReviewItems[0].message }}</text></view><text class="brief__link">{{ expanded === 'current-review' ? '收起' : '查看原因' }}</text></button>
				<view v-if="expanded === 'current-review'" class="brief__review-list"><view v-for="item in currentReviewItems" :key="item.key" class="brief__review-item"><view><text v-if="item.context" class="brief__label">{{ item.context }}</text><text class="brief__note">{{ item.label }} · {{ item.message }}</text><text v-if="item.sourceId" class="brief__note brief__reference" selectable>来源 {{ item.sourceId }}</text><text v-if="item.hint" class="brief__note">{{ item.hint }}</text></view><view class="brief__review-actions"><button v-for="action in allowedActions(item)" :key="action.route" role="button" tabindex="0" class="brief__text-button" @click="navigateTo(action.route)" @keydown="activateOnKey($event, navigateTo, false, action.route)">{{ action.label }} →</button></view></view><text v-if="currentIssuesIncomplete" class="brief__note">仅列出已返回的待核来源，完整范围仍需确认。</text></view>
			</view>
			<view v-if="ranking?.complete" class="brief__ranking"><view class="brief__section-heading"><text class="brief__label">欠款前三</text><text v-if="ranking.items.length" class="brief__meta">占全部欠款 {{ percentage(topShare) }}</text></view><template v-if="ranking.items.length"><text class="brief__note">按欠款金额排序，不代表逾期。</text><button v-for="(item, index) in ranking.items" :key="item.customer_id" role="button" :tabindex="canView('/pages/customer/statement') ? 0 : -1" :disabled="!canView('/pages/customer/statement')" class="brief__rank-row" @click="openCustomer(item.customer_id)" @keydown="activateOnKey($event, openCustomer, !canView('/pages/customer/statement'), item.customer_id)"><text class="brief__rank">{{ index + 1 }}</text><view class="brief__rank-name"><text>{{ item.name }}</text><text class="brief__meta">{{ item.code }}</text></view><view class="brief__rank-amount"><text>{{ money(item.amount) }}</text><text class="brief__meta">占 {{ percentage(item.share_of_total) }} <text v-if="canView('/pages/customer/statement')">→</text></text></view></button></template><text v-else class="brief__empty">暂无客户欠款</text></view>
			<button v-if="current?.pending?.complete && current.pending.count > 0" role="button" tabindex="0" class="brief__pending" :aria-expanded="expanded === 'pending'" @click="toggleDetail('pending')" @keydown="activateOnKey($event, toggleDetail, false, 'pending')"><view><text class="brief__pending-title">待匹配账单 {{ number(current.pending.count) }} 笔</text><text class="brief__pending-sub">{{ money(current.pending.amount) }}</text></view><text class="brief__pending-action">查看 →</text></button>
			<view v-if="expanded === 'pending'" class="brief__detail"><text class="brief__note">只包含用于结账且尚有未分配金额的收款。可在收款登记中核对账单。</text><button v-if="canView('/pages/cashier/receipt-intake')" role="button" tabindex="0" class="brief__text-button" @click="navigateTo('/pages/cashier/receipt-intake')" @keydown="activateOnKey($event, navigateTo, false, '/pages/cashier/receipt-intake')">打开收款登记 →</button></view>
		</view>

		<view class="brief__footer"><text class="brief__meta">{{ result ? `业务数据更新于 ${dateTime(result.updated_at)}` : '业务数据尚未读取完成' }}</text><button role="button" tabindex="0" class="brief__text-button" :aria-expanded="showScope" @click="toggleScope" @keydown="activateOnKey($event, toggleScope)">{{ showScope ? '收起口径' : '统计口径' }}</button></view>
		<view v-if="showScope" class="brief__scope"><text>日期切换货款、收退款和气量；当前欠款、可用款及待分配按标注的读取时点核算。结算进度与收款去向也按当前有效记录展示，不是历史日末快照。</text><text>客户欠款逐户核算后汇总，不以其他客户预收款冲减。TOP3只在完整核算全部可见客户后展示；欠款金额排序不代表逾期或信用风险。</text><text>储罐重量使用现有液位换算，钢瓶、地方车、车辆燃气及其他出罐使用同一截止时点。历史补录或更正后，结果可能变化。</text></view>
		<view class="brief__report">
			<button role="button" tabindex="0" class="brief__report-toggle" :aria-expanded="reportOpen" @click="toggleReport" @keydown="activateOnKey($event, toggleReport)"><text>业务明细与导出</text><text class="brief__link">{{ reportOpen ? '收起 −' : '展开 +' }}</text></button>
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
import { tankLossPresentation, operatingReviewItems } from '@/services/mappers/operatingBrief'
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
function money(value) { return value == null ? '—' : `¥${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}` }
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
const periodNoun = computed(() => period.value === 'month' ? '本月' : period.value === 'today' ? '今日' : '昨日')
function amountFor(domain, key, values = domain) { return domain?.complete === false ? '待核' : money(values?.[key]) }
function percentage(value) { return `${number(value * 100, 1)}%` }
const settlement = computed(() => result.value?.business?.positive_settlement)
const destinations = computed(() => result.value?.cash?.destinations)
const ranking = computed(() => current.value?.current?.debt_ranking)
const topShare = computed(() => (ranking.value?.items || []).reduce((sum, item) => sum + item.share_of_total, 0))
const noCashRefund = computed(() => result.value?.cash?.complete === true && result.value.cash.refund === 0 && result.value.cash.received === result.value.cash.net)
const lossPresentation = computed(() => tankLossPresentation(tankLoss.value))
const lossValueText = computed(() => {
	if (lossPresentation.value.needsReview) return '暂无法确认'
	const amount = lossPresentation.value.amount
	if (amount != null) return amount === 0 ? '0 kg' : amount < 1 ? '不足 1 kg' : `约 ${number(amount, 0)} kg`
	return tankLossLoading.value && !tankLoss.value ? '读取中…' : '待补数据'
})
const tankConsumption = computed(() => tankLoss.value?.estimated_consumption_kg)
const lossIssueText = computed(() => {
	const issues = tankLoss.value?.issues || []
	return issues.length ? `${issues[0].message}${issues.length > 1 ? `等 ${issues.length} 项` : ''}` : '期初、入罐或期末估算依据不足'
})
const currentTimeLabel = computed(() => current.value ? `截至 ${dateTime(current.value.updated_at)}${currentStale.value ? ' · 上次读取' : ''}` : '按当前时点核算')
const outflowCards = computed(() => (tankLoss.value?.outflow?.channels || [
	{ key: 'bottle', label: '钢瓶充装' }, { key: 'local', label: '地方车' }, { key: 'vehicle', label: '车辆燃气加注' }
]).filter(row => row.key !== 'other'))
const otherOutflow = computed(() => tankLoss.value?.outflow?.channels?.find(row => row.key === 'other'))
const destinationRows = computed(() => [
	['same_period', `${periodNoun.value}货款`], ['prior_period', '往期货款'], ['future_period', '后来形成的货款'],
	['other', '其他账单'], ['refunded_after_or_current', '后续已退款'], ['remaining_prepay', '预收款未使用'],
	['remaining_settlement', '结账款待匹配'], ['remaining_unknown', '余款用途待确认']
].map(([key, label]) => ({ key, label, amount: destinations.value?.[key] })))
const reviewItems = computed(() => {
	const data = result.value
	return operatingReviewItems([
		['货款', data?.business], ['货款结算', data?.business?.positive_settlement], ['到账凭据', data?.cash],
		['收款依据', data?.cash?.evidence], ['收款去向', data?.cash?.destinations], ['销售业务量', data?.operations]
	])
})
const currentReviewItems = computed(() => operatingReviewItems([
	['客户欠款', current.value?.current?.debt], ['客户可用款', current.value?.current?.available_funds], ['结账待分配', current.value?.pending]
]))
const currentIssuesIncomplete = computed(() => [current.value?.current?.debt, current.value?.current?.available_funds].some(block => block?.issues_complete === false))
const currentMetrics = computed(() => [
	['debt', '客户欠款', current.value?.current?.debt], ['funds', '客户可用款', current.value?.current?.available_funds]
].filter(([, , block]) => block && ['available', 'partial'].includes(block.status)).map(([key, label, block]) => ({
	key, label: block.status === 'partial' ? `已核${label}小计` : label, amount: block.verified_subtotal,
	coverage: block.status === 'partial' ? `已核 ${number(block.coverage.verified_customers)} / ${number(block.coverage.total_customers)} 户，${number(block.coverage.pending_customers)} 户待核` : ''
})))
function allowedActions(item) { return item.actions.filter(action => props.canView(action.route.split('?')[0])) }
function openCustomer(id) { navigateTo(`/pages/customer/statement?_id=${encodeURIComponent(id)}`) }
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
.brief__link { color: var(--crm-primary); font-size: 12px; white-space: nowrap; flex-shrink: 0; }
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

.brief__ledger { padding: 22px 0; border-bottom: 1px solid var(--crm-border); }
.brief__ledger:first-of-type { padding-top: 0; }
.brief__hero { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; margin-top: 16px; }
.brief__hero > view { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.brief__hero .brief__amount { font-size: clamp(28px, 3vw, 38px); }
.brief__net-equation { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 13px; color: var(--crm-text-muted); margin: 10px 0 18px; font-variant-numeric: tabular-nums; }
.brief__settlement { padding: 16px; border-radius: 8px; background: var(--crm-bg); }
.brief__settlement-grid, .brief__cash-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 14px 0 10px; }
.brief__settlement-grid > view, .brief__cash-grid > view, .brief__balances > view { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.brief__subamount { font-size: clamp(17px, 1.8vw, 23px); line-height: 1.4; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.brief__sales-note { display: block; font-size: 12px; color: var(--crm-text-muted); margin-top: 12px; }
.brief__disclosure { display: flex; justify-content: space-between; width: 100%; gap: 12px; background: transparent; border: 0; padding: 14px 0 0; text-align: left; font-size: 13px !important; }
.brief__ledger .brief__detail { margin: 14px 0 0; }
.brief__current { border-top: 0; }
.brief__ranking { margin: 16px 0; border: 1px solid var(--crm-border); border-radius: 8px; padding: 14px 16px; }
.brief__ranking > .brief__note { margin: 5px 0 10px; }
.brief__rank-row { width: 100%; display: flex; align-items: center; gap: 12px; border: 0; border-top: 1px solid var(--crm-border-weak); background: transparent; padding: 11px 0; text-align: left; }
.brief__rank { color: var(--crm-text-muted); font-size: 13px; width: 16px; }
.brief__rank-name { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 14px; overflow-wrap: anywhere; }
.brief__rank-amount { display: flex; flex-direction: column; align-items: flex-end; font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; }
.brief__empty { display: block; padding: 12px 0 4px; font-size: 13px; color: var(--crm-text-muted); }
.brief__gas-equation { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr); gap: 10px; align-items: start; margin: 18px 0; }
.brief__gas-equation > view, .brief__gas-result { display: flex; flex-direction: column; gap: 6px; }
.brief__gas-result { background: transparent; border: 0; padding: 0; text-align: left; }
.brief__operator { color: var(--crm-text-muted); align-self: center; font-size: 18px; }
.brief__outflow-channels { border-top: 1px solid var(--crm-border-weak); padding-top: 16px; }
.brief__other { margin-top: 10px; }
.brief__review { border: 1px solid var(--crm-border); border-left: 3px solid var(--crm-warning); border-radius: 6px; margin: 14px 0 0; background: var(--crm-bg); }
.brief__review-toggle { display: flex; width: 100%; justify-content: space-between; align-items: center; gap: 12px; background: transparent; border: 0; padding: 12px 14px; text-align: left; }
.brief__review-toggle > view { min-width: 0; }
.brief__review-list { padding: 0 14px 12px; }
.brief__review-item { display: flex; flex-direction: column; align-items: stretch; gap: 2px; border-top: 1px solid var(--crm-border-weak); padding-top: 8px; }
@media (max-width: 600px) {
 .brief__ledger { padding: 18px 0; }
 .brief__settlement { padding: 12px; }
 .brief__settlement-grid, .brief__cash-grid { gap: 10px; }
 .brief__subamount { font-size: 17px; }
 .brief__gas-equation { gap: 5px; }
 .brief__gas-equation .brief__subamount { font-size: 15px; }
 .brief__ranking { padding: 12px; }
 .brief__disclosure, .brief__gas-result { min-height: 44px; }
}


.brief__heading > view { gap: 1px; }
.brief__eyebrow { display: none; }
.brief__toolbar { margin-top: 12px; margin-bottom: 4px; gap: 6px; }
.brief__ledger { padding: 14px 0; }
.brief__hero { margin-top: 4px; align-items: center; }
.brief__hero > view { gap: 2px; }
.brief__hero .brief__amount { font-size: 30px; }
.brief__net-equation { margin: 6px 0; gap: 4px 12px; font-size: 12px; }
.brief__settlement { padding: 10px 12px; margin-top: 8px; }
.brief__settlement-grid, .brief__cash-grid { gap: 10px; margin: 8px 0 6px; }
.brief__subamount { font-size: 19px; white-space: nowrap; overflow-wrap: normal; }
.brief__sales-strip { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; margin-top: 10px; font-variant-numeric: tabular-nums; }
.brief__outflow-channels { border: 0; padding-top: 12px; gap: 10px; }
.brief__operation { gap: 3px; }
.brief__operation-value { font-size: 17px; }
.brief__gas-summary { width: 100%; display: grid; grid-template-columns: 1.2fr 1fr auto; align-items: center; gap: 10px; border: 0; background: var(--crm-bg); padding: 9px 10px; border-radius: 6px; margin-top: 12px !important; text-align: left; }
.brief__gas-summary > view { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.brief__gas-summary .brief__subamount { font-size: 17px; }
.brief__inline-note { margin-left: 8px; }
.brief__balances { margin: 10px 0 4px; gap: 10px; }
.brief__balance-value { font-size: 19px; }
.brief__ranking { padding: 0; border: 0; border-radius: 0; margin: 12px 0 4px; }
.brief__ranking > .brief__note { margin: 2px 0 4px; }
.brief__rank-row { padding: 7px 0; gap: 8px; min-height: 44px; }
.brief__rank-name, .brief__rank-amount { gap: 0; }
.brief__rank-amount { font-size: 15px; white-space: nowrap; }
.brief__pending { padding: 8px 10px; margin-top: 8px !important; background: var(--crm-bg); color: var(--crm-text) !important; border-color: var(--crm-border); }
.brief__pending > view { flex-direction: row; flex-wrap: wrap; gap: 2px 8px; align-items: center; }
.brief__pending-title { font-size: 12px; }
.brief__footer { margin-top: 8px; gap: 2px; }
.brief__report { margin-top: 6px; }
.brief__report-toggle { padding-top: 8px; }
.brief__review-toggle { padding: 8px 10px; }
@media (max-width: 600px) {
 .brief { padding: 14px 14px 10px; }
 .brief__ledger { padding: 12px 0; }
 .brief__title { font-size: 20px; }
 .brief__period { padding: 5px 16px; }
 .brief__hero .brief__amount { font-size: 28px; }
 .brief__settlement-grid, .brief__cash-grid { grid-template-columns: 1fr; gap: 2px; }
 .brief__settlement-grid > view, .brief__cash-grid > view { flex-direction: row; align-items: baseline; justify-content: space-between; gap: 10px; }
 .brief__settlement-grid .brief__subamount, .brief__cash-grid .brief__subamount { font-size: 17px; }
 .brief__settlement-grid { margin: 6px 0; }
 .brief__cash-grid { margin: 5px 0; }
 .brief__balances { grid-template-columns: 1fr; gap: 3px; }
 .brief__balances > view { flex-direction: row; justify-content: space-between; align-items: baseline; }
 .brief__balance-value { font-size: 17px; }
 .brief__operation { min-height: 0; }
 .brief__outflow-channels .brief__operation-value { font-size: 15px; }
 .brief__gas-summary { grid-template-columns: 1.15fr 1fr auto; gap: 6px; padding: 8px; }
 .brief__gas-summary .brief__subamount { font-size: 15px; }
 .brief__funds-note { text-align: right; }
 .brief__detail { padding: 12px; }
 .brief__detail-row { flex-wrap: wrap; gap: 3px 10px; }
 .brief__detail-row > text:last-child { margin-left: auto; }
}


.brief__amount, .brief__balance-value { white-space: nowrap; overflow-wrap: normal; }
.brief__hero { flex-wrap: wrap; }
.brief__pending, .brief__gas-summary { min-height: 44px; }
.brief__operation-sub { font-size: 12px; }
@media (max-width: 767px) {
 .brief__period, .brief__text-button, .brief__report-toggle, .brief__rank-row, .brief__review-toggle { min-height: 44px; }
 .brief__balances > view { flex-wrap: wrap; }
}
.brief__current-review { margin-top: 8px; border-radius: var(--crm-radius-sm); background: var(--crm-bg); }
.brief__current-review .brief__review-toggle { padding: 8px 10px; }
.brief__review-actions { display: flex; flex-wrap: wrap; gap: 0 8px; }
.brief__review-actions .brief__text-button { padding-left: 0; }
.brief__reference { overflow-wrap: anywhere; }
</style>
