import { callCloud } from '@/services/api'

const CLOUD_FUNCTION = 'crm-station-safety-export'
const EXPORT_TIMEOUT_MS = 180000

function call(action, data = {}) {
	return callCloud(CLOUD_FUNCTION, { action, data, timeout: EXPORT_TIMEOUT_MS })
}

export function previewStationSafetyExportV1(params = {}) { return call('previewV1', params) }
export function createStationSafetyExportV1(params = {}) { return call('createV1', params) }
export function getStationSafetyExportJobV1(jobId) { return call('getJobV1', { job_id: jobId }) }
export function listMyStationSafetyExportsV1(limit = 10) { return call('listMineV1', { limit }) }
export function resumeStationSafetyExportV1(jobId) { return call('resumeV1', { job_id: jobId }) }
export function getStationSafetyExportDownloadV1(jobId) { return call('getDownloadV1', { job_id: jobId }) }
