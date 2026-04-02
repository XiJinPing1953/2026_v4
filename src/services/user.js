import { callCloud } from '@/services/api'

export async function searchUsersV1(params) {
	return callCloud('crm-user', {
		action: 'listV1',
		data: {
			keyword: params.keyword || '',
			limit: params.limit || 20
		}
	})
}

export async function listManageUsersV1() {
	return callCloud('crm-user', {
		action: 'listManageV1',
		data: {}
	})
}

export async function createUserV1(data) {
	return callCloud('crm-user', {
		action: 'createV1',
		data
	})
}

export async function updateUserRoleV1(data) {
	return callCloud('crm-user', {
		action: 'updateRoleV1',
		data
	})
}

export async function resetUserPasswordV1(data) {
	return callCloud('crm-user', {
		action: 'resetPasswordV1',
		data
	})
}

export async function removeUserV1(data) {
	return callCloud('crm-user', {
		action: 'removeV1',
		data
	})
}

export async function getPermissionRegistryV1() {
	return callCloud('crm-user', {
		action: 'getPermissionRegistryV1',
		data: {}
	})
}

export async function saveUserPermissionsV1(data) {
	return callCloud('crm-user', {
		action: 'savePermissionsV1',
		data
	})
}

export async function backfillUserPermissionsV1() {
	return callCloud('crm-user', {
		action: 'backfillPermissionsV1',
		data: {}
	})
}
