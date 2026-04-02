<template>
		<AppCard class="basic-info-card" :padding="size === 'sm' ? '24rpx' : '32rpx'">
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

				<view
					id="suggest-anchor-customer"
					class="form-item span-2 customer-field"
					:class="{
						'field-popover-open': showSuggestions,
						'field-popover-up': suggestionPlacements.customer === 'up'
					}"
				>
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
					@focus="onCustomerFocus"
				/>
					<scroll-view v-if="showSuggestions && shouldUseScrollableSuggestions(suggestions)" scroll-y class="suggestions suggestions--scroll">
						<view class="suggest-list">
								<view
									v-for="item in suggestions"
									:key="item._id || `${item.name}-${item.contact}`"
									class="suggest-item"
									@tap.stop="selectCustomer(item)"
									@click.stop="selectCustomer(item)"
								>
								<view class="suggest-info">
									<text class="suggest-name">{{ item.name }}</text>
									<text class="suggest-sub" v-if="item.contact">{{ item.contact }}</text>
								</view>
								<AppIcon name="plus" size="24rpx" color="#94a3b8" />
							</view>
						</view>
					</scroll-view>
					<view v-else-if="showSuggestions && suggestions.length" class="suggestions">
						<view class="suggest-list">
								<view
									v-for="item in suggestions"
									:key="item._id || `${item.name}-${item.contact}`"
									class="suggest-item"
									@tap.stop="selectCustomer(item)"
								@click.stop="selectCustomer(item)"
							>
								<view class="suggest-info">
									<text class="suggest-name">{{ item.name }}</text>
									<text class="suggest-sub" v-if="item.contact">{{ item.contact }}</text>
								</view>
								<AppIcon name="plus" size="24rpx" color="#94a3b8" />
							</view>
						</view>
					</view>
					<view v-else-if="showSuggestions" class="suggestions">
						<view class="suggest-empty">
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

				<view
					id="suggest-anchor-vehicle"
					class="form-item span-2 vehicle-field"
					:class="{
						'field-popover-open': showVehicleSuggestions,
						'field-popover-up': suggestionPlacements.vehicle === 'up'
					}"
				>
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
					<scroll-view v-if="showVehicleSuggestions && shouldUseScrollableSuggestions(vehicleSuggestions)" scroll-y class="suggestions suggestions--scroll">
						<view class="suggest-list">
								<view
									v-for="item in vehicleSuggestions"
									:key="item._id || item.plate_no || item.plateNo || item.name"
									class="suggest-item"
									@tap.stop="selectVehicle(item)"
									@click.stop="selectVehicle(item)"
								>
								<view class="suggest-info">
									<text class="suggest-name">{{ item.plate_no || item.plateNo || item.name }}</text>
									<text class="suggest-sub" v-if="item.remark">{{ item.remark }}</text>
								</view>
								<AppIcon name="plus" size="24rpx" color="#94a3b8" />
							</view>
						</view>
					</scroll-view>
					<view v-else-if="showVehicleSuggestions && vehicleSuggestions.length" class="suggestions">
						<view class="suggest-list">
								<view
									v-for="item in vehicleSuggestions"
									:key="item._id || item.plate_no || item.plateNo || item.name"
									class="suggest-item"
								@tap.stop="selectVehicle(item)"
								@click.stop="selectVehicle(item)"
							>
								<view class="suggest-info">
									<text class="suggest-name">{{ item.plate_no || item.plateNo || item.name }}</text>
									<text class="suggest-sub" v-if="item.remark">{{ item.remark }}</text>
								</view>
								<AppIcon name="plus" size="24rpx" color="#94a3b8" />
							</view>
						</view>
					</view>
					<view v-else-if="showVehicleSuggestions" class="suggestions">
						<view class="suggest-empty">
							<text>未找到车辆</text>
						</view>
					</view>
			</view>

				<view
					id="suggest-anchor-delivery1"
					class="form-item delivery-field"
					:class="{
						'field-popover-open': showDelivery1Suggestions,
						'field-popover-up': suggestionPlacements.delivery1 === 'up'
					}"
				>
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
					<scroll-view v-if="showDelivery1Suggestions && shouldUseScrollableSuggestions(deliverySuggestions1)" scroll-y class="suggestions suggestions--scroll">
						<view class="suggest-list">
								<view
									v-for="item in deliverySuggestions1"
									:key="item._id || `${item.name || item.username}-${item.phone || item.remark}`"
									class="suggest-item"
									@tap.stop="selectDelivery(1, item)"
									@click.stop="selectDelivery(1, item)"
								>
								<view class="suggest-info">
									<text class="suggest-name">{{ item.name || item.username }}</text>
									<text class="suggest-sub" v-if="item.phone || item.remark">{{ item.phone || item.remark }}</text>
								</view>
								<AppIcon name="plus" size="24rpx" color="#94a3b8" />
							</view>
						</view>
					</scroll-view>
					<view v-else-if="showDelivery1Suggestions && deliverySuggestions1.length" class="suggestions">
						<view class="suggest-list">
								<view
									v-for="item in deliverySuggestions1"
									:key="item._id || `${item.name || item.username}-${item.phone || item.remark}`"
									class="suggest-item"
								@tap.stop="selectDelivery(1, item)"
								@click.stop="selectDelivery(1, item)"
							>
								<view class="suggest-info">
									<text class="suggest-name">{{ item.name || item.username }}</text>
									<text class="suggest-sub" v-if="item.phone || item.remark">{{ item.phone || item.remark }}</text>
								</view>
								<AppIcon name="plus" size="24rpx" color="#94a3b8" />
							</view>
						</view>
					</view>
					<view v-else-if="showDelivery1Suggestions" class="suggestions">
						<view class="suggest-empty">
							<text>未找到配送员</text>
						</view>
					</view>
			</view>

				<view
					id="suggest-anchor-delivery2"
					class="form-item delivery-field"
					:class="{
						'field-popover-open': showDelivery2Suggestions,
						'field-popover-up': suggestionPlacements.delivery2 === 'up'
					}"
				>
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
					<scroll-view v-if="showDelivery2Suggestions && shouldUseScrollableSuggestions(deliverySuggestions2)" scroll-y class="suggestions suggestions--scroll">
						<view class="suggest-list">
								<view
									v-for="item in deliverySuggestions2"
									:key="item._id || `${item.name || item.username}-${item.phone || item.remark}`"
									class="suggest-item"
									@tap.stop="selectDelivery(2, item)"
									@click.stop="selectDelivery(2, item)"
								>
								<view class="suggest-info">
									<text class="suggest-name">{{ item.name || item.username }}</text>
									<text class="suggest-sub" v-if="item.phone || item.remark">{{ item.phone || item.remark }}</text>
								</view>
								<AppIcon name="plus" size="24rpx" color="#94a3b8" />
							</view>
						</view>
					</scroll-view>
					<view v-else-if="showDelivery2Suggestions && deliverySuggestions2.length" class="suggestions">
						<view class="suggest-list">
								<view
									v-for="item in deliverySuggestions2"
									:key="item._id || `${item.name || item.username}-${item.phone || item.remark}`"
									class="suggest-item"
								@tap.stop="selectDelivery(2, item)"
								@click.stop="selectDelivery(2, item)"
							>
								<view class="suggest-info">
									<text class="suggest-name">{{ item.name || item.username }}</text>
									<text class="suggest-sub" v-if="item.phone || item.remark">{{ item.phone || item.remark }}</text>
								</view>
								<AppIcon name="plus" size="24rpx" color="#94a3b8" />
							</view>
						</view>
					</view>
					<view v-else-if="showDelivery2Suggestions" class="suggestions">
						<view class="suggest-empty">
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

			<view class="form-item span-2">
				<AppInput
					:model-value="modelValue.remark"
					label="业务备注"
					placeholder="例如：票上多算84元、余款68324.4元"
					:size="size"
					@update:modelValue="(v) => update('remark', v)"
				/>
			</view>
		</view>
	</AppCard>
