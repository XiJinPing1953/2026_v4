function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeType(value) {
	const type = normalizeString(value).toLowerCase()
	if (type === 'back' || type === 'fill' || type === 'out' || type === 'adjust') return type
	return ''
}

function normalizeDay(value) {
	const match = normalizeString(value).match(/^(\d{4}-\d{2}-\d{2})/)
	return match ? match[1] : ''
}

function movementTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	if (type === 'adjust') return 40
	return 99
}

function toSortNumber(value) {
	const num = Number(value)
	return Number.isFinite(num) ? num : 0
}

function eventDayOfRow(row) {
	return normalizeDay(row && row.event_day) || normalizeDay(row && row.date) || ''
}

function compareTimelineEventAsc(a, b) {
	const dayA = eventDayOfRow(a)
	const dayB = eventDayOfRow(b)
	if (dayA !== dayB) return dayA.localeCompare(dayB)

	const eventAtA = toSortNumber(a && a.event_at) || toSortNumber(a && a.created_at)
	const eventAtB = toSortNumber(b && b.event_at) || toSortNumber(b && b.created_at)
	if (eventAtA !== eventAtB) return eventAtA - eventAtB

	const orderRawA = Number(a && a.type_order)
	const orderRawB = Number(b && b.type_order)
	const orderA = Number.isFinite(orderRawA) ? orderRawA : movementTypeOrder(normalizeType(a && a.type))
	const orderB = Number.isFinite(orderRawB) ? orderRawB : movementTypeOrder(normalizeType(b && b.type))
	if (orderA !== orderB) return orderA - orderB

	const createdAtA = toSortNumber(a && a.created_at)
	const createdAtB = toSortNumber(b && b.created_at)
	return createdAtA - createdAtB
}

function listEffectiveEvents(events) {
	if (!Array.isArray(events)) return []
	return events.filter((row) => {
		const type = normalizeType(row && row.type)
		return type === 'back' || type === 'fill' || type === 'out'
	})
}

function hasSameDayBackOutWithoutFill(events) {
	const effectiveEvents = listEffectiveEvents(events)
	if (!effectiveEvents.length) return false
	const hasBack = effectiveEvents.some((row) => normalizeType(row && row.type) === 'back')
	const hasFill = effectiveEvents.some((row) => normalizeType(row && row.type) === 'fill')
	const hasOut = effectiveEvents.some((row) => normalizeType(row && row.type) === 'out')
	return hasBack && hasOut && !hasFill
}

function sortDayEventsByTypePriority(events, priorities) {
	return [...events].sort((a, b) => {
		const aType = normalizeType(a && a.type)
		const bType = normalizeType(b && b.type)
		const aPriority = Object.prototype.hasOwnProperty.call(priorities, aType) ? priorities[aType] : 99
		const bPriority = Object.prototype.hasOwnProperty.call(priorities, bType) ? priorities[bType] : 99
		if (aPriority !== bPriority) return aPriority - bPriority
		return compareTimelineEventAsc(a, b)
	})
}

function interleaveSameDayBackOutEvents(events, startType) {
	const sorted = [...events].sort(compareTimelineEventAsc)
	const backs = sorted.filter((row) => normalizeType(row && row.type) === 'back')
	const outs = sorted.filter((row) => normalizeType(row && row.type) === 'out')
	const others = sorted.filter((row) => {
		const type = normalizeType(row && row.type)
		return type !== 'back' && type !== 'out'
	})
	const result = []
	let expect = startType === 'out' ? 'out' : 'back'
	while (backs.length || outs.length) {
		if (expect === 'back') {
			if (backs.length) result.push(backs.shift())
			else if (outs.length) result.push(outs.shift())
			expect = 'out'
			continue
		}
		if (outs.length) result.push(outs.shift())
		else if (backs.length) result.push(backs.shift())
		expect = 'back'
	}
	return [...result, ...others]
}

function shouldQueueSameDayBackOut(events, state) {
	if (!hasSameDayBackOutWithoutFill(events)) return false
	if (Array.isArray(state && state.pendingSameDayBackOut) && state.pendingSameDayBackOut.length > 0) return true
	if (state && state.activeCycle && state.activeCycle.back) return false
	if (normalizeType(state && state.lastEffectiveType) === 'out') return false
	return true
}

function buildDayBusinessOrder(events, state) {
	const sorted = [...events].sort(compareTimelineEventAsc)
	if (!hasSameDayBackOutWithoutFill(sorted)) return sorted
	if (shouldQueueSameDayBackOut(sorted, state)) return sorted
	if (state && state.activeCycle && state.activeCycle.back) {
		return interleaveSameDayBackOutEvents(sorted, 'out')
	}
	if (normalizeType(state && state.lastEffectiveType) === 'out') {
		return interleaveSameDayBackOutEvents(sorted, 'back')
	}
	return sorted
}

