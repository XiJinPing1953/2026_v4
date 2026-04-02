<template>
	<AppCard class="bottle-lines-card" :padding="size === 'sm' ? '20rpx' : '32rpx'">
		<view class="card-body">
			<view class="section-head">
				<view class="section-title-wrap">
					<text class="section-title">{{ title }}</text>
					<text class="section-sub">{{ subtitle }}</text>
				</view>
				<view class="section-actions">
					<AppButton kind="ghost" size="sm" @click="toggleBatch">批量粘贴</AppButton>
				</view>
			</view>

			<view v-if="showBatch" class="batch-panel">
				<textarea
					class="batch-textarea"
					v-model="batchText"
					placeholder="每行一个瓶号，支持逗号/空格/换行分隔"
					maxlength="2000"
				/>
				<view class="batch-actions">
					<AppButton size="sm" kind="primary" @click="applyBatch">追加</AppButton>
					<AppButton size="sm" kind="neutral" @click="cancelBatch">取消</AppButton>
				</view>
			</view>

			<view v-if="rows.length === 0">
				<AppEmpty title="暂无明细" subtitle="点击下方按钮新增" />
				<view class="empty-action">
					<AppButton kind="ghost" size="sm" @click="addRow" icon="plus">新增明细行</AppButton>
				</view>
			</view>
			<view v-else class="rows">
				<view v-for="(row, index) in rows" :key="index" :class="['row-item', { 'row-item--suggesting': row.suggestions && row.suggestions.length }]">
					<view class="row-grid">
						<view class="grid-item bottle-cell">
							<text class="field-label">{{ bottleLabel }}</text>
							<view class="bottle-input-wrap">
								<AppInput
									:model-value="row.bottle_no"
									:placeholder="bottlePlaceholder"
									:size="size"
									@update:modelValue="(v) => onBottleInput(index, v)"
									@focus="() => onBottleFocus(index)"
									@blur="() => onBottleBlur(index)"
									@confirm="() => onBottleConfirm(index)"
								/>
								<view v-if="row.suggestions && row.suggestions.length" class="suggestions">
									<view
										v-for="item in row.suggestions"
										:key="item._id || item.bottle_no"
										class="suggestion-item"
										@tap.stop="selectSuggestion(index, item)"
									>
										<text class="suggestion-no">{{ item.bottle_no }}</text>
										<text class="suggestion-sub">{{ formatBottleSuggestionSub(item) }}</text>
									</view>
								</view>
							</view>
						</view>
						<view class="grid-item">
							<text class="field-label">毛重 (kg)</text>
							<AppInput
								:model-value="row.gross"
								placeholder="kg"
								:size="size"
								@update:modelValue="(v) => onWeightChange(index, 'gross', v)"
							/>
						</view>
						<view class="grid-item">
							<text class="field-label">皮重 (kg)</text>
							<AppInput
								:model-value="row.tare"
								placeholder="kg"
								:size="size"
								@update:modelValue="(v) => onWeightChange(index, 'tare', v)"
							/>
						</view>
						<view class="grid-item net-cell">
							<text class="field-label">净重 (kg)</text>
							<text class="btn-remove" @tap.stop="removeRow(index)">删除</text>
							<view class="net-input">
								<AppInput
									:model-value="row.net"
									:placeholder="netPlaceholder"
									:size="size"
									@update:modelValue="(v) => onNetInput(index, v)"
								/>
							</view>
							<view v-if="index === rows.length - 1" class="btn-add" @tap.stop="addRow">
								<AppIcon name="plus" size="26rpx" color="#2563eb" />
							</view>
						</view>
					</view>
				</view>
			</view>

			<view class="summary-block">
				<view class="summary-pill">
					<text class="summary-label">{{ summaryLabel }}：</text>
					<text class="summary-value">{{ totalNetText }} kg</text>
				</view>
				<text v-if="netFormula" class="summary-formula">{{ netFormula }}</text>
				<view v-if="showBackAmount" class="summary-back">
					<text class="summary-label">按单价结算：</text>
					<text class="summary-value" :class="backAmountClass">{{ backAmountAbs }} 元</text>
					<text class="summary-tip">{{ backAmountDirection }}</text>
				</view>
			</view>
		</view>
	</AppCard>
</template>

<script setup>
import { computed, ref } from 'vue'
import AppCard from '@/components/base/AppCard.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { formatBottleSuggestionSub, normalizeBottleNo, searchBottleSuggestions } from '@/composables/useBottleSuggestions'

