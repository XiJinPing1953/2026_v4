'use strict'

const OPERATOR_UPDATE_CONFIRM_TEXT = 'UPDATE_FILLING_OPERATOR'

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeId(value) {
	if (value == null) return ''
	if (typeof value === 'object') {
		const nested = normalizeString(value.$oid || value.oid || value.id || value._id)
		if (nested) return nested
	}
	return normalizeString(value)
}

function normalizeUniqueIds(rawIds) {
	const result = []
	const seen = new Set()
	for (const raw of Array.isArray(rawIds) ? rawIds : []) {
		const id = normalizeId(raw)
		if (!id || seen.has(id)) continue
		seen.add(id)
		result.push(id)
	}
	return result
}

function inspectOperatorRepairRows(rows = [], payload = {}) {
	const ids = normalizeUniqueIds(payload.ids)
	const expectedDate = normalizeString(payload.expected_date)
	const expectedOperator = normalizeString(payload.expected_operator)
	const targetOperator = normalizeString(payload.operator)
	const targetOperatorId = normalizeId(payload.operator_id)
	const rowMap = new Map(
		(Array.isArray(rows) ? rows : [])
			.map((row) => [normalizeId(row && row._id), row])
			.filter((item) => item[0])
	)
	const items = []
	const mismatchItems = []

	for (const id of ids) {
		const row = rowMap.get(id) || null
		if (!row) {
			const item = { _id: id, bottle_no: '', error: '记录不存在' }
			items.push(item)
			mismatchItems.push(item)
			continue
		}
		const item = {
			_id: id,
			bottle_no: normalizeString(row.bottle_no),
			date: normalizeString(row.date),
			operator: normalizeString(row.operator),
			operator_id: normalizeId(row.operator_id),
			fill_weight: row.fill_weight == null ? null : Number(row.fill_weight),
			weight_start: row.weight_start == null ? null : Number(row.weight_start),
			weight_end: row.weight_end == null ? null : Number(row.weight_end),
			actual_net_weight: row.actual_net_weight == null ? null : Number(row.actual_net_weight),
			created_by: normalizeId(row.created_by),
			created_by_name: normalizeString(row.created_by_name),
			remark: normalizeString(row.remark),
			created_at: Number(row.created_at) || 0,
			updated_at: Number(row.updated_at) || 0,
			error: ''
		}
		if (item.date !== expectedDate) item.error = `日期不是 ${expectedDate}`
		else if (item.operator !== expectedOperator) item.error = `录入员不是“${expectedOperator}”`
		else if (item.operator === targetOperator && item.operator_id === targetOperatorId) item.error = '录入员已是目标人员'
		items.push(item)
		if (item.error) mismatchItems.push(item)
	}

	return {
		ready: ids.length > 0 && mismatchItems.length === 0 && items.length === ids.length,
		target_total: ids.length,
		matched_total: items.length - mismatchItems.length,
		mismatch_total: mismatchItems.length,
		items,
		mismatch_items: mismatchItems
	}
}

module.exports = {
	OPERATOR_UPDATE_CONFIRM_TEXT,
	inspectOperatorRepairRows,
	normalizeId,
	normalizeUniqueIds
}
