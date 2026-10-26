<template>
	<view class="insights">
		<view class="insights__summary" aria-label="经营摘要">
			<text class="insights__title">经营摘要</text>
			<text v-for="(line, index) in summary" :key="index" class="insights__sentence">{{ line }}</text>
		</view>
		<view class="insights__head"><text class="insights__title">业务表现</text><text class="insights__muted">{{ period === 'today' ? '今日进行中' : '按当前登记记录' }}</text></view>
		<view class="insights__metrics">
			<view><text class="insights__muted">销售净气量</text><text class="insights__value">{{ operations?.complete ? number(operations.sale_weight_kg) + ' kg' : '待核' }}</text></view>
			<view><text class="insights__muted">出瓶数</text><text class="insights__value">{{ operations?.complete ? number(operations.sale_bottle_count) + ' 瓶' : '待核' }}</text></view>
			<view><text class="insights__muted">交易客户</text><text class="insights__value">{{ operations?.complete ? number(operations.customer_count) + ' 户' : '待核' }}</text></view>
		</view>
		<text class="insights__muted">净气量含回瓶余气扣减；交易客户按销售客户去重。</text>
		<text v-if="error" class="insights__warning" role="status">{{ error }}</text>
		<template v-if="analysis">
			<view class="insights__trend">
				<view class="insights__head"><text class="insights__label">近 7 个完整日 · 销售净气量</text><text class="insights__muted">kg</text></view>
				<text class="insights__muted">{{ range(analysis.trend.range) }}</text>
				<view class="insights__plot" role="img" :aria-label="trendDescription">
					<view class="insights__zero" :style="{ bottom: zero + '%' }"><text>0</text></view>
					<view v-for="point in analysis.trend.points" :key="point.date" class="insights__column">
						<view v-if="point.status === 'available' && point.value !== 0" class="insights__bar" :class="{ 'insights__bar--negative': point.value < 0 }" :style="barStyle(point.value)" />
						<text v-else-if="point.status !== 'available'" class="insights__gap">待核</text>
						<text v-else class="insights__real-zero" :style="{ bottom: zero + '%' }">0</text>
						<text class="insights__date">{{ point.date.slice(5) }}</text>
					</view>
				</view>
				<text class="insights__muted">{{ trendExtent }}；空缺表示待核，0 表示已登记净量为零。</text>
				<button role="button" tabindex="0" class="insights__button" :aria-expanded="dailyOpen" @click="dailyOpen = !dailyOpen" @keydown="activateOnKey($event, toggleDaily)">{{ dailyOpen ? '收起每日数值' : '查看每日数值' }}</button>
				<view v-if="dailyOpen" class="insights__daily"><view v-for="point in analysis.trend.points" :key="point.date"><text>{{ point.date }}</text><text>{{ point.status === 'available' ? number(point.value) + ' kg' : '待核' }}</text><text class="insights__muted">{{ point.status === 'available' ? point.source_count + ' 单' : point.issues[0]?.message }}</text><button v-if="canView('/pages/sale/list')" role="button" :tabindex="stale ? -1 : 0" :disabled="stale" class="insights__button" @click="$emit('sources', { metric: 'sale_weight_kg', scope: 'trend', date: point.date })" @keydown="activateOnKey($event, () => $emit('sources', { metric: 'sale_weight_kg', scope: 'trend', date: point.date }), stale)">原单 →</button></view></view>
			</view>
			<button role="button" tabindex="0" class="insights__button" :aria-expanded="comparisonOpen" @click="toggleComparison" @keydown="activateOnKey($event, toggleComparison)">{{ comparisonOpen ? '收起期间比较与客户贡献' : '查看期间比较与客户贡献' }}</button>
			<template v-if="comparisonOpen">
			<view class="insights__comparison">
				<view class="insights__head"><text class="insights__label">{{ period === 'month' ? '同日数比较（不含今天）' : '与前一完整日比较' }}</text><text v-if="stale" class="insights__warning">上次读取</text></view>
				<text v-if="comparison.status === 'not_comparable'" class="insights__muted">{{ period === 'today' ? '今天尚未结束，暂不与昨日全天比较。' : '本月尚无可比较的完整日。' }}</text>
				<template v-else>
					<text class="insights__muted">{{ range(comparison.current_range) }} 对 {{ range(comparison.baseline_range) }}</text>
					<view class="insights__compare-head"><text>指标</text><text>基期 → 本期</text><text>增减</text></view>
					<view v-for="metric in metrics" :key="metric.key" class="insights__compare-row">
						<text>{{ metric.label }}</text><text>{{ metric.data?.status === 'available' ? format(metric.data.baseline, metric.unit) + ' → ' + format(metric.data.current, metric.unit) : '待核' }}</text>
						<view><text>{{ metric.data?.status === 'available' ? signed(metric.data.delta, metric.unit) : '—' }}</text><text v-if="metric.data?.rate != null" class="insights__muted">{{ signed(metric.data.rate * 100, '%', 1) }}</text></view>
						<view v-if="sourceMetrics.some(row => row.key === metric.key)" class="insights__compare-sources"><button v-for="scope in ['baseline', 'current']" :key="scope" role="button" :tabindex="stale ? -1 : 0" :disabled="stale" class="insights__button" @click="$emit('sources', { metric: metric.key, scope })" @keydown="activateOnKey($event, () => $emit('sources', { metric: metric.key, scope }), stale)">{{ scope === 'baseline' ? '基期原单' : '本期原单' }} →</button></view>
					</view>
				</template>
			</view>
			<view v-if="analysis.drivers.status === 'available'" class="insights__drivers">
				<text class="insights__label">货款变化贡献 · 结算客户</text>
				<view v-for="row in analysis.drivers.items" :key="row.customer_id" class="insights__driver"><text>{{ row.name || row.code || '未命名客户' }}</text><text>{{ signed(row.delta, '元') }}</text></view>
				<view class="insights__driver insights__muted"><text>其他客户</text><text>{{ signed(analysis.drivers.other_delta, '元') }}</text></view>
				<view class="insights__driver"><text>合计变化</text><text>{{ signed(analysis.drivers.total_delta, '元') }}</text></view>
				<text class="insights__muted">按增减绝对值列前三，包含两期新增或未交易客户；金额贡献不代表变化原因。</text>
			</view>
			</template>
			<view class="insights__sources"><button role="button" tabindex="0" class="insights__button" :aria-expanded="sourcesOpen" @click="toggleSources" @keydown="activateOnKey($event, toggleSources)">{{ sourcesOpen ? '收起原单依据' : '查看原单依据' }}</button><view v-if="sourcesOpen" class="insights__source-buttons"><button v-for="metric in sourceMetrics" :key="metric.key" role="button" :tabindex="stale ? -1 : 0" :disabled="stale" class="insights__button" @click="$emit('sources', { metric: metric.key, scope: 'period' })" @keydown="activateOnKey($event, () => $emit('sources', { metric: metric.key, scope: 'period' }), stale)">{{ metric.label }} →</button></view><text v-if="sourcesOpen" class="insights__muted">来源为 CRM 登记记录；银行流水、实测库存与仪表校准尚未外部核验。</text></view>
		</template>
	</view>
