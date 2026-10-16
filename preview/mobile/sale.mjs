// Served only by the development preview plugin; never imported by production.
const customer = { _id: 'phone-demo-customer', name: '手机称重模拟客户', contact: '模拟联系人甲', phone: '13800000001', is_active: true, default_price_unit: 'kg', default_unit_price: 8 }
const customers = [customer, { ...customer, _id: 'phone-demo-customer-2', name: '手机称重模拟客户二', contact: '模拟联系人乙', phone: '13800000002', default_unit_price: 9.5 }]
const bottle = { _id: 'phone-demo-bottle', bottle_no: '101', tare_weight: 100, is_active: true, status: 'in' }
const operations = new Map()
const ok = data => ({ code: 0, msg: '本地模拟：未写入云端', data })

export function phoneSaleFixture(name, action, data) {
	if (name === 'crm-customer') {
		if (action === 'listV1') return ok(customers.filter(item => [item.name, item.contact, item.phone].some(value => value.includes(data.keyword || ''))))
		if (action === 'getV1') return ok(customers.find(item => item._id === data.id) || customer)
		if (action === 'resolveQrCodeV1') return ok({ customer })
	}
	if (name === 'crm-delivery' && action === 'listV1') return ok([])
	if (name === 'crm-vehicle' && action === 'listV1') return ok([])
	if (name === 'crm-bottle') {
		if (action === 'searchV1') return ok([bottle])
		if (action === 'resolveBottleNoV1' || action === 'resolvePdaQrCodeV1') return ok({ bottle })
	}
	if (name === 'crm-sale') {
		if (action === 'getCustomerDepositV1') return ok({ bottles: [], raw: '', count: 0 })
		if (action === 'createMobileV1') {
			if (!operations.has(data.operation_id)) operations.set(data.operation_id, {
				operation_id: data.operation_id, sale_id: 'LOCAL-DEMO-SALE', source_saved: true,
				source_exists: true, processing_state: 'completed', warnings: []
			})
			return ok(operations.get(data.operation_id))
		}
		if (action === 'getMobileCreateResultV1') return operations.has(data.operation_id)
			? ok(operations.get(data.operation_id))
			: { code: 404, msg: '本地模拟暂未查到', error_code: 'MOBILE_SALE_OPERATION_NOT_FOUND', data: { source_saved: null } }
	}
	return { code: 501, msg: `手机销售模拟未配置 ${name}/${action}` }
}