</template>

<script setup>
import { getCurrentInstance, nextTick, reactive, ref } from 'vue'
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
const suggestionPlacements = reactive({
	customer: 'down',
	vehicle: 'down',
	delivery1: 'down',
	delivery2: 'down'
})
const instance = getCurrentInstance()

const SUGGESTION_GAP_RPX = 8
const SUGGESTION_EMPTY_HEIGHT_RPX = 96
const SUGGESTION_ITEM_HEIGHT_RPX = 88
const SUGGESTION_SCROLL_HEIGHT_RPX = 320

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
	if (!String(value || '').trim()) {
		suggestions.value = []
		showSuggestions.value = false
		return
	}
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
	const res = await listCustomersV1({ keyword: key, pageSize: 20, is_active: true })
	if (res?.code !== 0) {
		suggestions.value = []
		showSuggestions.value = false
		return
	}
	const remote = Array.isArray(res.data) ? res.data.map(normalizeCustomer).slice(0, 20) : []
	suggestions.value = remote
	showSuggestions.value = remote.length > 0
	updatePopoverPlacement('customer', remote.length)
}

function normalizeCustomer(item) {
	return {
		_id: item?._id || '',
		name: item?.name || '',
		contact: item?.contact || '',
		default_unit_price: item?.default_unit_price,
		default_price_unit: item?.default_price_unit || ''
	}
}

