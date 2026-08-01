<template>
	<AppPage title="用户管理" subtitle="仅超级管理员可见" icon="user">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :loading="backfilling" @click="onBackfill">回填权限</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onRefresh">刷新</AppButton>
		</template>

		<view class="user-view">
			<AppSection title="新增用户">
				<view class="autofill-trap" aria-hidden="true">
					<input type="text" name="username" autocomplete="username" />
					<input type="password" name="password" autocomplete="current-password" />
				</view>
				<view class="form-grid">
					<AppInput
						v-model="createForm.username"
						label="账号"
						placeholder="至少 3 位"
						size="sm"
						name="crm_user_create_account"
						autocomplete="new-password"
					/>
					<AppInput
						v-model="createForm.nickname"
						label="昵称"
						placeholder="最多 20 字"
						size="sm"
						name="crm_user_create_nickname"
						autocomplete="off"
					/>
					<AppInput
						v-model="createForm.password"
						label="密码"
						placeholder="至少 6 位"
						type="password"
						size="sm"
						name="crm_user_create_secret"
						autocomplete="new-password"
					/>
					<view class="picker-field">
						<text class="picker-label">角色模板</text>
						<picker class="picker-block" mode="selector" :range="roleOptions" range-key="label" @change="onCreateRoleChange">
							<view class="picker-tap">
								<AppInput :model-value="createRoleLabel" disabled size="sm" />
							</view>
						</picker>
					</view>
				</view>
				<view class="section-actions">
					<AppButton size="sm" kind="primary" :loading="creating" @click="onCreate">新增用户</AppButton>
				</view>
			</AppSection>

			<AppSection title="用户列表">
				<AppTable
					:loading="loading"
					:rows="users"
					:columns="userColumns"
					row-key="_id"
					empty-title="暂无用户"
				>
					<template #cell-role_template="{ row }">
						<text>{{ roleText(row.role_template || row.role) }}</text>
					</template>
					<template #cell-created_at="{ row }">
						<text>{{ formatDateTime(row.created_at) }}</text>
					</template>
					<template #cell-actions="{ row }">
						<view class="table-actions">
							<AppButton size="sm" kind="ghost" @click="onSelect(row)">权限</AppButton>
							<AppButton size="sm" kind="ghost" @click="onPrepareReset(row)">重置密码</AppButton>
							<AppButton
								size="sm"
								kind="outline"
								:disabled="!canRemove(row)"
								@click="onRemove(row)"
							>
								删除
							</AppButton>
						</view>
					</template>
				</AppTable>
			</AppSection>

			<AppSection v-if="selectedUser" :title="`编辑权限 · ${selectedUser.username}`">
				<view class="form-grid">
					<view class="picker-field">
						<text class="picker-label">角色模板</text>
						<picker class="picker-block" mode="selector" :range="roleOptions" range-key="label" @change="onSelectedRoleChange">
							<view class="picker-tap">
								<AppInput :model-value="selectedRoleLabel" :disabled="isSelectedSuperAdmin" size="sm" />
							</view>
						</picker>
					</view>
					<AppInput
						v-model="selectedNickname"
						label="昵称"
						placeholder="最多 20 字"
						size="sm"
						name="crm-user-edit-nickname"
						autocomplete="off"
						:disabled="isSelectedSuperAdmin"
					/>
					<AppInput
						v-model="resetPassword"
						label="重置密码"
						placeholder="留空则不修改"
						type="password"
						size="sm"
						name="crm-user-reset-password"
						autocomplete="new-password"
						:disabled="isSelectedSuperAdmin"
					/>
				</view>
				<view v-if="isSelectedSuperAdmin" class="superadmin-tip">超级管理员固定全权，不支持单独修改权限或角色。</view>
				<view v-else-if="isSelectedSafetyInspector" class="superadmin-tip">
					安全巡检员固定拥有入户巡检、厂站巡检和隐患整改权限；两类巡检的导出页可分别授权，CRM、PDA、销售等权限仍保持关闭。
				</view>
				<view class="section-actions">
					<AppButton size="sm" kind="neutral" :disabled="isSelectedSuperAdmin || isSelectedSafetyInspector" @click="onResetSelectedTemplate">按角色模板重置</AppButton>
					<AppButton size="sm" kind="outline" :loading="resettingPassword" :disabled="isSelectedSuperAdmin || !resetPassword.trim()" @click="onResetPassword">
						提交新密码
					</AppButton>
					<AppButton size="sm" kind="primary" :loading="savingPermissions" :disabled="isSelectedSuperAdmin" @click="onSavePermissions">保存权限</AppButton>
				</view>
				<scroll-view scroll-x class="permission-scroll">
					<view class="permission-matrix">
						<view class="permission-row permission-row--head">
							<text class="permission-cell permission-cell--page">页面</text>
							<text class="permission-cell">查</text>
							<text class="permission-cell">增</text>
							<text class="permission-cell">改</text>
							<text class="permission-cell">删</text>
						</view>
						<view v-for="page in registryPages" :key="page.pagePath" class="permission-row">
							<view class="permission-cell permission-cell--page permission-cell--page-label">
								<text class="permission-page__name">{{ page.label }}</text>
								<text class="permission-page__path">{{ page.pagePath }}</text>
							</view>
							<label class="permission-cell permission-toggle">
								<switch
									:checked="getPermissionChecked(page.pagePath, 'view')"
									:disabled="isSelectedSuperAdmin || !isPermissionEditable(page)"
									@change="(e) => onTogglePermission(page.pagePath, 'view', e.detail.value)"
									color="#1677ff"
								/>
							</label>
							<view class="permission-cell permission-toggle">
								<switch
									v-if="page.supports?.create"
									:checked="getPermissionChecked(page.pagePath, 'create')"
									:disabled="isSelectedSuperAdmin || !isPermissionEditable(page)"
									@change="(e) => onTogglePermission(page.pagePath, 'create', e.detail.value)"
									color="#1677ff"
								/>
								<text v-else class="permission-na">—</text>
							</view>
							<view class="permission-cell permission-toggle">
								<switch
									v-if="page.supports?.update"
									:checked="getPermissionChecked(page.pagePath, 'update')"
									:disabled="isSelectedSuperAdmin || !isPermissionEditable(page)"
									@change="(e) => onTogglePermission(page.pagePath, 'update', e.detail.value)"
									color="#1677ff"
								/>
								<text v-else class="permission-na">—</text>
							</view>
							<view class="permission-cell permission-toggle">
								<switch
									v-if="page.supports?.delete"
									:checked="getPermissionChecked(page.pagePath, 'delete')"
									:disabled="isSelectedSuperAdmin || !isPermissionEditable(page)"
									@change="(e) => onTogglePermission(page.pagePath, 'delete', e.detail.value)"
									color="#1677ff"
								/>
								<text v-else class="permission-na">—</text>
							</view>
						</view>
					</view>
				</scroll-view>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppTable from '@/components/base/AppTable.vue'
