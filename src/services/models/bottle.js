const BOTTLE_STATUS = ['unknown', 'in_station', 'at_customer', 'scrapped', 'lost']

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function normalizeBottleStatus(value) {
	const s = normalizeString(value) || 'unknown'
	return BOTTLE_STATUS.includes(s) ? s : ''
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function validateBottleDraftV1(input = {}) {
	const bottleNo = normalizeBottleNo(input.bottle_no ?? input.bottleNo)
	if (!bottleNo) return { ok: false, msg: '钢瓶号必填' }

	const status = normalizeBottleStatus(input.status)
	if (!status) return { ok: false, msg: '状态无效' }

	if (input.tare_weight != null || input.tareWeight != null) {
		const tare = toNumber(input.tare_weight ?? input.tareWeight, null)
		if (!(typeof tare === 'number' && tare >= 0)) return { ok: false, msg: '皮重必须为非负数字' }
	}

	return { ok: true }
}

export { BOTTLE_STATUS, normalizeBottleNo, normalizeBottleStatus, validateBottleDraftV1 }
