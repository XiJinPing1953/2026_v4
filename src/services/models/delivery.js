function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeDeliveryName(value) {
	return normalizeString(value).replace(/\s+/g, ' ')
}

function normalizeDeliveryPhone(value) {
	return normalizeString(value).replace(/\s+/g, '')
}

function validateDeliveryDraftV1(input = {}) {
	const name = normalizeDeliveryName(input.name)
	if (!name) return { ok: false, msg: '配送员姓名必填' }
	return { ok: true }
}

export { normalizeDeliveryName, normalizeDeliveryPhone, validateDeliveryDraftV1 }
