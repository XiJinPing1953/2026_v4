const BOTTLE_STATUS = ['unknown', 'in_station', 'at_customer', 'scrapped', 'lost']
const CHECK_CYCLE_MONTHS = [6, 12, 24, 36]

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

function normalizeDateString(value) {
	return normalizeString(value)
}

function toNumber(value, fallback = null) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function isValidDateString(value) {
	const text = normalizeDateString(value)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
	const [year, month, day] = text.split('-').map((item) => Number(item))
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
	if (month < 1 || month > 12) return false
	const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
	return day >= 1 && day <= maxDay
}

function normalizeCycleMonths(value) {
	const num = Number(value)
	if (!Number.isInteger(num)) return null
	return CHECK_CYCLE_MONTHS.includes(num) ? num : null
}

function validateBottleDraftV1(input = {}) {
	const bottleNo = normalizeBottleNo(input.bottle_no ?? input.bottleNo)
	if (!bottleNo) return { ok: false, msg: '钢瓶号必填' }

	const status = normalizeBottleStatus(input.status)
	if (!status) return { ok: false, msg: '状态无效' }

	const fillingCompany = normalizeString(input.filling_company ?? input.fillingCompany)
	if (!fillingCompany) return { ok: false, msg: '充装单位必填' }

	const registrationMark = normalizeString(input.registration_mark ?? input.registrationMark)
	if (!registrationMark) return { ok: false, msg: '登记证标号必填' }

	const equipmentType = normalizeString(input.equipment_type ?? input.equipmentType)
	if (!equipmentType) return { ok: false, msg: '设备品种必填' }

	const productNo = normalizeString(input.product_no ?? input.productNo)
	if (!productNo) return { ok: false, msg: '产品编号必填' }

	const qrCode = normalizeString(input.qr_code ?? input.qrCode)
	if (!qrCode) return { ok: false, msg: '二维码号必填' }

	const volume = toNumber(input.volume_l ?? input.volumeL, null)
	if (!(typeof volume === 'number' && volume > 0)) return { ok: false, msg: '容积必须为大于 0 的数字' }

	const manufactureDate = normalizeDateString(input.manufacture_date ?? input.manufactureDate)
	if (!isValidDateString(manufactureDate)) return { ok: false, msg: '制造日期格式无效' }

	const bottleCheckDate = normalizeDateString(input.bottle_check_date ?? input.bottleCheckDate)
	if (!isValidDateString(bottleCheckDate)) return { ok: false, msg: '钢瓶检验日期格式无效' }

	const bottleNextCheckDate = normalizeDateString(input.bottle_next_check_date ?? input.bottleNextCheckDate)
	if (!isValidDateString(bottleNextCheckDate)) return { ok: false, msg: '钢瓶下次检验日期格式无效' }

	const bottleCycle = normalizeCycleMonths(input.bottle_check_cycle_months ?? input.bottleCheckCycleMonths)
	if (bottleCycle == null) return { ok: false, msg: '钢瓶检测周期无效' }

	const scrapDueDate = normalizeDateString(input.scrap_due_date ?? input.scrapDueDate)
	if (!isValidDateString(scrapDueDate)) return { ok: false, msg: '报废期限格式无效' }

	const pressureGaugeNo = normalizeString(input.pressure_gauge_no ?? input.pressureGaugeNo)
	if (!pressureGaugeNo) return { ok: false, msg: '压力表号必填' }

	const pressureMin = toNumber(input.pressure_gauge_range_min ?? input.pressureGaugeRangeMin, null)
	const pressureMax = toNumber(input.pressure_gauge_range_max ?? input.pressureGaugeRangeMax, null)
	if (!(typeof pressureMin === 'number' && pressureMin >= 0)) return { ok: false, msg: '压力区间下限必须为非负数字' }
	if (!(typeof pressureMax === 'number' && pressureMax >= 0)) return { ok: false, msg: '压力区间上限必须为非负数字' }
	if (pressureMin > pressureMax) return { ok: false, msg: '压力区间下限不能大于上限' }

	const pressureCheckDate = normalizeDateString(input.pressure_gauge_check_date ?? input.pressureGaugeCheckDate)
	if (!isValidDateString(pressureCheckDate)) return { ok: false, msg: '压力表检验日期格式无效' }

	const pressureNextCheckDate = normalizeDateString(input.pressure_gauge_next_check_date ?? input.pressureGaugeNextCheckDate)
	if (!isValidDateString(pressureNextCheckDate)) return { ok: false, msg: '压力表下次检验日期格式无效' }

	const pressureCycle = normalizeCycleMonths(input.pressure_gauge_cycle_months ?? input.pressureGaugeCycleMonths)
	if (pressureCycle == null) return { ok: false, msg: '压力表检测周期无效' }

	const valveCheckDate = normalizeDateString(input.safety_valve_check_date ?? input.safetyValveCheckDate)
	if (!isValidDateString(valveCheckDate)) return { ok: false, msg: '安全阀检测日期格式无效' }

	const valveNextCheckDate = normalizeDateString(input.safety_valve_next_check_date ?? input.safetyValveNextCheckDate)
	if (!isValidDateString(valveNextCheckDate)) return { ok: false, msg: '安全阀下次检测日期格式无效' }

	const valveCycle = normalizeCycleMonths(input.safety_valve_cycle_months ?? input.safetyValveCycleMonths)
	if (valveCycle == null) return { ok: false, msg: '安全阀检测周期无效' }

	if (input.tare_weight != null || input.tareWeight != null) {
		const tare = toNumber(input.tare_weight ?? input.tareWeight, null)
		if (!(typeof tare === 'number' && tare >= 0)) return { ok: false, msg: '皮重必须为非负数字' }
	}

	if (input.bottle_check_fee != null || input.bottleCheckFee != null) {
		const fee = toNumber(input.bottle_check_fee ?? input.bottleCheckFee, null)
		if (!(typeof fee === 'number' && fee >= 0)) return { ok: false, msg: '钢瓶检测费用必须为非负数字' }
	}

	if (input.pressure_gauge_check_fee != null || input.pressureGaugeCheckFee != null) {
		const fee = toNumber(input.pressure_gauge_check_fee ?? input.pressureGaugeCheckFee, null)
		if (!(typeof fee === 'number' && fee >= 0)) return { ok: false, msg: '压力表检测费用必须为非负数字' }
	}

	if (input.safety_valve_check_fee != null || input.safetyValveCheckFee != null) {
		const fee = toNumber(input.safety_valve_check_fee ?? input.safetyValveCheckFee, null)
		if (!(typeof fee === 'number' && fee >= 0)) return { ok: false, msg: '安全阀检测费用必须为非负数字' }
	}

	if (input.safety_valve_count != null || input.safetyValveCount != null) {
		const count = Number(input.safety_valve_count ?? input.safetyValveCount)
		if (!Number.isInteger(count) || count !== 2) return { ok: false, msg: '安全阀数量固定为 2' }
	}

	return { ok: true }
}

export {
	BOTTLE_STATUS,
	CHECK_CYCLE_MONTHS,
	normalizeBottleNo,
	normalizeBottleStatus,
	normalizeDateString,
	isValidDateString,
	normalizeCycleMonths,
	validateBottleDraftV1
}
