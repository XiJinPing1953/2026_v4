import { ref } from 'vue'
import { findPdaBottleByNo } from '@/services/pda/bottle'
import { getPdaCustomerById, listPdaCustomers, resolvePdaCustomerPricing } from '@/services/pda/customer'
import {
	applyBottleToSaleRow,
	createPdaBackItem,
	createPdaBottleSaleForm,
	createPdaOutItem,
	previewPdaDepositRows,
	submitPdaBottleSale,
	syncPdaBackRow
} from '@/services/pda/sale'
import { PDA_BLE_SCALE_DISPLAY_DECIMALS, PDA_BLE_SCALE_DIVISION_STEP_KG, quantizeBleScaleWeightKg } from '@/services/pda/bleScale'
import { normalizePdaScanLocation } from '@/services/pda/location'
import { normalizeBottleNo, normalizeText, toNumber, todayDate } from '@/services/pda/shared'

const SCALE_STABLE_CACHE_MAX_AGE_MS = 15000

function hasBleScaleMeasuredWeight(row = {}) {
	return (
		normalizeText(row.weightSource ?? row.weight_source) === 'ble_scale' &&
		toNumber(row.gross ?? row.gross_weight ?? row.grossMeasured ?? row.gross_measured, null) > 0 &&
		toNumber(row.tare ?? row.tare_weight, null) >= 0 &&
		toNumber(row.net ?? row.net_weight, null) > 0
	)
}

export function resolveUsableBleScaleWeight(scaleSnapshot = {}, now = Date.now()) {
	const isOnline = Boolean(scaleSnapshot.is_online ?? scaleSnapshot.isOnline)
	const isStable = Boolean(scaleSnapshot.is_stable ?? scaleSnapshot.isStable)
	const sampledAt = Number((scaleSnapshot.sampled_at ?? scaleSnapshot.sampledAt) || now)
	const currentScaleWeightRaw = toNumber(scaleSnapshot.weight_kg ?? scaleSnapshot.weightKg, null)
	const hasCurrentStableWeight = isOnline && isStable && currentScaleWeightRaw > 0
	const cachedStableWeightRaw = toNumber(scaleSnapshot.last_stable_weight_kg ?? scaleSnapshot.lastStableWeightKg, null)
	const cachedStableAt = Number((scaleSnapshot.last_stable_at ?? scaleSnapshot.lastStableAt) || 0)
	const hasFreshCachedStableWeight = cachedStableWeightRaw > 0 && cachedStableAt > 0 && now - cachedStableAt <= SCALE_STABLE_CACHE_MAX_AGE_MS
	const weightKg = hasCurrentStableWeight ? currentScaleWeightRaw : hasFreshCachedStableWeight ? cachedStableWeightRaw : null
	return {
		weightKg,
		sampledAt: hasCurrentStableWeight ? sampledAt : cachedStableAt || sampledAt,
		source: hasCurrentStableWeight ? 'current' : hasFreshCachedStableWeight ? 'stable_cache' : '',
		hasCurrentStableWeight,
		hasFreshCachedStableWeight
	}
}