import { useQuery } from '@/composables/useQuery'
import {
	backfillUserPermissionsV1,
	createUserV1,
	getPermissionRegistryV1,
	listManageUsersV1,
	removeUserV1,
	resetUserPasswordV1,
	saveUserPermissionsV1
} from '@/services/user'
import { buildRoleTemplatePermissions, normalizeRoleTemplate } from '@/services/pageAclRegistry'
import { getUser } from '@/services/auth'

const currentUser = ref(getUser() || null)
const users = ref([])
const registryPages = ref([])
const selectedUserId = ref('')
const selectedRoleTemplate = ref('user')
const selectedPagePermissions = ref({})
const selectedNickname = ref('')
const resetPassword = ref('')
const creating = ref(false)
const backfilling = ref(false)
const savingPermissions = ref(false)
const resettingPassword = ref(false)

const createForm = ref({
	username: '',
	nickname: '',
	password: '',
	role_template: 'user'
})

const roleOptions = [
	{ label: '超级管理员', value: 'superadmin' },
	{ label: '管理员', value: 'admin' },
	{ label: '财务', value: 'finance' },
	{ label: 'PDA 操作员', value: 'pda_operator' },
	{ label: '安全巡检员', value: 'safety_inspector' },
	{ label: '普通用户', value: 'user' }
]

