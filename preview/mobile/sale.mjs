// Served only by the development preview plugin; never imported by production.
const customer = { _id: 'phone-demo-customer', name: '手机称重模拟客户', is_active: true, default_price_unit: 'kg', default_unit_price: 8 }
const bottle = { _id: 'phone-demo-bottle', bottle_no: '101', tare_weight: 100, is_active: true, status: 'in' }
const operations = new Map()
const ok = data => ({ code: 0, msg: '本地模拟：未写入云端', data })

export function phoneSaleFixture(name, action, data) {
	if (name === 'crm-customer') {
		if (action === 'listV1') return ok([customer])
		if (action === 'getV1') return ok(customer)
		if (action === 'resolveQrCodeV1') return ok({ customer })
	}
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
