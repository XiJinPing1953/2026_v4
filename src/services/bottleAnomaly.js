import { callCloud } from '@/services/api'

function stableJson(value) {
	try {
		return JSON.stringify(value == null ? null : value)
	} catch (err) {
		return ''
	}
}

function normalizeReconcileTypes(value) {
	let list = value
	if (typeof list === 'string') {
		list = list
			.split(',')
			.map((item) => String(item || '').trim())
			.filter(Boolean)
	}
	if (!Array.isArray(list)) return []
	const allowed = new Set([
		'missing_back',
		'missing_fill',
		'missing_out',
		'continuous_fill',
		'continuous_out',
		'continuous_back',
		'missing_truck_fill',
		'truck_return_diff_excess',
		'missing_truck_back_gross'
	])
	const unique = []
	for (const item of list) {
		const type = String(item || '').trim()
		if (!allowed.has(type)) continue
		if (unique.includes(type)) continue
		unique.push(type)
	}
	return unique
}

export async function listBottleAnomaliesV1(params) {
	const rawSummaryIgnoreStatus = params.summary_ignore_status ?? params.summaryIgnoreStatus
	const rawWithBreakdown = params.with_breakdown ?? params.withBreakdown
	const rawStatus = params.status
	const data = {
		bottle_no: params.bottle_no || params.bottleNo || '',
		anomaly_type: params.anomaly_type || params.anomalyType || '',
		status: rawStatus == null ? 'open' : String(rawStatus),
		dateStart: params.dateStart || '',
		dateEnd: params.dateEnd || '',
		page: params.page || 1,
		pageSize: params.pageSize || 20
	}
	if (rawSummaryIgnoreStatus != null) {
		data.summary_ignore_status = Boolean(rawSummaryIgnoreStatus)
	}
	if (rawWithBreakdown != null) {
		data.with_breakdown = Boolean(rawWithBreakdown)
	}
	return callCloud('crm-bottle-anomaly', {
		action: 'listV1',
		data
	})
}

export async function getBottleAnomalyTypesV1() {
	return callCloud('crm-bottle-anomaly', {
		action: 'typesV1',
		data: {}
	})
}

export async function scanBottleAnomaliesRoundV2(params = {}) {
	const rawReconcileAnomalies = params.reconcile_anomalies ?? params.reconcileAnomalies
	const rawReconcileTypes = params.reconcile_types ?? params.reconcileTypes
	const reconcileTypes = normalizeReconcileTypes(rawReconcileTypes)
	const data = {
		bottle_no: params.bottle_no || params.bottleNo || '',
		cursor: params.cursor || null,
		reconcile_missing_back: Boolean(params.reconcile_missing_back ?? params.reconcileMissingBack),
		batch_size: params.batch_size ?? params.batchSize,
		max_events_per_round: params.max_events_per_round ?? params.maxEventsPerRound,
		max_ms_per_round: params.max_ms_per_round ?? params.maxMsPerRound,
		max_writes_per_round: params.max_writes_per_round ?? params.maxWritesPerRound
	}
	if (rawReconcileAnomalies != null) {
		data.reconcile_anomalies = Boolean(rawReconcileAnomalies)
	}
	if (rawReconcileTypes != null) {
		data.reconcile_types = reconcileTypes
	}
	return callCloud('crm-bottle-anomaly', {
		action: 'scanV2',
		data
	})
}

export async function scanBottleAnomaliesSafeV2(params = {}) {
	const maxRounds = Math.min(Math.max(Number(params.maxRounds || params.max_rounds || 8), 1), 30)
	let rounds = 0
	let done = false
	let cursor = params.cursor || null
	let created = 0
	let resolvedStale = 0
	let scannedEvents = 0

	while (!done && rounds < maxRounds) {
		const res = await scanBottleAnomaliesRoundV2({
			...params,
			cursor
		})
		if (res?.code !== 0) {
			return {
				...res,
				data: {
					...(res?.data || {}),
					done,
					cursor,
					created,
					resolved_stale: resolvedStale,
					scanned_events: scannedEvents,
					rounds
				}
			}
		}

		rounds += 1
		const payload = res?.data || {}
		created += Number(payload.round_created || 0)
		resolvedStale += Number(payload.round_resolved_stale || 0)
		scannedEvents += Number(payload.round_scanned_events || 0)
		done = Boolean(payload.done)
		cursor = payload.cursor || null
		if (!done && !cursor) break
	}

	return {
		code: 0,
		data: {
			done,
			cursor,
			created,
			resolved_stale: resolvedStale,
			scanned_events: scannedEvents,
			rounds
		}
	}
}

