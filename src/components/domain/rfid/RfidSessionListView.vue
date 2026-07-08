<template>
	<AppPage title="RFID 门口盘点" :subtitle="subtitle" icon="search">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="refresh">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="筛选结果" :value="summary.total" hint="次" icon="search" @click="setStatus('all')" />
				<AppStatCard class="summary-card" label="正常会话" :value="summary.complete" hint="次" icon="check-circle" @click="setStatus('complete')" />
				<AppStatCard class="summary-card" label="车辆冲突" :value="summary.conflict" hint="次" icon="alert" @click="setStatus('conflict')" />
				<AppStatCard class="summary-card" label="无车辆" :value="summary.noVehicle" hint="次" icon="minus-circle" @click="setStatus('no_vehicle')" />
			</view>
		</template>

		<view class="rfid-shell">
			<AppSection title="会话筛选">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="resetFilters">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch(true)">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput
						v-model="filters.keyword"
						label="关键词"
						placeholder="会话号/车牌/EPC/读写器"
						prefix-icon="search"
						size="sm"
					/>
					<picker class="picker-block" mode="selector" :range="statusOptions" range-key="label" @change="onStatusChange">
						<AppInput
							:model-value="statusLabel"
							label="会话状态"
							placeholder="全部状态"
							prefix-icon="list"
							disabled
							size="sm"
						/>
					</picker>
				</view>
			</AppSection>

			<AppSection title="盘点会话">
				<template #actions>
					<text class="section-hint">共 {{ pager.total }} 条 · 第 {{ pager.page }} / {{ totalPages }} 页</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无 RFID 盘点会话">
					<template #emptyAction>
						<AppButton size="sm" @click="refresh">重新查询</AppButton>
					</template>

					<AppListItem
						v-for="item in list"
						:key="item._id || item.session_id"
						:title="sessionTitle(item)"
						:subtitle="sessionSubtitle(item)"
						:status="statusText(item.status)"
						:status-kind="statusKind(item.status)"
						icon="search"
						:icon-class="statusIconClass(item.status)"
						clickable
						@click="loadDetail(item)"
					>
						<template #right>
							<view class="count-box">
								<text class="count-box__value">{{ Number(item.bottle_total || 0) }}</text>
								<text class="count-box__label">瓶</text>
							</view>
						</template>

						<template #meta>
							<view class="meta-tags">
								<AppTag :kind="item.vehicle_binding_status === 'bound' ? 'success' : 'warning'">
									{{ item.vehicle_no || item.vehicle_epc || '无车辆' }}
								</AppTag>
								<AppTag kind="soft">读写器 {{ item.reader_device_code || '-' }}</AppTag>
								<AppTag v-if="Number(item.unbound_bottle_total || 0) > 0" kind="warning">
									未绑定 {{ item.unbound_bottle_total }}
								</AppTag>
								<AppTag v-if="Number(item.unknown_total || 0) > 0" kind="danger">
									未知 {{ item.unknown_total }}
								</AppTag>
							</view>
						</template>
					</AppListItem>
				</AppList>

				<view v-if="pager.total > 0" class="pager-row">
					<AppButton size="sm" kind="neutral" :disabled="loading || pager.page <= 1" @click="prevPage">上一页</AppButton>
					<AppButton size="sm" kind="neutral" :disabled="loading || !pager.hasMore" @click="nextPage">下一页</AppButton>
				</view>
			</AppSection>

			<AppSection v-if="detail" title="会话详情">
				<template #actions>
					<AppButton size="sm" kind="ghost" @click="detail = null">收起</AppButton>
				</template>

				<view class="detail-grid">
					<view class="detail-cell">
						<text class="detail-label">车辆</text>
						<text class="detail-value">{{ detail.vehicle_no || detail.vehicle_epc || '无车辆标签' }}</text>
						<view v-if="detail.vehicle_epc && canManageBindings" class="binding-actions">
							<AppButton size="sm" kind="neutral" @click="openBindingPanel('vehicle', { epc: detail.vehicle_epc, serial: detail.vehicle_serial, binding_status: detail.vehicle_binding_status })">
								{{ detail.vehicle_binding_status === 'bound' ? '改绑车辆' : '绑定车辆' }}
							</AppButton>
							<AppButton v-if="detail.vehicle_binding_status === 'bound'" size="sm" kind="ghost" @click="confirmUnbind('vehicle', detail.vehicle_epc)">
								解绑
							</AppButton>
						</view>
					</view>
					<view class="detail-cell">
						<text class="detail-label">会话时间</text>
						<text class="detail-value">{{ formatDateTime(detail.started_at) }} - {{ formatTime(detail.ended_at) }}</text>
					</view>
					<view class="detail-cell">
						<text class="detail-label">会话号</text>
						<text class="detail-value detail-value--mono">{{ detail.session_id }}</text>
					</view>
					<view class="detail-cell">
						<text class="detail-label">网关</text>
						<text class="detail-value">{{ detail.gateway_id || '-' }}</text>
					</view>
				</view>

				<view v-if="bindingPanel.visible" class="binding-panel">
					<view class="binding-panel__head">
						<view>
							<text class="binding-panel__title">{{ bindingPanelTitle }}</text>
							<text class="binding-panel__sub">{{ bindingPanel.epc }}</text>
						</view>
						<AppButton size="sm" kind="ghost" :disabled="bindingPanel.loading" @click="closeBindingPanel">取消</AppButton>
					</view>
					<PdaLookupSuggestField
						v-model="bindingPanel.keyword"
						:label="bindingPanel.entityType === 'vehicle' ? '搜索车辆' : '搜索瓶子'"
						:placeholder="bindingPanel.entityType === 'vehicle' ? '输入车牌号' : '输入瓶号'"
						size="sm"
						:empty-text="bindingPanel.entityType === 'vehicle' ? '未找到匹配车辆' : '未找到匹配瓶子'"
						:fetcher="fetchBindingCandidates"
						:map-item="mapBindingCandidate"
						@select="onBindingCandidateSelect"
					/>
					<view v-if="bindingPanel.selected" class="binding-selected">
						<text class="binding-selected__label">已选</text>
						<text class="binding-selected__value">{{ selectedBindingLabel }}</text>
					</view>
					<view class="binding-panel__actions">
						<AppButton size="sm" kind="primary" :loading="bindingPanel.loading" :disabled="!bindingPanel.selected" @click="submitBinding(false)">确认绑定</AppButton>
					</view>
				</view>

				<view class="detail-block">
					<view class="detail-block__header">
						<text class="detail-block__title">瓶子明细</text>
						<text class="detail-block__hint">{{ detail.bottle_total || 0 }} 个 EPC</text>
					</view>
					<view v-if="detailBottles.length === 0" class="empty-line">没有瓶子标签</view>
					<view v-for="item in detailBottles" :key="item.epc" class="tag-row">
						<view class="tag-row__main">
							<text class="tag-row__title">{{ item.entity_no || item.epc }}</text>
							<text class="tag-row__sub">{{ item.epc }} · 读取 {{ item.read_count || 1 }} 次</text>
						</view>
						<view class="tag-row__side">
							<AppTag :kind="item.binding_status === 'bound' ? 'success' : 'warning'">
								{{ item.binding_status === 'bound' ? '已绑定' : '未绑定' }}
							</AppTag>
							<view v-if="canManageBindings" class="binding-actions binding-actions--row">
								<AppButton size="sm" kind="neutral" @click="openBindingPanel('bottle', item)">
									{{ item.binding_status === 'bound' ? '改绑' : '绑定' }}
								</AppButton>
								<AppButton v-if="item.binding_status === 'bound'" size="sm" kind="ghost" @click="confirmUnbind('bottle', item.epc)">
									解绑
								</AppButton>
							</view>
						</view>
					</view>
				</view>

				<view v-if="detailUnknownTags.length" class="detail-block">
					<view class="detail-block__header">
						<text class="detail-block__title">未知标签</text>
						<text class="detail-block__hint">{{ detailUnknownTags.length }} 个 EPC</text>
					</view>
					<view v-for="item in detailUnknownTags" :key="item.epc" class="tag-row">
						<view class="tag-row__main">
							<text class="tag-row__title">{{ item.epc }}</text>
							<text class="tag-row__sub">{{ item.epc_kind || 'unknown_epc' }} · 读取 {{ item.read_count || 1 }} 次</text>
						</view>
						<AppTag kind="danger">未知</AppTag>
					</view>
				</view>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import PdaLookupSuggestField from '@/components/domain/pda/PdaLookupSuggestField.vue'
