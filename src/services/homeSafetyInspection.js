import { callCloud } from '@/services/api'

const CLOUD_FUNCTION = 'crm-home-safety-inspection'
const SAVE_TIMEOUT_MS = 120000

function call(action, data = {}, timeout) {
	return callCloud(CLOUD_FUNCTION, { action, data, timeout })
}

export function getHomeSafetyTemplateV1(params = {}) {
	const templateCode = params.templateCode || params.template_code || ''
	const templateVersion = params.templateVersion ?? params.template_version ?? ''
	return call('getTemplateV1', {
		template_code: templateCode,
		template_version: templateVersion
	})
}

export function listHomeSafetyCustomersV1(params = {}) {
	return call('listCustomersV1', {
		customer_id: params.customerId || params.customer_id || '',
		keyword: params.keyword || '',
		page: params.page || 1,
		pageSize: params.pageSize || 20
	})
}

export async function getVisibleHomeSafetyCustomerV1(customerId) {
	const res = await listHomeSafetyCustomersV1({ customerId, page: 1, pageSize: 1 })
	if (res?.code !== 0) return res
	const customer = Array.isArray(res.data) ? res.data[0] : null
	return customer
		? { code: 0, data: customer }
		: { code: 404, msg: '客户不存在或已隐藏' }
}

export function listHomeSafetyInspectionsV1(params = {}) {
	return call('listV1', {
		customer_id: params.customerId || params.customer_id || '',
		page: params.page || 1,
		pageSize: params.pageSize || 20
	})
}

export function getHomeSafetyInspectionV1(id) {
	return call('getV1', { _id: id })
}

export function submitHomeSafetyInspectionV1(data) {
	return call('submitV1', data, SAVE_TIMEOUT_MS)
}

export function updateHomeSafetyInspectionV1(data) {
	return call('updateV1', data, SAVE_TIMEOUT_MS)
}

export function listHomeSafetyInspectionRevisionsV1(id) {
	return call('listRevisionsV1', { _id: id })
}
