import { createSaleV2, getCustomerDepositV1 } from '@/services/sale'
import { resolvePdaCustomerPricing } from './customer'
import { normalizePdaScanLocation } from './location'
import { buildDepositPreviewRows, normalizeBottleNo, normalizeText, todayDate, toNumber } from './shared'

const PDA_SALE_WEIGHT_DECIMALS = 1

function formatPdaSaleWeight(value) {
	const num = toNumber(value, null)
	if (num == null) return ''
	return Number(num).toFixed(PDA_SALE_WEIGHT_DECIMALS)
}

export function createPdaOutItem() {
	return {
		bottleNo: '',
		bottleId: '',
		gross: '',
		tare: '',
		net: '',
		grossMeasured: '',
		tareSource: '',
		weightSource: '',
		weightSampledAt: null,
		scanLocation: null
	}
}

export function createPdaBackItem() {
	return {
		bottleNo: '',
		bottleId: '',
		gross: '',
		tare: '',
		net: '',
		grossMeasured: '',
		tareSource: '',
		weightSource: '',
		weightSampledAt: null,
		scanLocation: null
	}
}

function buildNormalizedRowLocation(row = {}) {
	return normalizePdaScanLocation(row.scanLocation || row.scan_location)
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
	const gross = toNumber(row.gross ?? row.gross_weight ?? row.grossMeasured ?? row.gross_measured, null)
	const tare = toNumber(row.tare ?? row.tare_weight, null)
	const net = toNumber(row.net ?? row.net_weight, null)
	if (!bottleNo || !(gross > 0) || !(tare >= 0) || !(net > 0)) return null
	const normalized = {
		bottleNo,
		bottleId: normalizeText(row.bottleId || row.bottle_id),
		gross: toNumber(formatPdaSaleWeight(gross), gross),
		tare: toNumber(formatPdaSaleWeight(tare), tare),
		net: toNumber(formatPdaSaleWeight(net), net)
	}
	const scanLocation = buildNormalizedRowLocation(row)
	if (scanLocation) normalized.scanLocation = scanLocation
	return normalized
}

function normalizeBackRow(row = {}) {
	const bottleNo = normalizeBottleNo(row.bottleNo || row.bottle_no)
	if (!bottleNo) return null
	const gross = toNumber(row.gross ?? row.gross_weight, null)
	const tare = toNumber(row.tare ?? row.tare_weight, null)
	let net = toNumber(row.net ?? row.net_weight, null)
	if (!(net > 0) && gross != null && tare != null) {
		net = toNumber(formatPdaSaleWeight(Math.max(gross - tare, 0)), 0)
	}
	if (!(gross > 0) || !(tare >= 0) || !(net > 0)) return null
	const normalized = {
		bottleNo,
		bottleId: normalizeText(row.bottleId || row.bottle_id),
		gross: toNumber(formatPdaSaleWeight(gross), gross),
		tare: toNumber(formatPdaSaleWeight(tare), tare),
		net: toNumber(formatPdaSaleWeight(net), net)
	}
	const scanLocation = buildNormalizedRowLocation(row)
	if (scanLocation) normalized.scanLocation = scanLocation
	return normalized
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
		net: normalizeText(row.net ?? row.net_weight),
		grossMeasured: normalizeText(row.grossMeasured ?? row.gross_measured),
		tareSource: normalizeText(row.tareSource ?? row.tare_source),
		weightSource: normalizeText(row.weightSource ?? row.weight_source),
		weightSampledAt: row.weightSampledAt ?? row.weight_sampled_at ?? null,
		scanLocation: buildNormalizedRowLocation(row)
	}
	const gross = toNumber(next.gross, null)
	const tare = toNumber(next.tare, null)
	if (gross != null && tare != null) {
		next.net = formatPdaSaleWeight(Math.max(gross - tare, 0))
	}
	return next
}

export function applyBottleToSaleRow(row = {}, bottle = {}, options = {}) {
	const tareWeight = toNumber(bottle?.tare_weight, null)
	const nextBottleNo = normalizeBottleNo(bottle?.bottle_no || row.bottleNo || row.bottle_no)
	const currentBottleNo = normalizeBottleNo(row.bottleNo || row.bottle_no)
	const bottleChanged = Boolean(currentBottleNo && nextBottleNo && currentBottleNo !== nextBottleNo)
	const hasCurrentTare = normalizeText(row.tare ?? row.tare_weight)
	const currentTareSource = normalizeText(row.tareSource ?? row.tare_source)
	const shouldClearMeasuredWeight = bottleChanged
	const next = {
		...row,
		bottleNo: nextBottleNo,
		bottleId: normalizeText(bottle?._id || row.bottleId || row.bottle_id),
		gross: shouldClearMeasuredWeight ? '' : normalizeText(row.gross ?? row.gross_weight),
		net: bottleChanged ? '' : normalizeText(row.net ?? row.net_weight),
		grossMeasured: shouldClearMeasuredWeight ? '' : normalizeText(row.grossMeasured ?? row.gross_measured),
		weightSource: shouldClearMeasuredWeight ? '' : normalizeText(row.weightSource ?? row.weight_source),
		weightSampledAt: shouldClearMeasuredWeight ? null : row.weightSampledAt ?? row.weight_sampled_at ?? null,
		scanLocation: bottleChanged ? null : buildNormalizedRowLocation(row)
	}
	if (tareWeight != null && (options.fillTare || !hasCurrentTare || currentTareSource === 'bottle_profile')) {
		next.tare = String(tareWeight)
		next.tareSource = 'bottle_profile'
	} else if (tareWeight == null && currentTareSource === 'bottle_profile') {
		next.tare = ''
		next.tareSource = ''
	}
	if (!normalizeText(next.tare)) next.tareSource = ''
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

	const outRows = (form.outItems || []).filter((row) => normalizeBottleNo(row?.bottleNo || row?.bottle_no))
	const invalidOut = outRows.find((row) => !normalizeOutRow(row))
	if (invalidOut) return { ok: false, msg: '出瓶行需填写有效瓶号，并完成毛重、皮重、净重称重闭环' }
	const outItems = outRows.map(normalizeOutRow).filter(Boolean)
	if (!outItems.length) return { ok: false, msg: '至少填写一行已完成称重的出瓶' }

	const backItems = (form.backItems || []).filter((row) => normalizeBottleNo(row?.bottleNo || row?.bottle_no))
	const invalidBack = backItems.find((row) => !normalizeBackRow(row))
	if (invalidBack) {
		return { ok: false, msg: '回瓶行需填写有效瓶号，并完成毛重、皮重、净重称重闭环' }
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
