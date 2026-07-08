import { callCloud } from '@/services/api'

export async function listRfidSessionsV1(params = {}) {
	return callCloud('crm-rfid', {
		action: 'listSessionsV1',
		data: {
			keyword: params.keyword || '',
			status: params.status || '',
			gateway_id: params.gateway_id || params.gatewayId || '',
			reader_device_code: params.reader_device_code || params.readerDeviceCode || '',
			started_at_start: params.started_at_start || params.startedAtStart || '',
			started_at_end: params.started_at_end || params.startedAtEnd || '',
			page: params.page || 1,
			pageSize: params.pageSize || params.limit || 20
		}
	})
}

export async function getRfidSessionV1(params = {}) {
	return callCloud('crm-rfid', {
		action: 'getSessionV1',
		data: {
			_id: params._id || params.id || '',
			session_id: params.session_id || params.sessionId || ''
		}
	})
}

export async function bindRfidEpcV1(params = {}) {
	return callCloud('crm-rfid', {
		action: 'bindEpcV1',
		data: {
			epc: params.epc || '',
			entity_type: params.entity_type || params.entityType || '',
			entity_id: params.entity_id || params.entityId || '',
			serial: params.serial || '',
			session_id: params.session_id || params.sessionId || '',
			confirm_rebind: params.confirm_rebind ?? params.confirmRebind ?? false
		}
	})
}

export async function unbindRfidEpcV1(params = {}) {
	return callCloud('crm-rfid', {
		action: 'unbindEpcV1',
		data: {
			epc: params.epc || '',
			entity_type: params.entity_type || params.entityType || '',
			session_id: params.session_id || params.sessionId || ''
		}
	})
}
