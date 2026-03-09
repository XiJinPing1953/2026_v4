const ANOMALY_STATUS = ['open', 'resolved']

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function validateBottleAnomalyDraftV1(input = {}) {
	const bottleNo = normalizeString(input.bottle_no ?? input.bottleNo).toUpperCase().replace(/\s+/g, '')
	if (!bottleNo) return { ok: false, msg: '钢瓶号必填' }
	const anomalyType = normalizeString(input.anomaly_type ?? input.anomalyType)
	if (!anomalyType) return { ok: false, msg: '异常类型必填' }
	const status = normalizeString(input.status) || 'open'
	if (!ANOMALY_STATUS.includes(status)) return { ok: false, msg: '异常状态无效' }
	return { ok: true }
}

export { ANOMALY_STATUS, validateBottleAnomalyDraftV1 }
