<template>
	<AppPage title="追款详情" :subtitle="subtitle" icon="credit-card">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" @click="onBack">返回</AppButton>
			<AppButton
				size="sm"
				kind="neutral"
				:disabled="loadingTask || loadingFollowups || loadingUsers"
				@click="onRefresh"
			>
				刷新
			</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="应收" :value="summary.amountShould" hint="元" icon="wallet" />
				<AppStatCard class="summary-card" label="已收" :value="summary.amountReceived" hint="元" icon="check-circle" />
				<AppStatCard class="summary-card" label="未收" :value="summary.amountUnpaid" hint="元" icon="alert" />
				<AppStatCard class="summary-card" label="跟进次数" :value="summary.followupCount" hint="次" icon="list" />
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="任务信息">
				<template #actions>
					<AppButton size="sm" kind="neutral" :loading="loadingUsers" :disabled="loadingUsers" @click="onSearchOwners">
						搜人
					</AppButton>
					<AppButton
						size="sm"
						kind="neutral"
						:loading="recalculating"
						:disabled="recalculating || !task"
						@click="onRecalc"
					>
						重算金额
					</AppButton>
					<AppButton size="sm" kind="primary" :loading="savingTask" :disabled="savingTask || !task" @click="onSaveTask">
						保存任务
					</AppButton>
				</template>

				<view v-if="task" class="quick-status">
					<text class="quick-status__label">快捷状态</text>
					<view class="quick-status__actions">
						<AppButton
							v-for="item in quickStatusOptions"
							:key="item.value"
							size="sm"
							:kind="currentStatusValue === item.value ? 'primary' : 'neutral'"
							:disabled="savingTask"
							@click="onQuickStatus(item.value)"
						>
							{{ item.label }}
						</AppButton>
					</view>
				</view>

				<view v-if="task" class="filter-grid">
					<AppInput :model-value="task.customer_name || ''" label="客户" disabled size="sm" />
					<AppInput :model-value="rangeText(task)" label="范围" disabled size="sm" />
					<picker class="picker-block" mode="selector" :range="statusOptions" range-key="label" @change="onTaskStatusChange">
						<view class="picker-trigger">
							<AppInput :model-value="taskStatusLabel" label="任务状态" disabled size="sm" />
						</view>
					</picker>
					<picker class="picker-block" mode="selector" :range="priorityOptions" range-key="label" @change="onTaskPriorityChange">
						<view class="picker-trigger">
							<AppInput :model-value="taskPriorityLabel" label="优先级" disabled size="sm" />
						</view>
					</picker>
					<AppInput
						v-model="ownerKeyword"
						label="负责人搜索"
						placeholder="姓名/账号（回车刷新）"
						size="sm"
						confirm-type="search"
						@confirm="onSearchOwners"
					/>
					<picker class="picker-block" mode="selector" :range="ownerOptions" range-key="label" @change="onTaskOwnerChange">
						<view class="picker-trigger">
							<AppInput :model-value="taskOwnerLabel" label="负责人" disabled size="sm" />
						</view>
					</picker>
					<picker class="picker-block" mode="date" :value="taskForm.nextFollowupDate" @change="onTaskNextFollowupChange">
						<view class="picker-trigger">
							<AppInput :model-value="taskForm.nextFollowupDate" label="下次跟进" placeholder="YYYY-MM-DD" disabled size="sm" />
						</view>
					</picker>
					<AppInput v-model="taskForm.latestNote" label="任务备注" placeholder="备注摘要" size="sm" />
				</view>
				<view v-else class="empty-hint">任务不存在或已删除</view>
			</AppSection>

			<AppSection title="新增跟进">
				<template #actions>
					<AppButton size="sm" kind="primary" :loading="savingFollowup" :disabled="savingFollowup || !task" @click="onAddFollowup">
						提交跟进
					</AppButton>
				</template>

				<view class="filter-grid">
					<picker class="picker-block" mode="selector" :range="actionOptions" range-key="label" @change="onFollowupActionChange">
						<view class="picker-trigger">
							<AppInput :model-value="followupActionLabel" label="跟进方式" disabled size="sm" />
						</view>
					</picker>
					<picker class="picker-block" mode="selector" :range="resultOptions" range-key="label" @change="onFollowupResultChange">
						<view class="picker-trigger">
							<AppInput :model-value="followupResultLabel" label="跟进结果" disabled size="sm" />
						</view>
					</picker>
					<AppInput v-model="followupForm.amountCollected" label="本次回款" placeholder="0.00" size="sm" />
					<picker class="picker-block" mode="date" :value="followupForm.nextFollowupDate" @change="onFollowupNextDateChange">
						<view class="picker-trigger">
							<AppInput :model-value="followupForm.nextFollowupDate" label="下次跟进日期" placeholder="YYYY-MM-DD" disabled size="sm" />
						</view>
					</picker>
				</view>

				<view class="textarea-field">
					<text class="textarea-label">跟进内容</text>
					<textarea
						v-model="followupForm.note"
						class="textarea-control"
						placeholder="记录沟通要点、承诺时间、风险点"
					/>
				</view>
			</AppSection>

			<AppSection title="跟进记录">
				<template #actions>
					<text class="section-hint">共 {{ followupList.length }} 条</text>
				</template>

				<AppList :loading="loadingFollowups" :empty="followupList.length === 0" empty-title="暂无跟进记录">
					<AppListItem
						v-for="item in followupList"
						:key="item._id"
						:title="resultText(item.result)"
						:subtitle="`${actionText(item.action_type)} · ${formatDate(item.created_at)}`"
						:status="item.operator_name || '系统'"
						status-kind="info"
						icon="document"
						icon-class="bg-info"
					>
						<template #meta>
							<view class="meta-tags">
								<AppTag :kind="resultKind(item.result)">{{ resultText(item.result) }}</AppTag>
								<text class="meta-text">回款 {{ formatMoney(item.amount_collected) }}</text>
								<text v-if="item.next_followup_at" class="meta-text">下次 {{ formatDate(item.next_followup_at) }}</text>
							</view>
						</template>
						<template #footer>
							<text class="footer-note">{{ item.note || '-' }}</text>
						</template>
					</AppListItem>
				</AppList>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, reactive, ref, toRef, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import AppTag from '@/components/base/AppTag.vue'
