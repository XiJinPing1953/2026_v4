function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function validateFillingDraftV1(input = {}) {
	const date = normalizeString(input.date)
	if (!date) return { ok: false, msg: '日期必填' }
	const bottleNo = normalizeString(input.bottle_no ?? input.bottleNo).toUpperCase().replace(/\s+/g, '')
	if (!bottleNo) return { ok: false, msg: '钢瓶号必填' }
	const fillWeight = toNumber(input.fill_weight ?? input.fillWeight, null)
	if (!(typeof fillWeight === 'number' && fillWeight > 0)) return { ok: false, msg: '灌装重量必填且大于 0' }
	return { ok: true }
}

export { validateFillingDraftV1 }