const userColumns = [
	{ key: 'username', label: '账号', width: '200rpx' },
	{ key: 'nickname', label: '昵称', width: '180rpx' },
	{ key: 'role_template', label: '角色', width: '160rpx' },
	{ key: 'created_at', label: '创建时间', width: '220rpx' },
	{ key: 'actions', label: '操作', width: '340rpx' }
]

const createRoleLabel = computed(() => roleText(createForm.value.role_template))
const selectedUser = computed(() => users.value.find((item) => item._id === selectedUserId.value) || null)
const selectedRoleLabel = computed(() => roleText(selectedRoleTemplate.value))
const isSelectedSuperAdmin = computed(
	() => normalizeRoleTemplate(selectedUser.value?.role_template || selectedUser.value?.role || '') === 'superadmin'
)
const isSelectedSafetyInspector = computed(
	() => normalizeRoleTemplate(selectedRoleTemplate.value) === 'safety_inspector'
)

const { loading, run: fetchData } = useQuery(
	async () => {
		const [userRes, registryRes] = await Promise.all([listManageUsersV1(), getPermissionRegistryV1()])
		if (userRes?.code !== 0) throw new Error(userRes?.msg || '加载用户失败')
		if (registryRes?.code !== 0) throw new Error(registryRes?.msg || '加载权限注册表失败')
		return {
			users: Array.isArray(userRes.data) ? userRes.data : [],
			pages: Array.isArray(registryRes.data?.pages) ? registryRes.data.pages : []
		}
	},
	{
		immediate: true,
		onSuccess(result) {
			users.value = result?.users || []
			registryPages.value = result?.pages || []
			if (selectedUserId.value) {
				const latest = users.value.find((item) => item._id === selectedUserId.value)
				if (latest) applySelectedUser(latest)
				else clearSelection()
			}
		},
		onError(err) {
			uni.showToast({ title: err?.message || '加载失败', icon: 'none' })
		}
	}
)

function roleText(value) {
	const role = normalizeRoleTemplate(value)
	return roleOptions.find((item) => item.value === role)?.label || role || '-'
}

function formatDateTime(value) {
	if (!value) return '-'
	const ts = Number(value)
	if (!Number.isFinite(ts) || ts <= 0) return '-'
	const date = new Date(ts)
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const hh = String(date.getHours()).padStart(2, '0')
	const mm = String(date.getMinutes()).padStart(2, '0')
	return `${y}-${m}-${d} ${hh}:${mm}`
}

function clonePermissions(value) {
	return JSON.parse(JSON.stringify(value || {}))
}

function applySelectedUser(user) {
	selectedUserId.value = user?._id || ''
	selectedRoleTemplate.value = normalizeRoleTemplate(user?.role_template || user?.role || 'user')
	selectedPagePermissions.value = clonePermissions(
		user?.page_permissions || buildRoleTemplatePermissions(selectedRoleTemplate.value)
	)
	selectedNickname.value = String(user?.nickname || '').trim()
	resetPassword.value = ''
}

function clearSelection() {
	selectedUserId.value = ''
	selectedRoleTemplate.value = 'user'
	selectedPagePermissions.value = {}
	selectedNickname.value = ''
	resetPassword.value = ''
}

function onSelect(user) {
	applySelectedUser(user)
}

function onCreateRoleChange(event) {
	const index = Number(event?.detail?.value || 0)
	createForm.value.role_template = roleOptions[index]?.value || 'user'
}

