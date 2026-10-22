<template>
	<AppPage class="pda-compact-page pda-compact-page--inner" title="钢瓶查询" icon="bottle" hideBottleQuery>
		<view class="query-tabs">
			<AppButton :kind="tab === 'bottle' ? 'primary' : 'neutral'" @click="tab = 'bottle'">钢瓶档案</AppButton>
			<AppButton v-if="canMovement" :kind="tab === 'movement' ? 'primary' : 'neutral'" @click="openMovement(filters.keyword)">流转记录</AppButton>
		</view>
		<text v-if="isNative" class="section-hint">{{ scannerReady ? '按扫描键查询钢瓶' : '可输入瓶号查询，扫描头未就绪' }}</text>
		<PdaMovementQueryView v-if="tab === 'movement' && canMovement" :key="movementVersion" embedded :initial-bottle-no="movementBottle" @bottle="showBottle" />
		<template v-else>
		<AppSection :title="isNative ? '查钢瓶' : '筛选'">
			<view :class="['filters', isNative && !moreFilters && 'filters--simple']">
				<AppInput v-model="filters.keyword" :label="isNative ? '瓶号' : '瓶号 / 关键词'" placeholder="请输入瓶号" @confirm="runSearch" />
				<picker v-if="!isNative || moreFilters" class="picker-block" mode="selector" :range="statusOptions" range-key="label" @change="onStatusChange">
					<view class="picker-trigger">
						<AppInput :model-value="statusLabel" label="流向" readonly />
					</view>
				</picker>
			</view>
			<view class="actions-row">
				<AppButton @click="runSearch">查询</AppButton>
				<AppButton v-if="isNative" kind="ghost" @click="moreFilters = !moreFilters">{{ moreFilters ? '收起条件' : '更多条件' }}</AppButton>
				<AppButton kind="neutral" @click="resetSearch">重置</AppButton>
			</view>
		</AppSection>

		<AppSection title="查询结果">
			<template #actions>
				<text class="section-hint">共 {{ paging.total }} 条</text>
			</template>
			<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无钢瓶数据">
				<AppListItem
					v-for="item in list"
					:key="item._id || item.bottle_no"
					:title="item.bottle_no || '-'"
					:subtitle="item.current_customer_name || '当前无客户占用'"
					icon="bottle"
				>
					<template #meta>
						<view class="meta-row">
							<AppTag kind="soft">{{ isNative ? statusText(item.status) : item.status || 'unknown' }}</AppTag>
							<text class="meta-text">空瓶重 {{ formatWeight(item.tare_weight) }} kg</text>
							<text class="meta-text">检验 {{ item.bottle_next_check_date || item.bottle_check_date || '-' }}</text>
						</view>
					</template>
					<template #footer>
						<view class="item-actions">
							<AppButton v-if="canMovement" size="sm" kind="neutral" @click="openMovement(item.bottle_no)">流转记录</AppButton>
						</view>
					</template>
				</AppListItem>
			</AppList>
			<AppButton v-if="paging.hasMore" kind="neutral" :disabled="loading" @click="loadMore">加载更多</AppButton>
		</AppSection>
		</template>
	</AppPage>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppTag from '@/components/base/AppTag.vue'
import { queryPdaBottleArchive } from '@/services/pda/bottle'
import { formatWeight, normalizeText } from '@/services/pda/shared'

import PdaMovementQueryView from './PdaMovementQueryView.vue'
import { canViewPage } from '@/services/pageAcl'
import { isPdaAppMode } from '@/services/pda/entry'
import { usePdaQueryScan } from '@/composables/pda/usePdaQueryScan'

const props = defineProps({
	initialKeyword: { type: String, default: '' }
})

const filters = reactive({
	keyword: '',
	statusIndex: 0
})
const loading = ref(false)
const list = ref([])
const paging = ref({ page: 1, pageSize: 20, total: 0, hasMore: false })

