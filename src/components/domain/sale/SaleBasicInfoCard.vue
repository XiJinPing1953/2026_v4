<template>
	<AppCard :padding="size === 'sm' ? '24rpx' : '32rpx'">
		<view class="info-grid" :class="{ 'info-grid--sm': size === 'sm' }">
			<view class="form-item span-2">
				<picker class="picker-full" mode="date" @change="onDateChange">
					<AppInput
						:model-value="modelValue.date"
						label="销售日期"
						placeholder="请选择日期"
						prefix-icon="calendar"
						:size="size"
						class="picker-input"
						disabled
					/>
				</picker>
			</view>

			<view class="form-item span-2 customer-field">
				<AppInput
					:model-value="modelValue.customerName"
					label="客户名称"
					placeholder="输入关键字搜索"
					prefix-icon="user"
					confirm-type="search"
					:size="size"
					@update:modelValue="onCustomerInput"
					@confirm="onCustomerConfirm"
					@blur="onCustomerBlur"
					@focus="showSuggestions = true"
				/>
				<view v-if="showSuggestions" class="suggestions">
					<view v-if="suggestions.length" class="suggest-list">
						<view
							v-for="item in suggestions"
							:key="item._id"
							class="suggest-item"
							@click.stop="selectCustomer(item)"
						>
							<view class="suggest-info">
								<text class="suggest-name">{{ item.name }}</text>
								<text class="suggest-sub" v-if="item.contact">{{ item.contact }}</text>
							</view>
							<AppIcon name="plus" size="24rpx" color="#94a3b8" />
						</view>
					</view>
					<view v-else class="suggest-empty">
						<text>未找到匹配客户</text>
					</view>
				</view>
			</view>

			<view class="form-item span-2">
				<text class="field-label">业务模式</text>
				<view class="choice-group">
					<view
						v-for="item in bizModeOptions"
						:key="item.value"
						class="choice-pill"
						:class="{ 'choice-pill--active': modelValue.bizMode === item.value }"
						@tap="update('bizMode', item.value)"
					>
						{{ item.label }}
					</view>
				</view>
			</view>

			<view class="form-item span-2 vehicle-field">
				<AppInput
					:model-value="modelValue.vehicleNo"
					label="配送车辆"
					placeholder="输入车牌搜索"
					prefix-icon="truck"
					:size="size"
					confirm-type="search"
					@update:modelValue="onVehicleInput"
					@confirm="onVehicleConfirm"
					@blur="onVehicleBlur"
					@focus="onVehicleFocus"
				/>
				<view v-if="showVehicleSuggestions" class="suggestions">
					<view v-if="vehicleSuggestions.length" class="suggest-list">
						<view
							v-for="item in vehicleSuggestions"
							:key="item._id"
							class="suggest-item"
							@tap.stop="selectVehicle(item)"
						>
							<view class="suggest-info">
								<text class="suggest-name">{{ item.plate_no || item.plateNo || item.name }}</text>
								<text class="suggest-sub" v-if="item.remark">{{ item.remark }}</text>
							</view>
							<AppIcon name="plus" size="24rpx" color="#94a3b8" />
						</view>
					</view>
					<view v-else class="suggest-empty">
						<text>未找到车辆</text>
					</view>
				</view>
			</view>

			<view class="form-item delivery-field">
				<AppInput
					:model-value="modelValue.deliveryMan1"
					label="配送员1"
					placeholder="输入姓名搜索"
					:size="size"
					confirm-type="search"
					@update:modelValue="(v) => onDeliveryInput(1, v)"
					@confirm="() => onDeliveryConfirm(1)"
					@blur="() => onDeliveryBlur(1)"
					@focus="() => onDeliveryFocus(1)"
				/>
				<view v-if="showDelivery1Suggestions" class="suggestions">
					<view v-if="deliverySuggestions1.length" class="suggest-list">
						<view
							v-for="item in deliverySuggestions1"
							:key="item._id"
							class="suggest-item"
							@tap.stop="selectDelivery(1, item)"
						>
							<view class="suggest-info">
								<text class="suggest-name">{{ item.name || item.username }}</text>
								<text class="suggest-sub" v-if="item.phone || item.remark">{{ item.phone || item.remark }}</text>
							</view>
							<AppIcon name="plus" size="24rpx" color="#94a3b8" />
						</view>
					</view>
					<view v-else class="suggest-empty">
						<text>未找到配送员</text>
					</view>
				</view>
			</view>

			<view class="form-item delivery-field">
				<AppInput
					:model-value="modelValue.deliveryMan2"
					label="配送员2"
					placeholder="输入姓名搜索"
					:size="size"
					confirm-type="search"
					@update:modelValue="(v) => onDeliveryInput(2, v)"
					@confirm="() => onDeliveryConfirm(2)"
					@blur="() => onDeliveryBlur(2)"
					@focus="() => onDeliveryFocus(2)"
				/>
				<view v-if="showDelivery2Suggestions" class="suggestions">
					<view v-if="deliverySuggestions2.length" class="suggest-list">
						<view
							v-for="item in deliverySuggestions2"
							:key="item._id"
							class="suggest-item"
							@tap.stop="selectDelivery(2, item)"
						>
							<view class="suggest-info">
								<text class="suggest-name">{{ item.name || item.username }}</text>
								<text class="suggest-sub" v-if="item.phone || item.remark">{{ item.phone || item.remark }}</text>
							</view>
							<AppIcon name="plus" size="24rpx" color="#94a3b8" />
						</view>
					</view>
					<view v-else class="suggest-empty">
						<text>未找到配送员</text>
					</view>
				</view>
			</view>

			<view class="form-item unit-group span-2">
				<view class="unit-input">
					<AppInput 
						:model-value="modelValue.unitPrice" 
						label="销售单价" 
						placeholder="0.00" 
						:size="size"
						@update:modelValue="(v) => update('unitPrice', v)" 
					/>
				</view>
				<view class="unit-picker">
					<text class="field-label">计价单位</text>
					<view class="choice-group choice-group--compact">
						<view
							v-for="item in priceUnitOptions"
							:key="item.value"
							class="choice-pill"
							:class="{ 'choice-pill--active': modelValue.priceUnit === item.value }"
							@tap="update('priceUnit', item.value)"
						>
							{{ item.label }}
						</view>
					</view>
				</view>
			</view>
		</view>
	</AppCard>