function resolveSettlementModeByCustomer(item) {
	return String(item?.default_price_unit || '').trim() === 'm3' ? 'customer_flow' : 'sale'
}

function selectCustomer(item) {
	const normalized = normalizeCustomer(item)
	emitPatch({
		customerId: normalized._id,
		customerName: normalized.name,
		unitPrice: normalized.default_unit_price != null ? String(normalized.default_unit_price) : props.modelValue?.unitPrice || '',
		priceUnit: normalized.default_price_unit || props.modelValue?.priceUnit || 'kg',
		settlementMode: resolveSettlementModeByCustomer(normalized)
	})
	suggestions.value = []
	showSuggestions.value = false
}

function onCustomerConfirm() {
	emitPatch({
		customerName: String(props.modelValue?.customerName || '').trim(),
		customerId: props.modelValue?.customerId || ''
	})
	suggestions.value = []
	showSuggestions.value = false
}

function onCustomerBlur() {
	setTimeout(() => {
		showSuggestions.value = false
	}, 150)
}

function onCustomerFocus() {
	const keyword = String(props.modelValue?.customerName || '').trim()
	if (!keyword) return
	showSuggestions.value = true
	if (fetchTimer.value) clearTimeout(fetchTimer.value)
	fetchTimer.value = setTimeout(() => {
		fetchCustomers(keyword)
	}, 120)
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
	if (!String(value || '').trim()) {
		vehicleSuggestions.value = []
		showVehicleSuggestions.value = false
		return
	}
	vehicleTimer.value = setTimeout(() => {
		fetchVehicles(value)
	}, 200)
}

async function fetchVehicles(keyword) {
	const key = String(keyword || '').trim()
	if (!key) {
		vehicleSuggestions.value = []
		showVehicleSuggestions.value = false
		return
	}
	const res = await searchVehiclesV1({ keyword: key, limit: 20, is_active: true })
	if (res?.code !== 0) {
		vehicleSuggestions.value = []
		showVehicleSuggestions.value = false
		return
	}
	const remote = Array.isArray(res.data) ? res.data.map(normalizeVehicle).slice(0, 20) : []
	vehicleSuggestions.value = remote
	showVehicleSuggestions.value = remote.length > 0
	updatePopoverPlacement('vehicle', remote.length)
}

function selectVehicle(item) {
	const normalized = normalizeVehicle(item)
	emitPatch({
		vehicleNo: normalized.plate_no
	})
	vehicleSuggestions.value = []
	showVehicleSuggestions.value = false
}

