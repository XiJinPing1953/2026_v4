import { callCloud } from './callCloud'

const FUNCTION_NAME = 'crm-customer-settlement'
const DEFAULT_TIMEOUT = 30000

function normalizeString(value) {
	return value == null ? '' : String(value).trim()
}

function normalizePageSize(value, fallback = 20) {
	const parsed = Number(value)
	if (!Number.isInteger(parsed) || parsed <= 0) return fallback
	return parsed
}

function invoke(action, data, timeout = DEFAULT_TIMEOUT) {
	return callCloud(FUNCTION_NAME, { action, data, timeout })
}

function commandPayload(params = {}) {
	const source = params && typeof params === 'object' ? params : {}
	const payload = {
		command: normalizeString(source.command),
		customer_id: normalizeString(source.customer_id),
		intake_id: normalizeString(source.intake_id),
		operation_id: normalizeString(source.operation_id),
		expected_version: Number.isInteger(Number(source.expected_version)) ? Number(source.expected_version) : 0,
		kind: normalizeString(source.kind),
		amount: source.amount,
		gas_amount: source.gas_amount,
		deposit_amount: source.deposit_amount,
		purpose: normalizeString(source.purpose),
		biz_date: normalizeString(source.biz_date),
		payment_method: normalizeString(source.payment_method),
		proof_images: Array.isArray(source.proof_images) ? source.proof_images.slice() : [],
		note: normalizeString(source.note),
		reason: normalizeString(source.reason)
	}
	if (source.expected_snapshot != null) payload.expected_snapshot = source.expected_snapshot
	return payload
}

export function previewReceiptIntakeV2(params = {}) {
	return invoke('previewReceiptIntakeV2', commandPayload(params))
}

// Pass a preview submission directly. The server owns normalization and the
// expected snapshot; rebuilding it from live form state would weaken the guard.
export function saveReceiptIntakeV2(submission = {}) {
	return invoke('saveReceiptIntakeV2', { ...submission })
}

export function voidReceiptIntakeV2(submission = {}) {
	return invoke('voidReceiptIntakeV2', { ...submission })
}

export function getReceiptIntakeOperationV2(params = {}) {
	return invoke('getReceiptIntakeOperationV2', {
		operation_id: normalizeString(params.operation_id)
	})
}

export function listReceiptIntakeV2(params = {}) {
	return invoke('listReceiptIntakeV2', {
		customer_id: normalizeString(params.customer_id),
		date_from: normalizeString(params.date_from),
		date_to: normalizeString(params.date_to),
		include_void: Boolean(params.include_void),
		kind: normalizeString(params.kind),
		purpose: normalizeString(params.purpose),
		cursor: params.cursor ?? '',
		page_size: normalizePageSize(params.page_size, 20),
		export_mode: Boolean(params.export_mode)
	})
}

export function getReceiptIntakeDetailV2(params = {}) {
	return invoke('getReceiptIntakeDetailV2', {
		intake_id: normalizeString(params.intake_id)
	})
}

export function releaseReceiptAllocationsV2(params = {}) {
	return invoke('releaseReceiptAllocationsV2', {
		receipt_id: normalizeString(params.receipt_id),
		customer_id: normalizeString(params.customer_id),
		operation_id: normalizeString(params.operation_id),
		expected_receipt: params.expected_receipt && typeof params.expected_receipt === 'object'
			? params.expected_receipt
			: null
	})
}
