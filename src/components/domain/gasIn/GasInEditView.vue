<template>
	<AppPage :title="pageTitle" :subtitle="pageSubtitle" icon="truck">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="submitting" @click="onCancel">取消</AppButton>
			<AppButton size="sm" kind="primary" :loading="submitting" icon="check-circle" @click="onSubmit">
				{{ isEditMode ? '保存修改' : '保存入库' }}
			</AppButton>
		</template>

		<view class="edit-shell">
			<AppSection class="gas-in-basic-section" title="基础信息">
				<view class="form-grid">
					<picker class="picker-block" mode="date" :value="form.date" @change="onDateChange">
						<AppInput :model-value="form.date" label="入库日期" placeholder="请选择日期" prefix-icon="calendar" disabled size="sm" />
					</picker>
					<view class="basic-triplet span-2">
						<view class="plate-wrap">
							<AppInput
								:model-value="form.plate_no"
								label="车牌号"
								placeholder="输入车牌联想启用车辆"
								prefix-icon="truck"
								size="sm"
								confirm-type="search"
								@update:modelValue="onPlateInput"
								@focus="onPlateFocus"
								@blur="onPlateBlur"
								@confirm="onPlateConfirm"
							/>
							<view v-if="showPlateSuggestions && plateSuggestions.length" class="plate-suggestions">
								<view
									v-for="item in plateSuggestions"
									:key="item._id || item.plate_no"
									class="plate-suggestion-item"
									@tap.stop="selectPlateSuggestion(item)"
									@click.stop="selectPlateSuggestion(item)"
								>
									<text class="plate-no">{{ item.plate_no }}</text>
									<text class="plate-sub">{{ item.remark || '在用车辆' }}</text>
								</view>
							</view>
						</view>
						<AppInput v-model="form.tanker_no" label="挂车号" placeholder="可选" size="sm" />
						<AppInput v-model="form.product_name" label="产品名称" placeholder="默认 LNG" size="sm" />
					</view>
				</view>
			</AppSection>

			<AppSection title="重量与金额（吨 / 元/吨）">
				<template #actions>
					<AppButton size="sm" kind="ghost" @click="resetAutoCalc">恢复自动计算</AppButton>
				</template>
				<view class="form-grid">
					<AppInput v-model="form.load_weight_t" label="装载重量(吨)" placeholder="例如 21.120" size="sm" />
					<AppInput v-model="form.gross_weight_t" label="出厂毛重(吨)" placeholder="例如 44.590" size="sm" />
					<AppInput v-model="form.tare_weight_t" label="回厂皮重(吨)" placeholder="例如 23.490" size="sm" />
					<AppInput v-model="form.net_weight_t" label="净重(吨)" placeholder="自动计算，可手改" size="sm" @input="onManualInput('net_weight_t')" />
					<AppInput v-model="form.station_weight_t" label="站内卸入(吨)" placeholder="默认等于净重" size="sm" @input="onManualInput('station_weight_t')" />
					<AppInput v-model="form.direct_sale_weight_t" label="直销随车(吨)" placeholder="默认 0" size="sm" @input="onManualInput('direct_sale_weight_t')" />
					<AppInput v-model="form.loss_amount_t" label="损耗(吨)" placeholder="自动计算，可手改" size="sm" @input="onManualInput('loss_amount_t')" />
					<AppInput v-model="form.unit_price_per_ton" label="单价(元/吨)" placeholder="例如 3250" size="sm" />
					<AppInput v-model="form.amount" label="金额(元)" placeholder="自动计算，可手改" size="sm" @input="onManualInput('amount')" />
				</view>
				<text v-if="lossWarning" class="warning-text">提示：当前为负损耗，请确认过磅数据</text>
				<text v-if="splitWarning" class="warning-text">提示：站内卸入 + 直销随车 必须等于净重</text>
			</AppSection>

			<AppSection title="补充信息">
				<view class="form-grid">
					<AppInput v-model="form.sender" label="送气人" placeholder="可选" size="sm" />
					<AppInput v-model="form.factory" label="气源厂家" placeholder="可选" size="sm" />
					<view class="span-2">
						<AppInput v-model="form.remark" label="备注" placeholder="可选" size="sm" />
					</view>
				</view>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRef, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import { createGasInV1, getGasInV1, updateGasInV1 } from '@/services/gasIn'
import { searchVehiclesV1 } from '@/services/vehicle'

const GAS_IN_LIST_REFRESH_KEY = 'gasIn:list:refresh'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')