const props = defineProps({
	modelValue: { type: Array, default: () => [] },
	size: { type: String, default: 'md' },
	title: { type: String, default: '出瓶' },
	subtitle: { type: String, default: '本次送出去的瓶子，可添加多行' },
	bottleLabel: { type: String, default: '出厂瓶号' },
	bottlePlaceholder: { type: String, default: '例如 207，支持模糊搜索' },
	netPlaceholder: { type: String, default: '若不填将按 毛重-皮重' },
	summaryLabel: { type: String, default: '本次出瓶净重合计' },
	type: { type: String, default: 'out' },
	unitPrice: { type: [String, Number], default: '' },
	priceUnit: { type: String, default: 'kg' }
})

const emit = defineEmits(['update:modelValue'])

const showBatch = ref(false)
const batchText = ref('')
const rows = computed(() => props.modelValue || [])
const suggestTimers = new Map()

const totalNetNumber = computed(() => {
	return rows.value.reduce((sum, row) => {
		const value = Number(row?.net)
		return sum + (Number.isNaN(value) ? 0 : value)
	}, 0)
})

const totalNetText = computed(() => totalNetNumber.value.toFixed(2))

const netFormula = computed(() => {
	const nums = rows.value
		.map((row) => Number(row?.net))
		.filter((num) => Number.isFinite(num) && num !== 0)
	if (!nums.length) return ''
	let expr = ''
	nums.forEach((num, idx) => {
		const val = Math.abs(num).toFixed(2)
		if (idx === 0) expr += (num < 0 ? '-' : '') + val
		else expr += (num < 0 ? '-' : '+') + val
	})
	const total = totalNetNumber.value.toFixed(2)
	return `${expr}=${total}kg`
})

const unitPriceNumber = computed(() => {
	const num = Number(props.unitPrice)
	return Number.isFinite(num) ? num : 0
})

const showBackAmount = computed(() => props.type === 'back' && props.priceUnit === 'kg' && unitPriceNumber.value > 0)

const backAmount = computed(() => {
	if (!showBackAmount.value) return 0
	return totalNetNumber.value * unitPriceNumber.value
})

const backAmountAbs = computed(() => Math.abs(backAmount.value).toFixed(2))

const backAmountDirection = computed(() => {
	if (backAmount.value > 0) return '（需退给客户）'
	if (backAmount.value < 0) return '（需客户补）'
	return ''
})

const backAmountClass = computed(() => {
	if (backAmount.value > 0) return 'summary-negative'
	if (backAmount.value < 0) return 'summary-positive'
	return ''
})

function toggleBatch() {
	showBatch.value = !showBatch.value
}

function cancelBatch() {
	batchText.value = ''
	showBatch.value = false
}

function applyBatch() {
	const tokens = batchText.value
		.split(/[\s,，;；]+/)
		.map((item) => item.trim())
		.filter(Boolean)
	if (!tokens.length) {
		cancelBatch()
		return
	}
	const existing = new Set(rows.value.map((row) => normalizeKey(row.bottle_no)))
	const nextRows = [...rows.value]
	const seen = new Set()
	tokens.forEach((token) => {
		const key = normalizeKey(token)
		if (!key || existing.has(key) || seen.has(key)) return
		seen.add(key)
		existing.add(key)
		nextRows.push(createRow(token))
	})
	emit('update:modelValue', nextRows)
	cancelBatch()
}

function normalizeKey(value) {
	return normalizeBottleNo(value)
}

function createRow(no = '') {
	return {
		bottle_no: no,
		bottle_id: null,
		gross: '',
		tare: '',
		net: '',
		netManual: false,
		suggestions: []
	}
}

function patchRow(index, patch) {
	const next = rows.value.map((row, idx) => (idx === index ? { ...row, ...patch } : row))
	emit('update:modelValue', next)
}

function onBottleInput(index, value) {
	const row = rows.value[index] || {}
	const nextBottleNo = normalizeBottleNo(value)
	const prevBottleNo = normalizeBottleNo(row.bottle_no)
	const isBottleChanged = nextBottleNo !== prevBottleNo
	const patch = {
		bottle_no: value,
		bottle_id: null,
		suggestions: []
	}
	if (isBottleChanged) {
		patch.tare = ''
		if (!row.netManual) patch.net = ''
	}
	patchRow(index, {
		...patch
	})
	if (suggestTimers.has(index)) clearTimeout(suggestTimers.get(index))
	if (!value) return
	const timer = setTimeout(() => {
		fetchSuggestions(index, value)
	}, 200)
	suggestTimers.set(index, timer)
}