import { useQuery } from '@/composables/useQuery'
import {
	addCollectionFollowupV1,
	getCollectionTaskV1,
	listCollectionFollowupsV1,
	recalcCollectionTaskV1,
	updateCollectionTaskV1
} from '@/services/collection'
import { searchUsersV1 } from '@/services/user'
import {
	validateCollectionFollowupDraftV1,
	validateCollectionTaskPatchV1
} from '@/services/models'

const props = defineProps({
	taskId: { type: String, default: '' }
})

const taskId = toRef(props, 'taskId')
const task = ref(null)
const followupList = ref([])
const users = ref([])
const ownerKeyword = ref('')
const savingTask = ref(false)
const savingFollowup = ref(false)
const recalculating = ref(false)

const statusOptions = [
	{ label: '待跟进', value: 'open' },
	{ label: '跟进中', value: 'in_progress' },
	{ label: '承诺回款', value: 'promised' },
	{ label: '部分回款', value: 'partial_paid' },
	{ label: '已结清', value: 'paid' },
	{ label: '暂停', value: 'paused' },
	{ label: '已关闭', value: 'closed' }
]

const quickStatusOptions = [
	{ label: '待跟进', value: 'open' },
	{ label: '跟进中', value: 'in_progress' },
	{ label: '承诺', value: 'promised' },
	{ label: '部分回款', value: 'partial_paid' },
	{ label: '已结清', value: 'paid' },
	{ label: '暂停', value: 'paused' }
]

const priorityOptions = [
	{ label: '高优先', value: 'P0' },
	{ label: '常规', value: 'P1' },
	{ label: '低优先', value: 'P2' }
]

const actionOptions = [
	{ label: '电话', value: 'call' },
	{ label: '拜访', value: 'visit' },
	{ label: '微信', value: 'wechat' },
	{ label: '短信', value: 'sms' },
	{ label: '其他', value: 'other' }
]

const resultOptions = [
	{ label: '承诺回款', value: 'promised' },
	{ label: '部分回款', value: 'partial_paid' },
	{ label: '已结清', value: 'paid' },
	{ label: '未接通/未响应', value: 'no_response' },
	{ label: '争议处理中', value: 'dispute' }
]

