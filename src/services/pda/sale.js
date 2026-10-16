import { createSaleV2, getCustomerDepositV1 } from '@/services/sale'
import { callCloud } from '@/services/api'
import { normalizeSaleDraft } from '@/services/models/sale'
import { createMobileSaleId } from './mobileSaleDraft'
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
		rowId: createMobileSaleId('row'),
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
		rowId: createMobileSaleId('row'),
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
	const net = toNumber(row.net ?? row.net_weight, null)
	if (!(gross > 0) || tare == null || !(tare >= 0) || net == null) return null
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
		rowId: row.rowId || createMobileSaleId('row'),
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
		next.net = formatPdaSaleWeight(gross - tare)
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
		rowId: row.rowId || createMobileSaleId('row'),
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
	for (const rows of [outRows, form.backItems || []]) {
		const seen = new Set()
		for (const row of rows) {
			const no = normalizeBottleNo(row.bottleNo)
			if (!no) continue
			if (seen.has(no)) return { ok: false, msg: `同一方向不能重复填写钢瓶 ${no}` }
			seen.add(no)
			if (!row.bottleId) return { ok: false, msg: `请先查档确认钢瓶 ${no}` }
			if ([row.gross, row.tare, row.net].some((value) => toNumber(value, null) == null)) return { ok: false, msg: `钢瓶 ${no} 尚未完成毛重、皮重、净重称重` }
			if (Math.abs(Number(row.gross) - Number(row.tare) - Number(row.net)) > 0.001) return { ok: false, msg: `钢瓶 ${no} 的毛重、皮重和净重不一致，请重新称重` }
		}
	}
	const invalidOut = outRows.find((row) => !normalizeOutRow(row))
	if (invalidOut) return { ok: false, msg: '出瓶行需填写有效瓶号，并完成毛重、皮重、净重称重闭环' }
	const outItems = outRows.map(normalizeOutRow).filter(Boolean)

	const backItems = (form.backItems || []).filter((row) => normalizeBottleNo(row?.bottleNo || row?.bottle_no))
	const invalidBack = backItems.find((row) => !normalizeBackRow(row))
	if (invalidBack) {
		return { ok: false, msg: '回瓶行需填写有效瓶号，并完成毛重、皮重、净重称重闭环' }
	}
	if (!outItems.length && !backItems.length) return { ok: false, msg: '至少填写一行已完成称重的出瓶或回瓶' }

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

export function buildMobileSalePayload(form, options = {}) {
	const draft = buildPdaSaleDraft(form)
	const payload = normalizeSaleDraft({
		...draft.form, ...draft.settlement,
		delivery1: form.delivery1, delivery2: form.delivery2, carNo: form.vehicleNo,
		outItems: draft.outItems, backItems: draft.backItems, depositRows: draft.depositRows,
		agentSaleRows: []
	})
	for (const [key, rows] of [['outRows', form.outItems], ['backRows', form.backItems]]) {
		payload[key] = payload[key].map((row) => {
			const source = rows.find((item) => normalizeBottleNo(item.bottleNo) === row.bottle_no)
			return {
				...row,
				weight_source: source?.weightSource || '',
				weight_sampled_at: source?.weightSampledAt || null,
				scale_session_id: source?.scaleSessionId || '',
				scale_stable_seq: Number(source?.scaleStableSeq || 0)
			}
		})
	}
	if (options.confirmedWarnings) payload.ignore_bottle_flow_warning = true
	return payload
}

export function createMobileSale(operationId, payload) {
	return callCloud('crm-sale', { action: 'createMobileV1', data: { operation_id: operationId, payload }, timeout: 120000 })
}

export function getMobileSaleCreateResult(operationId) {
	return callCloud('crm-sale', { action: 'getMobileCreateResultV1', data: { operation_id: operationId } })
}
