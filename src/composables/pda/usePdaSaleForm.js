import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getUser } from '@/services/auth'
import { findPdaBottleByNo } from '@/services/pda/bottle'
import { getPdaCustomerById, listPdaCustomers, resolvePdaCustomerPricing } from '@/services/pda/customer'
import {
	applyBottleToSaleRow,
	createPdaBackItem,
	createPdaBottleSaleForm,
	createPdaOutItem,
	previewPdaDepositRows,
	buildMobileSalePayload,
	createMobileSale,
	getMobileSaleCreateResult,
	validatePdaBottleSaleForm,
	syncPdaBackRow
} from '@/services/pda/sale'
import { PDA_BLE_SCALE_DISPLAY_DECIMALS, PDA_BLE_SCALE_DIVISION_STEP_KG, quantizeBleScaleWeightKg } from '@/services/pda/bleScale'
import { normalizePdaScanLocation } from '@/services/pda/location'
import { normalizeBottleNo, normalizeText, toNumber } from '@/services/pda/shared'
import { canReleaseMobileSubmission, cloneMobileSale, createMobileSaleDraftStore, createMobileSaleId, mobileSaleReceipt } from '@/services/pda/mobileSaleDraft'

const SCALE_SAMPLE_MAX_AGE_MS = 3000

function hasBleScaleMeasuredWeight(row = {}, type = 'out') {
	const tare = toNumber(row.tare ?? row.tare_weight, null)
	const net = toNumber(row.net ?? row.net_weight, null)
	return (
		['ble_scale', 'web_ble'].includes(normalizeText(row.weightSource ?? row.weight_source)) &&
		toNumber(row.gross ?? row.gross_weight ?? row.grossMeasured ?? row.gross_measured, null) > 0 &&
		tare != null && tare >= 0 && net != null && (type === 'back' || net > 0)
	)
}

export function resolveUsableBleScaleWeight(scaleSnapshot = {}, now = Date.now()) {
	const isOnline = Boolean(scaleSnapshot.is_online ?? scaleSnapshot.isOnline)
	const isConnected = Boolean(scaleSnapshot.is_connected ?? scaleSnapshot.isConnected)
	const isStable = Boolean(scaleSnapshot.is_stable ?? scaleSnapshot.isStable)
	const sampledAt = Number((scaleSnapshot.sampled_at ?? scaleSnapshot.sampledAt) || 0)
	const currentScaleWeightRaw = toNumber(scaleSnapshot.weight_kg ?? scaleSnapshot.weightKg, null)
	const hasCurrentStableWeight = isConnected && isOnline && isStable && currentScaleWeightRaw > 0
		&& sampledAt > 0 && now >= sampledAt && now - sampledAt <= SCALE_SAMPLE_MAX_AGE_MS
		&& sampledAt >= Number(scaleSnapshot.measurement_started_at || 0)
	return {
		weightKg: hasCurrentStableWeight ? currentScaleWeightRaw : null,
		sampledAt,
		source: hasCurrentStableWeight ? 'current' : '',
		hasCurrentStableWeight,
		hasFreshCachedStableWeight: false
	}
}