</template>

<script setup>
import { computed, ref } from 'vue'
const props = defineProps({ analysis: { type: Object, default: null }, operations: { type: Object, default: null }, businessRange: { type: Object, default: null }, period: { type: String, default: 'yesterday' }, attention: { type: String, default: '' }, canView: { type: Function, default: () => false }, stale: Boolean, error: { type: String, default: '' }, tankLoss: { type: Object, default: null }, tankLossStale: Boolean, tankLossError: { type: String, default: '' }, tankLossLoading: Boolean })
defineEmits(['sources'])
const dailyOpen = ref(false)
const comparisonOpen = ref(false)
const sourcesOpen = ref(false)
const number = (value, digits = 3) => value == null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits })
const format = (value, unit) => `${number(value)}${unit === '%' ? '' : ' '}${unit}`
const signed = (value, unit, digits = 3) => `${value > 0 ? '+' : ''}${number(value, digits)}${unit === '%' ? '' : ' '}${unit}`
const range = value => !value ? '—' : value.start === value.end ? value.start : `${value.start} 至 ${value.end}`
const comparison = computed(() => props.analysis?.comparison)
const metrics = computed(() => [['sale_weight_kg', '净气量', 'kg'], ['business_net', '货款', '元'], ['cash_net', '净收款', '元'], ['customer_count', '交易客户', '户']].map(([key, label, unit]) => ({ key, label, unit, data: comparison.value?.metrics?.[key] })))
const sourceMetrics = computed(() => metrics.value.filter(row => {
	const paths = { sale_weight_kg: ['/pages/sale/list'], customer_count: ['/pages/sale/list'], business_net: ['/pages/sale/list', '/pages/customer/statement'], cash_net: ['/pages/cashier/receipt-intake'] }
	return paths[row.key].every(path => props.canView(path))
}))
const summary = computed(() => {
	const lines = [], change = comparison.value?.metrics?.sale_weight_kg
	const periodName = props.period === 'month' ? '本月' : props.period === 'today' ? '今日' : '昨日'
	if (props.stale) lines.push('业务数据保留上次读取结果，刷新后再判断最新变化。')
	else if (change?.status === 'available') lines.push(`${props.period === 'month' ? '本月可比完整日' : '昨日'}销售净气量 ${number(change.current)} kg，较基期${change.delta < 0 ? '减少' : change.delta > 0 ? '增加' : '持平'}${change.delta ? ' ' + number(Math.abs(change.delta)) + ' kg' : ''}。`)
	else if (props.operations?.complete) lines.push(`${periodName}已登记销售净气量 ${number(props.operations.sale_weight_kg)} kg、出瓶 ${number(props.operations.sale_bottle_count)} 瓶，涉及 ${number(props.operations.customer_count)} 户客户。${props.period === 'today' ? '今日仍在进行。' : '期间比较依据待核。'}`)
	else lines.push(props.period === 'today' ? '今日业务仍在进行，按已登记记录展示。' : props.analysis ? '业务比较依据尚不足，先核对受影响来源。' : '业务与货款按各自来源展示，比较依据尚未取得。')
	const gas = props.tankLoss?.period === props.period && (!props.businessRange ||
		props.tankLoss.range?.start === props.businessRange.start && props.tankLoss.range?.end === props.businessRange.end) ? props.tankLoss : null
	if (props.tankLossStale || props.tankLossError) lines.push('灌装与储罐依据更新未完成，重新读取后再判断。')
	else if (gas) {
		const bottle = gas.outflow?.channels?.find(row => row.key === 'bottle')
		const end = new Date(Number(gas.period_ended_at) + 8 * 3600000)
		const cutoff = props.period === 'yesterday' ? '' : `（截至 ${Number.isFinite(end.getTime()) ? end.toISOString().slice(5, 16).replace('T', ' ') : '本次读取'}）`
		lines.push(bottle?.complete ? `${periodName}${cutoff}登记钢瓶灌装 ${number(bottle.count)} 瓶次，共 ${number(bottle.weight_kg)} kg。` : `${periodName}钢瓶灌装记录待核，暂不能确认瓶次与气量。`)
		const level = gas.level_change_kpa
		let tank = typeof level === 'number' && gas.opening && gas.closing
			? `同期主罐采样液位${level < 0 ? '下降 ' + number(-level) : level > 0 ? '上升 ' + number(level) : '持平，变化 0'} kPa（${number(gas.opening.level_kpa)} → ${number(gas.closing.level_kpa)} kPa）`
			: '同期主罐液位变化待核'
		if (gas.status === 'available') {
			const loss = gas.estimated_loss_kg
			const estimate = loss === 0 ? '0 kg' : loss < 1 ? '不足 1 kg' : `约 ${number(loss, 0)} kg`
			tank += `；按储罐收支估算损耗${estimate}。该差额不能直接归为钢瓶灌装亏损。`
		} else tank += '；估算损耗待核。'
		lines.push(tank)
	} else if (props.tankLossLoading) lines.push('正在读取灌装瓶次、储罐液位和估算损耗依据。')
	const driver = !props.stale && props.analysis?.drivers?.status === 'available' && props.analysis.drivers.items[0]
	if (driver && driver.delta !== 0) lines.push(`${driver.name || driver.code || '首位客户'}的货款变化贡献最大：${signed(driver.delta, '元')}。`)
	if (props.attention) lines.push(`优先核对：${props.attention}`)
	return lines
})
const extent = computed(() => {
	const values = (props.analysis?.trend.points || []).filter(p => p.status === 'available').map(p => p.value)
	return { low: Math.min(0, ...values), high: Math.max(0, ...values), values }
})
const span = computed(() => extent.value.high - extent.value.low || 1)
const zero = computed(() => -extent.value.low / span.value * 100)
function barStyle(value) { return { height: `${Math.abs(value) / span.value * 100}%`, bottom: `${(Math.min(0, value) - extent.value.low) / span.value * 100}%` } }
const trendExtent = computed(() => extent.value.values.length ? `图示范围 ${number(extent.value.low)} 至 ${number(extent.value.high)} kg` : '每日数据待核')
const trendDescription = computed(() => (props.analysis?.trend.points || []).map(point => `${point.date}：${point.status === 'available' ? point.value + ' kg' : '待核'}`).join('；'))
function toggleComparison() { comparisonOpen.value = !comparisonOpen.value }
function toggleSources() { sourcesOpen.value = !sourcesOpen.value }
function toggleDaily() { dailyOpen.value = !dailyOpen.value }
function activateOnKey(event, action, disabled = false) {
	if (disabled || !['Enter', ' '].includes(event?.key)) return
	event.preventDefault(); if (!event.repeat) action()
}
</script>

