'use strict'

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function uniqueStrings(values = []) {
	return Array.from(new Set((Array.isArray(values) ? values : []).map(normalizeString).filter(Boolean)))
}

function resolveSaleListSearchTerms(data = {}) {
	const customerId = normalizeString(data.customerId || data.customer_id)
	return {
		customerId,
		customerScope: normalizeString(data.customerScope || data.customer_scope) === 'delivery'
			? 'delivery'
			: 'settlement',
		// Once a customer is selected, its stable ID is authoritative. The keyword is
		// only the current display label and must not exclude historical name snapshots.
		keyword: customerId ? '' : normalizeString(data.keyword)
	}
}

function buildCurrentCustomerReferenceConditions(dbCmd, customerIds = [], chunkSize = 200) {
	const ids = uniqueStrings(customerIds)
	const size = Math.max(Number(chunkSize) || 0, 1)
	const conditions = []
	for (let index = 0; index < ids.length; index += size) {
		const chunk = ids.slice(index, index + size)
		conditions.push({ customer_id: dbCmd.in(chunk) })
		conditions.push({ delivery_customer_id: dbCmd.in(chunk) })
	}
	return conditions
}

module.exports = {
	resolveSaleListSearchTerms,
	buildCurrentCustomerReferenceConditions
}