const taskForm = reactive({
	statusIndex: 0,
	priorityIndex: 1,
	ownerIndex: 0,
	nextFollowupDate: '',
	latestNote: ''
})

const followupForm = reactive({
	actionIndex: 0,
	resultIndex: 0,
	amountCollected: '',
	nextFollowupDate: '',
	note: ''
})

const subtitle = computed(() => {
	if (!task.value) return '应收任务与跟进闭环'
	return `${task.value.customer_name || '-'} · ${rangeText(task.value)}`
})

const summary = computed(() => {
	const amountShould = formatMoney(task.value?.amount_should)
	const amountReceived = formatMoney(task.value?.amount_received)
	const amountUnpaid = formatMoney(task.value?.amount_unpaid)
	return {
		amountShould,
		amountReceived,
		amountUnpaid,
		followupCount: followupList.value.length
	}
})

const ownerOptions = computed(() => {
	const map = new Map()
	map.set('', { label: '未分配', value: '', name: '' })
	for (const user of users.value || []) {
		const id = normalizeId(user?._id || user?.id)
		if (!id) continue
		const name = normalizeString(user?.name || user?.username || '') || '未命名用户'
		const role = normalizeString(user?.role || '')
		const label = role ? `${name}（${role}）` : name
		map.set(id, { label, value: id, name })
	}
	const currentOwnerId = normalizeId(task.value?.owner_id)
	const currentOwnerName = normalizeString(task.value?.owner_name)
	if (currentOwnerId && !map.has(currentOwnerId)) {
		map.set(currentOwnerId, {
			label: `${currentOwnerName || '当前负责人'}（离线）`,
			value: currentOwnerId,
			name: currentOwnerName || '当前负责人'
		})
	}
	return Array.from(map.values())
})

const taskStatusLabel = computed(() => statusOptions[taskForm.statusIndex]?.label || '待跟进')
const taskPriorityLabel = computed(() => priorityOptions[taskForm.priorityIndex]?.label || '常规')
const taskOwnerLabel = computed(() => ownerOptions.value[taskForm.ownerIndex]?.label || '未分配')
const followupActionLabel = computed(() => actionOptions[followupForm.actionIndex]?.label || '电话')
const followupResultLabel = computed(() => resultOptions[followupForm.resultIndex]?.label || '承诺回款')
const currentStatusValue = computed(() => statusOptions[taskForm.statusIndex]?.value || 'open')

const { loading: loadingTask, run: fetchTask } = useQuery(
	async () => {
		if (!taskId.value) return null
		const res = await getCollectionTaskV1({ _id: taskId.value })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '加载任务失败', icon: 'none' })
			return null
		}
		return res.data || null
	},
	{ immediate: false, initialData: null }
)

const { loading: loadingFollowups, run: fetchFollowups } = useQuery(
	async () => {
		if (!taskId.value) return []
		const res = await listCollectionFollowupsV1({ taskId: taskId.value, page: 1, pageSize: 200 })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '加载跟进失败', icon: 'none' })
			return []
		}
		return Array.isArray(res.data) ? res.data : []
	},
	{ immediate: false, initialData: [] }
)

const { loading: loadingUsers, run: fetchUsers } = useQuery(
	async () => {
		const res = await searchUsersV1({ keyword: ownerKeyword.value, limit: 50 })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '加载用户失败', icon: 'none' })
			return []
		}
		return Array.isArray(res.data) ? res.data : []
	},
	{
		immediate: false,
		initialData: [],
		cacheTTL: 30000,
		throttleMs: 300,
		cacheKey: () => `collection:users:${ownerKeyword.value}`
	}
)

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeId(value) {
	if (value == null) return ''
	if (typeof value === 'object' && value.$oid) return String(value.$oid).trim()
	return String(value).trim()
}

function findStatusIndex(value) {
	const idx = statusOptions.findIndex((item) => item.value === value)
	return idx >= 0 ? idx : 0
}

function findPriorityIndex(value) {
	const idx = priorityOptions.findIndex((item) => item.value === value)
	return idx >= 0 ? idx : 1
}

