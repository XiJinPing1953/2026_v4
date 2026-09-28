'use strict'

const crypto = require('crypto')
const path = require('path')
const {
	VERSION: FILLING_OPERATION_VERSION,
	fingerprint: operationFingerprint
} = require('../../uniCloud-alipay/cloudfunctions/crm-filling/fillingOperations')

const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{12,128}$/

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function stableValue(value) {
	if (Array.isArray(value)) return value.map(stableValue)
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.filter((key) => value[key] !== undefined)
				.map((key) => [key, stableValue(value[key])])
		)
	}
	return value
}

function stableClone(value) {
	return JSON.parse(JSON.stringify(stableValue(value)))
}

function sha256Hex(value) {
	return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function sourceIdentity(row, inputPath) {
	const sourceId = normalizeString(row && row.source_id)
	if (sourceId) return `source_id:${sourceId}`
	const resolvedInput = path.resolve(String(inputPath || ''))
	const suppliedLineNo = Number(row && row.source_line_no)
	const lineNo = Number.isInteger(suppliedLineNo) && suppliedLineNo > 0
		? suppliedLineNo
		: Math.max(1, Number(row && row.line_no) || 1)
	return `input_path:${sha256Hex(resolvedInput).slice(0, 32)}:line:${lineNo}`
}

function deriveOperationId(identity) {
	return `fillimp_${sha256Hex(`legacy_filling\0${identity}`).slice(0, 48)}`
}

function buildFrozenPayload(row) {
	const payload = {
		date: row.date,
		bottle_no: row.bottle_no,
		record_type: row.record_type,
		operator: row.operator,
		fill_weight: row.fill_weight,
		remark: row.remark,
		source_type: 'legacy_import'
	}
	const operatorId = normalizeString(row.operator_id)
	if (operatorId) payload.operator_id = operatorId
	return stableClone(payload)
}

function frozenPayloadHash(payload) {
	// Reuse the production operation digest contract. It deliberately excludes
	// operation_id, preview and warning-confirmation flags.
	return operationFingerprint(payload)
}

function buildCreateData(frozenPayload, operationId, respectFlowWarning) {
	return {
		...stableClone(frozenPayload),
		operation_id: operationId,
		...(respectFlowWarning ? {} : { ignore_bottle_flow_warning: true })
	}
}

function sanitizePreviousRecord(record) {
	if (!record || typeof record !== 'object') return null
	const operationId = normalizeString(record.operation_id)
	const frozenPayload = record.frozen_payload && typeof record.frozen_payload === 'object'
		? stableClone(record.frozen_payload)
		: null
	return {
		record_identity: normalizeString(record.record_identity),
		source_id: normalizeString(record.source_id),
		line_no: Number(record.line_no) || 0,
		source_line_no: Number(record.source_line_no) || null,
		operation_id: operationId,
		frozen_payload: frozenPayload,
		frozen_payload_hash: normalizeString(record.frozen_payload_hash),
		dispatched: record.dispatched === true,
		attempt_count: Math.max(0, Number(record.attempt_count) || 0),
		first_dispatched_at: normalizeString(record.first_dispatched_at),
		last_attempt_at: normalizeString(record.last_attempt_at),
		last_confirmed_at: normalizeString(record.last_confirmed_at),
		state: normalizeString(record.state),
		accepted: record.accepted === true,
		source_saved: record.source_saved === true,
		post_processing_complete: record.post_processing_complete === true,
		operation_status: normalizeString(record.operation_status),
		source_record_id: normalizeString(record.source_record_id),
		last_code: record.last_code === null || record.last_code === undefined || record.last_code === ''
			? null
			: (Number.isFinite(Number(record.last_code)) ? Number(record.last_code) : null),
		message: normalizeString(record.message),
		warning: normalizeString(record.warning),
		recovery_note: normalizeString(record.recovery_note)
	}
}

function prepareOperationRecord(row, inputPath, previousRecord) {
	const identity = sourceIdentity(row, inputPath)
	const previous = sanitizePreviousRecord(previousRecord)
	const hasFrozenAttempt = Boolean(previous && previous.dispatched)
	const derivedOperationId = deriveOperationId(identity)
	const operationId = hasFrozenAttempt ? previous.operation_id : derivedOperationId
	const currentPayload = buildFrozenPayload(row)
	const currentHash = frozenPayloadHash(currentPayload)
	let conflict = ''
	let frozenPayload = currentPayload
	let retainedHash = currentHash

	if (!OPERATION_ID_PATTERN.test(operationId)) {
		conflict = '恢复记录中的 operation_id 无效，已停止该源记录以避免生成新业务'
	} else if (hasFrozenAttempt) {
		if (previous.record_identity && previous.record_identity !== identity) {
			conflict = '同一输入位置的源记录标识已变化，不能沿用原 operation_id'
			frozenPayload = previous.frozen_payload || currentPayload
			retainedHash = previous.frozen_payload_hash || currentHash
		} else if (!previous.frozen_payload || !previous.frozen_payload_hash) {
			conflict = '恢复记录缺少冻结提交内容，已停止该源记录以避免不确定重放'
		} else {
			frozenPayload = previous.frozen_payload
			retainedHash = previous.frozen_payload_hash
			const recordedHash = frozenPayloadHash(previous.frozen_payload)
			if (recordedHash !== previous.frozen_payload_hash) {
				conflict = '恢复记录的冻结提交内容校验失败，已停止该源记录'
			} else if (currentHash !== previous.frozen_payload_hash) {
				conflict = '同一源记录的输入已发生实质变化，不能沿用原 operation_id'
			} else {
				frozenPayload = previous.frozen_payload
			}
		}
	}

	return {
		record_identity: identity,
		source_id: normalizeString(row.source_id),
		line_no: Number(row.line_no) || 0,
		source_line_no: Number(row.source_line_no) || null,
		signature: normalizeString(row.signature),
		operation_id: operationId,
		frozen_payload: stableClone(frozenPayload),
		frozen_payload_hash: retainedHash,
		dispatched: hasFrozenAttempt,
		attempt_count: previous ? previous.attempt_count : 0,
		first_dispatched_at: previous ? previous.first_dispatched_at : '',
		last_attempt_at: previous ? previous.last_attempt_at : '',
		last_confirmed_at: previous ? previous.last_confirmed_at : '',
		state: conflict ? 'local_conflict' : 'planned',
		accepted: false,
		source_saved: false,
		post_processing_complete: false,
		operation_status: '',
		source_record_id: '',
		last_code: conflict ? 409 : null,
		message: conflict,
		warning: previous ? previous.warning : '',
		recovery_note: previous ? previous.recovery_note : '',
		local_conflict: conflict
	}
}

function classifyOperationStatus(response, operationId, expectedPayloadHash) {
	if (!response || response.code !== 0) {
		return {
			confirmed: false,
			code: response && Number.isFinite(Number(response.code)) ? Number(response.code) : null,
			message: normalizeString(response && response.msg) || '操作状态查询失败'
		}
	}
	const data = response.data && typeof response.data === 'object' ? response.data : {}
	if (normalizeString(data.operation_id) !== operationId) {
		return { confirmed: false, code: 0, message: '操作状态返回了不匹配的 operation_id' }
	}
	if (normalizeString(data.rule_version) !== FILLING_OPERATION_VERSION) {
		return { confirmed: false, code: 0, message: '操作状态协议版本不匹配' }
	}
	if (!expectedPayloadHash || normalizeString(data.input_hash) !== expectedPayloadHash) {
		return { confirmed: false, accepted: true, code: 0, message: '操作内容摘要与冻结源记录不一致或缺失，停止重放并等待核查' }
	}
	const sourceRecords = Array.isArray(data.source_records) ? data.source_records : []
	if (Number(data.accepted_total) !== 1 || sourceRecords.length !== 1) {
		return {
			confirmed: false,
			accepted: true,
			code: 0,
			operation_status: normalizeString(data.status),
			message: '操作状态没有返回单条导入所需的完整源单检查结果'
		}
	}
	const verifiedSources = sourceRecords.filter((row) => (
		row && normalizeString(row._id) && row.saved === true && row.version_matches === true
	))
	const mismatchedSources = sourceRecords.filter((row) => (
		row && row.saved === true && (!normalizeString(row._id) || row.version_matches !== true)
	))
	const sourceSavedTotal = Number(data.source_saved_total)
	const sourceSaved = sourceSavedTotal >= 1 && verifiedSources.length >= 1
	const operationStatus = normalizeString(data.status)
	const completeClaimed = data.complete === true
	if (mismatchedSources.length > 0) {
		return {
			confirmed: true,
			accepted: true,
			code: 0,
			state: 'conflict',
			source_saved: false,
			post_processing_complete: false,
			operation_status: operationStatus,
			source_record_id: '',
			message: '源单已存在但版本或操作关联不匹配，不能计为本次保存成功'
		}
	}
	if (completeClaimed && !sourceSaved) {
		return {
			confirmed: false,
			accepted: true,
			code: 0,
			operation_status: operationStatus,
			message: '后台声称处理完成，但未返回匹配版本的已保存源单证据'
		}
	}
	const operationFailed = operationStatus === 'failed'
	const state = operationFailed
		? 'operation_failed'
		: completeClaimed && sourceSaved
			? 'complete'
			: sourceSaved
				? 'saved_processing'
				: 'accepted_pending_save'
	return {
		confirmed: true,
		accepted: true,
		code: 0,
		state,
		source_saved: sourceSaved,
		post_processing_complete: completeClaimed && sourceSaved,
		operation_status: operationStatus,
		source_record_id: sourceSaved ? normalizeString(verifiedSources[0]._id) : '',
		message: normalizeString(response.msg),
		last_error: normalizeString(data.last_error)
	}
}

module.exports = {
	FILLING_OPERATION_VERSION,
	OPERATION_ID_PATTERN,
	stableValue,
	sha256Hex,
	sourceIdentity,
	deriveOperationId,
	buildFrozenPayload,
	frozenPayloadHash,
	buildCreateData,
	sanitizePreviousRecord,
	prepareOperationRecord,
	classifyOperationStatus
}
