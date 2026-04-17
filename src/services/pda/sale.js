import { createSaleV2, getCustomerDepositV1 } from '@/services/sale'
import { resolvePdaCustomerPricing } from './customer'
import { buildDepositPreviewRows, normalizeBottleNo, normalizeText, todayDate, toNumber } from './shared'

export function createPdaOutItem() {
	return {
		bottleNo: '',
		bottleId: '',
		net: ''
	}
}

export function createPdaBackItem() {
	return {
		bottleNo: '',
		bottleId: '',
		gross: '',
		tare: '',
		net: ''
	}
}

export function createPdaBottleSaleForm() {
	return {
		date: todayDate(),
		customerId: '',
		customerName: '',
		delivery1: '',
		delivery2: '',
		vehicleNo: '',
		remark: '',
		priceUnit: 'kg',
		unitPrice: '',
		settlementMode: 'sale',
		paymentStatus: 'unpaid',
		paymentMethod: 'on_account',
		amountReceived: '0',
		roundingAmount: '0',
		applyOffsetCredit: false,
		offsetEnabled: false,
		outItems: [createPdaOutItem()],
		backItems: [],
		depositRows: [],
		depositRaw: '',
		depositCount: 0
	}
}

function normalizeOutRow(row = {}) {
	const bottleNo = normalizeBottleNo(row.bottleNo || row.bottle_no)
	const net = toNumber(row.net ?? row.net_weight, null)
	if (!bottleNo || !(net > 0)) return null
	return {
		bottleNo,
		bottleId: normalizeText(row.bottleId || row.bottle_id),
		net
	}
}

function normalizeBackRow(row = {}) {
	const bottleNo = normalizeBottleNo(row.bottleNo || row.bottle_no)
	if (!bottleNo) return null
	const gross = toNumber(row.gross ?? row.gross_weight, null)
	const tare = toNumber(row.tare ?? row.tare_weight, null)
	let net = toNumber(row.net ?? row.net_weight, null)
	if (!(net > 0) && gross != null && tare != null) {
		net = Math.max(gross - tare, 0)
	}
	if (!(net > 0)) return null
	return {
		bottleNo,
		bottleId: normalizeText(row.bottleId || row.bottle_id),
		gross,
		tare,
		net
	}
}

function normalizeDepositRows(rows = []) {
	return rows
		.map((row) => normalizeBottleNo(row?.bottle_no || row?.bottleNo))
		.filter(Boolean)
		.map((bottleNo) => ({ bottle_no: bottleNo }))
}

export function syncPdaBackRow(row = {}) {
	const next = {
		...row,
		bottleNo: normalizeBottleNo(row.bottleNo || row.bottle_no),
		bottleId: normalizeText(row.bottleId || row.bottle_id),
		gross: normalizeText(row.gross ?? row.gross_weight),
		tare: normalizeText(row.tare ?? row.tare_weight),
		net: normalizeText(row.net ?? row.net_weight)
	}
	const gross = toNumber(next.gross, null)
	const tare = toNumber(next.tare, null)
	if (gross != null && tare != null) {
		next.net = String(Math.max(gross - tare, 0))
	}
	return next
}

export function applyBottleToSaleRow(row = {}, bottle = {}, options = {}) {
	const next = {
		...row,
		bottleNo: normalizeBottleNo(bottle?.bottle_no || row.bottleNo || row.bottle_no),
		bottleId: normalizeText(bottle?._id || row.bottleId || row.bottle_id)
	}
	if (options.fillTare && normalizeText(row.tare ?? row.tare_weight) === '' && bottle?.tare_weight != null) {
		next.tare = String(bottle.tare_weight)
	}
	return options.fillTare ? syncPdaBackRow(next) : next
}