function onVehicleConfirm() {
	update('vehicleNo', String(props.modelValue?.vehicleNo || '').trim())
	vehicleSuggestions.value = []
	showVehicleSuggestions.value = false
}

function onVehicleBlur() {
	setTimeout(() => {
		showVehicleSuggestions.value = false
	}, 150)
}

function onVehicleFocus() {
	const keyword = String(props.modelValue?.vehicleNo || '').trim()
	if (!keyword) return
	showVehicleSuggestions.value = true
	if (vehicleTimer.value) clearTimeout(vehicleTimer.value)
	vehicleTimer.value = setTimeout(() => {
		fetchVehicles(keyword)
	}, 120)
}

function onDeliveryInput(slot, value) {
	if (slot === 1) emitPatch({ deliveryMan1: value })
	else emitPatch({ deliveryMan2: value })

	if (slot === 1 && deliveryTimer1.value) clearTimeout(deliveryTimer1.value)
	if (slot === 2 && deliveryTimer2.value) clearTimeout(deliveryTimer2.value)
	if (!String(value || '').trim()) {
		if (slot === 1) {
			deliverySuggestions1.value = []
			showDelivery1Suggestions.value = false
		} else {
			deliverySuggestions2.value = []
			showDelivery2Suggestions.value = false
		}
		return
	}

	const timer = setTimeout(() => {
		fetchDelivery(slot, value)
	}, 200)

	if (slot === 1) deliveryTimer1.value = timer
	else deliveryTimer2.value = timer
}

async function fetchDelivery(slot, keyword) {
	const key = String(keyword || '').trim()
	if (!key) {
		if (slot === 1) {
			deliverySuggestions1.value = []
			showDelivery1Suggestions.value = false
		} else {
			deliverySuggestions2.value = []
			showDelivery2Suggestions.value = false
		}
		return
	}
	const res = await searchDeliveriesV1({ keyword: key, limit: 20, is_active: true })
	if (res?.code !== 0) {
		if (slot === 1) {
			deliverySuggestions1.value = []
			showDelivery1Suggestions.value = false
		} else {
			deliverySuggestions2.value = []
			showDelivery2Suggestions.value = false
		}
		return
	}
	const list = Array.isArray(res.data) ? res.data.map(normalizeDelivery).slice(0, 20) : []
	if (slot === 1) {
		deliverySuggestions1.value = list
		showDelivery1Suggestions.value = list.length > 0
		updatePopoverPlacement('delivery1', list.length)
	} else {
		deliverySuggestions2.value = list
		showDelivery2Suggestions.value = list.length > 0
		updatePopoverPlacement('delivery2', list.length)
	}
}

function selectDelivery(slot, item) {
	const normalized = normalizeDelivery(item)
	const value = normalized.name
	if (slot === 1) emitPatch({ deliveryMan1: value })
	else emitPatch({ deliveryMan2: value })

	if (slot === 1) showDelivery1Suggestions.value = false
	else showDelivery2Suggestions.value = false
}

function onDeliveryConfirm(slot) {
	const current = slot === 1 ? props.modelValue?.deliveryMan1 : props.modelValue?.deliveryMan2
	if (slot === 1) emitPatch({ deliveryMan1: String(current || '').trim() })
	else emitPatch({ deliveryMan2: String(current || '').trim() })
	if (slot === 1) {
		deliverySuggestions1.value = []
		showDelivery1Suggestions.value = false
	} else {
		deliverySuggestions2.value = []
		showDelivery2Suggestions.value = false
	}
}

function onDeliveryBlur(slot) {
	setTimeout(() => {
		if (slot === 1) showDelivery1Suggestions.value = false
		else showDelivery2Suggestions.value = false
	}, 150)
}

