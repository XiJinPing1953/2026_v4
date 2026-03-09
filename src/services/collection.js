import { callCloud } from '@/services/api'

export async function listCollectionTasksV1(params = {}) {
	return callCloud('crm-collection', {
		action: 'listTasksV1',
		data: {
			keyword: params.keyword || '',
			status: params.status || '',
			owner_id: params.owner_id || params.ownerId || '',
			date_from: params.date_from || params.dateFrom || '',
			date_to: params.date_to || params.dateTo || '',
			min_unpaid: params.min_unpaid ?? params.minUnpaid ?? 0,
			page: params.page || 1,
			pageSize: params.pageSize || 50
		}
	})
}

export async function autoCreateCollectionTasksV1(params = {}) {
	return callCloud('crm-collection', {
		action: 'autoCreateTasksV1',
		data: {
			date_from: params.date_from || params.dateFrom || '',
			date_to: params.date_to || params.dateTo || '',
			min_unpaid: params.min_unpaid ?? params.minUnpaid ?? 0
		}
	})
}

export async function getCollectionTaskV1(params = {}) {
	return callCloud('crm-collection', {
		action: 'getTaskV1',
		data: {
			_id: params._id || params.id || params.task_id || params.taskId || ''
		}
	})
}

export async function updateCollectionTaskV1(params = {}) {
	return callCloud('crm-collection', {
		action: 'updateTaskV1',
		data: {
			_id: params._id || params.id || params.task_id || params.taskId || '',
			status: params.status || '',
			priority: params.priority || '',
			owner_id: params.owner_id || params.ownerId || '',
			owner_name: params.owner_name || params.ownerName || '',
			next_followup_at: params.next_followup_at ?? params.nextFollowupAt ?? null,
			latest_note: params.latest_note || params.latestNote || ''
		}
	})
}

export async function listCollectionFollowupsV1(params = {}) {
	return callCloud('crm-collection', {
		action: 'listFollowupsV1',
		data: {
			task_id: params.task_id || params.taskId || '',
			page: params.page || 1,
			pageSize: params.pageSize || 100
		}
	})
}

export async function addCollectionFollowupV1(params = {}) {
	return callCloud('crm-collection', {
		action: 'addFollowupV1',
		data: {
			task_id: params.task_id || params.taskId || '',
			action_type: params.action_type || params.actionType || '',
			result: params.result || '',
			amount_collected: params.amount_collected ?? params.amountCollected ?? 0,
			note: params.note || '',
			next_followup_at: params.next_followup_at ?? params.nextFollowupAt ?? null
		}
	})
}

export async function recalcCollectionTaskV1(params = {}) {
	return callCloud('crm-collection', {
		action: 'recalcTaskV1',
		data: {
			_id: params._id || params.id || params.task_id || params.taskId || ''
		}
	})
}
