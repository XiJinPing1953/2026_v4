<template>
	<AppCard :padding="size === 'sm' ? '20rpx' : '32rpx'">
		<view class="card-body">
			<view v-if="rows.length === 0">
				<AppEmpty title="暂无存瓶" subtitle="点击下方按钮新增" />
				<view class="empty-action">
					<AppButton kind="ghost" size="sm" @click="addRow" icon="plus">新增明细行</AppButton>
				</view>
			</view>
			<view v-else class="rows">
				<view v-for="(row, index) in rows" :key="index" :class="['row-item', { 'row-item--suggesting': row.suggestions && row.suggestions.length }]">
					<view class="row-grid">
						<view class="grid-main">
							<view class="bottle-input-wrap">
								<AppInput
									:model-value="row.bottle_no"
									label="存入瓶号"
									placeholder="输入瓶号联想钢瓶档案"
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
						<view class="row-actions">
							<text class="btn-remove" @tap.stop="removeRow(index)">删除</text>
							<view v-if="index === rows.length - 1" class="btn-add" @tap.stop="addRow">
								<AppIcon name="plus" size="26rpx" color="#2563eb" />
							</view>
						</view>
					</view>
				</view>
			</view>

			<view class="summary-block">
				<view class="summary-pill">
					<text class="summary-label">本次存瓶数：</text>
					<text class="summary-value">{{ rows.length }}</text>
				</view>
			</view>
		</view>
	</AppCard>
</template>

<script setup>
import { computed } from 'vue'
import AppCard from '@/components/base/AppCard.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { formatBottleSuggestionSub, normalizeBottleNo, searchBottleSuggestions } from '@/composables/useBottleSuggestions'

const props = defineProps({
	modelValue: { type: Array, default: () => [] },
	size: { type: String, default: 'md' }
})

const emit = defineEmits(['update:modelValue'])

const rows = computed(() => props.modelValue || [])
const suggestTimers = new Map()

function patchRow(index, patch) {
	const next = rows.value.map((row, idx) => (idx === index ? { ...row, ...patch } : row))
	emit('update:modelValue', next)
}

function onBottleInput(index, value) {
	patchRow(index, { bottle_no: value, bottle_id: null, suggestions: [] })
	if (suggestTimers.has(index)) clearTimeout(suggestTimers.get(index))
	if (!value) return
	const timer = setTimeout(() => {
		void fetchSuggestions(index, value)
	}, 200)
	suggestTimers.set(index, timer)
}

function onBottleFocus(index) {
	const keyword = normalizeBottleNo(rows.value[index]?.bottle_no)
	if (!keyword) return
	if (suggestTimers.has(index)) clearTimeout(suggestTimers.get(index))
	const timer = setTimeout(() => {
		void fetchSuggestions(index, keyword)
	}, 120)
	suggestTimers.set(index, timer)
}

function onBottleBlur(index) {
	setTimeout(() => {
		if (!rows.value[index]) return
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
	patchRow(index, { bottle_no: keyword, bottle_id: null, suggestions: [] })
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
	patchRow(index, {
		bottle_no: normalizeBottleNo(item?.bottle_no),
		bottle_id: item?._id || null,
		suggestions: []
	})
}

function addRow() {
	emit('update:modelValue', [...rows.value, { bottle_no: '', bottle_id: null, suggestions: [] }])
}

function removeRow(index) {
	const next = rows.value.filter((_, idx) => idx !== index)
	emit('update:modelValue', next)
}
</script>

<style scoped>
.card-body {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.rows {
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.row-item {
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
	grid-template-columns: 1fr 52rpx;
	gap: 12rpx;
	align-items: center;
}

.grid-main {
	min-width: 0;
}

.bottle-input-wrap {
	position: relative;
}

.row-actions {
	display: grid;
	grid-template-rows: auto auto;
	row-gap: 8rpx;
	justify-items: center;
	align-items: center;
	min-height: 104rpx;
}

.btn-remove {
	font-size: 22rpx;
	color: #ef4444;
	font-weight: 600;
	line-height: 1.2;
	justify-self: center;
	align-self: baseline;
	white-space: nowrap;
}

.btn-remove:active {
	color: #dc2626;
}

.btn-add {
	width: 52rpx;
	height: 52rpx;
	display: grid;
	place-items: center;
	background: #fff;
	border: 1rpx solid #c7d2fe;
	border-radius: 50%;
	box-shadow: 0 8rpx 14rpx rgba(59, 130, 246, 0.12);
	justify-self: center;
	align-self: center;
	z-index: 2;
}

.btn-add .app-icon {
	display: block;
	transform: translateY(-7.5rpx);
}

.empty-action {
	display: flex;
	justify-content: flex-start;
	margin-top: 12rpx;
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
</style>