function findOwnerIndex(ownerId) {
	const id = normalizeId(ownerId)
	if (!id) return 0
	const idx = ownerOptions.value.findIndex((item) => item.value === id)
	return idx >= 0 ? idx : 0
}

function syncTaskForm(doc) {
	taskForm.statusIndex = findStatusIndex(doc?.status || 'open')
	taskForm.priorityIndex = findPriorityIndex(doc?.priority || 'P1')
	taskForm.ownerIndex = findOwnerIndex(doc?.owner_id)
	taskForm.nextFollowupDate = formatDate(doc?.next_followup_at)
	taskForm.latestNote = doc?.latest_note || ''
}

async function onRefresh() {
	if (!taskId.value) return
	const [taskDoc, followRows, userRows] = await Promise.all([fetchTask(), fetchFollowups(), fetchUsers()])
	task.value = taskDoc || null
	followupList.value = followRows || []
	users.value = userRows || []
	if (task.value) syncTaskForm(task.value)
}

async function onSearchOwners() {
	const currentOwnerId = ownerOptions.value[taskForm.ownerIndex]?.value || normalizeId(task.value?.owner_id)
	const data = await fetchUsers()
	users.value = data || []
	const idx = ownerOptions.value.findIndex((item) => item.value === currentOwnerId)
	taskForm.ownerIndex = idx >= 0 ? idx : 0
}

function normalizeDateToTimestamp(value) {
	if (!value) return null
	const parsed = Date.parse(`${value}T00:00:00`)
	if (!Number.isFinite(parsed) || parsed <= 0) return null
	return parsed
}

async function onSaveTask() {
	if (!task.value || savingTask.value) return
	const owner = ownerOptions.value[taskForm.ownerIndex] || ownerOptions.value[0]
	const patch = {
		status: statusOptions[taskForm.statusIndex]?.value || 'open',
		priority: priorityOptions[taskForm.priorityIndex]?.value || 'P1',
		owner_name: owner?.name || '',
		owner_id: owner?.value || '',
		next_followup_at: normalizeDateToTimestamp(taskForm.nextFollowupDate),
		latest_note: taskForm.latestNote
	}
	const validation = validateCollectionTaskPatchV1(patch)
	if (!validation.ok) {
		uni.showToast({ title: validation.msg || '任务信息校验失败', icon: 'none' })
		return
	}

	savingTask.value = true
	try {
		const res = await updateCollectionTaskV1({ _id: task.value._id, ...patch })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '保存失败', icon: 'none' })
			return
		}
		uni.showToast({ title: '任务已保存', icon: 'success' })
		await onRefresh()
	} finally {
		savingTask.value = false
	}
}

async function onQuickStatus(status) {
	if (!task.value || savingTask.value) return
	if (currentStatusValue.value === status) return
	savingTask.value = true
	try {
		const res = await updateCollectionTaskV1({ _id: task.value._id, status })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '状态更新失败', icon: 'none' })
			return
		}
		uni.showToast({ title: '状态已更新', icon: 'success' })
		await onRefresh()
	} finally {
		savingTask.value = false
	}
}

async function onRecalc() {
	if (!task.value || recalculating.value) return
	recalculating.value = true
	try {
		const res = await recalcCollectionTaskV1({ _id: task.value._id })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '重算失败', icon: 'none' })
			return
		}
		uni.showToast({ title: '金额已重算', icon: 'success' })
		await onRefresh()
	} finally {
		recalculating.value = false
	}
}

function resetFollowupForm() {
	followupForm.actionIndex = 0
	followupForm.resultIndex = 0
	followupForm.amountCollected = ''
	followupForm.nextFollowupDate = ''
	followupForm.note = ''
}

async function onAddFollowup() {
	if (!task.value || savingFollowup.value) return
	const draft = {
		action_type: actionOptions[followupForm.actionIndex]?.value || 'call',
		result: resultOptions[followupForm.resultIndex]?.value || 'promised',
		amount_collected: Number(followupForm.amountCollected || 0),
		note: followupForm.note,
		next_followup_at: normalizeDateToTimestamp(followupForm.nextFollowupDate)
	}
	const validation = validateCollectionFollowupDraftV1(draft)
	if (!validation.ok) {
		uni.showToast({ title: validation.msg || '跟进校验失败', icon: 'none' })
		return
	}

	savingFollowup.value = true
	try {
		const res = await addCollectionFollowupV1({
			taskId: task.value._id,
			...draft
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '提交失败', icon: 'none' })
			return
		}
		uni.showToast({ title: '跟进已提交', icon: 'success' })
		resetFollowupForm()
		await onRefresh()
	} finally {
		savingFollowup.value = false
	}
}