export function usePdaSaleForm(initialValues = {}) {
	// Account defaults seed new sales only; restored drafts and user edits keep their values.
	function createNewForm(values = {}) {
		const defaults = getUser()?.mobile_sale_defaults || {}
		return {
			...createPdaBottleSaleForm(),
			delivery1: normalizeText(defaults.delivery1),
			delivery2: normalizeText(defaults.delivery2),
			vehicleNo: normalizeText(defaults.vehicle_no),
			...values
		}
	}
	const form = ref(createNewForm(initialValues))
	if (!Array.isArray(form.value.outItems) || !form.value.outItems.length) form.value.outItems = [createPdaOutItem()]
	if (!Array.isArray(form.value.backItems)) form.value.backItems = []
	if (!Array.isArray(form.value.depositRows)) form.value.depositRows = []

	const selectedCustomer = ref(null)
	const customerKeyword = ref(normalizeText(initialValues.customerName))
	const resolvingBottleKey = ref('')
	const depositLoading = ref(false)
	const depositDirty = ref(true)
	const submitting = ref(false)
	const draftStep = ref(1)
	const receipt = ref(null)
	const frozenSubmission = ref(null)
	const currentOwner = () => normalizeText(getUser()?._id || getUser()?.id)
	const ownerId = currentOwner()
	// H5 tree shaking resolves direct uni API calls; the runtime uni object may omit them.
	const store = createMobileSaleDraftStore(ownerId, {
		getStorageSync: key => uni.getStorageSync(key),
		setStorageSync: (key, value) => uni.setStorageSync(key, value),
		removeStorageSync: key => uni.removeStorageSync(key)
	}, currentOwner)
	let draftId = createMobileSaleId()
	let unreadableDraft = false
	const draftStatus = ref({ available: false, restored: false, state: 'ready', message: '' })
	const submissionLocked = computed(() => unreadableDraft || submitting.value || Boolean(frozenSubmission.value) || draftStatus.value.available)
	let availableDraft = null
	let replacingDraft = false
	let revalidationCandidate = null
	let asyncRevision = 0
	function invalidateAsyncWork() { asyncRevision += 1 }
	try {
		availableDraft = store.load()
		draftStatus.value.available = Boolean(availableDraft)
	} catch (error) {
		unreadableDraft = true
		draftStatus.value = { available: false, restored: false, state: 'error', message: `无法读取草稿，原数据已保留，请检查原草稿后再录单：${error.message}` }
	}

	function ownerMatches() { return Boolean(ownerId && currentOwner() === ownerId) }
	function canEdit() { return ownerMatches() && !submissionLocked.value }
	function persistDraft() {
		if (unreadableDraft || replacingDraft || draftStatus.value.available) return false
		try {
			const hasContent = form.value.customerId || form.value.remark || form.value.delivery1 || form.value.delivery2 || form.value.vehicleNo
				|| [...(form.value.outItems || []), ...(form.value.backItems || [])].some((row) => row.bottleNo)
			if (!hasContent && !frozenSubmission.value && !receipt.value) {
				store.remove()
				draftStatus.value = { ...draftStatus.value, state: 'ready', message: '' }
				return true
			}
			store.save({ draftId, form: form.value, customer: selectedCustomer.value, step: draftStep.value, submission: frozenSubmission.value, receipt: receipt.value })
			draftStatus.value = { ...draftStatus.value, state: 'saved', message: '草稿已保存到当前浏览器' }
			return true
		} catch (error) {
			draftStatus.value = { ...draftStatus.value, state: 'error', message: `草稿未保存：${error.message}` }
			return false
		}
	}

	function restoreDraft() {
		if (!availableDraft || !ownerMatches()) return false
		invalidateAsyncWork()
		replacingDraft = true
		draftId = availableDraft.draftId || availableDraft.submission?.operationId || createMobileSaleId()
		form.value = cloneMobileSale(availableDraft.form)
		for (const rows of [form.value.outItems, form.value.backItems]) {
			for (const row of rows || []) row.rowId ||= createMobileSaleId('row')
		}
		selectedCustomer.value = availableDraft.customer || null
		customerKeyword.value = form.value.customerName || ''
		draftStep.value = Math.max(1, Math.min(3, Number(availableDraft.step) || 1))
		frozenSubmission.value = availableDraft.submission || null
		receipt.value = availableDraft.receipt || null
		if (frozenSubmission.value && receipt.value?.operationId !== frozenSubmission.value.operationId) {
			receipt.value = mobileSaleReceipt({ msg: '已恢复原提交操作，请查询结果或重试原内容' }, frozenSubmission.value.operationId)
		}
		depositDirty.value = true
		draftStatus.value = { available: false, restored: true, state: 'saved', message: '已恢复草稿；提交前会重新核对档案' }
		availableDraft = null
		replacingDraft = false
		persistDraft()
		return true
	}

	function resetDraft() {
		invalidateAsyncWork()
		replacingDraft = true
		draftId = createMobileSaleId()
		form.value = createNewForm()
		selectedCustomer.value = null
		customerKeyword.value = ''
		frozenSubmission.value = null
		receipt.value = null
		draftStep.value = 1
		depositDirty.value = true
		availableDraft = null
		draftStatus.value.available = false
		revalidationCandidate = null
		replacingDraft = false
		persistDraft()
	}

	function discardDraft() {
		if (unreadableDraft || !ownerMatches()) return false
		if (availableDraft?.submission || frozenSubmission.value) return false
		resetDraft()
		return true
	}

	function startNewSale() {
		if (unreadableDraft || !ownerMatches() || submitting.value || draftStatus.value.available) return false
		if (frozenSubmission.value && receipt.value?.sourceSaved !== true) return false
		resetDraft()
		return true
	}

	watch([form, selectedCustomer, draftStep, frozenSubmission, receipt], persistDraft, { deep: true, flush: 'sync' })
	if (typeof window !== 'undefined') window.addEventListener('pagehide', persistDraft)
	onBeforeUnmount(() => {
		persistDraft()
		if (typeof window !== 'undefined') window.removeEventListener('pagehide', persistDraft)
	})

	function markDepositDirty() {
		depositDirty.value = true
	}

	function clearDepositPreview() {
		form.value.depositRows = []
		form.value.depositRaw = ''
		form.value.depositCount = 0
	}

	function applySelectedCustomer(customer) {
		if (!canEdit()) return
		selectedCustomer.value = customer || null
		form.value.customerId = normalizeText(customer?._id)
		form.value.customerName = normalizeText(customer?.name)
		customerKeyword.value = normalizeText(customer?.name)
		const pricing = resolvePdaCustomerPricing(customer)
		form.value.unitPrice = pricing.ok ? String(pricing.unitPrice) : ''
		markDepositDirty()
	}

	async function hydrateSelectedCustomer(customerId = '') {
		if (!canEdit()) return { code: 409, msg: '请先处理现有草稿或提交结果' }
		const id = normalizeText(customerId)
		const revision = asyncRevision
		const previousCustomerId = form.value.customerId
		if (!id) return { code: 400, msg: '客户 ID 必填', data: null }
		const res = await getPdaCustomerById(id)
		if (revision !== asyncRevision || form.value.customerId !== previousCustomerId) return { code: 409, msg: '客户选择已变化，请重新选择' }
		if (res?.code === 0 && res.data && canEdit()) applySelectedCustomer(res.data)
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
		if (!canEdit()) return
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
		if (!canEdit()) return
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
		if (!canEdit()) return
		form.value.outItems.push(createPdaOutItem())
		markDepositDirty()
	}

	function removeOutItem(index) {
		if (!canEdit()) return
		if (form.value.outItems.length <= 1) {
			form.value.outItems = [createPdaOutItem()]
		} else {
			form.value.outItems.splice(index, 1)
		}
		markDepositDirty()
	}

	function addBackItem() {
		if (!canEdit()) return
		form.value.backItems.push(createPdaBackItem())
		markDepositDirty()
	}

	function removeBackItem(index) {
		if (!canEdit()) return
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
		if (!canEdit()) return { code: 409, msg: '当前单据不可编辑' }
		const list = type === 'back' ? form.value.backItems : form.value.outItems
		const row = list[index]
		if (!row) return { code: 404, msg: '行不存在', data: null }
		const key = `${type}:${index}`
		const rowId = row.rowId
		const bottleNo = row.bottleNo
		const customerId = form.value.customerId
		const revision = asyncRevision
		resolvingBottleKey.value = key
		try {
			const res = await findPdaBottleByNo(row.bottleNo)
			if (revision !== asyncRevision || !canEdit() || list !== (type === 'back' ? form.value.backItems : form.value.outItems)
				|| list[index]?.rowId !== rowId || list[index]?.bottleNo !== bottleNo || form.value.customerId !== customerId) {
				return { code: 409, msg: '目标行已变化，请重新查瓶' }
			}
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
		if (!canEdit()) return null
		const list = type === 'back' ? form.value.backItems : form.value.outItems
		const row = list[index]
		if (!row || !bottle) return row
		list[index] = applyBottleToSaleRow(row, bottle, { fillTare: type === 'back' })
		markDepositDirty()
		return list[index]
	}

	function attachBottleScanLocation(type, index, location) {
		if (!canEdit()) return null
		const list = type === 'back' ? form.value.backItems : form.value.outItems
		const row = list[index]
		if (!row) return null
		row.scanLocation = normalizePdaScanLocation(location)
		markDepositDirty()
		return row
	}

	function applyDeliverySelection(slot, delivery) {
		if (!canEdit()) return
		const name = normalizeText(delivery?.name || delivery)
		if (!name) return
		if (slot === 'delivery2') form.value.delivery2 = name
		else form.value.delivery1 = name
		markDepositDirty()
	}

	function applyVehicleSelection(vehicle) {
		if (!canEdit()) return
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
		if (!canEdit()) return { code: 409, msg: '当前单据不可编辑' }
		if (options.sessionId && options.sessionId !== scaleSnapshot.session_id) return { code: 409, msg: '称重会话已变化，请重新称重' }
		const list = type === 'back' ? form.value.backItems : form.value.outItems
		const row = list[index]
		if (!row) return { code: 404, msg: '行不存在', data: null }
		if (hasBleScaleMeasuredWeight(row, type) && options.force !== true) {
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
		if (type !== 'back' && !(netWeight > 0)) {
			return { code: 400, msg: '出瓶毛重减空瓶重后净重需大于 0，请核对瓶档和称重', data: null }
		}

		const nextCommon = {
			tare: formatScaleValue(tareWeight),
			gross: formatScaleValue(grossMeasured),
			grossMeasured: formatScaleValue(grossMeasured),
			tareSource: 'bottle_profile',
			weightSource: scaleSnapshot.transport === 'web' ? 'web_ble' : 'ble_scale',
			weightSampledAt: selected.sampledAt,
			scaleSessionId: scaleSnapshot.session_id || '',
			scaleStableSeq: Number(scaleSnapshot.stable_seq || 0)
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
		if (!canEdit()) return { code: 409, msg: '当前单据不可编辑' }
		const list = type === 'back' ? form.value.backItems : form.value.outItems
		const row = list[index]
		if (!row) return { code: 404, msg: '行不存在', data: null }
		const next = {
			...row,
			gross: '',
			net: '',
			grossMeasured: '',
			weightSource: '',
			weightSampledAt: null,
			scaleSessionId: '',
			scaleStableSeq: 0
		}
		list[index] = type === 'back' ? syncPdaBackRow(next) : next
		markDepositDirty()
		return { code: 0, msg: '', data: list[index] }
	}

	async function refreshDepositRows(options = {}) {
		if (frozenSubmission.value || !ownerMatches()) return { code: 409, msg: '提交内容已冻结，请查询原操作' }
		if (!normalizeText(form.value.customerId)) {
			clearDepositPreview()
			return { code: 400, msg: '请先选择客户' }
		}
		depositLoading.value = true
		const previewKey = JSON.stringify([form.value.customerId, form.value.date, form.value.outItems, form.value.backItems])
		const revision = asyncRevision
		try {
			const res = await previewPdaDepositRows(form.value)
			if (revision !== asyncRevision || !ownerMatches() || frozenSubmission.value || previewKey !== JSON.stringify([form.value.customerId, form.value.date, form.value.outItems, form.value.backItems])) return { code: 409, msg: '明细已变化，请重新预览存瓶' }
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

	function isOffline() { return typeof navigator !== 'undefined' && navigator.onLine === false }
	function sortedDeposit(rows) { return (rows || []).map((r) => normalizeBottleNo(r.bottle_no || r.bottleNo)).filter(Boolean).sort().join('|') }

	async function revalidateBeforeSubmit() {
		const signature = JSON.stringify(form.value)
		const snapshot = cloneMobileSale(form.value)
		const rows = [...snapshot.outItems, ...snapshot.backItems].filter((r) => r.bottleNo)
		const [customerRes, depositRes, ...bottleResults] = await Promise.all([
			getPdaCustomerById(snapshot.customerId), previewPdaDepositRows(snapshot),
			...rows.map((row) => findPdaBottleByNo(row.bottleNo, { fresh: true }))
		])
		if (!ownerMatches() || signature !== JSON.stringify(form.value)) return { code: 409, msg: '录单内容或账号已变化，请重新核对' }
		for (const result of [customerRes, depositRes, ...bottleResults]) {
			if (result?.code !== 0) return result || { code: 503, msg: '档案复核失败，请联网后重试' }
		}
		if (!customerRes.data || customerRes.data.is_active === false) return { code: 400, msg: '客户已停用或不可用，请重新选择客户' }
		const pricing = resolvePdaCustomerPricing(customerRes.data)
		if (!pricing.ok) return { code: 400, msg: pricing.msg }
		const changes = []
		if (Number(snapshot.unitPrice) !== pricing.unitPrice) changes.push(`客户单价由 ${snapshot.unitPrice} 变为 ${pricing.unitPrice} 元/kg`)
		if (selectedCustomer.value?.effective_settlement_customer_id && selectedCustomer.value.effective_settlement_customer_id !== customerRes.data.effective_settlement_customer_id) changes.push('客户结算归属已变化')
		const bottles = []
		for (let index = 0; index < rows.length; index++) {
			const row = rows[index]
			const bottle = bottleResults[index].data
			if (!bottle || bottle._id !== row.bottleId || normalizeBottleNo(bottle.bottle_no) !== row.bottleNo || bottle.is_active === false) return { code: 409, msg: `钢瓶 ${row.bottleNo} 档案已变化或停用，请重新选择` }
			if (bottle.tare_weight == null || !Number.isFinite(Number(bottle.tare_weight))) return { code: 400, msg: `钢瓶 ${row.bottleNo} 缺少有效皮重` }
			if (Number(row.tare) !== Number(bottle.tare_weight)) changes.push(`钢瓶 ${row.bottleNo} 皮重由 ${row.tare} 变为 ${bottle.tare_weight} kg，需重新称重`)
			bottles.push({ rowId: row.rowId, bottle })
		}
		if (sortedDeposit(snapshot.depositRows) !== sortedDeposit(depositRes.data.depositRows)) changes.push('客户存瓶已变化，请重新核对存瓶预览')
		if (changes.length) {
			revalidationCandidate = { signature, customer: customerRes.data, deposit: depositRes.data, bottles }
			return { code: 409, error_code: 'MOBILE_SALE_REVALIDATION_CHANGED', msg: '档案或存瓶有变化，请确认后重新预览', data: { changes } }
		}
		revalidationCandidate = null
		return { code: 0 }
	}

	function applyRevalidationChanges() {
		const candidate = revalidationCandidate
		if (!canEdit() || !candidate || candidate.signature !== JSON.stringify(form.value)) return false
		applySelectedCustomer(candidate.customer)
		for (const { rowId, bottle } of candidate.bottles) {
			for (const [type, rows] of [['out', form.value.outItems], ['back', form.value.backItems]]) {
				const index = rows.findIndex((row) => row.rowId === rowId)
				if (index >= 0 && Number(rows[index].tare) !== Number(bottle.tare_weight)) {
					clearScaleWeightFromRow(type, index)
					rows[index].tare = String(bottle.tare_weight)
					rows[index].tareSource = 'bottle_profile'
					applyBottleSelection(type, index, bottle)
				}
			}
		}
		form.value.depositRows = candidate.deposit.depositRows
		form.value.depositRaw = candidate.deposit.raw
		form.value.depositCount = candidate.deposit.baseCount
		draftStep.value = 2
		revalidationCandidate = null
		persistDraft()
		return true
	}

	function acceptResponse(res, fromQuery = false) {
		const operationId = frozenSubmission.value?.operationId || receipt.value?.operationId || ''
		const next = mobileSaleReceipt(res, operationId)
		const previous = receipt.value
		receipt.value = previous?.sourceSaved === true && previous.operationId === operationId && next.sourceSaved !== true
			? { ...previous, message: '销售单已保存；最新处理进度暂未查到，请稍后查询原操作' }
			: next
		if (canReleaseMobileSubmission(res, fromQuery)) {
			draftId = createMobileSaleId()
			frozenSubmission.value = null
		}
		persistDraft()
		return res
	}

	async function querySubmission() {
		if (submitting.value) return { code: 409, msg: '正在查询或提交，请稍候' }
		if (!ownerMatches()) return { code: 401, msg: '请使用原账号查询提交结果' }
		if (!frozenSubmission.value) return { code: 400, msg: '没有待查询的提交操作' }
		if (isOffline()) return { code: 503, msg: '当前离线，已保留原操作，请联网后查询' }
		submitting.value = true
		try {
			return acceptResponse(await getMobileSaleCreateResult(frozenSubmission.value.operationId), true)
		} catch (error) {
			return acceptResponse({ code: 503, msg: '暂时无法确认结果，原提交内容已保留，请稍后查询', error_code: 'MOBILE_SALE_RESULT_UNKNOWN' }, true)
		} finally { submitting.value = false }
	}

	async function submit(options = {}) {
		if (unreadableDraft) return { code: 409, msg: '原草稿无法读取，请先检查，避免重复录单' }
		if (submitting.value) return { code: 409, msg: '正在提交，请勿重复操作' }
		if (!ownerMatches()) return { code: 401, msg: '登录账号已变化，请使用原账号恢复草稿' }
		if (draftStatus.value.available) return { code: 409, msg: '请先恢复或处理已有草稿' }
		if (isOffline()) return { code: 503, msg: '当前离线，草稿已保留，请联网后提交' }
		if (frozenSubmission.value && receipt.value?.sourceSaved === true) return querySubmission()
		submitting.value = true
		try {
			if (!frozenSubmission.value) {
				const validation = validatePdaBottleSaleForm(form.value, selectedCustomer.value)
				if (!validation.ok) return { code: 400, msg: validation.msg }
				const checked = await revalidateBeforeSubmit()
				if (checked.code !== 0) return checked
				frozenSubmission.value = { operationId: draftId, payload: cloneMobileSale(buildMobileSalePayload(form.value, options)), attempted: false }
				receipt.value = mobileSaleReceipt({ msg: '正在保存本次提交，请勿另建相同单据' }, frozenSubmission.value.operationId)
			}
			const previouslyAttempted = Boolean(frozenSubmission.value.attempted)
			if (!persistDraft()) {
				if (!previouslyAttempted) {
					frozenSubmission.value = null
					receipt.value = mobileSaleReceipt({ code: 507, msg: '草稿存储失败，销售单尚未发送', data: { source_saved: false } }, '')
				}
				return { code: 507, msg: previouslyAttempted ? '存储失败，原提交结果仍待确认；请查询原操作，不能另建单据' : '草稿未能保存，尚未发送销售单；请先恢复浏览器存储后重试' }
			}
			frozenSubmission.value.attempted = true
			if (!persistDraft()) {
				if (!previouslyAttempted) {
					frozenSubmission.value = null
					receipt.value = mobileSaleReceipt({ code: 507, msg: '提交凭据未保存，销售单尚未发送', data: { source_saved: false } }, '')
				}
				return { code: 507, msg: previouslyAttempted ? '存储失败，原提交内容仍已冻结；请查询原操作' : '提交凭据未能保存，尚未发送销售单' }
			}
			if (!ownerMatches()) return { code: 401, msg: '账号已变化，原提交未发送' }
			const { operationId, payload } = frozenSubmission.value
			return acceptResponse(await createMobileSale(operationId, cloneMobileSale(payload)))
		} catch (error) {
			if (!frozenSubmission.value?.attempted) return { code: 503, msg: error?.message || '提交前核对失败，尚未发送销售单' }
			return acceptResponse({ code: 503, error_code: 'MOBILE_SALE_RESULT_UNKNOWN', msg: '提交结果尚未确认。原内容已保留，请查询或重试原操作' })
		} finally { submitting.value = false }
	}

	return {
		invalidateAsyncWork,
		draftStep,
		draftStatus,
		receipt,
		submissionLocked,
		persistDraft,
		restoreDraft,
		discardDraft,
		startNewSale,
		querySubmission,
		applyRevalidationChanges,
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