import { useQuery } from '@/composables/useQuery'
import { bindRfidEpcV1, getRfidSessionV1, listRfidSessionsV1, unbindRfidEpcV1 } from '@/services/rfid'
import { searchBottlesV1 } from '@/services/bottle'
import { searchVehiclesV1 } from '@/services/vehicle'
import { getUser } from '@/services/auth'

const list = ref([])
const detail = ref(null)
const summary = ref({ total: 0, complete: 0, conflict: 0, noVehicle: 0 })
const currentUser = ref(getUser() || null)
const bindingPanel = reactive({
	visible: false,
	entityType: '',
	epc: '',
	serial: '',
	keyword: '',
	selected: null,
	loading: false
})
const pager = reactive({
	page: 1,
	pageSize: 20,
	total: 0,
	hasMore: false
})

const statusOptions = [
	{ label: '全部状态', value: 'all' },
	{ label: '正常会话', value: 'complete' },
	{ label: '车辆冲突', value: 'conflict' },
	{ label: '无车辆', value: 'no_vehicle' }
]

const filters = reactive({
	keyword: '',
	statusIndex: 0
})

const statusLabel = computed(() => statusOptions[filters.statusIndex]?.label || '全部状态')
const subtitle = computed(() => (pager.total ? `当前筛选 ${pager.total} 次会话` : '车辆门口盘点会话'))
const totalPages = computed(() => Math.max(Math.ceil(Number(pager.total || 0) / Number(pager.pageSize || 20)), 1))
const detailBottles = computed(() => Array.isArray(detail.value?.bottles) ? detail.value.bottles : [])
const detailUnknownTags = computed(() => Array.isArray(detail.value?.unknown_tags) ? detail.value.unknown_tags : [])
const canManageBindings = computed(() => ['superadmin', 'admin'].includes(normalizeRole(currentUser.value?.role_template || currentUser.value?.role)))
const bindingPanelTitle = computed(() => {
	if (bindingPanel.entityType === 'vehicle') return '绑定车辆标签'
	if (bindingPanel.entityType === 'bottle') return '绑定瓶子标签'
	return '绑定 RFID 标签'
})
const selectedBindingLabel = computed(() => {
	const selected = bindingPanel.selected || {}
	if (bindingPanel.entityType === 'vehicle') return selected.plate_no || '-'
	if (bindingPanel.entityType === 'bottle') return selected.bottle_no || '-'
	return '-'
})

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listRfidSessionsV1({
			keyword: filters.keyword,
			status: statusOptions[filters.statusIndex]?.value || 'all',
			page: pager.page,
			pageSize: pager.pageSize
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return {
				items: [],
				paging: { page: 1, pageSize: pager.pageSize, total: 0, hasMore: false },
				summary: { total: 0, complete: 0, conflict: 0, no_vehicle: 0 }
			}
		}
		return {
			items: Array.isArray(res.data) ? res.data : [],
			paging: res.paging || { page: pager.page, pageSize: pager.pageSize, total: Number(res.total || 0), hasMore: false },
			summary: res.summary || { total: 0, complete: 0, conflict: 0, no_vehicle: 0 }
		}
	},
	{
		immediate: false,
		initialData: {
			items: [],
			paging: { page: 1, pageSize: 20, total: 0, hasMore: false },
			summary: { total: 0, complete: 0, conflict: 0, no_vehicle: 0 }
		},
		cacheTTL: 8000,
		throttleMs: 300,
		cacheKey: () => `rfid:sessions:${filters.keyword}:${filters.statusIndex}:${pager.page}:${pager.pageSize}`
	}
)