function onSelectedRoleChange(event) {
	const index = Number(event?.detail?.value || 0)
	selectedRoleTemplate.value = roleOptions[index]?.value || 'user'
	if (selectedRoleTemplate.value === 'safety_inspector') {
		selectedPagePermissions.value = clonePermissions(buildRoleTemplatePermissions('safety_inspector'))
	}
}

function onResetSelectedTemplate() {
	selectedPagePermissions.value = clonePermissions(buildRoleTemplatePermissions(selectedRoleTemplate.value))
}

function getPermissionChecked(pagePath, action) {
	return Boolean(selectedPagePermissions.value?.[pagePath]?.[action])
}

function isPermissionEditable(page) {
	if (!isSelectedSafetyInspector.value) return true
	return (
		['/pages/home-safety-inspection/export', '/pages/station-safety-inspection/export'].includes(page?.pagePath) &&
		Boolean(page?.supports?.view)
	)
}

function onTogglePermission(pagePath, action, checked) {
	const next = clonePermissions(selectedPagePermissions.value)
	if (!next[pagePath]) next[pagePath] = { view: false, create: false, update: false, delete: false }
	next[pagePath][action] = Boolean(checked)
	if (action === 'view' && !checked) {
		next[pagePath].create = false
		next[pagePath].update = false
		next[pagePath].delete = false
	}
	if (action !== 'view' && checked) next[pagePath].view = true
	selectedPagePermissions.value = next
}

function canRemove(user) {
	if (!user?._id) return false
	if (user._id === currentUser.value?._id) return false
	return normalizeRoleTemplate(user.role_template || user.role) !== 'superadmin'
}

async function onCreate() {
	const username = String(createForm.value.username || '').trim()
	const nickname = String(createForm.value.nickname || '').trim()
	const password = String(createForm.value.password || '').trim()
	if (!nickname) {
		uni.showToast({ title: '请填写昵称', icon: 'none' })
		return
	}
	if (nickname.length > 20) {
		uni.showToast({ title: '昵称最多20个字', icon: 'none' })
		return
	}
	if (username.length < 3 || password.length < 6) {
		uni.showToast({ title: '账号至少3位，密码至少6位', icon: 'none' })
		return
	}
	creating.value = true
	try {
		const res = await createUserV1({
			...createForm.value,
			username,
			nickname,
			password
		})
		if (res?.code !== 0) throw new Error(res?.msg || '创建失败')
		uni.showToast({ title: '创建成功', icon: 'success' })
		createForm.value = { username: '', nickname: '', password: '', role_template: 'user' }
		await fetchData({ force: true })
	} catch (err) {
		uni.showToast({ title: err?.message || '创建失败', icon: 'none' })
	} finally {
		creating.value = false
	}
}

async function onResetPassword() {
	if (!selectedUser.value?._id) return
	const password = String(resetPassword.value || '').trim()
	if (password.length < 6) {
		uni.showToast({ title: '密码至少6位', icon: 'none' })
		return
	}
	resettingPassword.value = true
	try {
		const res = await resetUserPasswordV1({ userId: selectedUser.value._id, password })
		if (res?.code !== 0) throw new Error(res?.msg || '重置失败')
		uni.showToast({ title: '密码已重置', icon: 'success' })
		resetPassword.value = ''
	} catch (err) {
		uni.showToast({ title: err?.message || '重置失败', icon: 'none' })
	} finally {
		resettingPassword.value = false
	}
}

