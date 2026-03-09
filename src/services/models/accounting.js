const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense', 'cost', 'other']
const ACCOUNT_DIRECTIONS = ['debit', 'credit']
const ENTRY_DIRECTIONS = ['debit', 'credit']

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function validateAccountDraftV1(input = {}) {
	const code = normalizeString(input.code)
	if (!code) return { ok: false, msg: '科目编码必填' }
	const name = normalizeString(input.name)
	if (!name) return { ok: false, msg: '科目名称必填' }
	const type = normalizeString(input.type)
	if (!ACCOUNT_TYPES.includes(type)) return { ok: false, msg: '科目类型无效' }
	const direction = normalizeString(input.direction)
	if (!ACCOUNT_DIRECTIONS.includes(direction)) return { ok: false, msg: '余额方向无效' }
	return { ok: true }
}

function validateVoucherDraftV1(input = {}) {
	const date = normalizeString(input.date)
	if (!date) return { ok: false, msg: '日期必填' }
	const summary = normalizeString(input.summary)
	if (!summary) return { ok: false, msg: '摘要必填' }
	const entries = Array.isArray(input.entries) ? input.entries : []
	if (entries.length < 2) return { ok: false, msg: '至少两条分录' }
	let debit = 0
	let credit = 0
	for (const row of entries) {
		const direction = normalizeString(row.direction)
		if (!ENTRY_DIRECTIONS.includes(direction)) return { ok: false, msg: '分录方向无效' }
		const amount = Number(row.amount)
		if (!Number.isFinite(amount) || amount <= 0) return { ok: false, msg: '分录金额无效' }
		if (direction === 'debit') debit += amount
		else credit += amount
	}
	if (Math.abs(debit - credit) > 0.0001) return { ok: false, msg: '借贷不平衡' }
	return { ok: true }
}

export { ACCOUNT_TYPES, ACCOUNT_DIRECTIONS, validateAccountDraftV1, validateVoucherDraftV1 }