function applyResult(payload) {
	const data = payload || {}
	list.value = Array.isArray(data.items) ? data.items : []
	const paging = data.paging || {}
	pager.page = Number(paging.page || pager.page || 1)
	pager.pageSize = Number(paging.pageSize || pager.pageSize || 20)
	pager.total = Number(paging.total || 0)
	pager.hasMore = Boolean(paging.hasMore)
	const nextSummary = data.summary || {}
	summary.value = {
		total: Number(nextSummary.total || 0),
		complete: Number(nextSummary.complete || 0),
		conflict: Number(nextSummary.conflict || 0),
		noVehicle: Number(nextSummary.no_vehicle || nextSummary.noVehicle || 0)
	}
}

async function onSearch(resetPage = false) {
	if (resetPage) pager.page = 1
	applyResult(await fetchList({ force: true }))
}

function refresh() {
	return onSearch(false)
}

function resetFilters() {
	filters.keyword = ''
	filters.statusIndex = 0
	detail.value = null
	onSearch(true)
}

function setStatus(status) {
	const index = statusOptions.findIndex((item) => item.value === status)
	filters.statusIndex = index >= 0 ? index : 0
	onSearch(true)
}

function onStatusChange(event) {
	filters.statusIndex = Number(event.detail.value || 0)
	onSearch(true)
}