export async function previewPdaDepositRows(form = {}) {
	const customerId = normalizeText(form.customerId)
	if (!customerId) return { code: 400, msg: '请先选择客户' }
	const res = await getCustomerDepositV1({
		customerId,
		customerName: normalizeText(form.customerName),
		date: normalizeText(form.date) || todayDate()
	})
	if (res?.code !== 0) {
		return { code: res?.code ?? -1, msg: res?.msg || '存瓶查询失败', data: { depositRows: [], raw: '', baseCount: 0 } }
	}
	const baseBottleNos = Array.isArray(res?.data?.bottles) ? res.data.bottles : []
	const depositRows = buildDepositPreviewRows({
		baseBottleNos,
		outItems: form.outItems || [],
		backItems: form.backItems || []
	})
	return {
		code: 0,
		msg: '',
		data: {
			depositRows,
			raw: normalizeText(res?.data?.raw),
			baseCount: Number(res?.data?.count || baseBottleNos.length || 0)
		}
	}
}

export function buildPdaSaleDraft(form = {}) {
	const outItems = (form.outItems || []).map(normalizeOutRow).filter(Boolean)
	const backItems = (form.backItems || []).map(normalizeBackRow).filter(Boolean)
	const depositRows = normalizeDepositRows(form.depositRows || [])
	return {
		form: {
			date: normalizeText(form.date) || todayDate(),
			customerId: normalizeText(form.customerId),
			customerName: normalizeText(form.customerName),
			deliveryMan1: normalizeText(form.delivery1),
			deliveryMan2: normalizeText(form.delivery2),
			vehicleNo: normalizeText(form.vehicleNo),
			remark: normalizeText(form.remark),
			priceUnit: 'kg',
			settlementMode: 'sale',
			unitPrice: toNumber(form.unitPrice, 0),
			bizMode: 'bottle',
			ticketImage: '',
			ticketImages: []
		},
		truck: {
			truckNo: '',
			truckOutGross: '',
			truckBackGross: '',
			truckSettleTare: '',
			truckSettleGross: '',
			truckGrossDiff: ''
		},
		flow: {
			flowPrev: '',
			flowCurr: '',
			flowVolume: '',
			flowRatio: ''
		},
		settlement: {
			paymentStatus: 'unpaid',
			paymentMethod: 'on_account',
			amountReceived: 0,
			roundingAmount: 0,
			applyOffsetCredit: false,
			offsetEnabled: false,
			paymentNote: ''
		},
		outItems,
		backItems,
		depositRows,
		agentSaleRows: []
	}
}

export function validatePdaBottleSaleForm(form = {}, customer = null) {
	if (!normalizeText(form.date)) return { ok: false, msg: '请选择日期' }
	if (!normalizeText(form.customerId)) return { ok: false, msg: '请先选择客户' }
	const pricing = resolvePdaCustomerPricing(customer || { default_price_unit: 'kg', default_unit_price: form.unitPrice })
	if (!pricing.ok) return { ok: false, msg: pricing.msg }

	const outItems = (form.outItems || []).map(normalizeOutRow).filter(Boolean)
	if (!outItems.length) return { ok: false, msg: '至少填写一行出瓶和净重' }

	const backItems = (form.backItems || []).filter((row) => normalizeBottleNo(row?.bottleNo || row?.bottle_no))
	const invalidBack = backItems.find((row) => !normalizeBackRow(row))
	if (invalidBack) {
		return { ok: false, msg: '回瓶行需填写有效瓶号，并保证净重或毛重/空瓶重大于 0' }
	}

	return { ok: true, unitPrice: pricing.unitPrice }
}

export async function submitPdaBottleSale(form = {}, options = {}) {
	const customer = options.customer || null
	const validation = validatePdaBottleSaleForm(form, customer)
	if (!validation.ok) return { code: 400, msg: validation.msg }

	const depositRes = await previewPdaDepositRows(form)
	if (depositRes.code !== 0) return depositRes

	const draft = buildPdaSaleDraft({
		...form,
		unitPrice: validation.unitPrice,
		depositRows: depositRes.data.depositRows
	})
	const res = await createSaleV2(draft)
	return {
		...res,
		depositPreview: depositRes.data
	}
}