function formatTodayUtc8() {
	const now = new Date()
	const utc8Time = now.getTime() + 8 * 60 * 60 * 1000
	const date = new Date(utc8Time)
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, '0')
	const d = String(date.getUTCDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizePlateNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function roundTo(value, digits = 3) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	const base = 10 ** Number(digits || 0)
	return Math.round(num * base) / base
}

function formatTon(value) {
	const num = toNumber(value, null)
	if (num == null) return ''
	return String(roundTo(num, 3))
}

function formatMoney(value) {
	const num = toNumber(value, null)
	if (num == null) return ''
	return String(roundTo(num, 2))
}

const form = reactive({
	date: formatTodayUtc8(),
	product_name: 'LNG',
	plate_no: '',
	tanker_no: '',
	load_weight_t: '',
	gross_weight_t: '',
	tare_weight_t: '',
	net_weight_t: '',
	station_weight_t: '',
	direct_sale_weight_t: '',
	loss_amount_t: '',
	unit_price_per_ton: '',
	amount: '',
	sender: '',
	factory: '',
	remark: ''
})

const manualOverride = reactive({
	net_weight_t: false,
	station_weight_t: false,
	direct_sale_weight_t: false,
	loss_amount_t: false,
	amount: false
})

const submitting = ref(false)
const loadingDetail = ref(false)
const plateSuggestions = ref([])
const showPlateSuggestions = ref(false)
let plateTimer = 0
let plateBlurTimer = 0
let plateFetchSeq = 0

const isEditMode = computed(() => Boolean(normalizeString(recordId.value)))
const pageTitle = computed(() => (isEditMode.value ? '天然气入库编辑' : '天然气入库录入'))
const pageSubtitle = computed(() => (isEditMode.value ? 'GAS IN EDIT' : 'GAS IN CREATE'))

const lossWarning = computed(() => {
	const loss = toNumber(form.loss_amount_t, null)
	return loss != null && loss < 0
})

const splitWarning = computed(() => {
	const net = toNumber(form.net_weight_t, null)
	const station = toNumber(form.station_weight_t, null)
	const directSale = toNumber(form.direct_sale_weight_t, null)
	if (net == null || station == null || directSale == null) return false
	return Math.abs(roundTo(station + directSale - net, 3)) > 0.001
})

function applyAutoCalculations() {
	const gross = toNumber(form.gross_weight_t, null)
	const tare = toNumber(form.tare_weight_t, null)
	const load = toNumber(form.load_weight_t, null)
	const net = toNumber(form.net_weight_t, null)
	const unitPrice = toNumber(form.unit_price_per_ton, null)

	let computedNet = net
	if (!manualOverride.net_weight_t && gross != null && tare != null) {
		computedNet = roundTo(gross - tare, 3)
		form.net_weight_t = String(computedNet)
	}

	const finalNet = toNumber(form.net_weight_t, null)
	const station = toNumber(form.station_weight_t, null)
	const directSale = toNumber(form.direct_sale_weight_t, 0) || 0
	if (finalNet != null && !manualOverride.station_weight_t) {
		form.station_weight_t = String(roundTo(finalNet - directSale, 3))
	}
	if (finalNet != null && manualOverride.station_weight_t && !manualOverride.direct_sale_weight_t && station != null) {
		form.direct_sale_weight_t = String(roundTo(finalNet - station, 3))
	}
	if (!manualOverride.loss_amount_t && load != null && finalNet != null) {
		form.loss_amount_t = String(roundTo(load - finalNet, 3))
	}

	if (!manualOverride.amount && finalNet != null && unitPrice != null) {
		form.amount = String(roundTo(finalNet * unitPrice, 2))
	}
}

watch(
	() => [form.load_weight_t, form.gross_weight_t, form.tare_weight_t, form.unit_price_per_ton],
	() => {
		applyAutoCalculations()
	}
)

function onManualInput(field) {
	if (!field) return
	manualOverride[field] = true
	applyAutoCalculations()
}

function resetAutoCalc() {
	manualOverride.net_weight_t = false
	manualOverride.station_weight_t = false
	manualOverride.direct_sale_weight_t = false
	manualOverride.loss_amount_t = false
	manualOverride.amount = false
	form.direct_sale_weight_t = '0'
	applyAutoCalculations()
}

function onDateChange(e) {
	form.date = e?.detail?.value || ''
}