export async function rebuildBottleAnomaliesRoundV2(params = {}) {
	const data = {
		cursor: params.cursor || null,
		batch_bottles_per_round: params.batch_bottles_per_round ?? params.batchBottlesPerRound,
		max_ms_per_round: params.max_ms_per_round ?? params.maxMsPerRound,
		max_events_per_round: params.max_events_per_round ?? params.maxEventsPerRound,
		max_writes_per_round: params.max_writes_per_round ?? params.maxWritesPerRound,
		batch_size: params.batch_size ?? params.batchSize
	}
	return callCloud('crm-bottle-anomaly', {
		action: 'rebuildV2',
		data
	})
}

export async function rebuildBottleAnomaliesSafeV2(params = {}) {
	const maxRounds = Math.min(Math.max(Number(params.maxRounds || params.max_rounds || 240), 1), 600)
	const maxStallRounds = Math.min(Math.max(Number(params.maxStallRounds || params.max_stall_rounds || 3), 1), 8)
	let rounds = 0
	let done = false
	let cursor = params.cursor || null
	let bottles = 0
	let trucks = 0
	let scannedEvents = 0
	let created = 0
	let resolvedStale = 0
	let elapsedMs = 0
	let stallRounds = 0

	while (!done && rounds < maxRounds) {
		const requestCursor = cursor || null
		const requestCursorJson = stableJson(requestCursor)
		const res = await rebuildBottleAnomaliesRoundV2({
			...params,
			cursor: requestCursor
		})
		if (res?.code !== 0) {
			return {
				...res,
				data: {
					...(res?.data || {}),
					done,
					cursor,
					rounds,
					bottles,
					trucks,
					scanned_events: scannedEvents,
					created,
					resolved_stale: resolvedStale,
					elapsed_ms: elapsedMs
				}
			}
		}
		rounds += 1
		const payload = res.data || {}
		done = Boolean(payload.done)
		const nextCursor = payload.cursor || null
		const roundBottles = Number(payload.round_bottles || 0)
		const roundTrucks = Number(payload.round_trucks || 0)
		const roundScannedEvents = Number(payload.round_scanned_events || 0)
		const roundCreated = Number(payload.round_created || 0)
		const roundResolvedStale = Number(payload.round_resolved_stale || 0)
		const roundElapsedMs = Number(payload.elapsed_ms || 0)
		const progressed =
			done ||
			roundBottles > 0 ||
			roundScannedEvents > 0 ||
			roundCreated > 0 ||
			roundResolvedStale > 0 ||
			requestCursorJson !== stableJson(nextCursor)

		cursor = nextCursor
		bottles += roundBottles
		trucks += roundTrucks
		scannedEvents += roundScannedEvents
		created += roundCreated
		resolvedStale += roundResolvedStale
		elapsedMs += roundElapsedMs
		stallRounds = progressed ? 0 : stallRounds + 1
		if (!done && stallRounds >= maxStallRounds) {
			return {
				code: 408,
				msg: '全量扫描停滞，请稍后重试',
				data: {
					done,
					cursor,
					rounds,
					bottles,
					trucks,
					scanned_events: scannedEvents,
					created,
					resolved_stale: resolvedStale,
					elapsed_ms: elapsedMs,
					stopped_reason: 'stalled',
					stall_rounds: stallRounds
				}
			}
		}
		if (!done && !cursor) break
	}

	return {
		code: 0,
		data: {
			done,
			cursor,
			rounds,
			bottles,
			trucks,
			scanned_events: scannedEvents,
			created,
			resolved_stale: resolvedStale,
			elapsed_ms: elapsedMs,
			limit_reached: !done && rounds >= maxRounds,
			stall_rounds: stallRounds
		}
	}
}

export async function resolveBottleAnomalyV1(params = {}) {
	const payload = typeof params === 'string' ? { id: params } : params
	return callCloud('crm-bottle-anomaly', {
		action: 'resolveV1',
		data: {
			id: payload.id || payload._id || '',
			resolution_mode: payload.resolution_mode || payload.resolutionMode || ''
		}
	})
}
