<template>
	<AppPage :title="recordId ? '修改钢瓶档案' : '新建钢瓶档案'" subtitle="BOTTLE PROFILE" icon="bottle">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="submitting" @click="onCancel">取消</AppButton>
			<AppButton size="sm" kind="primary" :loading="submitting" icon="check-circle" @click="onSubmit">
				保存钢瓶档案
			</AppButton>
		</template>

		<view class="edit-container">
			<AppCard class="edit-header-card" padding="20rpx">
				<view class="edit-header-info">
					<view class="info-pill">
						<text class="pill-label">流向状态</text>
						<text class="pill-value">{{ statusLabel }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">启用状态</text>
						<text class="pill-value">{{ activeLabel }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">钢瓶下检</text>
						<text class="pill-value">{{ bottleNextSummary }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">压力表下检</text>
						<text class="pill-value">{{ gaugeNextSummary }}</text>
					</view>
				</view>
			</AppCard>

			<view class="form-body">
				<AppSection title="钢瓶本体信息">
					<view class="form-grid">
						<view class="form-item">
							<AppInput v-model="form.bottle_no" label="单位内编号" placeholder="现有钢瓶编号" prefix-icon="bottle" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.filling_company" label="充装单位" placeholder="例如：无极县新拓能源开发有限公司" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.registration_mark" label="登记证标号" placeholder="例如：瓶32冀A02039(23)" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.equipment_type" label="设备品种" placeholder="例如：焊接气瓶" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.product_no" label="产品编号" placeholder="例如：DA16-02-002" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.pda_qr_code" label="PDA二维码号" placeholder="PDA扫码专用编码" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.qr_code" label="原二维码号" placeholder="保留原档案二维码（选填）" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.manufacturer" label="制造单位" placeholder="例如：河北润丰低温设备有限公司" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.volume_l" label="容积（L）" placeholder="例如：100" size="sm" />
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="date" :value="form.manufacture_date" @change="onManufactureDateChange">
								<AppInput :model-value="form.manufacture_date" label="制造日期" placeholder="请选择制造日期" disabled prefix-icon="calendar" size="sm" />
							</picker>
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="date" :value="form.scrap_due_date" @change="onScrapDueDateChange">
								<AppInput :model-value="form.scrap_due_date" label="报废期限" placeholder="请选择报废期限" disabled prefix-icon="calendar" size="sm" />
							</picker>
						</view>
						<view class="form-item">
							<AppInput v-model="form.tare_weight" label="标准皮重（kg）" placeholder="0.00" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.current_customer_name" label="持有客户" placeholder="当前所在客户名称（选填）" prefix-icon="user" size="sm" />
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="selector" :range="statusOptions" range-key="label" @change="onStatusChange">
								<AppInput :model-value="statusLabel" label="当前流向" placeholder="请选择状态" disabled prefix-icon="list" size="sm" />
							</picker>
						</view>
					</view>
				</AppSection>

				<AppSection title="钢瓶检验">
					<view class="form-grid">
						<view class="form-item">
							<picker class="picker-full" mode="date" :value="form.bottle_check_date" @change="onBottleCheckDateChange">
								<AppInput :model-value="form.bottle_check_date" label="检验日期" placeholder="请选择检验日期" disabled prefix-icon="calendar" size="sm" />
							</picker>
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="selector" :range="cycleOptions" range-key="label" @change="onBottleCycleChange">
								<AppInput :model-value="bottleCycleLabel" label="检测周期" placeholder="请选择周期" disabled prefix-icon="list" size="sm" />
							</picker>
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="date" :value="form.bottle_next_check_date" @change="onBottleNextCheckDateChange">
								<AppInput :model-value="form.bottle_next_check_date" label="下次检验日期" placeholder="自动生成或手动选择" disabled prefix-icon="calendar" size="sm" />
							</picker>
						</view>
					</view>
				</AppSection>

				<AppSection title="压力表信息">
					<view class="form-grid">
						<view class="form-item">
							<AppInput v-model="form.pressure_gauge_no" label="压力表号" placeholder="唯一数字编号" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.pressure_gauge_manufacturer" label="生产厂家" placeholder="选填" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.pressure_gauge_range_min" label="压力下限" placeholder="例如：0" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.pressure_gauge_range_max" label="压力上限" placeholder="例如：2.8" size="sm" />
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="date" :value="form.pressure_gauge_check_date" @change="onGaugeCheckDateChange">
								<AppInput :model-value="form.pressure_gauge_check_date" label="检验日期" placeholder="请选择检验日期" disabled prefix-icon="calendar" size="sm" />
							</picker>
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="selector" :range="cycleOptions" range-key="label" @change="onGaugeCycleChange">
								<AppInput :model-value="gaugeCycleLabel" label="检测周期" placeholder="请选择周期" disabled prefix-icon="list" size="sm" />
							</picker>
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="date" :value="form.pressure_gauge_next_check_date" @change="onGaugeNextCheckDateChange">
								<AppInput :model-value="form.pressure_gauge_next_check_date" label="下次检验日期" placeholder="自动生成或手动选择" disabled prefix-icon="calendar" size="sm" />
							</picker>
						</view>
					</view>
				</AppSection>

				<AppSection title="安全阀信息（2个阀共用检测）">
					<view class="form-grid">
						<view class="form-item">
							<AppInput :model-value="String(form.safety_valve_count)" label="安全阀数量" disabled size="sm" />
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="date" :value="form.safety_valve_check_date" @change="onValveCheckDateChange">
								<AppInput :model-value="form.safety_valve_check_date" label="检测日期" placeholder="请选择检测日期" disabled prefix-icon="calendar" size="sm" />
							</picker>
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="selector" :range="cycleOptions" range-key="label" @change="onValveCycleChange">
								<AppInput :model-value="valveCycleLabel" label="检测周期" placeholder="请选择周期" disabled prefix-icon="list" size="sm" />
							</picker>
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="date" :value="form.safety_valve_next_check_date" @change="onValveNextCheckDateChange">
								<AppInput :model-value="form.safety_valve_next_check_date" label="下次检测日期" placeholder="自动生成或手动选择" disabled prefix-icon="calendar" size="sm" />
							</picker>
						</view>
					</view>
				</AppSection>

				<AppSection title="档案管理">
					<view class="form-grid">
						<view class="form-item">
							<picker class="picker-full" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
								<AppInput :model-value="activeLabel" label="启用状态" disabled prefix-icon="list" size="sm" />
							</picker>
						</view>
						<view class="form-item span-2">
							<AppInput v-model="form.remark" label="档案备注" placeholder="检修记录或其他说明" size="sm" />
						</view>
					</view>
				</AppSection>
			</view>

			<view class="safe-area-bottom"></view>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, reactive, ref, toRef, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppCard from '@/components/base/AppCard.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import { createBottleV1, getBottleV1, updateBottleV1 } from '@/services/bottle'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const CHECK_CYCLE_MONTHS = [6, 12, 24, 36]

const recordId = toRef(props, 'recordId')
const submitting = ref(false)

const statusOptions = [
	{ label: '未知状态', value: 'unknown' },
	{ label: '在站内', value: 'in_station' },
	{ label: '在客户', value: 'at_customer' },
	{ label: '已报废', value: 'scrapped' },
	{ label: '已丢失', value: 'lost' }
]

const activeOptions = [
	{ label: '启用中', value: true },
	{ label: '已停用', value: false }
]

const cycleOptions = [
	{ label: '半年', value: 6 },
	{ label: '1 年', value: 12 },
	{ label: '2 年', value: 24 },
	{ label: '3 年', value: 36 }
]

const form = reactive({
	bottle_no: '',
	filling_company: '',
	registration_mark: '',
	equipment_type: '',
	product_no: '',
	pda_qr_code: '',
	qr_code: '',
	manufacturer: '',
	volume_l: '',
	manufacture_date: '',
	scrap_due_date: '',
	tare_weight: '',
	status: '',
	current_customer_name: '',
	bottle_check_date: '',
	bottle_next_check_date: '',
	bottle_check_cycle_months: 12,
	pressure_gauge_no: '',
	pressure_gauge_manufacturer: '',
	pressure_gauge_range_min: '',
	pressure_gauge_range_max: '',
	pressure_gauge_check_date: '',
	pressure_gauge_next_check_date: '',
	pressure_gauge_cycle_months: 12,
	safety_valve_count: 2,
	safety_valve_check_date: '',
	safety_valve_next_check_date: '',
	safety_valve_cycle_months: 12,
	remark: '',
	is_active: true
})

const statusLabel = computed(() => {
	const item = statusOptions.find((opt) => opt.value === form.status)
	return item?.label || '请选择'
})

const activeLabel = computed(() => (form.is_active ? '启用中' : '已停用'))

const bottleCycleLabel = computed(() => getCycleLabel(form.bottle_check_cycle_months))
const gaugeCycleLabel = computed(() => getCycleLabel(form.pressure_gauge_cycle_months))
const valveCycleLabel = computed(() => getCycleLabel(form.safety_valve_cycle_months))

const bottleNextSummary = computed(() => normalizeString(form.bottle_next_check_date) || '未设置')
const gaugeNextSummary = computed(() => normalizeString(form.pressure_gauge_next_check_date) || '未设置')

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toDisplayNumber(value) {
	if (value == null || value === '') return ''
	return String(value)
}

function toNullableNumber(value) {
	const text = normalizeString(value)
	if (!text) return null
	const num = Number(text)
	return Number.isFinite(num) ? num : NaN
}

function isValidDateString(value) {
	const text = normalizeString(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
	const [year, month, day] = text.split('-').map((item) => Number(item))
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
	if (month < 1 || month > 12) return false
	const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
	return day >= 1 && day <= maxDay
}

function addMonths(dateText, months) {
	if (!isValidDateString(dateText)) return ''
	const [year, month, day] = dateText.split('-').map((item) => Number(item))
	const totalMonth = month - 1 + Number(months || 0)
	const targetYear = year + Math.floor(totalMonth / 12)
	const targetMonth = ((totalMonth % 12) + 12) % 12
	const maxDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
	const safeDay = Math.min(day, maxDay)
	const y = String(targetYear).padStart(4, '0')
	const m = String(targetMonth + 1).padStart(2, '0')
	const d = String(safeDay).padStart(2, '0')
	return `${y}-${m}-${d}`
}

function isCycleValid(value) {
	return CHECK_CYCLE_MONTHS.includes(Number(value))
}

function normalizeCycle(value, fallback = 12) {
	const num = Number(value)
	if (Number.isInteger(num) && CHECK_CYCLE_MONTHS.includes(num)) return num
	return fallback
}

function getCycleLabel(value) {
	const item = cycleOptions.find((opt) => opt.value === Number(value))
	return item?.label || '未设置'
}

function autoBottleNextDate() {
	if (!isValidDateString(form.bottle_check_date)) return
	if (!isCycleValid(form.bottle_check_cycle_months)) return
	form.bottle_next_check_date = addMonths(form.bottle_check_date, form.bottle_check_cycle_months)
}

function autoGaugeNextDate() {
	if (!isValidDateString(form.pressure_gauge_check_date)) return
	if (!isCycleValid(form.pressure_gauge_cycle_months)) return
	form.pressure_gauge_next_check_date = addMonths(form.pressure_gauge_check_date, form.pressure_gauge_cycle_months)
}

function autoValveNextDate() {
	if (!isValidDateString(form.safety_valve_check_date)) return
	if (!isCycleValid(form.safety_valve_cycle_months)) return
	form.safety_valve_next_check_date = addMonths(form.safety_valve_check_date, form.safety_valve_cycle_months)
}

function onStatusChange(e) {
	const idx = Number(e?.detail?.value)
	const item = statusOptions[idx]
	if (item) form.status = item.value
}

function onActiveChange(e) {
	const idx = Number(e?.detail?.value)
	const item = activeOptions[idx]
	if (item) form.is_active = Boolean(item.value)
}

function onManufactureDateChange(e) {
	form.manufacture_date = e?.detail?.value || ''
}

function onScrapDueDateChange(e) {
	form.scrap_due_date = e?.detail?.value || ''
}

function onBottleCheckDateChange(e) {
	form.bottle_check_date = e?.detail?.value || ''
	autoBottleNextDate()
}

function onBottleCycleChange(e) {
	const idx = Number(e?.detail?.value)
	const item = cycleOptions[idx]
	if (!item) return
	form.bottle_check_cycle_months = item.value
	autoBottleNextDate()
}

function onBottleNextCheckDateChange(e) {
	form.bottle_next_check_date = e?.detail?.value || ''
}

function onGaugeCheckDateChange(e) {
	form.pressure_gauge_check_date = e?.detail?.value || ''
	autoGaugeNextDate()
}

function onGaugeCycleChange(e) {
	const idx = Number(e?.detail?.value)
	const item = cycleOptions[idx]
	if (!item) return
	form.pressure_gauge_cycle_months = item.value
	autoGaugeNextDate()
}

function onGaugeNextCheckDateChange(e) {
	form.pressure_gauge_next_check_date = e?.detail?.value || ''
}

function onValveCheckDateChange(e) {
	form.safety_valve_check_date = e?.detail?.value || ''
	autoValveNextDate()
}

function onValveCycleChange(e) {
	const idx = Number(e?.detail?.value)
	const item = cycleOptions[idx]
	if (!item) return
	form.safety_valve_cycle_months = item.value
	autoValveNextDate()
}

function onValveNextCheckDateChange(e) {
	form.safety_valve_next_check_date = e?.detail?.value || ''
}

async function loadRecord(id) {
	const res = await getBottleV1({ _id: id })
	if (res?.code !== 0 || !res?.data) {
		uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
		return
	}
	const doc = res.data
	form.bottle_no = doc.bottle_no || ''
	form.filling_company = doc.filling_company || ''
	form.registration_mark = doc.registration_mark || ''
	form.equipment_type = doc.equipment_type || ''
	form.product_no = doc.product_no || ''
	form.pda_qr_code = doc.pda_qr_code || ''
	form.qr_code = doc.qr_code || ''
	form.manufacturer = doc.manufacturer || ''
	form.volume_l = toDisplayNumber(doc.volume_l)
	form.manufacture_date = doc.manufacture_date || ''
	form.scrap_due_date = doc.scrap_due_date || ''
	form.tare_weight = toDisplayNumber(doc.tare_weight)
	form.status = doc.status || ''
	form.current_customer_name = doc.current_customer_name || ''
	form.bottle_check_date = doc.bottle_check_date || ''
	form.bottle_next_check_date = doc.bottle_next_check_date || ''
	form.bottle_check_cycle_months = normalizeCycle(doc.bottle_check_cycle_months, 12)
	form.pressure_gauge_no = doc.pressure_gauge_no || ''
	form.pressure_gauge_manufacturer = doc.pressure_gauge_manufacturer || ''
	form.pressure_gauge_range_min = toDisplayNumber(doc.pressure_gauge_range_min)
	form.pressure_gauge_range_max = toDisplayNumber(doc.pressure_gauge_range_max)
	form.pressure_gauge_check_date = doc.pressure_gauge_check_date || ''
	form.pressure_gauge_next_check_date = doc.pressure_gauge_next_check_date || ''
	form.pressure_gauge_cycle_months = normalizeCycle(doc.pressure_gauge_cycle_months, 12)
	form.safety_valve_count = 2
	form.safety_valve_check_date = doc.safety_valve_check_date || ''
	form.safety_valve_next_check_date = doc.safety_valve_next_check_date || ''
	form.safety_valve_cycle_months = normalizeCycle(doc.safety_valve_cycle_months, 12)
	form.remark = doc.remark || ''
	form.is_active = doc.is_active !== false
}

watch(
	recordId,
	async (id) => {
		if (!id) return
		await loadRecord(String(id))
	},
	{ immediate: true }
)

function assert(condition, message) {
	if (condition) return true
	uni.showToast({ title: message, icon: 'none' })
	return false
}

async function onSubmit() {
	if (submitting.value) return

	const requiredTextChecks = [
		{ value: form.bottle_no, msg: '单位内编号必填' }
	]

	for (const item of requiredTextChecks) {
		if (!assert(Boolean(normalizeString(item.value)), item.msg)) return
	}

	if (!assert(statusOptions.some((item) => item.value === form.status), '当前流向必填')) return

	const tareWeight = toNullableNumber(form.tare_weight)
	if (!assert(typeof tareWeight === 'number' && tareWeight >= 0, '标准皮重必填且必须为非负数字')) return

	const volume = toNullableNumber(form.volume_l)
	if (normalizeString(form.volume_l) && !assert(typeof volume === 'number' && volume > 0, '容积必须为大于 0 的数字')) return

	const pressureMin = toNullableNumber(form.pressure_gauge_range_min)
	const pressureMax = toNullableNumber(form.pressure_gauge_range_max)
	const hasPressureMin = Boolean(normalizeString(form.pressure_gauge_range_min))
	const hasPressureMax = Boolean(normalizeString(form.pressure_gauge_range_max))
	if (hasPressureMin || hasPressureMax) {
		if (!assert(typeof pressureMin === 'number' && pressureMin >= 0, '压力下限必须为非负数字')) return
		if (!assert(typeof pressureMax === 'number' && pressureMax >= 0, '压力上限必须为非负数字')) return
		if (!assert(pressureMin <= pressureMax, '压力下限不能大于上限')) return
	}

	const optionalDates = [
		{ value: form.manufacture_date, msg: '制造日期格式无效' },
		{ value: form.scrap_due_date, msg: '报废期限格式无效' },
		{ value: form.bottle_check_date, msg: '钢瓶检验日期格式无效' },
		{ value: form.bottle_next_check_date, msg: '钢瓶下次检验日期格式无效' },
		{ value: form.pressure_gauge_check_date, msg: '压力表检验日期格式无效' },
		{ value: form.pressure_gauge_next_check_date, msg: '压力表下次检验日期格式无效' },
		{ value: form.safety_valve_check_date, msg: '安全阀检测日期格式无效' },
		{ value: form.safety_valve_next_check_date, msg: '安全阀下次检测日期格式无效' }
	]

	for (const item of optionalDates) {
		if (normalizeString(item.value) && !assert(isValidDateString(item.value), item.msg)) return
	}

	if (form.bottle_check_cycle_months != null && !assert(isCycleValid(form.bottle_check_cycle_months), '钢瓶检测周期无效')) return
	if (form.pressure_gauge_cycle_months != null && !assert(isCycleValid(form.pressure_gauge_cycle_months), '压力表检测周期无效')) return
	if (form.safety_valve_cycle_months != null && !assert(isCycleValid(form.safety_valve_cycle_months), '安全阀检测周期无效')) return

	if (!assert(Number(form.safety_valve_count) === 2, '安全阀数量固定为 2')) return

	submitting.value = true
	try {
		const payload = {
			bottle_no: normalizeString(form.bottle_no),
			filling_company: normalizeString(form.filling_company),
			registration_mark: normalizeString(form.registration_mark),
			equipment_type: normalizeString(form.equipment_type),
			product_no: normalizeString(form.product_no),
			pda_qr_code: normalizeString(form.pda_qr_code),
			qr_code: normalizeString(form.qr_code),
			manufacturer: normalizeString(form.manufacturer),
			volume_l: volume,
			manufacture_date: normalizeString(form.manufacture_date),
			scrap_due_date: normalizeString(form.scrap_due_date),
			tare_weight: tareWeight,
			status: form.status,
			current_customer_name: normalizeString(form.current_customer_name),
			bottle_check_date: normalizeString(form.bottle_check_date),
			bottle_next_check_date: normalizeString(form.bottle_next_check_date),
			bottle_check_cycle_months: Number(form.bottle_check_cycle_months),
			pressure_gauge_no: normalizeString(form.pressure_gauge_no),
			pressure_gauge_manufacturer: normalizeString(form.pressure_gauge_manufacturer),
			pressure_gauge_range_min: pressureMin,
			pressure_gauge_range_max: pressureMax,
			pressure_gauge_check_date: normalizeString(form.pressure_gauge_check_date),
			pressure_gauge_next_check_date: normalizeString(form.pressure_gauge_next_check_date),
			pressure_gauge_cycle_months: Number(form.pressure_gauge_cycle_months),
			safety_valve_count: 2,
			safety_valve_check_date: normalizeString(form.safety_valve_check_date),
			safety_valve_next_check_date: normalizeString(form.safety_valve_next_check_date),
			safety_valve_cycle_months: Number(form.safety_valve_cycle_months),
			remark: normalizeString(form.remark),
			is_active: form.is_active
		}

		const result = recordId.value
			? await updateBottleV1({ _id: recordId.value, ...payload })
			: await createBottleV1(payload)

		if (result?.code !== 0) {
			uni.showToast({ title: result?.msg || '保存失败', icon: 'none' })
			return
		}

		uni.showToast({ title: '保存成功', icon: 'success' })
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 400)
	} catch (err) {
		console.error('save bottle failed', err)
		uni.showToast({ title: '保存失败', icon: 'none' })
	} finally {
		submitting.value = false
	}
}

function onCancel() {
	uni.navigateBack({ delta: 1 })
}
</script>

<style scoped>
.edit-container {
	padding-bottom: 48rpx;
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.edit-header-card {
	box-shadow: 0 12rpx 32rpx rgba(15, 23, 42, 0.06);
}

.edit-header-info {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220rpx, 1fr));
	gap: 16rpx;
}

.info-pill {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	padding: 12rpx 16rpx;
	background: #f8fafc;
	border: 1rpx solid #eef2f7;
	border-radius: 16rpx;
}

.pill-label {
	font-size: 18rpx;
	color: var(--crm-text-muted);
	text-transform: uppercase;
	letter-spacing: 0.6rpx;
}

.pill-value {
	font-size: 26rpx;
	color: var(--crm-text);
	font-weight: 700;
}

.form-body {
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16rpx;
}

.form-item {
	display: flex;
	flex-direction: column;
}

.span-2 {
	grid-column: span 2;
}

.safe-area-bottom {
	height: constant(safe-area-inset-bottom);
	height: env(safe-area-inset-bottom);
}

.form-body :deep(.section__header) {
	padding: 12rpx 20rpx;
}

.form-body :deep(.section__body) {
	padding: 20rpx;
}

@media (max-width: 720px) {
	.form-grid {
		grid-template-columns: 1fr;
	}
	.span-2 {
		grid-column: auto;
	}
}
</style>