<style scoped>
.insights { color: var(--crm-text); min-width: 0; font-size: 13px; }
.insights__summary { padding: 12px 14px; background: var(--crm-bg); border-radius: 6px; margin: 12px 0 18px; }
.insights__title, .insights__label { display: block; font-weight: 600; }
.insights__title { font-size: 15px; }
.insights__sentence { display: block; margin-top: 6px; line-height: 1.6; }
.insights__head { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.insights__muted { color: var(--crm-text-muted); font-size: 12px; line-height: 1.6; display: block; }
.insights__warning { color: var(--crm-warning); font-size: 12px; display: block; }
.insights__metrics { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 12px; margin: 12px 0 6px; }
.insights__value { display: block; font-size: clamp(16px, 2vw, 23px); font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.insights__comparison, .insights__trend, .insights__drivers { margin-top: 12px; }
.insights__sources { display: inline-block; margin-left: 20px; vertical-align: top; }
.insights__compare-head, .insights__compare-row { display: grid; grid-template-columns: 68px minmax(0, 1fr) minmax(64px, .7fr); gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--crm-border-weak); font-variant-numeric: tabular-nums; }
.insights__compare-row > :nth-child(3) { text-align: right; }
.insights__compare-head { color: var(--crm-text-muted); font-size: 11px; }
.insights__plot { position: relative; height: 92px; margin: 16px 0 29px 12px; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
.insights__column { position: relative; min-width: 0; }
.insights__bar { position: absolute; width: 62%; left: 19%; background: var(--crm-primary); border-radius: 2px 2px 0 0; }
.insights__bar--negative { background: var(--crm-text-muted); border-radius: 0 0 2px 2px; }
.insights__zero { position: absolute; width: 100%; border-top: 1px solid var(--crm-border); }
.insights__zero > text { position: absolute; left: -12px; top: -8px; color: var(--crm-text-muted); font-size: 10px; }
.insights__date { position: absolute; top: calc(100% + 6px); left: 0; width: 100%; text-align: center; font-size: 11px; color: var(--crm-text-muted); white-space: nowrap; }
.insights__gap { position: absolute; bottom: 30%; width: 100%; text-align: center; font-size: 11px; color: var(--crm-text-muted); }
.insights__real-zero { position: absolute; left: 40%; font-size: 10px; color: var(--crm-text-muted); }
.insights__driver, .insights__daily > view { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; padding: 7px 0; font-variant-numeric: tabular-nums; }
.insights__daily > view { border-bottom: 1px solid var(--crm-border-weak); }
.insights__button { display: inline-flex; align-items: center; min-height: 44px; padding: 6px 0; margin: 0; border: 0; background: transparent; color: var(--crm-primary); font-size: 12px; line-height: 1.5; cursor: pointer; }
.insights__button::after { border: 0; }
.insights__button:focus-visible { outline: 2px solid var(--crm-primary); outline-offset: 2px; }
.insights__compare-sources { grid-column: 1 / -1; display: flex; gap: 20px; }
.insights__button[disabled] { opacity: .6; cursor: default; }
.insights__source-buttons { display: flex; flex-wrap: wrap; gap: 0 18px; }
@media (min-width: 900px) { .insights__trend { max-width: 600px; } }
@media (max-width: 380px) { .insights__compare-row, .insights__compare-head { grid-template-columns: 54px minmax(0, 1fr) 74px; font-size: 11px; gap: 4px; } .insights__metrics { gap: 6px; } }
</style>