function buildSubmitPayload() {
	return {
		date: normalizeString(form.date),
		product_name: normalizeString(form.product_name) || 'LNG',
		plate_no: normalizePlateNo(form.plate_no),
		tanker_no: normalizeString(form.tanker_no),
		load_weight_t: toNumber(form.load_weight_t, null),
		gross_weight_t: toNumber(form.gross_weight_t, null),
		tare_weight_t: toNumber(form.tare_weight_t, null),
		net_weight_t: toNumber(form.net_weight_t, null),
		station_weight_t: toNumber(form.station_weight_t, null),
		direct_sale_weight_t: toNumber(form.direct_sale_weight_t, 0) || 0,
		loss_amount_t: toNumber(form.loss_amount_t, null),
		unit_price_per_ton: toNumber(form.unit_price_per_ton, null),
		amount: toNumber(form.amount, null),
		sender: normalizeString(form.sender),
		factory: normalizeString(form.factory),
		remark: normalizeString(form.remark)
	}
}

function validatePayload(payload) {
	if (!payload.date) return '入库日期必填'
	if (!payload.plate_no) return '车牌号必填'
	if (payload.load_weight_t == null) return '装载重量必填'
	if (payload.gross_weight_t == null) return '出厂毛重必填'
	if (payload.tare_weight_t == null) return '回厂皮重必填'
	if (payload.station_weight_t == null) return '站内卸入必填'
	if (payload.station_weight_t < 0) return '站内卸入不能为负数'
	if (payload.direct_sale_weight_t < 0) return '直销随车不能为负数'
	if (Math.abs(roundTo(payload.station_weight_t + payload.direct_sale_weight_t - payload.net_weight_t, 3)) > 0.001) {
		return '站内卸入 + 直销随车 必须等于净重'
	}
	if (payload.unit_price_per_ton == null) return '单价必填'
	return ''
}

async function onSubmit() {
	if (submitting.value || loadingDetail.value) return
	const payload = buildSubmitPayload()
	const validateMsg = validatePayload(payload)
	if (validateMsg) {
		uni.showToast({ title: validateMsg, icon: 'none' })
		return
	}

	submitting.value = true
	try {
		const res = isEditMode.value
			? await updateGasInV1({ _id: recordId.value, ...payload })
			: await createGasInV1(payload)
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '保存失败', icon: 'none', duration: 2800 })
			return
		}
		const warning = normalizeString(res?.data?.warning)
		uni.showToast({
			title: warning ? `保存成功（${warning}）` : '保存成功',
			icon: 'success',
			duration: warning ? 2600 : 1800
		})
		try {
			uni.setStorageSync(GAS_IN_LIST_REFRESH_KEY, String(Date.now()))
		} catch (_) {
			// ignore storage failures
		}
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 360)
	} catch (err) {
		uni.showToast({ title: err?.message || '保存失败', icon: 'none' })
	} finally {
		submitting.value = false
	}
}

function onCancel() {
	uni.navigateBack({ delta: 1 })
}

function applyDetail(doc = {}) {
	form.date = normalizeString(doc.date) || formatTodayUtc8()
	form.product_name = normalizeString(doc.product_name) || 'LNG'
	form.plate_no = normalizePlateNo(doc.plate_no)
	form.tanker_no = normalizeString(doc.tanker_no)
	form.load_weight_t = formatTon(doc.load_weight_t)
	form.gross_weight_t = formatTon(doc.gross_weight_t)
	form.tare_weight_t = formatTon(doc.tare_weight_t)
	form.net_weight_t = formatTon(doc.net_weight_t)
	form.station_weight_t = formatTon(doc.station_weight_t == null ? doc.net_weight_t : doc.station_weight_t)
	form.direct_sale_weight_t = formatTon(doc.direct_sale_weight_t == null ? 0 : doc.direct_sale_weight_t)
	form.loss_amount_t = formatTon(doc.loss_amount_t)
	form.unit_price_per_ton = formatMoney(doc.unit_price_per_ton)
	form.amount = formatMoney(doc.amount)
	form.sender = normalizeString(doc.sender)
	form.factory = normalizeString(doc.factory)
	form.remark = normalizeString(doc.remark)
	manualOverride.net_weight_t = false
	manualOverride.station_weight_t = false
	manualOverride.direct_sale_weight_t = false
	manualOverride.loss_amount_t = false
	manualOverride.amount = false
}

async function loadDetail() {
	if (!isEditMode.value) return
	loadingDetail.value = true
	try {
		const res = await getGasInV1({ _id: recordId.value })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
			return
		}
		applyDetail(res.data || {})
	} catch (err) {
		uni.showToast({ title: err?.message || '加载失败', icon: 'none' })
	} finally {
		loadingDetail.value = false
	}
}