export function usePdaSaleForm(initialValues = {}) {
	const form = ref({
		...createPdaBottleSaleForm(),
		...initialValues
	})
	if (!Array.isArray(form.value.outItems) || !form.value.outItems.length) form.value.outItems = [createPdaOutItem()]
	if (!Array.isArray(form.value.backItems)) form.value.backItems = []
	if (!Array.isArray(form.value.depositRows)) form.value.depositRows = []

	const selectedCustomer = ref(null)
	const customerKeyword = ref(normalizeText(initialValues.customerName))
	const resolvingBottleKey = ref('')
	const depositLoading = ref(false)
	const depositDirty = ref(true)
	const submitting = ref(false)

	function markDepositDirty() {
		depositDirty.value = true
	}

	function clearDepositPreview() {
		form.value.depositRows = []
		form.value.depositRaw = ''
		form.value.depositCount = 0
	}

	function applySelectedCustomer(customer) {
		selectedCustomer.value = customer || null
		form.value.customerId = normalizeText(customer?._id)
		form.value.customerName = normalizeText(customer?.name)
		customerKeyword.value = normalizeText(customer?.name)
		const pricing = resolvePdaCustomerPricing(customer)
		form.value.unitPrice = pricing.ok ? String(pricing.unitPrice) : ''
		markDepositDirty()
	}

	async function hydrateSelectedCustomer(customerId = '') {
		const id = normalizeText(customerId)
		if (!id) return { code: 400, msg: '客户 ID 必填', data: null }
		const res = await getPdaCustomerById(id)
		if (res?.code === 0 && res.data) applySelectedCustomer(res.data)
		return res
	}

	async function searchCustomers(keyword = customerKeyword.value) {
		const text = normalizeText(keyword)
		customerKeyword.value = text
		if (text.length < 2) return { code: 0, data: [] }
		return listPdaCustomers({
			keyword: text,
			page: 1,
			pageSize: 12,
			isActive: true
		})
	}

	function setCustomerKeyword(keyword = '') {
		const text = normalizeText(keyword)
		const currentName = normalizeText(selectedCustomer.value?.name)
		customerKeyword.value = text
		if (!form.value.customerId || text === currentName) return
		selectedCustomer.value = null
		form.value.customerId = ''
		form.value.customerName = ''
		form.value.unitPrice = ''
		clearDepositPreview()
		markDepositDirty()
	}

	function clearSelectedCustomer(options = {}) {
		const keepKeyword = normalizeText(options.keepKeyword)
		selectedCustomer.value = null
		form.value.customerId = ''
		form.value.customerName = ''
		form.value.unitPrice = ''
		customerKeyword.value = keepKeyword
		clearDepositPreview()
		markDepositDirty()
	}

	function addOutItem() {
		form.value.outItems.push(createPdaOutItem())
		markDepositDirty()
	}

	function removeOutItem(index) {
		if (form.value.outItems.length <= 1) {
			form.value.outItems = [createPdaOutItem()]
		} else {
			form.value.outItems.splice(index, 1)
		}
		markDepositDirty()
	}

	function addBackItem() {
		form.value.backItems.push(createPdaBackItem())
		markDepositDirty()
	}

	function removeBackItem(index) {
		form.value.backItems.splice(index, 1)
		markDepositDirty()
	}

	function normalizeOutBottle(index) {
		const row = form.value.outItems[index]
		if (!row) return
		row.bottleNo = normalizeBottleNo(row.bottleNo)
		markDepositDirty()
	}

	function normalizeBackBottle(index) {
		const row = form.value.backItems[index]
		if (!row) return
		form.value.backItems[index] = syncPdaBackRow({
			...row,
			bottleNo: normalizeBottleNo(row.bottleNo)
		})
		markDepositDirty()
	}

	function syncBackRow(index) {
		const row = form.value.backItems[index]
		if (!row) return
		form.value.backItems[index] = syncPdaBackRow(row)
		markDepositDirty()
	}

	async function resolveBottle(type, index) {
		const list = type === 'back' ? form.value.backItems : form.value.outItems
		const row = list[index]
		if (!row) return { code: 404, msg: '行不存在', data: null }
		const key = `${type}:${index}`
		resolvingBottleKey.value = key
		try {
			const res = await findPdaBottleByNo(row.bottleNo)
			if (res?.code === 0 && res.data) {
				list[index] = applyBottleToSaleRow(row, res.data, { fillTare: type === 'back' })
				markDepositDirty()
			}
			return res
		} finally {
			resolvingBottleKey.value = ''
		}
	}

	function applyBottleSelection(type, index, bottle) {
		const list = type === 'back' ? form.value.backItems : form.value.outItems
		const row = list[index]
		if (!row || !bottle) return row
		list[index] = applyBottleToSaleRow(row, bottle, { fillTare: type === 'back' })
		markDepositDirty()
		return list[index]
	}

	function attachBottleScanLocation(type, index, location) {
		const list = type === 'back' ? form.value.backItems : form.value.outItems
		const row = list[index]
		if (!row) return null
		row.scanLocation = normalizePdaScanLocation(location)
		markDepositDirty()
		return row
	}

	function applyDeliverySelection(slot, delivery) {
		const name = normalizeText(delivery?.name || delivery)
		if (!name) return
		if (slot === 'delivery2') form.value.delivery2 = name
		else form.value.delivery1 = name
		markDepositDirty()
	}

	function applyVehicleSelection(vehicle) {
		const plateNo = normalizeText(vehicle?.plate_no || vehicle?.plateNo || vehicle)
		if (!plateNo) return
		form.value.vehicleNo = plateNo
		markDepositDirty()
	}

	function formatScaleValue(value) {
		const num = toNumber(value, null)
		if (!(num != null)) return ''
		return Number(num).toFixed(PDA_BLE_SCALE_DISPLAY_DECIMALS)
	}

	function applyScaleWeightToRow(type, index, scaleSnapshot = {}, options = {}) {
		const list = type === 'back' ? form.value.backItems : form.value.outItems
		const row = list[index]
		if (!row) return { code: 404, msg: '行不存在', data: null }
		if (hasBleScaleMeasuredWeight(row) && options.force !== true) {
			return {
				code: 208,
				msg: '该瓶已完成称重，如需覆盖请点击重新称重',
				data: {
					alreadyWeighed: true
				}
			}
		}
		const isConnected = Boolean(scaleSnapshot.is_connected ?? scaleSnapshot.isConnected)
		const isOnline = Boolean(scaleSnapshot.is_online ?? scaleSnapshot.isOnline)
		const isStable = Boolean(scaleSnapshot.is_stable ?? scaleSnapshot.isStable)
		const selected = resolveUsableBleScaleWeight(scaleSnapshot)
		const selectedScaleWeight = selected.weightKg
		if (!(selectedScaleWeight > 0)) {
			if (!isConnected) return { code: 400, msg: '吊秤未连接，请先连接吊秤', data: null }
			if (!isOnline) return { code: 400, msg: '等待称重数据，请稍候重试', data: null }
			if (!isStable) return { code: 400, msg: '请保持吊秤稳定后再回填', data: null }
			return { code: 400, msg: '当前重量无效，请重试', data: null }
		}

		const grossMeasured = quantizeBleScaleWeightKg(selectedScaleWeight, PDA_BLE_SCALE_DIVISION_STEP_KG, PDA_BLE_SCALE_DISPLAY_DECIMALS)
		if (!(grossMeasured > 0)) return { code: 400, msg: '秤值量化后无效，请重试', data: null }
		const tareWeight = toNumber(row.tare ?? row.tare_weight, null)
		if (!(tareWeight >= 0)) {
			return { code: 400, msg: '该瓶未维护空瓶重，请先扫码或查瓶补齐瓶档', data: null }
		}
		const netWeight = Number((grossMeasured - tareWeight).toFixed(PDA_BLE_SCALE_DISPLAY_DECIMALS))
		if (!(netWeight > 0)) {
			return { code: 400, msg: '毛重减空瓶重后净重需大于 0，请核对瓶档和称重', data: null }
		}

		const nextCommon = {
			tare: formatScaleValue(tareWeight),
			gross: formatScaleValue(grossMeasured),
			grossMeasured: formatScaleValue(grossMeasured),
			tareSource: 'bottle_profile',
			weightSource: 'ble_scale',
			weightSampledAt: selected.sampledAt
		}

		if (type === 'back') {
			list[index] = syncPdaBackRow({
				...row,
				...nextCommon,
				net: formatScaleValue(netWeight)
			})
		} else {
			list[index] = {
				...row,
				...nextCommon,
				net: formatScaleValue(netWeight)
			}
		}
		markDepositDirty()
		return {
			code: 0,
			msg: '',
			data: {
				grossMeasured,
				tareWeight,
				netWeight
			}
		}
	}

	function clearScaleWeightFromRow(type, index) {
		const list = type === 'back' ? form.value.backItems : form.value.outItems
		const row = list[index]
		if (!row) return { code: 404, msg: '行不存在', data: null }
		const next = {
			...row,
			gross: '',
			net: '',
			grossMeasured: '',
			weightSource: '',
			weightSampledAt: null
		}
		list[index] = type === 'back' ? syncPdaBackRow(next) : next
		markDepositDirty()
		return { code: 0, msg: '', data: list[index] }
	}

	async function refreshDepositRows(options = {}) {
		if (!normalizeText(form.value.customerId)) {
			clearDepositPreview()
			return { code: 400, msg: '请先选择客户' }
		}
		depositLoading.value = true
		try {
			const res = await previewPdaDepositRows(form.value)
			if (res?.code === 0) {
				form.value.depositRows = res.data?.depositRows || []
				form.value.depositRaw = res.data?.raw || ''
				form.value.depositCount = Number(res.data?.baseCount || 0)
				depositDirty.value = false
			}
			return res
		} finally {
			depositLoading.value = false
		}
	}

	async function submit() {
		submitting.value = true
		try {
			const res = await submitPdaBottleSale(form.value, { customer: selectedCustomer.value })
			if (res?.depositPreview) {
				form.value.depositRows = res.depositPreview.depositRows || []
				form.value.depositRaw = res.depositPreview.raw || ''
				form.value.depositCount = Number(res.depositPreview.baseCount || 0)
				depositDirty.value = false
			}
			if (res?.code === 0) {
				const keepDate = form.value.date || todayDate()
				form.value = {
					...createPdaBottleSaleForm(),
					date: keepDate
				}
				selectedCustomer.value = null
				customerKeyword.value = ''
				depositDirty.value = true
			}
			return res
		} finally {
			submitting.value = false
		}
	}

	return {
		form,
		selectedCustomer,
		customerKeyword,
		resolvingBottleKey,
		depositLoading,
		depositDirty,
		submitting,
		markDepositDirty,
		applySelectedCustomer,
		applyBottleSelection,
		attachBottleScanLocation,
		applyDeliverySelection,
		applyVehicleSelection,
		hydrateSelectedCustomer,
		searchCustomers,
		setCustomerKeyword,
		clearSelectedCustomer,
		addOutItem,
		removeOutItem,
		addBackItem,
		removeBackItem,
		normalizeOutBottle,
		normalizeBackBottle,
		applyScaleWeightToRow,
		clearScaleWeightFromRow,
		resolveBottle,
		refreshDepositRows,
		submit
	}
}