</template>

<script setup>
import { ref } from 'vue'
import AppCard from '@/components/base/AppCard.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppIcon from '@/components/base/AppIcon.vue'
import { listCustomersV1 } from '@/services/customer'
import { searchDeliveriesV1 } from '@/services/delivery'
import { searchVehiclesV1 } from '@/services/vehicle'

const props = defineProps({
	modelValue: {
		type: Object,
		default: () => ({})
	},
	size: { type: String, default: 'md' }
})

const emit = defineEmits(['update:modelValue'])

const suggestions = ref([])
const showSuggestions = ref(false)
const fetchTimer = ref(null)
const vehicleSuggestions = ref([])
const showVehicleSuggestions = ref(false)
const vehicleTimer = ref(null)
const deliverySuggestions1 = ref([])
const showDelivery1Suggestions = ref(false)
const deliverySuggestions2 = ref([])
const showDelivery2Suggestions = ref(false)
const deliveryTimer1 = ref(null)
const deliveryTimer2 = ref(null)

const RECENT_VEHICLE_KEY = 'crm_recent_vehicles'
const RECENT_DELIVERY_KEY = 'crm_recent_delivery'
const MAX_RECENTS = 8

const bizModeOptions = [
	{ label: '瓶装', value: 'bottle' },
	{ label: '整车', value: 'truck' },
	{ label: '代理出站', value: 'agent_sale' }
]

const priceUnitOptions = [
	{ label: 'kg', value: 'kg' },
	{ label: '瓶', value: 'bottle' },
	{ label: 'm3', value: 'm3' }
]

function emitPatch(patch) {
	emit('update:modelValue', { ...props.modelValue, ...patch })
}

function update(key, value) {
	emitPatch({ [key]: value })
}

function onDateChange(e) {
	const date = e?.detail?.value || ''
	if (date) update('date', date)
}

function onCustomerInput(value) {
	emitPatch({
		customerName: value,
		customerId: ''
	})
	if (fetchTimer.value) clearTimeout(fetchTimer.value)
	fetchTimer.value = setTimeout(() => {
		fetchCustomers(value)
	}, 200)
}

async function fetchCustomers(keyword) {
	const key = String(keyword || '').trim()
	if (!key) {
		suggestions.value = []
		showSuggestions.value = false
		return
	}
	const res = await listCustomersV1({ keyword: key, pageSize: 8, is_active: true })
	if (res?.code !== 0) {
		suggestions.value = []
		showSuggestions.value = false
		return
	}
	suggestions.value = Array.isArray(res.data) ? res.data : []
	showSuggestions.value = true
}

function selectCustomer(item) {
	emitPatch({
		customerId: item._id,
		customerName: item.name,
		unitPrice: item.default_unit_price != null ? String(item.default_unit_price) : props.modelValue?.unitPrice || '',
		priceUnit: item.default_price_unit || props.modelValue?.priceUnit || 'kg'
	})
	showSuggestions.value = false
}

