function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizePlateNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function validateVehicleDraftV1(input = {}) {
	const plateNo = normalizePlateNo(input.plate_no ?? input.plateNo)
	if (!plateNo) return { ok: false, msg: '车牌必填' }
	return { ok: true }
}

export { normalizePlateNo, validateVehicleDraftV1 }
