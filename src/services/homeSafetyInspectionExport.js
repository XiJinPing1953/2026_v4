import { callCloud } from '@/services/api'

const CLOUD_FUNCTION = 'crm-home-safety-export'
const EXPORT_TIMEOUT_MS = 180000

function call(action, data = {}, timeout = EXPORT_TIMEOUT_MS) {
	return callCloud(CLOUD_FUNCTION, { action, data, timeout })
}

export function previewHomeSafetyInspectionExportV1(params = {}) {
	return call('previewV1', params)
}

export function createHomeSafetyInspectionExportV1(params = {}) {
	return call('createV1', params)
}

export function getHomeSafetyInspectionExportJobV1(jobId) {
	return call('getJobV1', { job_id: jobId })
}

export function listMyHomeSafetyInspectionExportsV1(limit = 10) {
	return call('listMineV1', { limit })
}

export function resumeHomeSafetyInspectionExportV1(jobId) {
	return call('resumeV1', { job_id: jobId })
}

export function getHomeSafetyInspectionExportDownloadV1(jobId) {
	return call('getDownloadV1', { job_id: jobId })
}