async function fetchPlateSuggestions(keyword) {
	const key = normalizePlateNo(keyword)
	if (!key) {
		plateSuggestions.value = []
		showPlateSuggestions.value = false
		return
	}
	const fetchSeq = ++plateFetchSeq
	try {
		const res = await searchVehiclesV1({ keyword: key, is_active: true, page: 1, pageSize: 20 })
		if (fetchSeq !== plateFetchSeq) return
		if (res?.code !== 0) {
			plateSuggestions.value = []
			showPlateSuggestions.value = false
			return
		}
		const suggestions = (Array.isArray(res.data) ? res.data : []).map((row) => ({
			_id: row._id,
			plate_no: normalizePlateNo(row.plate_no),
			remark: normalizeString(row.remark)
		}))
		plateSuggestions.value = suggestions
		showPlateSuggestions.value = suggestions.length > 0
	} catch (_) {
		if (fetchSeq !== plateFetchSeq) return
		plateSuggestions.value = []
		showPlateSuggestions.value = false
	}
}

function onPlateInput(value) {
	const plateNo = normalizePlateNo(value)
	form.plate_no = plateNo
	plateFetchSeq += 1
	if (plateBlurTimer) clearTimeout(plateBlurTimer)
	if (plateTimer) clearTimeout(plateTimer)
	if (!plateNo) {
		plateSuggestions.value = []
		showPlateSuggestions.value = false
		return
	}
	plateTimer = setTimeout(() => {
		fetchPlateSuggestions(form.plate_no)
	}, 150)
}

function onPlateFocus() {
	if (plateBlurTimer) clearTimeout(plateBlurTimer)
	if (plateSuggestions.value.length) {
		showPlateSuggestions.value = true
		return
	}
	if (normalizePlateNo(form.plate_no)) fetchPlateSuggestions(form.plate_no)
}

function onPlateBlur() {
	if (plateBlurTimer) clearTimeout(plateBlurTimer)
	plateBlurTimer = setTimeout(() => {
		showPlateSuggestions.value = false
	}, 180)
}

function onPlateConfirm() {
	if (!plateSuggestions.value.length) return
	selectPlateSuggestion(plateSuggestions.value[0])
}

function selectPlateSuggestion(item) {
	if (plateBlurTimer) clearTimeout(plateBlurTimer)
	if (plateTimer) clearTimeout(plateTimer)
	plateFetchSeq += 1
	form.plate_no = normalizePlateNo(item && item.plate_no)
	plateSuggestions.value = []
	showPlateSuggestions.value = false
}

watch(
	recordId,
	() => {
		if (!isEditMode.value) {
			applyDetail({ date: formatTodayUtc8(), product_name: 'LNG' })
			return
		}
		loadDetail()
	},
	{ immediate: true }
)

onMounted(() => {
	if (!isEditMode.value) applyAutoCalculations()
})

onBeforeUnmount(() => {
	if (plateTimer) clearTimeout(plateTimer)
	if (plateBlurTimer) clearTimeout(plateBlurTimer)
})
</script>

<style scoped>
.edit-shell {
	display: flex;
	flex-direction: column;
	gap: 20rpx;
}

.gas-in-basic-section {
	overflow: visible;
	position: relative;
	z-index: 6;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16rpx;
}

.span-2 {
	grid-column: span 2;
}

.basic-triplet {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 16rpx;
	align-items: start;
	min-width: 0;
}

.picker-block {
	display: block;
}

.plate-wrap {
	position: relative;
	z-index: 8;
}

.plate-suggestions {
	position: absolute;
	left: 0;
	right: 0;
	top: calc(100% + 6rpx);
	background: #ffffff;
	border: 1px solid #e2e8f0;
	border-radius: 12rpx;
	box-shadow: 0 16rpx 34rpx rgba(15, 23, 42, 0.12);
	max-height: 360rpx;
	overflow-y: auto;
	z-index: 30;
}

.plate-suggestion-item {
	padding: 14rpx 18rpx;
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	border-bottom: 1px solid #eef2f7;
}

.plate-suggestion-item:last-child {
	border-bottom: none;
}

.plate-no {
	font-size: 26rpx;
	font-weight: 600;
	color: #0f172a;
}

.plate-sub {
	font-size: 22rpx;
	color: #64748b;
}

.warning-text {
	margin-top: 12rpx;
	font-size: 24rpx;
	color: #b45309;
	background: #fffbeb;
	border: 1px solid #fcd34d;
	padding: 10rpx 14rpx;
	border-radius: 10rpx;
	display: inline-flex;
}
</style>