function onCustomerConfirm() {
	if (!suggestions.value.length) {
		showSuggestions.value = false
		return
	}
	selectCustomer(suggestions.value[0])
}

function onCustomerBlur() {
	setTimeout(() => {
		showSuggestions.value = false
	}, 150)
}

function readRecents(key) {
	try {
		const data = uni.getStorageSync(key)
		if (Array.isArray(data)) return data
		if (typeof data === 'string') {
			const parsed = JSON.parse(data)
			return Array.isArray(parsed) ? parsed : []
		}
		return []
	} catch (err) {
		return []
	}
}

function saveRecents(key, list) {
	try {
		const next = list.slice(0, MAX_RECENTS)
		uni.setStorageSync(key, next)
	} catch (err) {
		// noop
	}
}

function uniqueBy(list, getKey) {
	const seen = new Set()
	const result = []
	list.forEach((item) => {
		const key = getKey(item)
		if (!key || seen.has(key)) return
		seen.add(key)
		result.push(item)
	})
	return result
}

function normalizeVehicle(item) {
	return {
		_id: item._id || '',
		plate_no: item.plate_no || item.plateNo || item.uniq_key || '',
		remark: item.remark || ''
	}
}

function normalizeDelivery(item) {
	return {
		_id: item._id || '',
		name: item.name || item.username || '',
		phone: item.phone || '',
		remark: item.remark || '',
		is_active: item.is_active !== false
	}
}

function onVehicleInput(value) {
	update('vehicleNo', value)
	if (vehicleTimer.value) clearTimeout(vehicleTimer.value)
	vehicleTimer.value = setTimeout(() => {
		fetchVehicles(value)
	}, 200)
}

async function fetchVehicles(keyword) {
	const key = String(keyword || '').trim()
	if (!key) {
		const recents = readRecents(RECENT_VEHICLE_KEY)
		vehicleSuggestions.value = recents
		showVehicleSuggestions.value = recents.length > 0
		return
	}
	const recentList = readRecents(RECENT_VEHICLE_KEY).filter((item) =>
		(item.plate_no || '').toLowerCase().includes(key.toLowerCase())
	)
	const res = await searchVehiclesV1({ keyword: key, limit: 8, is_active: true })
	if (res?.code !== 0) {
		vehicleSuggestions.value = recentList
		showVehicleSuggestions.value = recentList.length > 0
		return
	}
	const remote = Array.isArray(res.data) ? res.data.map(normalizeVehicle) : []
	const combined = uniqueBy([...recentList, ...remote], (item) => item.plate_no)
	vehicleSuggestions.value = combined
	showVehicleSuggestions.value = combined.length > 0
}

function selectVehicle(item) {
	const normalized = normalizeVehicle(item)
	emitPatch({
		vehicleNo: normalized.plate_no
	})
	const recents = readRecents(RECENT_VEHICLE_KEY)
	const next = uniqueBy([normalized, ...recents], (row) => row.plate_no)
	saveRecents(RECENT_VEHICLE_KEY, next)
	showVehicleSuggestions.value = false
}

function onVehicleConfirm() {
	if (!vehicleSuggestions.value.length) {
		showVehicleSuggestions.value = false
		return
	}
	selectVehicle(vehicleSuggestions.value[0])
}

function onVehicleBlur() {
	setTimeout(() => {
		showVehicleSuggestions.value = false
	}, 150)
}

function onVehicleFocus() {
	showVehicleSuggestions.value = true
	if (!props.modelValue?.vehicleNo) {
		fetchVehicles('')
	}
}

function onDeliveryInput(slot, value) {
	if (slot === 1) emitPatch({ deliveryMan1: value })
	else emitPatch({ deliveryMan2: value })

	if (slot === 1 && deliveryTimer1.value) clearTimeout(deliveryTimer1.value)
	if (slot === 2 && deliveryTimer2.value) clearTimeout(deliveryTimer2.value)

	const timer = setTimeout(() => {
		fetchDelivery(slot, value)
	}, 200)

	if (slot === 1) deliveryTimer1.value = timer
	else deliveryTimer2.value = timer
}

