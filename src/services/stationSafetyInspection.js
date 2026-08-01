import { callCloud } from '@/services/api'

const CLOUD_FUNCTION = 'crm-station-safety-inspection'
const SAVE_TIMEOUT_MS = 180000

function call(action, data = {}, timeout = SAVE_TIMEOUT_MS) {
	return callCloud(CLOUD_FUNCTION, { action, data, timeout })
}

export function getStationSafetyTemplateV1(params = {}) {
	return call('getTemplateV1', {
		template_code: params.templateCode || params.template_code || '',
		template_version: params.templateVersion ?? params.template_version ?? ''
	})
}

export function listStationSafetyInspectionsV1(params = {}) {
	return call('listV1', params)
}

export function getStationSafetyInspectionV1(id) {
	return call('getV1', { _id: id })
}

export function submitStationSafetyInspectionV1(data) {
	return call('submitV1', data)
}

export function updateStationSafetyInspectionV1(data) {
	return call('updateV1', data)
}

export function listStationSafetyHazardsV1(params = {}) {
	return call('listHazardsV1', params)
}

export function getStationSafetyHazardV1(id) {
	return call('getHazardV1', { _id: id })
}

export function submitStationSafetyRectificationV1(id, data) {
	return call('submitRectificationV1', { _id: id, ...data })
}

export function verifyStationSafetyHazardV1(id, data) {
	return call('verifyHazardV1', { _id: id, ...data })
}

export function updateStationSafetyHazardOutcomeV1(id, data) {
	return call('updateHazardOutcomeV1', { _id: id, ...data })
}
