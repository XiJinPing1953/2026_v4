'use strict'

const DEFAULT_CUTOFF_DAY = '2026-08-12'
const DEFAULT_CUTOFF_AT = 1786464000000
const DEFAULT_OPENING_TANK_T = 0
const TELEMETRY_STALE_MS = 60 * 1000
const INVENTORY_LINKED_RECORD_TYPES = new Set(['normal_fill', 'truck_out_agent_sale'])
const MOVEMENT_TYPES = new Set(['fill', 'out', 'back'])

const DEFAULT_PERIOD = Object.freeze({
	period_key: 'physical_2026-08-12',
	cutoff_day: DEFAULT_CUTOFF_DAY,
	cutoff_at: DEFAULT_CUTOFF_AT,
	opening_tank_t: DEFAULT_OPENING_TANK_T,
	reason: '储罐持续清零后重新建立现场库存账期',
	status: 'active',
	persisted: false
})

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNullableNumber(value) {
	if (value === '' || value == null) return null
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function roundTo(value, digits = 3) {
	const num = Number(value)
	if (!Number.isFinite(num)) return 0
	const base = 10 ** Number(digits || 0)
	return Math.round(num * base) / base
}

function roundTon(value) {
	return roundTo(value, 3)
}

function normalizeBottleNo(value) {
	return normalizeString(value).toUpperCase().replace(/\s+/g, '')
}

function looksLikeTruckNo(value) {
	return /^TRUCK[-_A-Z0-9]/.test(normalizeBottleNo(value))
}

function normalizeRecordType(value) {
	return normalizeString(value).toLowerCase() || 'normal_fill'
}

function normalizeMovementType(value) {
	const text = normalizeString(value).toLowerCase()
	return MOVEMENT_TYPES.has(text) ? text : ''
}

function parseShanghaiDayStart(day) {
	const text = normalizeString(day)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
	const ts = Date.parse(`${text}T00:00:00+08:00`)
	return Number.isFinite(ts) ? ts : null
}

function normalizePeriod(row = {}) {
	const source = row && typeof row === 'object' ? row : {}
	const cutoffDay = normalizeString(source.cutoff_day) || DEFAULT_CUTOFF_DAY
	const parsedCutoff = parseShanghaiDayStart(cutoffDay)
	const cutoffAt = toNullableNumber(source.cutoff_at) ?? parsedCutoff ?? DEFAULT_CUTOFF_AT
	return {
		_id: source._id || null,
		period_key: normalizeString(source.period_key) || `physical_${cutoffDay}`,
		cutoff_day: cutoffDay,
		cutoff_at: cutoffAt,
		opening_tank_t: roundTon(toNullableNumber(source.opening_tank_t) ?? DEFAULT_OPENING_TANK_T),
		reason: normalizeString(source.reason) || DEFAULT_PERIOD.reason,
		status: normalizeString(source.status).toLowerCase() === 'archived' ? 'archived' : 'active',
		activated_at: toNullableNumber(source.activated_at),
		activated_by: source.activated_by || null,
		activated_by_name: normalizeString(source.activated_by_name),
		created_at: toNullableNumber(source.created_at),
		updated_at: toNullableNumber(source.updated_at),
		persisted: Boolean(source._id || source.persisted)
	}
}

function movementTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	return 99
}

function timestampFromDay(value, fallback = 0) {
	const text = normalizeString(value)
	if (!text) return Number(fallback) || 0
	const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
	if (matched) {
		const hh = String(matched[4] || '00').padStart(2, '0')
		const mm = String(matched[5] || '00').padStart(2, '0')
		const ss = String(matched[6] || '00').padStart(2, '0')
		const ts = Date.parse(`${matched[1]}-${matched[2]}-${matched[3]}T${hh}:${mm}:${ss}+08:00`)
		if (Number.isFinite(ts)) return ts
	}
	const parsed = Date.parse(text)
	return Number.isFinite(parsed) ? parsed : Number(fallback) || 0
}

function fillingSortKey(row = {}) {
	const createdAt = toNullableNumber(row.created_at) || 0
	return {
		event_at: timestampFromDay(row.date, createdAt),
		created_at: createdAt,
		id: normalizeString(row._id)
	}
}

function movementSortKey(row = {}) {
	const type = normalizeMovementType(row.type)
	const createdAt = toNullableNumber(row.created_at) || 0
	return {
		event_at: toNullableNumber(row.event_at) ?? timestampFromDay(row.event_day || row.date, createdAt),
		type_order: toNullableNumber(row.type_order) ?? movementTypeOrder(type),
		created_at: createdAt,
		id: normalizeString(row._id)
	}
}