function onDeliveryFocus(slot) {
	const current = slot === 1 ? props.modelValue?.deliveryMan1 : props.modelValue?.deliveryMan2
	const keyword = String(current || '').trim()
	if (!keyword) return
	if (slot === 1) {
		showDelivery1Suggestions.value = true
		if (deliveryTimer1.value) clearTimeout(deliveryTimer1.value)
		deliveryTimer1.value = setTimeout(() => {
			fetchDelivery(slot, keyword)
		}, 120)
		return
	}
	showDelivery2Suggestions.value = true
	if (deliveryTimer2.value) clearTimeout(deliveryTimer2.value)
	deliveryTimer2.value = setTimeout(() => {
		fetchDelivery(slot, keyword)
	}, 120)
}

function shouldUseScrollableSuggestions(list) {
	return Array.isArray(list) && list.length > 3
}

function getWindowInfoSafe() {
	try {
		if (typeof uni.getWindowInfo === 'function') return uni.getWindowInfo()
		if (typeof uni.getSystemInfoSync === 'function') return uni.getSystemInfoSync()
	} catch (err) {
		// noop
	}
	return {}
}

function rpxToPx(value) {
	const info = getWindowInfoSafe()
	const width = Number(info.windowWidth || info.screenWidth || 375)
	return (Number(value) * width) / 750
}

function estimateSuggestionHeightPx(count) {
	if (!count) return rpxToPx(SUGGESTION_EMPTY_HEIGHT_RPX)
	if (count > 3) return rpxToPx(SUGGESTION_SCROLL_HEIGHT_RPX)
	return rpxToPx(count * SUGGESTION_ITEM_HEIGHT_RPX + SUGGESTION_GAP_RPX)
}

function updatePopoverPlacement(fieldKey, count) {
	nextTick(() => {
		try {
			const query = uni.createSelectorQuery().in(instance?.proxy)
			query.select(`#suggest-anchor-${fieldKey}`).boundingClientRect((rect) => {
				if (!rect) {
					suggestionPlacements[fieldKey] = 'down'
					return
				}
				const info = getWindowInfoSafe()
				const windowHeight = Number(info.windowHeight || info.safeArea?.height || info.screenHeight || 667)
				const gapPx = rpxToPx(SUGGESTION_GAP_RPX)
				const popupHeightPx = estimateSuggestionHeightPx(count)
				const spaceBelow = windowHeight - Number(rect.bottom || 0) - gapPx
				const spaceAbove = Number(rect.top || 0) - gapPx
				suggestionPlacements[fieldKey] = spaceBelow < popupHeightPx && spaceAbove > spaceBelow ? 'up' : 'down'
			}).exec()
		} catch (err) {
			suggestionPlacements[fieldKey] = 'down'
		}
	})
}
</script>

<style scoped>
.info-grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 24rpx;
	overflow: visible;
}

.info-grid--sm {
	grid-template-columns: repeat(6, 1fr);
	gap: 16rpx;
}

.form-item {
	display: flex;
	flex-direction: column;
	overflow: visible;
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

.field-popover-open {
	z-index: 120;
}

.suggestions {
	position: absolute;
	top: calc(100% + 8rpx);
	left: 0;
	right: 0;
	z-index: 80;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, 0.08);
	overflow: hidden;
}

.field-popover-up .suggestions {
	top: auto;
	bottom: calc(100% + 8rpx);
}

.suggestions--scroll {
	height: 320rpx;
}

.suggest-list {
	padding-bottom: 8rpx;
}

.suggest-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 14rpx 16rpx;
	border-bottom: 1rpx solid #f1f5f9;
	transition: background 0.2s;
}

.suggest-item:last-child {
	border-bottom: none;
}

.suggest-item:active {
	background: #f8fafc;
}

.suggest-info {
	display: flex;
	flex-direction: column;
	gap: 4rpx;
	min-width: 0;
}

.suggest-name {
	font-size: 24rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.suggest-sub {
	font-size: 20rpx;
	color: var(--crm-text-muted);
}

.suggest-empty {
	padding: 32rpx;
	text-align: center;
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.basic-info-card {
	overflow: visible;
}

.basic-info-card :deep(.card__body) {
	overflow: visible;
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
