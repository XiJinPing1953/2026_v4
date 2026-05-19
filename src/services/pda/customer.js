import { getCustomerV1, listCustomersV1, resolveCustomerQrCodeV1 } from '@/services/customer'
import { normalizeQrCode, normalizeText, toNumber } from './shared'

const CUSTOMER_QR_CACHE_TTL_MS = 30 * 1000
const customerQrCache = new Map()

function readCache(cache, key) {
	if (!key || !cache.has(key)) return null
	const cached = cache.get(key)
	if (!cached || Number(cached.expireAt || 0) <= Date.now()) {
		cache.delete(key)
		return null
	}
	return cached.data || null
}

function writeCache(cache, key, data, ttlMs) {
	if (!key || !data) return data
	cache.set(key, {
		data,
		expireAt: Date.now() + Math.max(Number(ttlMs) || 0, 1000)
	})
	return data
}

function buildPaging(res, page, pageSize) {
	return res?.paging || {
		page,
		pageSize,
		total: Array.isArray(res?.data) ? res.data.length : 0,
		hasMore: false
	}
}

function normalizePdaCustomerSummary(customer = null) {
	if (!customer || typeof customer !== 'object') return null
	return {
		_id: normalizeText(customer._id || customer.customer_id),
		name: normalizeText(customer.name || customer.customer_name),
		contact: normalizeText(customer.contact),
		phone: normalizeText(customer.phone),
		is_active: customer.is_active !== false,
		default_price_unit: normalizeText(customer.effective_default_price_unit || customer.default_price_unit || 'kg') || 'kg',
		default_unit_price: toNumber(customer.effective_default_unit_price ?? customer.default_unit_price, null),
		effective_price_source: normalizeText(customer.effective_price_source),
		settlement_default_price_unit: normalizeText(customer.settlement_default_price_unit),
		settlement_default_unit_price: toNumber(customer.settlement_default_unit_price, null),
		settlement_customer_id: normalizeText(customer.settlement_customer_id),
		settlement_customer_name: normalizeText(customer.settlement_customer_name),
		effective_settlement_customer_id: normalizeText(customer.effective_settlement_customer_id || customer.settlement_customer_id || customer._id),
		effective_settlement_customer_name: normalizeText(customer.effective_settlement_customer_name || customer.settlement_customer_name || customer.name),
		is_settlement_child: Boolean(customer.is_settlement_child || customer.settlement_customer_id),
		receivable_balance: toNumber(customer.receivable_balance, 0),
		prepay_balance: toNumber(customer.prepay_balance, 0),
		net_balance: toNumber(customer.net_balance, 0),
		deposit_count: Number(customer.deposit_count || 0)
	}
}

export async function listPdaCustomers(params = {}) {
	const page = Number(params.page || 1)
	const pageSize = Number(params.pageSize || 20)
	const res = await listCustomersV1({
		keyword: normalizeText(params.keyword),
		page,
		pageSize,
		isActive: params.isActive ?? true,
		summaryIgnoreActive: true
	})
	return {
		code: res?.code ?? -1,
		msg: res?.msg || '',
		data: Array.isArray(res?.data) ? res.data.map(normalizePdaCustomerSummary).filter(Boolean) : [],
		paging: buildPaging(res, page, pageSize)
	}
}

export async function getPdaCustomerById(id) {
	const customerId = normalizeText(id)
	if (!customerId) return { code: 400, msg: '客户 ID 必填', data: null }
	const res = await getCustomerV1({ id: customerId })
	return {
		code: res?.code ?? -1,
		msg: res?.msg || '',
		data: normalizePdaCustomerSummary(res?.data || null)
	}
}

export async function resolvePdaCustomerByQrCode(qrCode) {
	const normalized = normalizeQrCode(qrCode)
	if (!normalized) return { code: 400, msg: '客户二维码必填', data: null }
	const cached = readCache(customerQrCache, normalized)
	if (cached) return { code: 0, msg: '', data: cached }
	const res = await resolveCustomerQrCodeV1({ qr_code: normalized })
	if (res?.code !== 0) return { code: res?.code ?? -1, msg: res?.msg || '客户扫码失败', data: null }
	const summary = normalizePdaCustomerSummary(res?.data?.customer || null)
	return {
		code: 0,
		msg: '',
		data: writeCache(customerQrCache, normalized, summary, CUSTOMER_QR_CACHE_TTL_MS)
	}
}

export function resolvePdaCustomerPricing(customer) {
	const priceUnit = normalizeText(customer?.default_price_unit || 'kg').toLowerCase() || 'kg'
	if (priceUnit !== 'kg') {
		return {
			ok: false,
			msg: '客户默认计价单位不是 kg，请回桌面端维护'
		}
	}
	const unitPrice = toNumber(customer?.default_unit_price, null)
	if (!(unitPrice > 0)) {
		return {
			ok: false,
			msg: '客户未维护有效 kg 单价，请回桌面端维护'
		}
	}
	return {
		ok: true,
		priceUnit: 'kg',
		unitPrice,
		source: normalizeText(customer?.effective_price_source),
		settlementUnitPrice: toNumber(customer?.settlement_default_unit_price, null),
		settlementPriceUnit: normalizeText(customer?.settlement_default_price_unit)
	}
}

export function buildPdaSaleCreateUrl(customer = {}) {
	const customerId = normalizeText(customer?._id || customer?.customer_id || customer)
	const customerName = normalizeText(customer?.name || customer?.customer_name)
	const parts = []
	if (customerId) parts.push(`customer_id=${encodeURIComponent(customerId)}`)
	if (customerName) parts.push(`customer_name=${encodeURIComponent(customerName)}`)
	return parts.length ? `/pages/pda/sale-create?${parts.join('&')}` : '/pages/pda/sale-create'
}