function isLaterSortKey(left, right) {
	if (!right) return true
	if (left.event_at !== right.event_at) return left.event_at > right.event_at
	if ((left.type_order || 0) !== (right.type_order || 0)) return (left.type_order || 0) > (right.type_order || 0)
	if (left.created_at !== right.created_at) return left.created_at > right.created_at
	return left.id > right.id
}

function buildFilledUnsoldSnapshot({ fillings = [], movements = [], cutoffAt = null } = {}) {
	const normalizedCutoffAt = toNullableNumber(cutoffAt)
	const fillingById = new Map()
	const latestFillingByBottle = new Map()
	const latestFillingKeyByBottle = new Map()
	const sourceFillings = Array.isArray(fillings) ? fillings : []

	for (let i = 0; i < sourceFillings.length; i += 1) {
		const row = sourceFillings[i] || {}
		const id = normalizeString(row._id)
		const bottleNo = normalizeBottleNo(row.bottle_no)
		const recordType = normalizeRecordType(row.record_type)
		const key = fillingSortKey(row)
		if (normalizedCutoffAt != null && key.event_at < normalizedCutoffAt) continue
		if (!id || !bottleNo || looksLikeTruckNo(bottleNo) || !INVENTORY_LINKED_RECORD_TYPES.has(recordType)) continue
		fillingById.set(id, row)
		if (isLaterSortKey(key, latestFillingKeyByBottle.get(bottleNo))) {
			latestFillingByBottle.set(bottleNo, row)
			latestFillingKeyByBottle.set(bottleNo, key)
		}
	}

	const latestMovementByBottle = new Map()
	const latestMovementKeyByBottle = new Map()
	const sourceMovements = Array.isArray(movements) ? movements : []
	for (let i = 0; i < sourceMovements.length; i += 1) {
		const row = sourceMovements[i] || {}
		const bottleNo = normalizeBottleNo(row.bottle_no)
		const type = normalizeMovementType(row.type)
		if (!bottleNo || !type) continue
		const key = movementSortKey(row)
		if (normalizedCutoffAt != null && key.event_at < normalizedCutoffAt) continue
		if (isLaterSortKey(key, latestMovementKeyByBottle.get(bottleNo))) {
			latestMovementByBottle.set(bottleNo, row)
			latestMovementKeyByBottle.set(bottleNo, key)
		}
	}

	let weightKg = 0
	let count = 0
	const unresolved = []
	for (const [bottleNo, latestFilling] of latestFillingByBottle.entries()) {
		const movement = latestMovementByBottle.get(bottleNo)
		const fillingKey = latestFillingKeyByBottle.get(bottleNo)
		const movementKey = latestMovementKeyByBottle.get(bottleNo)
		if (!movement) {
			unresolved.push({ bottle_no: bottleNo, reason: '缺少瓶子流转事件' })
			continue
		}

		const movementType = normalizeMovementType(movement.type)
		if (movementKey && fillingKey && movementKey.event_at < fillingKey.event_at) {
			unresolved.push({ bottle_no: bottleNo, reason: '最新灌装晚于最新流转事件' })
			continue
		}
		if (movementType === 'out' || movementType === 'back') continue
		if (movementType !== 'fill') {
			unresolved.push({ bottle_no: bottleNo, reason: '最新流转状态无法识别' })
			continue
		}

		const sourceType = normalizeString(movement.source_type).toLowerCase()
		const sourceId = normalizeString(movement.source_id)
		const matchedFilling = sourceType === 'filling' && sourceId ? fillingById.get(sourceId) : null
		if (!matchedFilling || normalizeBottleNo(matchedFilling.bottle_no) !== bottleNo) {
			unresolved.push({ bottle_no: bottleNo, reason: '最新灌装事件无法关联灌装记录' })
			continue
		}
		if (normalizeString(latestFilling._id) !== sourceId) {
			unresolved.push({ bottle_no: bottleNo, reason: '最新灌装记录与流转事件不一致' })
			continue
		}
		const fillWeightKg = toNullableNumber(matchedFilling.fill_weight)
		if (!(fillWeightKg > 0)) {
			unresolved.push({ bottle_no: bottleNo, reason: '灌装净重缺失或无效' })
			continue
		}
		weightKg += fillWeightKg
		count += 1
	}

	return {
		filled_unsold_t: roundTon(weightKg / 1000),
		filled_unsold_count: count,
		unresolved_bottle_count: unresolved.length,
		unresolved: unresolved.slice(0, 50),
		candidate_bottle_count: latestFillingByBottle.size
	}
}

