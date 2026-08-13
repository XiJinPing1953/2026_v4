'use strict'

const NUMBER_PREFIX = 'XJ'

function normalizeDateKey(value) {
	const text = String(value || '').trim()
	if (/^\d{8}$/.test(text)) return text
	if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replace(/-/g, '')
	return ''
}

function formatInspectionNumber(dateKey, sequence) {
	const normalizedDate = normalizeDateKey(dateKey)
	const normalizedSequence = Math.max(Number(sequence || 0) || 0, 0)
	if (!normalizedDate || !normalizedSequence) return ''
	return `${NUMBER_PREFIX}${normalizedDate}-${String(normalizedSequence).padStart(3, '0')}`
}

function parseInspectionNumber(value) {
	const match = String(value || '').trim().match(/^XJ(\d{8})-(\d{3,})$/)
	if (!match) return null
	return {
		dateKey: match[1],
		sequence: Number(match[2])
	}
}

function isDuplicateKeyError(error) {
	const message = String(error?.message || '').toLowerCase()
	return message.includes('duplicate key') || message.includes('e11000')
}

async function ensureCounterDocument(counters, dateKey, now) {
	try {
		await counters.add({
			_id: dateKey,
			next_sequence: 0,
			created_at: now,
			updated_at: now
		})
	} catch (error) {
		if (!isDuplicateKeyError(error)) {
			const existing = await counters.doc(dateKey).get()
			if (!existing?.data || (Array.isArray(existing.data) && !existing.data.length)) throw error
		}
	}
}

async function allocateInspectionNumber({ counters, dbCmd, dateKey, now = Date.now() }) {
	const normalizedDate = normalizeDateKey(dateKey)
	if (!normalizedDate) throw new Error('巡检编号日期无效')
	await ensureCounterDocument(counters, normalizedDate, now)
	const counterQuery = counters.where({ _id: normalizedDate })
	if (typeof counterQuery.updateAndReturn !== 'function') {
		throw new Error('当前云数据库版本不支持安全分配巡检编号')
	}
	const result = await counterQuery.updateAndReturn({
		next_sequence: dbCmd.inc(1),
		updated_at: now
	})
	const sequence = Number(result?.doc?.next_sequence || 0)
	if (!sequence) throw new Error('巡检编号分配失败')
	return {
		inspection_no: formatInspectionNumber(normalizedDate, sequence),
		inspection_number_date: normalizedDate,
		inspection_sequence: sequence
	}
}

module.exports = {
	NUMBER_PREFIX,
	normalizeDateKey,
	formatInspectionNumber,
	parseInspectionNumber,
	allocateInspectionNumber
}
