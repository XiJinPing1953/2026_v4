'use strict'

const assert = require('node:assert/strict')
const {
	resolveSaleListSearchTerms,
	buildCurrentCustomerReferenceConditions
} = require('../uniCloud-alipay/cloudfunctions/crm-sale/saleListSearchLocal')

const selectedCustomer = resolveSaleListSearchTerms({
	keyword: '孟董庄喷塑-赵建刚',
	customerId: 'customer-zhao',
	customerScope: 'settlement'
})
assert.deepEqual(selectedCustomer, {
	keyword: '',
	customerId: 'customer-zhao',
	customerScope: 'settlement'
})

const freeKeyword = resolveSaleListSearchTerms({
	keyword: '孟董庄喷塑-赵建刚',
	customer_scope: 'delivery'
})
assert.deepEqual(freeKeyword, {
	keyword: '孟董庄喷塑-赵建刚',
	customerId: '',
	customerScope: 'delivery'
})

const dbCmd = {
	in(values) {
		return { $in: values }
	}
}
const conditions = buildCurrentCustomerReferenceConditions(
	dbCmd,
	['customer-zhao', 'customer-zhao', 'delivery-site'],
	1
)
assert.deepEqual(conditions, [
	{ customer_id: { $in: ['customer-zhao'] } },
	{ delivery_customer_id: { $in: ['customer-zhao'] } },
	{ customer_id: { $in: ['delivery-site'] } },
	{ delivery_customer_id: { $in: ['delivery-site'] } }
])

console.log('sale customer rename search tests passed')
