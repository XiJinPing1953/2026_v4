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
import { normalizeBottleNo, normalizeText, todayDate } from '@/services/pda/shared'

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

	function setOutNet(index, value) {
		const row = form.value.outItems[index]
		if (!row) return
		row.net = normalizeText(value)
		markDepositDirty()
	}

	function setBackGross(index, value) {
		const row = form.value.backItems[index]
		if (!row) return
		row.gross = normalizeText(value)
		syncBackRow(index)
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
		syncBackRow,
		setOutNet,
		setBackGross,
		resolveBottle,
		refreshDepositRows,
		submit
	}
}
