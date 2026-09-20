export function normalizeCashierText(value) {
	return value == null ? '' : String(value).trim()
}

export function normalizeCashierMoneyScale(value, fallback = 2) {
	return Number(value) === 3 ? 3 : (Number(value) === 2 ? 2 : (Number(fallback) === 3 ? 3 : 2))
}

export function normalizeCashierMoney(value, scale = 2, options = {}) {
	const digits = normalizeCashierMoneyScale(scale)
	const allowZero = options.allowZero !== false
	if (typeof value === 'number' && !Number.isFinite(value)) return ''
	const text = normalizeCashierText(value)
	if (!/^\d+(?:\.\d+)?$/.test(text)) return ''
	const [integerRaw, decimalRaw = ''] = text.split('.')
	if (decimalRaw.length > digits) return ''
	const integer = integerRaw.replace(/^0+(?=\d)/, '') || '0'
	const decimal = decimalRaw.padEnd(digits, '0')
	const normalized = digits > 0 ? `${integer}.${decimal}` : integer
	if (!allowZero && !/[1-9]/.test(`${integer}${decimal}`)) return ''
	return normalized
}

export function cashierMoneyToMinor(value, scale = 2) {
	const digits = normalizeCashierMoneyScale(scale)
	const normalized = normalizeCashierMoney(value, digits)
	if (!normalized) return ''
	const [integer, decimal = ''] = normalized.split('.')
	return `${integer}${decimal.padEnd(digits, '0')}`.replace(/^0+(?=\d)/, '') || '0'
}

function addUnsignedIntegers(left, right) {
	let carry = 0
	let output = ''
	let i = left.length - 1
	let j = right.length - 1
	while (i >= 0 || j >= 0 || carry) {
		const a = i >= 0 ? Number(left[i]) : 0
		const b = j >= 0 ? Number(right[j]) : 0
		const next = a + b + carry
		output = String(next % 10) + output
		carry = Math.floor(next / 10)
		i -= 1
		j -= 1
	}
	return output.replace(/^0+(?=\d)/, '') || '0'
}

function padMinorScale(minor, fromScale, toScale) {
	if (toScale <= fromScale) return minor
	return `${minor}${'0'.repeat(toScale - fromScale)}`
}

export function cashierMinorToMoney(minor, scale = 2) {
	const digits = normalizeCashierMoneyScale(scale)
	const raw = normalizeCashierText(minor)
	if (!/^\d+$/.test(raw)) return ''
	const padded = raw.padStart(digits + 1, '0')
	const integer = padded.slice(0, -digits).replace(/^0+(?=\d)/, '') || '0'
	return `${integer}.${padded.slice(-digits)}`
}

export function addCashierMoney(left, leftScale, right, rightScale, resultScale = null) {
	const aScale = normalizeCashierMoneyScale(leftScale)
	const bScale = normalizeCashierMoneyScale(rightScale)
	const targetScale = resultScale == null
		? Math.max(aScale, bScale)
		: normalizeCashierMoneyScale(resultScale, Math.max(aScale, bScale))
	const a = cashierMoneyToMinor(left, aScale)
	const b = cashierMoneyToMinor(right, bScale)
	if (!a || !b || targetScale < aScale || targetScale < bScale) return ''
	return cashierMinorToMoney(addUnsignedIntegers(
		padMinorScale(a, aScale, targetScale),
		padMinorScale(b, bScale, targetScale)
	), targetScale)
}

export function sumCashierMoney(items = [], scaleResolver = () => 2, valueResolver = (item) => item) {
	const rows = Array.isArray(items) ? items : []
	const scales = rows.map((item) => normalizeCashierMoneyScale(scaleResolver(item)))
	const targetScale = scales.includes(3) ? 3 : 2
	let total = targetScale === 3 ? '0.000' : '0.00'
	for (let index = 0; index < rows.length; index += 1) {
		const scale = scales[index] || 2
		const value = normalizeCashierMoney(valueResolver(rows[index]), scale)
		if (!value) return ''
		total = addCashierMoney(total, targetScale, value, scale, targetScale)
		if (!total) return ''
	}
	return total
}

export function normalizeCashierKind(value) {
	const text = normalizeCashierText(value).toLowerCase()
	return ['gas', 'deposit', 'mixed'].includes(text) ? text : 'gas'
}

export function normalizeCashierPurpose(value, kind = 'gas') {
	const text = normalizeCashierText(value)
	if (!text) return 'unspecified' // Historical records had no purpose field.
	if (!['unspecified', 'prepay', 'settlement'].includes(text)) return ''
	return normalizeCashierKind(kind) === 'deposit' ? 'unspecified' : text
}

export function buildCashierAmounts({ kind = 'gas', amount = '', gas_amount = '', deposit_amount = '', money_scale = 2 } = {}) {
	const normalizedKind = normalizeCashierKind(kind)
	const gasScale = normalizeCashierMoneyScale(money_scale)
	const totalScale = normalizedKind === 'deposit' ? 2 : gasScale
	const total = normalizeCashierMoney(amount, totalScale, { allowZero: false })
	if (!total) return null
	const gas = normalizeCashierMoney(gas_amount, gasScale, { allowZero: false })
	const deposit = normalizeCashierMoney(deposit_amount, 2, { allowZero: false })
	if (normalizedKind === 'gas') {
		return { amount: total, gas_amount: total, deposit_amount: '0.00', money_scale: gasScale }
	}
	if (normalizedKind === 'deposit') {
		return { amount: total, gas_amount: gasScale === 3 ? '0.000' : '0.00', deposit_amount: total, money_scale: gasScale }
	}
	if (!gas || !deposit) return null
	const splitTotal = addCashierMoney(gas, gasScale, deposit, 2, gasScale)
	if (!splitTotal || total !== splitTotal) return null
	return { amount: total, gas_amount: gas, deposit_amount: deposit, money_scale: gasScale }
}

function stableValue(value) {
	if (Array.isArray(value)) return value.map(stableValue)
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
	}
	return value
}

export function cashierDraftFingerprint(input = {}) {
	const proofs = Array.isArray(input.proof_images) ? input.proof_images : []
	return JSON.stringify(stableValue({
		command: normalizeCashierText(input.command),
		intake_id: normalizeCashierText(input.intake_id),
		customer_id: normalizeCashierText(input.customer_id),
		kind: normalizeCashierKind(input.kind),
		amount: normalizeCashierText(input.amount),
		gas_amount: normalizeCashierText(input.gas_amount),
		deposit_amount: normalizeCashierText(input.deposit_amount),
		purpose: normalizeCashierPurpose(input.purpose, input.kind),
		biz_date: normalizeCashierText(input.biz_date),
		payment_method: normalizeCashierText(input.payment_method),
		proof_images: proofs.map((item) => normalizeCashierText(item?.draft_key || item?.draftKey || item?.file_id || item?.fileId || item?.local_path || item?.localPath || item)),
		note: normalizeCashierText(input.note),
		reason: normalizeCashierText(input.reason)
	}))
}