function onBottleFocus(index) {
	const row = rows.value[index]
	const keyword = normalizeBottleNo(row?.bottle_no)
	if (!keyword) return
	if (suggestTimers.has(index)) clearTimeout(suggestTimers.get(index))
	const timer = setTimeout(() => {
		fetchSuggestions(index, keyword)
	}, 120)
	suggestTimers.set(index, timer)
}

function onBottleBlur(index) {
	setTimeout(() => {
		const row = rows.value[index]
		if (!row) return
		void onBottleConfirm(index)
	}, 150)
}

async function onBottleConfirm(index) {
	const row = rows.value[index]
	if (!row) return
	const keyword = normalizeBottleNo(row.bottle_no)
	if (!keyword) {
		patchRow(index, { bottle_no: '', bottle_id: null, suggestions: [] })
		return
	}
	const list = await searchBottleSuggestions(keyword, { limit: 20 })
	const current = rows.value[index]
	if (!current || normalizeBottleNo(current.bottle_no) !== keyword) return
	const exact = (list || []).find((item) => normalizeBottleNo(item && item.bottle_no) === keyword)
	if (exact) {
		selectSuggestion(index, exact)
		return
	}
	patchRow(index, {
		bottle_no: keyword,
		bottle_id: null,
		suggestions: []
	})
}

async function fetchSuggestions(index, keyword) {
	const row = rows.value[index]
	if (!row) return
	if (normalizeBottleNo(row.bottle_no) !== normalizeBottleNo(keyword)) return
	const list = await searchBottleSuggestions(keyword, { limit: 20 })
	if (normalizeBottleNo((rows.value[index] || {}).bottle_no) !== normalizeBottleNo(keyword)) return
	patchRow(index, { suggestions: list })
}

function selectSuggestion(index, item) {
	const row = rows.value[index] || {}
	const nextBottleNo = normalizeBottleNo(item && item.bottle_no)
	const prevBottleNo = normalizeBottleNo(row && row.bottle_no)
	const isBottleChanged = nextBottleNo !== prevBottleNo
	const next = {
		bottle_no: nextBottleNo,
		bottle_id: item._id,
		suggestions: [],
		netManual: false
	}
	const tareValue = extractTareWeight(item)
	if (tareValue != null) {
		next.tare = String(tareValue)
	} else if (isBottleChanged) {
		next.tare = ''
	}
	const merged = { ...row, ...next }
	if (!merged.netManual) {
		const net = calcNet(merged)
		if (net !== null) merged.net = net
	}
	patchRow(index, merged)
}

function onWeightChange(index, key, value) {
	const row = rows.value[index] || {}
	const next = { ...row, [key]: value }
	if (!next.netManual) {
		const net = calcNet(next)
		if (net !== null) next.net = net
	}
	patchRow(index, next)
}

function onNetInput(index, value) {
	const row = rows.value[index] || {}
	patchRow(index, { ...row, net: value, netManual: true })
}

function calcNet(row) {
	const gross = Number(row.gross)
	const tare = Number(row.tare)
	if (!Number.isNaN(gross) && !Number.isNaN(tare)) {
		return (gross - tare).toFixed(2)
	}
	return null
}

function addRow() {
	emit('update:modelValue', [...rows.value, createRow('')])
}

function removeRow(index) {
	const next = rows.value.filter((_, idx) => idx !== index)
	emit('update:modelValue', next)
}

function formatTare(value) {
	if (value == null || value === '') return '-'
	const num = Number(value)
	if (!Number.isFinite(num)) return '-'
	return num.toFixed(2)
}

function extractTareWeight(item = {}) {
	const candidates = [item.tare_weight, item.tareWeight, item.tare]
	for (let i = 0; i < candidates.length; i += 1) {
		const num = Number(candidates[i])
		if (Number.isFinite(num)) return num
	}
	return null
}

</script>

<style scoped>
.bottle-lines-card {
	overflow: visible;
}

.card-body {
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.section-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
}

.section-title-wrap {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
}

.section-title {
	font-size: 28rpx;
	font-weight: 700;
	color: #0f172a;
}

.section-sub {
	font-size: 24rpx;
	color: #94a3b8;
}

.section-actions {
	display: flex;
	align-items: center;
	gap: 12rpx;
}

