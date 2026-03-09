const COLLECTION_TASK_STATUS = ['open', 'in_progress', 'promised', 'partial_paid', 'paid', 'paused', 'closed']
const COLLECTION_TASK_PRIORITY = ['P0', 'P1', 'P2']
const COLLECTION_FOLLOWUP_ACTION = ['call', 'visit', 'wechat', 'sms', 'other']
const COLLECTION_FOLLOWUP_RESULT = ['promised', 'partial_paid', 'paid', 'no_response', 'dispute']

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function validateCollectionTaskPatchV1(input = {}) {
	const hasStatus = normalizeString(input.status)
	if (hasStatus && !COLLECTION_TASK_STATUS.includes(hasStatus)) {
		return { ok: false, msg: '任务状态无效' }
	}

	const hasPriority = normalizeString(input.priority)
	if (hasPriority && !COLLECTION_TASK_PRIORITY.includes(hasPriority)) {
		return { ok: false, msg: '优先级无效' }
	}
	return { ok: true }
}

function validateCollectionFollowupDraftV1(input = {}) {
	const actionType = normalizeString(input.action_type || input.actionType)
	if (!COLLECTION_FOLLOWUP_ACTION.includes(actionType)) {
		return { ok: false, msg: '跟进方式无效' }
	}

	const result = normalizeString(input.result)
	if (!COLLECTION_FOLLOWUP_RESULT.includes(result)) {
		return { ok: false, msg: '跟进结果无效' }
	}

	const note = normalizeString(input.note)
	if (!note) return { ok: false, msg: '跟进内容必填' }

	const amountCollected = Number(input.amount_collected ?? input.amountCollected ?? 0)
	if (!Number.isFinite(amountCollected) || amountCollected < 0) {
		return { ok: false, msg: '回款金额无效' }
	}

	return { ok: true }
}

export {
	COLLECTION_TASK_STATUS,
	COLLECTION_TASK_PRIORITY,
	COLLECTION_FOLLOWUP_ACTION,
	COLLECTION_FOLLOWUP_RESULT,
	validateCollectionTaskPatchV1,
	validateCollectionFollowupDraftV1
}