function onTaskStatusChange(e) {
	const idx = Number(e?.detail?.value)
	taskForm.statusIndex = Number.isFinite(idx) ? idx : 0
}

function onTaskPriorityChange(e) {
	const idx = Number(e?.detail?.value)
	taskForm.priorityIndex = Number.isFinite(idx) ? idx : 1
}

function onTaskOwnerChange(e) {
	const idx = Number(e?.detail?.value)
	taskForm.ownerIndex = Number.isFinite(idx) ? idx : 0
}

function onTaskNextFollowupChange(e) {
	taskForm.nextFollowupDate = e?.detail?.value || ''
}

function onFollowupActionChange(e) {
	const idx = Number(e?.detail?.value)
	followupForm.actionIndex = Number.isFinite(idx) ? idx : 0
}

function onFollowupResultChange(e) {
	const idx = Number(e?.detail?.value)
	followupForm.resultIndex = Number.isFinite(idx) ? idx : 0
}

function onFollowupNextDateChange(e) {
	followupForm.nextFollowupDate = e?.detail?.value || ''
}

function rangeText(item) {
	const from = item?.date_from || '-'
	const to = item?.date_to || '-'
	return `${from} ~ ${to}`
}

function formatMoney(value) {
	const num = Number(value || 0)
	return Number.isFinite(num) ? num.toFixed(2) : '0.00'
}

function formatDate(timestamp) {
	const time = Number(timestamp)
	if (!Number.isFinite(time) || time <= 0) return ''
	const d = new Date(time)
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}-${m}-${day}`
}

function actionText(value) {
	const map = {
		call: '电话',
		visit: '拜访',
		wechat: '微信',
		sms: '短信',
		other: '其他'
	}
	return map[value] || '其他'
}

function resultText(value) {
	const map = {
		promised: '承诺回款',
		partial_paid: '部分回款',
		paid: '已结清',
		no_response: '未接通/未响应',
		dispute: '争议处理中'
	}
	return map[value] || '跟进中'
}

function resultKind(value) {
	if (value === 'paid') return 'success'
	if (value === 'partial_paid' || value === 'promised') return 'warning'
	if (value === 'dispute') return 'danger'
	return 'info'
}

function onBack() {
	uni.navigateBack({ delta: 1 })
}

watch(
	taskId,
	async (id) => {
		if (!id) return
		await onRefresh()
	},
	{ immediate: true }
)
</script>

<style scoped>
.list-shell {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.summary-row {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220rpx, 1fr));
	gap: 16rpx;
	width: 100%;
}

:deep(.summary-card .stat__content) {
	align-items: center;
	gap: 16rpx;
}

:deep(.summary-card .stat__value-wrap) {
	align-items: flex-start;
}

:deep(.summary-card .stat__value) {
	text-align: left;
	font-size: 24px;
}

:deep(.summary-card .stat__icon) {
	margin-left: 12rpx;
}

.quick-status {
	display: flex;
	flex-direction: column;
	gap: 10rpx;
	margin-bottom: 12rpx;
}

.quick-status__label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.quick-status__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 10rpx;
}

.filter-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

.picker-block {
	display: block;
	width: 100%;
}

.picker-trigger {
	pointer-events: none;
}

.textarea-field {
	margin-top: 12rpx;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.textarea-label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.textarea-control {
	width: 100%;
	min-height: 160rpx;
	padding: 16rpx 20rpx;
	box-sizing: border-box;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid var(--crm-border);
	background: #fff;
	font-size: 26rpx;
	color: var(--crm-text);
}

.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.meta-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.footer-note {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.section-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.empty-hint {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

@media (max-width: 680px) {
	.summary-row {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

@media (max-width: 420px) {
	.summary-row {
		grid-template-columns: 1fr;
	}
}
</style>