async function fetchDelivery(slot, keyword) {
	const key = String(keyword || '').trim()
	if (!key) {
		const recents = readRecents(RECENT_DELIVERY_KEY)
		if (slot === 1) {
			deliverySuggestions1.value = recents
			showDelivery1Suggestions.value = recents.length > 0
		} else {
			deliverySuggestions2.value = recents
			showDelivery2Suggestions.value = recents.length > 0
		}
		return
	}
	const recentList = readRecents(RECENT_DELIVERY_KEY).filter((item) =>
		`${item.name || ''} ${item.phone || ''}`.toLowerCase().includes(key.toLowerCase())
	)
	const res = await searchDeliveriesV1({ keyword: key, limit: 8, is_active: true })
	if (res?.code !== 0) {
		if (slot === 1) {
			deliverySuggestions1.value = recentList
			showDelivery1Suggestions.value = recentList.length > 0
		} else {
			deliverySuggestions2.value = recentList
			showDelivery2Suggestions.value = recentList.length > 0
		}
		return
	}
	const list = Array.isArray(res.data) ? res.data.map(normalizeDelivery) : []
	const combined = uniqueBy([...recentList, ...list], (item) => item._id || `${item.name}|${item.phone}`)
	if (slot === 1) {
		deliverySuggestions1.value = combined
		showDelivery1Suggestions.value = combined.length > 0
	} else {
		deliverySuggestions2.value = combined
		showDelivery2Suggestions.value = combined.length > 0
	}
}

function selectDelivery(slot, item) {
	const normalized = normalizeDelivery(item)
	const value = normalized.name
	if (slot === 1) emitPatch({ deliveryMan1: value })
	else emitPatch({ deliveryMan2: value })

	if (slot === 1) showDelivery1Suggestions.value = false
	else showDelivery2Suggestions.value = false

	const recents = readRecents(RECENT_DELIVERY_KEY)
	const next = uniqueBy([normalized, ...recents], (row) => row._id || `${row.name}|${row.phone}`)
	saveRecents(RECENT_DELIVERY_KEY, next)
}

function onDeliveryConfirm(slot) {
	const list = slot === 1 ? deliverySuggestions1.value : deliverySuggestions2.value
	if (!list.length) {
		if (slot === 1) showDelivery1Suggestions.value = false
		else showDelivery2Suggestions.value = false
		return
	}
	selectDelivery(slot, list[0])
}

function onDeliveryBlur(slot) {
	setTimeout(() => {
		if (slot === 1) showDelivery1Suggestions.value = false
		else showDelivery2Suggestions.value = false
	}, 150)
}

function onDeliveryFocus(slot) {
	if (slot === 1) showDelivery1Suggestions.value = true
	else showDelivery2Suggestions.value = true

	const current = slot === 1 ? props.modelValue?.deliveryMan1 : props.modelValue?.deliveryMan2
	if (!current) fetchDelivery(slot, '')
}
</script>

<style scoped>
.info-grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 24rpx;
}

.info-grid--sm {
	grid-template-columns: repeat(6, 1fr);
	gap: 16rpx;
}

.form-item {
	display: flex;
	flex-direction: column;
}

.span-2 {
	grid-column: span 2;
}

.unit-group {
	display: grid;
	grid-template-columns: 2fr 1fr;
	gap: 16rpx;
}

.customer-field {
	position: relative;
}

.vehicle-field {
	position: relative;
}

.delivery-field {
	position: relative;
}

.suggestions {
	position: absolute;
	top: 100%;
	left: 0;
	right: 0;
	background: #ffffff;
	border: 1rpx solid #e2e8f0;
	border-radius: 16rpx;
	box-shadow: 0 12rpx 32rpx rgba(0, 0, 0, 0.1);
	z-index: 100;
	margin-top: 8rpx;
	overflow: hidden;
}

.suggest-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 24rpx;
	border-bottom: 1rpx solid #f8fafc;
	transition: background 0.2s;
}

.suggest-item:last-child {
	border-bottom: none;
}

.suggest-item:active {
	background: #f1f5f9;
}

.suggest-info {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
}

.suggest-name {
	font-size: 28rpx;
	font-weight: 600;
	color: #1e293b;
}

.suggest-sub {
	font-size: 24rpx;
	color: #64748b;
}

.suggest-empty {
	padding: 32rpx;
	text-align: center;
	font-size: 26rpx;
	color: #94a3b8;
}

.picker-full {
	width: 100%;
}

.picker-input {
	pointer-events: none;
}

.choice-group {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
}

.choice-group--compact {
	gap: 10rpx;
}

.choice-pill {
	padding: 10rpx 20rpx;
	border-radius: 999rpx;
	border: 1rpx solid #e2e8f0;
	background: #f8fafc;
	font-size: 24rpx;
	color: #475569;
}

.choice-pill--active {
	background: #e0f2fe;
	border-color: #bae6fd;
	color: #0f172a;
	font-weight: 600;
}

@media (max-width: 600px) {
	.info-grid {
		grid-template-columns: 1fr;
	}
	.span-2 {
		grid-column: auto;
	}
	.unit-group {
		grid-template-columns: 1fr;
	}
}
</style>
