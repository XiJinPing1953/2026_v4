import { getCustomerV1, listCustomersV1 } from '@/services/customer'
import { normalizeText, toNumber } from './shared'

function buildPaging(res, page, pageSize) {
	return res?.paging || {
		page,
		pageSize,
		total: Array.isArray(res?.data) ? res.data.length : 0,
		hasMore: false
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
		data: Array.isArray(res?.data) ? res.data : [],
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
		data: res?.data || null
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
		unitPrice
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