function resolveTankReading({ tank = {}, tankConfig = {}, now = Date.now() } = {}) {
	const source = tank && typeof tank === 'object' ? tank : {}
	const sampledAt = toNullableNumber(source.sampled_at) ?? toNullableNumber(source.updated_at)
	const ageMs = sampledAt == null ? null : Math.max(Number(now) - sampledAt, 0)
	let status = normalizeString(source.status).toLowerCase()
	if (!['online', 'stale', 'error', 'empty'].includes(status)) status = 'empty'
	if (status === 'online' && (ageMs == null || ageMs > TELEMETRY_STALE_MS)) status = 'stale'

	const directWeight = toNullableNumber(source.lng_weight_t)
	const levelPercent = toNullableNumber(source.level_percent)
	const fullTankWeight = toNullableNumber(tankConfig.full_tank_weight_t)
	let tankT = null
	let weightSource = 'unavailable'
	let isFallback = false
	if (directWeight != null) {
		if (directWeight >= 0) {
			tankT = roundTon(directWeight)
			weightSource = 'plc_weight'
		} else {
			weightSource = 'invalid_plc_weight'
		}
	} else if (levelPercent != null && fullTankWeight != null && fullTankWeight > 0) {
		tankT = roundTon((Math.min(Math.max(levelPercent, 0), 100) * fullTankWeight) / 100)
		weightSource = 'level_estimate'
		isFallback = true
	}
	const available = status === 'online' && tankT != null

	return {
		tank_t: tankT,
		available,
		status,
		sampled_at: sampledAt,
		age_ms: ageMs,
		weight_source: weightSource,
		is_fallback: isFallback
	}
}

function buildLedgerTankT({ period = DEFAULT_PERIOD, movements = [] } = {}) {
	const normalizedPeriod = normalizePeriod(period)
	const rows = Array.isArray(movements) ? movements : []
	let total = normalizedPeriod.opening_tank_t
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i] || {}
		const eventAt = toNullableNumber(row.event_at) ?? timestampFromDay(row.event_day || row.date, row.created_at)
		if (eventAt < normalizedPeriod.cutoff_at) continue
		total += toNullableNumber(row.station_delta_t) || 0
	}
	return roundTon(total)
}

function buildCurrentInventory({
	period = DEFAULT_PERIOD,
	tank = {},
	tankConfig = {},
	filledUnsold = {},
	ledgerTankT = null,
	now = Date.now()
} = {}) {
	const normalizedPeriod = normalizePeriod(period)
	const tankReading = resolveTankReading({ tank, tankConfig, now })
	const filledUnsoldT = roundTon(toNullableNumber(filledUnsold.filled_unsold_t) || 0)
	const filledUnsoldCount = Math.max(Number(filledUnsold.filled_unsold_count) || 0, 0)
	const unresolvedCount = Math.max(Number(filledUnsold.unresolved_bottle_count) || 0, 0)
	const ledgerValue = toNullableNumber(ledgerTankT)
	const totalT = tankReading.available ? roundTon((tankReading.tank_t || 0) + filledUnsoldT) : null
	const diffT = tankReading.available && ledgerValue != null ? roundTon((tankReading.tank_t || 0) - ledgerValue) : null

	let message = '现场库存可用'
	if (tankReading.status === 'stale') message = '储罐数据超过60秒未更新，总库存暂不可用'
	else if (tankReading.status === 'error') message = '储罐采集异常，总库存暂不可用'
	else if (tankReading.status === 'empty') message = '等待储罐网关上报，总库存暂不可用'
	else if (!tankReading.available) message = '储罐重量不可用，总库存暂不可用'
	else if (tankReading.is_fallback) message = 'PLC重量缺失，储罐使用液位比例备用估算'

	return {
		period: normalizedPeriod,
		physical: {
			tank_t: tankReading.tank_t,
			filled_unsold_t: filledUnsoldT,
			total_t: totalT,
			filled_unsold_count: filledUnsoldCount,
			available: tankReading.available,
			status: tankReading.status,
			sampled_at: tankReading.sampled_at,
			weight_source: tankReading.weight_source,
			is_fallback: tankReading.is_fallback,
			message
		},
		ledger: {
			tank_t: ledgerValue == null ? null : roundTon(ledgerValue),
			diff_t: diffT
		},
		quality: {
			unresolved_bottle_count: unresolvedCount,
			message: unresolvedCount > 0
				? `有${unresolvedCount}只瓶子的最新流转状态待核对，未计入可信库存`
				: '瓶装库存流转状态完整'
		}
	}
}

module.exports = {
	DEFAULT_PERIOD,
	TELEMETRY_STALE_MS,
	buildCurrentInventory,
	buildFilledUnsoldSnapshot,
	buildLedgerTankT,
	normalizePeriod,
	parseShanghaiDayStart,
	resolveTankReading,
	roundTon
}