.batch-panel {
	border: 1rpx solid #e2e8f0;
	border-radius: 14rpx;
	padding: 14rpx;
	background: #f8fafc;
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.batch-textarea {
	width: 100%;
	min-height: 120rpx;
	padding: 12rpx;
	border-radius: 12rpx;
	border: 1rpx solid #e2e8f0;
	background: #fff;
	font-size: 24rpx;
	color: #0f172a;
	box-sizing: border-box;
}

.batch-actions {
	display: flex;
	gap: 12rpx;
	justify-content: flex-end;
}

.rows {
	display: flex;
	flex-direction: column;
	gap: 22rpx;
}

.row-item {
	display: flex;
	flex-direction: column;
	gap: 18rpx;
	position: relative;
	z-index: 1;
	overflow: visible;
	padding: 20rpx;
	background: #fff;
	border: 1rpx solid #eef2f7;
	border-radius: 16rpx;
	box-shadow: 0 4rpx 10rpx rgba(15, 23, 42, 0.04);
}

.row-item--suggesting {
	z-index: 30;
	padding-bottom: 340rpx;
}

.row-grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 18rpx;
	align-items: flex-start;
}

.field-label {
	display: block;
	font-size: 22rpx;
	color: #64748b;
	line-height: 1.2;
}

.grid-item {
	min-width: 0;
}

.grid-item > .field-label {
	margin-bottom: 8rpx;
}

.bottle-cell {
	position: relative;
	z-index: 20;
}

.bottle-input-wrap {
	position: relative;
}

.net-cell {
	display: grid;
	grid-template-columns: 1fr 52rpx;
	grid-template-rows: auto auto;
	column-gap: 12rpx;
	row-gap: 8rpx;
	align-items: center;
}

.btn-remove {
	grid-column: 2;
	grid-row: 1;
	justify-self: center;
	align-self: baseline;
	font-size: 22rpx;
	color: #ef4444;
	font-weight: 600;
	line-height: 1.2;
	padding: 0;
	border-radius: 6rpx;
	white-space: nowrap;
}
.btn-remove:active {
	color: #dc2626;
}

.btn-add {
	grid-column: 2;
	grid-row: 2;
	justify-self: center;
	align-self: center;
	width: 52rpx;
	height: 52rpx;
	display: grid;
	place-items: center;
	background: #fff;
	border: 1rpx solid #c7d2fe;
	border-radius: 50%;
	box-shadow: 0 8rpx 14rpx rgba(59, 130, 246, 0.12);
	z-index: 2;
}

.btn-add .app-icon {
	display: block;
	transform: translateY(-7.5rpx);
}

.net-input {
	grid-column: 1;
	grid-row: 2;
}

.suggestions {
	position: absolute;
	top: calc(100% + 8rpx);
	left: 0;
	right: 0;
	z-index: 20;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, 0.08);
	max-height: 320rpx;
	overflow: auto;
}

.suggestion-item {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	padding: 14rpx 16rpx;
	border-bottom: 1rpx solid #f1f5f9;
}

.suggestion-item:last-child {
	border-bottom: none;
}

.suggestion-item:active {
	background: #f8fafc;
}

.suggestion-no {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.suggestion-sub {
	display: block;
	color: var(--crm-text-muted);
	font-size: 20rpx;
}

.empty-action {
	display: flex;
	justify-content: flex-start;
	margin-top: 12rpx;
}

.summary-block {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
	margin-top: 6rpx;
}

.summary-pill {
	display: flex;
	width: 100%;
	align-items: center;
	gap: 10rpx;
	background: #f8fafc;
	border: 1rpx solid #eef2f7;
	border-radius: 14rpx;
	padding: 18rpx 20rpx;
}

.summary-label {
	font-size: 24rpx;
	color: #64748b;
}

.summary-value {
	font-size: 28rpx;
	font-weight: 700;
	color: #0f172a;
}

.summary-formula {
	font-size: 22rpx;
	color: #94a3b8;
	padding-left: 6rpx;
}

.summary-back {
	display: flex;
	align-items: center;
	gap: 8rpx;
	font-size: 24rpx;
	color: #64748b;
}

.summary-tip {
	font-size: 22rpx;
	color: #94a3b8;
}

.summary-positive {
	color: #16a34a;
}

.summary-negative {
	color: #ef4444;
}

@media (max-width: 600px) {
	.row-grid {
		grid-template-columns: repeat(2, 1fr);
	}
	.net-cell {
		grid-template-columns: 1fr 52rpx;
	}
	.section-head {
		flex-direction: column;
		align-items: flex-start;
	}
	.batch-actions {
		justify-content: flex-start;
	}
	.summary-back {
		flex-wrap: wrap;
	}
}
</style>
