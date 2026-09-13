'use strict'

// Authoritative sales money rules. Deployment-local copies are generated, never edited.
const RULE_VERSION = 'sale-accounting/2026-09-08.1'
const number = (value, fallback = 0) => value === '' || value == null || !Number.isFinite(Number(value)) ? fallback : Number(value)
const money = (value) => Number(number(value).toFixed(2))
const text = (value) => String(value == null ? '' : value).trim()

// Keep the established two-decimal rounding / three-decimal truncation policy.
// Add quantized amounts as integers: floating addition followed by truncation loses mills.
function sumMoneyByScale(values, moneyScale = 2) {
	const digits = Number(moneyScale) === 3 ? 3 : 2
	const total = values.reduce((sum, value) => {
		const raw = digits === 2 ? String(money(value)) : text(value)
		const normalized = /^[+-]?\d+(?:\.\d+)?$/.test(raw) ? raw : String(number(value))
		const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
		if (!match) return sum
		const units = BigInt(match[2] + (match[3] || '').padEnd(digits, '0').slice(0, digits))
		return sum + (match[1] === '-' ? -units : units)
	}, 0n)
	return Number(total) / (10 ** digits)
}

class FinancialRuleError extends Error {
	constructor(reason, details = {}) {
		super('历史 m³ 销售单的结算归属待核，暂不能计算完整账务；请先核对销售单与流量结算')
		this.name = 'FinancialRuleError'
		this.code = 'FINANCIAL_CLASSIFICATION_REQUIRED'
		this.details = { reason, rule_version: RULE_VERSION, complete: false, ...details }
	}
}

function resolveSettlementMode(doc = {}) {
	const mode = text(doc.settlement_mode)
	if (mode === 'sale' || mode === 'customer_flow') return mode
	if (text(doc.price_unit) === 'm3' || mode) {
		throw new FinancialRuleError('settlement_mode_unresolved', {
			unresolved_source_ids: text(doc._id) ? [text(doc._id)] : [],
			customer_id: text(doc.customer_id), settlement_mode: mode || null
		})
	}
	return 'sale'
}

function effectiveShouldReceive(shouldReceive, roundingAmount) {
	const should = money(shouldReceive)
	const rounding = Math.max(number(roundingAmount), 0)
	return money(should > 0 ? should - rounding : should < 0 ? should + rounding : 0)
}

function truckBillableNet(doc = {}, priceUnit = 'kg') {
	const outGross = number(doc.truck_out_gross, null)
	const backGross = number(doc.truck_back_gross, null)
	const reference = outGross != null && backGross != null
		? Math.max(outGross - backGross, 0) : Math.max(number(doc.truck_gross_diff), 0)
	if (priceUnit === 'kg') {
		const tare = number(doc.truck_settle_tare, null)
		const gross = number(doc.truck_settle_gross, null)
		const settlement = tare != null && gross != null ? Math.max(gross - tare, 0) : Math.max(number(doc.truck_sale_net), 0)
		if (settlement > 0) return settlement
	}
	return reference
}