const moreFilters = ref(false)
const statusText = status => statusOptions.find(item => item.value === status)?.label || '未知'
const tab = ref('bottle')
const movementBottle = ref('')
const movementVersion = ref(0)
const canMovement = canViewPage('/pages/pda/movement-query')
const isNative = isPdaAppMode()
let queryVersion = 0
let searchedFilters = null
function invalidateQuery() { queryVersion += 1; loading.value = false; list.value = []; paging.value = { page: 1, pageSize: 20, total: 0, hasMore: false }; searchedFilters = null; movementVersion.value += 1; tab.value = 'bottle' }
const { scannerReady, activate, deactivate: stopScanner, invalidate: invalidateScan } = usePdaQueryScan({ onStart: invalidateQuery, onBottle: showBottle })
function deactivate() { invalidateQuery(); return stopScanner() }
defineExpose({ activate, deactivate })
onBeforeUnmount(() => { queryVersion += 1 })
function showBottle(bottleNo, id) { tab.value = 'bottle'; filters.keyword = bottleNo; filters.statusIndex = 0; runSearch({ id }) }
function openMovement(bottleNo) { invalidateScan(); queryVersion += 1; loading.value = false; movementBottle.value = bottleNo || ''; movementVersion.value += 1; tab.value = 'movement' }

const statusOptions = [
	{ label: '全部流向', value: '' },
	{ label: '在站', value: 'in_station' },
	{ label: '在户', value: 'at_customer' },
	{ label: '未知', value: 'unknown' },
	{ label: '报废', value: 'scrapped' },
	{ label: '遗失', value: 'lost' }
]

const statusLabel = computed(() => statusOptions[filters.statusIndex]?.label || '全部流向')

watch(
	() => props.initialKeyword,
	(value) => {
		const keyword = normalizeText(value)
		if (!keyword) return
		filters.keyword = keyword
		runSearch()
	},
	{ immediate: true }
)

async function runSearch(options = {}) {
	const append = options.append === true
	if (append && (loading.value || !paging.value.hasMore || !searchedFilters)) return
	invalidateScan()
	const version = ++queryVersion
	loading.value = true
	if (!append) {
		list.value = []
		paging.value = { page: 1, pageSize: 20, total: 0, hasMore: false }
		searchedFilters = { keyword: filters.keyword, status: statusOptions[filters.statusIndex]?.value || '', id: options.id || '' }
	}
	try {
		const res = await queryPdaBottleArchive({ ...searchedFilters, page: append ? paging.value.page + 1 : 1, pageSize: 20 })
		if (version !== queryVersion) return
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return
		}
		list.value = append ? Array.from(new Map([...list.value, ...(res.data || [])].map(item => [item._id || item.bottle_no, item])).values()) : res.data || []
		paging.value = res.paging || paging.value
	} catch (error) {
		if (version === queryVersion) uni.showToast({ title: error.message || '查询失败', icon: 'none' })
	} finally {
		if (version === queryVersion) loading.value = false
	}
}

function loadMore() { return runSearch({ append: true }) }

function resetSearch() {
	invalidateScan()
	invalidateQuery()
	filters.keyword = ''
	filters.statusIndex = 0
	list.value = []
	paging.value = { page: 1, pageSize: 20, total: 0, hasMore: false }
}

function onStatusChange(event) {
	const index = Number(event?.detail?.value || 0)
	filters.statusIndex = Number.isFinite(index) ? index : 0
}

</script>

<style scoped>
.filters--simple { grid-template-columns: 1fr !important; }
.filters {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12rpx;
}

.picker-block {
	display: block;
}

.actions-row {
	margin-top: 16rpx;
	display: flex;
	gap: 16rpx;
	justify-content: flex-end;
}

.section-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.meta-row {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	align-items: center;
}

.meta-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.item-actions {
	display: flex;
	gap: 12rpx;
}

.query-tabs { display: flex; gap: 12rpx; margin-bottom: 12rpx; }
</style>

<style scoped lang="scss">
@import './pdaCompact.scss';
/* #ifdef APP-PLUS */
.query-tabs { margin-bottom: 0; }
/* #endif */
</style>