function createActiveCycleFromBack(backRow) {
	return {
		back: backRow,
		fillCount: 0
	}
}

function buildPendingSameDayBackOutEntry(events, dayEntry) {
	const sorted = [...listEffectiveEvents(events)].sort(compareTimelineEventAsc)
	const backEvents = sorted.filter((row) => normalizeType(row && row.type) === 'back')
	const outEvents = sorted.filter((row) => normalizeType(row && row.type) === 'out')
	const back = backEvents[backEvents.length - 1] || null
	const out = outEvents[outEvents.length - 1] || null
	if (!back || !out) return null
	return {
		back,
		out,
		rawSorted: [...events],
		dayEntry
	}
}

function resolvePendingSameDayBackOut(state, nextType) {
	const queue = Array.isArray(state && state.pendingSameDayBackOut) ? state.pendingSameDayBackOut : []
	if (!queue.length) return null
	const type = normalizeType(nextType)
	if (!type || type === 'adjust') return null
	const latest = queue[queue.length - 1] || null
	state.pendingSameDayBackOut = []
	if (!latest || !latest.back || !latest.out) return null
	if (type === 'fill') {
		state.activeCycle = createActiveCycleFromBack(latest.back)
		state.lastEffectiveType = 'back'
		return {
			...latest,
			displaySorted: sortDayEventsByTypePriority(latest.rawSorted, { out: 10, back: 20, adjust: 30 })
		}
	}
	state.activeCycle = null
	state.lastEffectiveType = 'out'
	return {
		...latest,
		displaySorted: sortDayEventsByTypePriority(latest.rawSorted, { back: 10, out: 20, adjust: 30 })
	}
}

function applyDayState(state, dayEvents) {
	for (const row of dayEvents) {
		const type = normalizeType(row && row.type)
		if (type === 'back') {
			state.activeCycle = createActiveCycleFromBack(row)
			state.lastEffectiveType = 'back'
			continue
		}
		if (type === 'fill') {
			state.lastEffectiveType = 'fill'
			if (state.activeCycle && state.activeCycle.back) {
				state.activeCycle.fillCount += 1
			}
			continue
		}
		if (type === 'out') {
			state.lastEffectiveType = 'out'
			if (state.activeCycle && state.activeCycle.back) {
				state.activeCycle = null
			}
			continue
		}
		if (type === 'adjust') {
			state.lastEffectiveType = 'adjust'
		}
	}
}

function buildBottleTimelineDisplayEvents(events) {
	const sortedRows = Array.isArray(events) ? [...events].sort(compareTimelineEventAsc) : []
	const state = {
		activeCycle: null,
		pendingSameDayBackOut: [],
		lastEffectiveType: ''
	}
	const dayEntries = []
	let dayBuffer = []

	const flushDayBuffer = () => {
		if (!dayBuffer.length) return
		const rawSorted = [...dayBuffer].sort(compareTimelineEventAsc)
		dayBuffer = []
		const dayEntry = {
			rawSorted,
			displaySorted: rawSorted
		}
		dayEntries.push(dayEntry)

		if (shouldQueueSameDayBackOut(rawSorted, state)) {
			const pendingEntry = buildPendingSameDayBackOutEntry(rawSorted, dayEntry)
			if (pendingEntry) {
				state.pendingSameDayBackOut = [...state.pendingSameDayBackOut, pendingEntry]
			}
			return
		}

		const firstEffectiveEvent = listEffectiveEvents(rawSorted)[0] || null
		if (firstEffectiveEvent) {
			const resolvedPending = resolvePendingSameDayBackOut(state, firstEffectiveEvent.type)
			if (resolvedPending && resolvedPending.dayEntry) {
				resolvedPending.dayEntry.displaySorted = resolvedPending.displaySorted
			}
		}

		const sorted = buildDayBusinessOrder(rawSorted, state)
		dayEntry.displaySorted = sorted
		applyDayState(state, sorted)
	}

	for (const row of sortedRows) {
		const eventDay = eventDayOfRow(row)
		if (!dayBuffer.length) {
			dayBuffer.push(row)
			continue
		}
		if (eventDay === eventDayOfRow(dayBuffer[0])) {
			dayBuffer.push(row)
			continue
		}
		flushDayBuffer()
		dayBuffer.push(row)
	}
	flushDayBuffer()

	const ascEvents = []
	for (const entry of dayEntries) {
		const current = Array.isArray(entry.displaySorted) && entry.displaySorted.length ? entry.displaySorted : entry.rawSorted
		ascEvents.push(...current)
	}
	return ascEvents.reverse()
}

export { buildBottleTimelineDisplayEvents }