function computeAmounts({ settlementMode = 'sale', bizMode = 'bottle', priceUnit = 'kg', unitPrice = 0,
	outItems = [], backItems = [], agentRows = [], truckSaleNet, truckOutGross, truckBackGross,
	truckSettleTare, truckSettleGross, flow = {}, roundingAmount = 0 } = {}) {
	if (!['sale', 'customer_flow'].includes(settlementMode)) throw new FinancialRuleError('settlement_mode_unresolved')
	let outNet = outItems.reduce((sum, row) => sum + number(row && row.net), 0)
	let backNet = backItems.reduce((sum, row) => sum + number(row && row.net), 0)
	const agentNet = agentRows.reduce((sum, row) => sum + number(row && row.fill_weight), 0)
	let totalNet = outNet - backNet
	if (bizMode === 'truck') totalNet = truckBillableNet({ truck_sale_net: truckSaleNet, truck_gross_diff: truckSaleNet,
		truck_out_gross: truckOutGross, truck_back_gross: truckBackGross,
		truck_settle_tare: truckSettleTare, truck_settle_gross: truckSettleGross }, priceUnit)
	if (bizMode === 'agent_sale') { outNet = agentNet; backNet = 0; totalNet = agentNet }
	let outAmount = 0; let backAmount = 0; let should = 0
	const price = number(unitPrice)
	if (settlementMode === 'sale') {
		if (bizMode === 'agent_sale') { outAmount = agentNet * price; should = outAmount }
		else if (priceUnit === 'kg') { outAmount = outNet * price; backAmount = backNet * price; should = totalNet * price }
		else if (priceUnit === 'bottle') { outAmount = outItems.length * price; should = outAmount }
		else if (priceUnit === 'm3') { outAmount = number(flow.flow_volume_m3) * price; should = outAmount }
	}
	const rounding = settlementMode === 'customer_flow' ? 0 : Math.max(number(roundingAmount), 0)
	return { out_net_total: outNet, back_net_total: backNet, total_net_weight: totalNet,
		out_amount: money(outAmount), back_amount: money(backAmount), rounding_amount: money(rounding),
		effective_should_receive: effectiveShouldReceive(should, rounding), should_receive: money(should), amount: money(should) }
}

function computeSaleAmountsForDoc(doc = {}, { allowUnresolved = false } = {}) {
	const bizMode = ['truck', 'agent_sale'].includes(text(doc.biz_mode)) ? text(doc.biz_mode) : 'bottle'
	const priceUnit = text(doc.price_unit) || 'kg'
	let settlementMode
	try { settlementMode = resolveSettlementMode(doc) } catch (error) {
		if (!allowUnresolved || error.code !== 'FINANCIAL_CLASSIFICATION_REQUIRED') throw error
		const candidate = computeSaleAmountsForDoc({ ...doc, settlement_mode: 'sale' })
		return { bizMode, amounts: { ...candidate.amounts, out_amount: null, back_amount: null,
			rounding_amount: null, effective_should_receive: null, should_receive: null, amount: null },
			accounting: { ...error.details, status: 'unresolved', candidate_sale_amount: candidate.amounts.should_receive } }
	}
	let volume = number(doc.flow_volume_m3, null)
	if (volume == null && number(doc.flow_index_curr, null) != null && number(doc.flow_index_prev, null) != null) {
		volume = Math.max(number(doc.flow_index_curr) - number(doc.flow_index_prev), 0)
	}
	const amounts = computeAmounts({ settlementMode, bizMode, priceUnit, unitPrice: doc.unit_price,
		outItems: bizMode === 'agent_sale' ? [] : Array.isArray(doc.out_items) ? doc.out_items : [],
		backItems: bizMode === 'agent_sale' ? [] : Array.isArray(doc.back_items) ? doc.back_items : [],
		agentRows: Array.isArray(doc.agent_sale_items) ? doc.agent_sale_items : [],
		truckSaleNet: truckBillableNet(doc, priceUnit), truckOutGross: doc.truck_out_gross, truckBackGross: doc.truck_back_gross,
		truckSettleTare: doc.truck_settle_tare, truckSettleGross: doc.truck_settle_gross,
		flow: { flow_volume_m3: volume }, roundingAmount: doc.rounding_amount })
	return { bizMode, amounts, accounting: { complete: true, status: 'resolved', settlement_mode: settlementMode,
		rule_version: RULE_VERSION, source_id: text(doc._id) } }
}

function assertSalesClassified(docs = []) {
	const unresolved = []
	for (const doc of docs) {
		try { resolveSettlementMode(doc) } catch (error) {
			if (error.code !== 'FINANCIAL_CLASSIFICATION_REQUIRED') throw error
			unresolved.push(text(doc._id))
		}
	}
	if (unresolved.length) throw new FinancialRuleError('settlement_mode_unresolved', { unresolved_source_ids: unresolved })
}

module.exports = { RULE_VERSION, FinancialRuleError, resolveSettlementMode, effectiveShouldReceive, truckBillableNet,
	computeAmounts, computeSaleAmountsForDoc, assertSalesClassified, sumMoneyByScale }