async function onSavePermissions() {
	if (!selectedUser.value?._id) return
	const nickname = String(selectedNickname.value || '').trim()
	if (!nickname) {
		uni.showToast({ title: '请填写昵称', icon: 'none' })
		return
	}
	if (nickname.length > 20) {
		uni.showToast({ title: '昵称最多20个字', icon: 'none' })
		return
	}
	savingPermissions.value = true
	try {
		const res = await saveUserPermissionsV1({
			userId: selectedUser.value._id,
			nickname,
			role_template: selectedRoleTemplate.value,
			page_permissions: selectedPagePermissions.value
		})
		if (res?.code !== 0) throw new Error(res?.msg || '保存失败')
		uni.showToast({ title: '权限已保存', icon: 'success' })
		await fetchData({ force: true })
	} catch (err) {
		uni.showToast({ title: err?.message || '保存失败', icon: 'none' })
	} finally {
		savingPermissions.value = false
	}
}

async function onBackfill() {
	backfilling.value = true
	try {
		const res = await backfillUserPermissionsV1()
		if (res?.code !== 0) throw new Error(res?.msg || '回填失败')
		uni.showToast({ title: res?.msg || '回填完成', icon: 'success' })
		await fetchData({ force: true })
	} catch (err) {
		uni.showToast({ title: err?.message || '回填失败', icon: 'none' })
	} finally {
		backfilling.value = false
	}
}

async function onRemove(user) {
	if (!canRemove(user)) return
	const confirmed = await new Promise((resolve) => {
		uni.showModal({
			title: '删除用户',
			content: `确定删除账号“${user.username}”吗？`,
			success: (res) => resolve(Boolean(res.confirm)),
			fail: () => resolve(false)
		})
	})
	if (!confirmed) return
	try {
		const res = await removeUserV1({ userId: user._id })
		if (res?.code !== 0) throw new Error(res?.msg || '删除失败')
		uni.showToast({ title: '已删除', icon: 'success' })
		if (selectedUserId.value === user._id) clearSelection()
		await fetchData({ force: true })
	} catch (err) {
		uni.showToast({ title: err?.message || '删除失败', icon: 'none' })
	}
}

function onPrepareReset(user) {
	applySelectedUser(user)
	resetPassword.value = ''
	uni.showToast({ title: `已切换到 ${user.username}`, icon: 'none' })
}

function onRefresh() {
	fetchData({ force: true })
}

defineExpose({
	refresh: onRefresh
})
</script>

<style scoped>
.user-view {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.autofill-trap {
	position: absolute;
	width: 0;
	height: 0;
	overflow: hidden;
	opacity: 0;
	pointer-events: none;
}

.autofill-trap input {
	width: 0;
	height: 0;
	border: 0;
	padding: 0;
	margin: 0;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 16rpx;
}

.picker-field {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.picker-label {
	font-size: 24rpx;
	color: var(--crm-text);
}

.picker-block,
.picker-tap {
	display: block;
	width: 100%;
}

.section-actions {
	margin-top: 16rpx;
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
}

.superadmin-tip {
	margin-top: 16rpx;
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.table-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8rpx;
}

.permission-scroll {
	width: 100%;
	margin-top: 16rpx;
}

.permission-matrix {
	min-width: 980rpx;
	display: flex;
	flex-direction: column;
	border: 1rpx solid var(--crm-border);
	border-radius: 20rpx;
	overflow: hidden;
	background: #fff;
}

.permission-row {
	display: grid;
	grid-template-columns: 1.8fr repeat(4, 160rpx);
	border-top: 1rpx solid var(--crm-border-weak);
}

.permission-row:first-child {
	border-top: none;
}

.permission-row--head {
	background: rgba(22, 119, 255, 0.08);
}

.permission-cell {
	padding: 16rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 24rpx;
	color: var(--crm-text);
}

.permission-cell--page {
	justify-content: flex-start;
}

.permission-cell--page-label {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 6rpx;
}

.permission-page__name {
	font-weight: 600;
}

.permission-page__path {
	font-size: 20rpx;
	color: var(--crm-text-muted);
}

.permission-toggle {
	min-height: 100%;
}

.permission-na {
	font-size: 30rpx;
	line-height: 1;
	color: var(--crm-text-muted);
}

@media (max-width: 1200px) {
	.form-grid {
		grid-template-columns: 1fr;
	}
}
</style>