function prevPage() {
	if (pager.page <= 1) return
	pager.page -= 1
	onSearch(false)
}

function nextPage() {
	if (!pager.hasMore) return
	pager.page += 1
	onSearch(false)
}

async function loadDetail(item) {
	const res = await getRfidSessionV1({ _id: item._id, session_id: item.session_id })
	if (res?.code !== 0) {
		uni.showToast({ title: res?.msg || '加载详情失败', icon: 'none' })
		return
	}
	detail.value = res.data || null
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeRole(value) {
	return normalizeString(value).toLowerCase()
}

function closeBindingPanel() {
	bindingPanel.visible = false
	bindingPanel.entityType = ''
	bindingPanel.epc = ''
	bindingPanel.serial = ''
	bindingPanel.keyword = ''
	bindingPanel.selected = null
	bindingPanel.loading = false
}

function openBindingPanel(entityType, item = {}) {
	if (!canManageBindings.value) {
		uni.showToast({ title: '仅管理员可绑定 RFID', icon: 'none' })
		return
	}
	bindingPanel.visible = true
	bindingPanel.entityType = entityType
	bindingPanel.epc = normalizeString(item.epc || '')
	bindingPanel.serial = normalizeString(item.serial || '')
	bindingPanel.keyword = normalizeString(entityType === 'vehicle' ? detail.value?.vehicle_no : item.entity_no)
	bindingPanel.selected = null
	bindingPanel.loading = false
}

async function fetchBindingCandidates(keyword) {
	const text = normalizeString(keyword)
	if (!text) return []
	if (bindingPanel.entityType === 'vehicle') {
		const res = await searchVehiclesV1({ keyword: text, page: 1, pageSize: 8, is_active: true })
		return res?.code === 0 && Array.isArray(res.data) ? res.data : []
	}
	if (bindingPanel.entityType === 'bottle') {
		const res = await searchBottlesV1({ keyword: text, page: 1, pageSize: 8, is_active: true })
		return res?.code === 0 && Array.isArray(res.data) ? res.data : []
	}
	return []
}

function mapBindingCandidate(item = {}) {
	if (bindingPanel.entityType === 'vehicle') {
		return {
			key: item._id || item.plate_no,
			title: item.plate_no || '-',
			subtitle: item.remark || '',
			raw: item
		}
	}
	return {
		key: item._id || item.bottle_no,
		title: item.bottle_no || '-',
		subtitle: item.current_customer_name || item.status || '',
		raw: item
	}
}

function onBindingCandidateSelect(item) {
	bindingPanel.selected = item || null
	if (bindingPanel.entityType === 'vehicle') bindingPanel.keyword = normalizeString(item?.plate_no)
	else bindingPanel.keyword = normalizeString(item?.bottle_no)
}

function buildConflictMessage(conflicts = []) {
	const rows = Array.isArray(conflicts) ? conflicts : []
	if (!rows.length) return '该标签或档案已有绑定，确认后将停用旧绑定并写入新绑定。'
	const lines = rows.slice(0, 4).map((item) => {
		const typeText = item.kind === 'entity_active_binding' ? '档案已有标签' : '标签已有绑定'
		return `${typeText}: ${item.entity_no || item.entity_id || '-'} / ${item.epc || '-'}`
	})
	return `${lines.join('\n')}\n确认后将停用旧绑定并写入新绑定。`
}

async function reloadCurrentDetail() {
	const current = detail.value
	if (!current) return
	await loadDetail({ _id: current._id, session_id: current.session_id })
	await onSearch(false)
}

async function submitBinding(confirmRebind = false) {
	if (!bindingPanel.selected || !bindingPanel.selected._id) {
		uni.showToast({ title: '请先选择目标档案', icon: 'none' })
		return
	}
	bindingPanel.loading = true
	let res = null
	try {
		res = await bindRfidEpcV1({
			epc: bindingPanel.epc,
			entity_type: bindingPanel.entityType,
			entity_id: bindingPanel.selected._id,
			serial: bindingPanel.serial,
			session_id: detail.value?.session_id || '',
			confirm_rebind: confirmRebind
		})
	} catch (err) {
		uni.showToast({ title: err?.message || '绑定失败', icon: 'none' })
		return
	} finally {
		bindingPanel.loading = false
	}
	if (res?.code === 409) {
		const confirmRes = await uni.showModal({
			title: '确认改绑',
			content: buildConflictMessage(res.data?.conflicts),
			confirmText: '确认改绑',
			cancelText: '取消'
		})
		if (confirmRes.confirm) return submitBinding(true)
		return
	}
	if (res?.code !== 0) {
		uni.showToast({ title: res?.msg || '绑定失败', icon: 'none' })
		return
	}
	uni.showToast({ title: '绑定成功', icon: 'success' })
	closeBindingPanel()
	await reloadCurrentDetail()
}

async function confirmUnbind(entityType, epc) {
	if (!canManageBindings.value) {
		uni.showToast({ title: '仅管理员可解绑 RFID', icon: 'none' })
		return
	}
	const confirmRes = await uni.showModal({
		title: '确认解绑',
		content: '解绑后该标签后续盘点将显示为未绑定，不会影响车辆、瓶子或业务单据。',
		confirmText: '确认解绑',
		cancelText: '取消'
	})
	if (!confirmRes.confirm) return
	const res = await unbindRfidEpcV1({
		epc,
		entity_type: entityType,
		session_id: detail.value?.session_id || ''
	})
	if (res?.code !== 0) {
		uni.showToast({ title: res?.msg || '解绑失败', icon: 'none' })
		return
	}
	uni.showToast({ title: '已解绑', icon: 'success' })
	await reloadCurrentDetail()
}

function statusText(status) {
	if (status === 'complete') return '正常'
	if (status === 'conflict') return '冲突'
	if (status === 'no_vehicle') return '无车辆'
	return '未知'
}

function statusKind(status) {
	if (status === 'complete') return 'success'
	if (status === 'conflict') return 'danger'
	if (status === 'no_vehicle') return 'warning'
	return 'info'
}

function statusIconClass(status) {
	if (status === 'complete') return 'bg-emerald'
	if (status === 'conflict') return 'bg-danger'
	if (status === 'no_vehicle') return 'bg-alert'
	return 'bg-primary'
}

function formatDateTime(value) {
	const ts = Number(value || 0)
	if (!ts) return '-'
	const date = new Date(ts)
	const pad = (num) => String(num).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatTime(value) {
	const ts = Number(value || 0)
	if (!ts) return '-'
	const date = new Date(ts)
	const pad = (num) => String(num).padStart(2, '0')
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function sessionTitle(item) {
	return item.vehicle_no || item.vehicle_epc || '未识别车辆'
}

function sessionSubtitle(item) {
	const time = formatDateTime(item.started_at)
	const reader = item.reader_device_code || '-'
	return `${time} · 读写器 ${reader}`
}

onMounted(() => {
	onSearch(true)
})

defineExpose({ refresh })
</script>

<style scoped>
.summary-row {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 20rpx;
	width: 100%;
}
.summary-card {
	min-width: 0;
}
.rfid-shell {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}
.filter-grid {
	display: grid;
	grid-template-columns: minmax(0, 2fr) minmax(220rpx, 1fr);
	gap: 20rpx;
}
.picker-block {
	display: block;
}
.section-hint {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}
.count-box {
	min-width: 88rpx;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
}
.count-box__value {
	font-size: 34rpx;
	font-weight: 800;
	color: var(--crm-text);
	line-height: 1;
}
.count-box__label {
	margin-top: 6rpx;
	font-size: 22rpx;
	color: var(--crm-text-muted);
}
.meta-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
}
.pager-row {
	margin-top: 20rpx;
	display: flex;
	justify-content: flex-end;
	gap: 16rpx;
}
.detail-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 20rpx;
}
.detail-cell {
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	padding: 18rpx 20rpx;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
	min-width: 0;
}
.detail-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}
.detail-value {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
	word-break: break-all;
}
.detail-value--mono {
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	font-size: 22rpx;
}
.binding-actions {
	margin-top: 12rpx;
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
}
.binding-actions--row {
	margin-top: 0;
	justify-content: flex-end;
}
.binding-panel {
	margin-top: 24rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	padding: 20rpx;
	background: #f8fbff;
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}
.binding-panel__head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16rpx;
}
.binding-panel__title {
	display: block;
	font-size: 28rpx;
	font-weight: 800;
	color: var(--crm-text);
}
.binding-panel__sub {
	display: block;
	margin-top: 6rpx;
	font-size: 22rpx;
	color: var(--crm-text-muted);
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	word-break: break-all;
}
.binding-selected {
	display: flex;
	align-items: center;
	gap: 12rpx;
	font-size: 24rpx;
}
.binding-selected__label {
	color: var(--crm-text-muted);
}
.binding-selected__value {
	font-weight: 800;
	color: var(--crm-text);
}
.binding-panel__actions {
	display: flex;
	justify-content: flex-end;
}
.detail-block {
	margin-top: 24rpx;
	border-top: 1rpx solid var(--crm-border-weak);
	padding-top: 20rpx;
	display: flex;
	flex-direction: column;
	gap: 14rpx;
}
.detail-block__header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 16rpx;
}
.detail-block__title {
	font-size: 28rpx;
	font-weight: 800;
	color: var(--crm-text);
}
.detail-block__hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}
.tag-row {
	display: flex;
	justify-content: space-between;
	gap: 20rpx;
	align-items: flex-start;
	padding: 16rpx 0;
	border-bottom: 1rpx solid var(--crm-border-weak);
}
.tag-row__side {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 12rpx;
	flex-shrink: 0;
}
.tag-row__main {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 6rpx;
}
.tag-row__title {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
	word-break: break-all;
}
.tag-row__sub {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	word-break: break-all;
}
.empty-line {
	font-size: 24rpx;
	color: var(--crm-text-muted);
	padding: 18rpx 0;
}
@media (max-width: 760px) {
	.summary-row,
	.filter-grid,
	.detail-grid {
		grid-template-columns: 1fr;
	}
	.tag-row {
		flex-direction: column;
	}
	.tag-row__side {
		width: 100%;
		align-items: flex-start;
	}
	.binding-actions--row {
		justify-content: flex-start;
	}
	.binding-panel__head {
		flex-direction: column;
	}
}
</style>
