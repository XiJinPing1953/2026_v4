<template>
	<view class="filling-time-picker">
		<view class="time-field">
			<text class="time-field__label">{{ label }}</text>
			<picker mode="multiSelector" :range="dateRanges" :value="dateSelection" @columnchange="onDateColumnChange" @change="onDateChange" @cancel="syncSelection">
				<button class="time-field__button" :aria-label="`${label}：${dateValue || '请选择日期'}`">
					<AppIcon name="calendar" size="18px" class="time-field__icon" />
					<text>{{ dateValue || '请选择日期' }}</text>
				</button>
			</picker>
		</view>
		<view class="time-field">
			<text class="time-field__label">小时</text>
			<picker mode="multiSelector" :range="[hourOptions]" range-key="label" :value="hourSelection" @columnchange="onHourColumnChange" @change="onHourChange" @cancel="syncSelection">
				<button class="time-field__button time-field__button--hour" :aria-label="`${label}小时：${hourOptions[hourIndex].label}`">
					<text>{{ hourValue ? `${hourValue}时` : '未记录' }}</text>
					<AppIcon name="chevron-right" size="14px" class="time-field__arrow" />
				</button>
			</picker>
		</view>
	</view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'

const props = defineProps({ modelValue: { type: String, default: '' }, label: { type: String, default: '灌装日期' } })
const emit = defineEmits(['update:modelValue'])
const pad = value => String(value).padStart(2, '0')
const years = Array.from({ length: 231 }, (_, index) => `${1970 + index}年`)
const months = Array.from({ length: 12 }, (_, index) => `${pad(index + 1)}月`)
const dateSelection = ref([0, 0, 0])
const hourSelection = ref([0])
const dateRanges = computed(() => [years, months, Array.from({
	length: new Date(Date.UTC(1970 + dateSelection.value[0], dateSelection.value[1] + 1, 0)).getUTCDate()
}, (_, index) => `${pad(index + 1)}日`)])
const hourOptions = [
	{ label: '未记录小时', value: '' },
	...Array.from({ length: 24 }, (_, hour) => {
		const value = String(hour).padStart(2, '0')
		return { label: `${value}时`, value }
	})
]
// Keep the existing API value (YYYY-MM-DD[-HH]); labels are presentation only.
const dateValue = computed(() => props.modelValue.slice(0, 10))
const hourValue = computed(() => props.modelValue.split('-')[3] || '')
const hourIndex = computed(() => Math.max(0, hourOptions.findIndex(option => option.value === hourValue.value)))

function todayUtc8() {
	return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
}
function syncSelection() {
	const [year, month, day] = (dateValue.value || todayUtc8()).split('-').map(Number)
	dateSelection.value = [Math.max(0, Math.min(year - 1970, years.length - 1)), month - 1, day - 1]
	hourSelection.value = [hourIndex.value]
}
function onDateColumnChange(event) {
	const next = [...dateSelection.value]
	next[event.detail.column] = Number(event.detail.value)
	dateSelection.value = next
	dateSelection.value = [next[0], next[1], Math.min(next[2], dateRanges.value[2].length - 1)]
}
function onHourColumnChange(event) {
	hourSelection.value = [Number(event.detail.value)]
}
function onDateChange(event) {
	const [year, month, day] = event.detail.value.map(Number)
	const maxDay = new Date(Date.UTC(1970 + year, month + 1, 0)).getUTCDate()
	const date = `${1970 + year}-${pad(month + 1)}-${pad(Math.min(day + 1, maxDay))}`
	// A date-only historical record stays date-only until an hour is explicitly chosen.
	emit('update:modelValue', hourValue.value ? `${date}-${hourValue.value}` : date)
}
function onHourChange(event) {
	const hour = hourOptions[Number(event.detail.value[0])]?.value
	if (hour == null) return
	const date = dateValue.value || todayUtc8()
	emit('update:modelValue', hour ? `${date}-${hour}` : date)
}
// Track wheel drafts, so cancel can restore the confirmed value even when props have not changed.
watch(() => props.modelValue, syncSelection, { immediate: true })
</script>

<style scoped>
.filling-time-picker {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 96px;
	gap: 12rpx;
	grid-column: 1 / -1;
	width: 100%;
	max-width: 420px;
	min-width: 0;
}
.time-field { min-width: 0; }
.time-field__label {
	display: block;
	margin-bottom: 8rpx;
	font-size: 24rpx;
	color: var(--crm-text-muted);
}
.time-field__button {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	min-height: 44px;
	margin: 0;
	padding: 0 10px;
	box-sizing: border-box;
	border: 1px solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: var(--crm-surface);
	color: var(--crm-text);
	font-size: 26rpx;
	line-height: 1.4;
	text-align: left;
	white-space: nowrap;
}
.time-field__button::after { border: none; }
.time-field__button:focus-visible { outline: 2px solid var(--crm-primary); outline-offset: 2px; }
.time-field__button--hour { justify-content: space-between; }
.time-field__icon, .time-field__arrow { flex-shrink: 0; color: var(--crm-text-muted); }
.time-field__arrow { transform: rotate(90deg); }
/* #ifdef H5 */
@media (max-width: 767px) {
	.time-field__label { font-size: 14px; line-height: 1.5; }
	.time-field__button { font-size: 16px; }
}
/* #endif */
</style>
