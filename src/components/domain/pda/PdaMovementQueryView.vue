<template>
	<AppPage title="流转查询" subtitle="只读查询" icon="list" hideBottleQuery>
		<AppSection title="筛选">
			<view class="filters">
				<AppInput v-model="filters.bottleNo" label="瓶号" placeholder="请输入瓶号" @confirm="runSearch" />
				<picker class="picker-block" mode="selector" :range="typeOptions" range-key="label" @change="onTypeChange">
					<view class="picker-trigger">
						<AppInput :model-value="typeLabel" label="类型" readonly />
					</view>
				</picker>
				<picker class="picker-block" mode="selector" :range="sourceOptions" range-key="label" @change="onSourceChange">
					<view class="picker-trigger">
						<AppInput :model-value="sourceLabel" label="来源" readonly />
					</view>
				</picker>
				<picker class="picker-block" mode="date" :value="filters.dateStart" @change="(e) => onDateChange('dateStart', e)">
					<view class="picker-trigger">
						<AppInput :model-value="filters.dateStart" label="开始日期" readonly placeholder="请选择开始日期" />
					</view>
				</picker>
				<picker class="picker-block" mode="date" :value="filters.dateEnd" @change="(e) => onDateChange('dateEnd', e)">
					<view class="picker-trigger">
						<AppInput :model-value="filters.dateEnd" label="结束日期" readonly placeholder="请选择结束日期" />
					</view>
				</picker>
			</view>
			<view class="actions-row">
				<AppButton @click="runSearch">查询</AppButton>
				<AppButton kind="neutral" @click="resetSearch">重置</AppButton>
			</view>
		</AppSection>

		<AppSection title="查询结果">
			<template #actions>
				<text class="section-hint">共 {{ paging.total }} 条</text>
			</template>
			<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无流转记录">
				<AppListItem
					v-for="item in list"
					:key="item._id || `${item.bottle_no}:${item.event_at}:${item.type}`"
					:title="`${item.bottle_no || '-'} · ${typeText(item.type)}`"
					:subtitle="displayDate(item)"
					icon="list"
				>
					<template #meta>
						<view class="meta-row">
							<AppTag kind="soft">{{ sourceText(item.source_type) }}</AppTag>
							<text class="meta-text">客户 {{ item.customer_name || '-' }}</text>
							<text v-if="item.net_weight != null" class="meta-text">净重 {{ item.net_weight }} kg</text>
						</view>
						<text v-if="item.note" class="note-text">{{ item.note }}</text>
					</template>
					<template #footer>
						<view class="item-actions">
							<AppButton size="sm" kind="neutral" @click="goBottle(item)">查看钢瓶</AppButton>
						</view>
					</template>
				</AppListItem>
			</AppList>
		</AppSection>
	</AppPage>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppTag from '@/components/base/AppTag.vue'
import { listBottleMovementsV1 } from '@/services/bottleMovement'
import { formatDateTime, normalizeBottleNo, normalizeText } from '@/services/pda/shared'

const props = defineProps({
	initialBottleNo: { type: String, default: '' }
})

const filters = reactive({
	bottleNo: '',
	typeIndex: 0,
	sourceIndex: 0,
	dateStart: '',
	dateEnd: ''
})
const loading = ref(false)
const list = ref([])
const paging = ref({ page: 1, pageSize: 20, total: 0, hasMore: false })

const typeOptions = [
	{ label: '全部类型', value: '' },
	{ label: '出瓶', value: 'out' },
	{ label: '回瓶', value: 'back' },
	{ label: '灌装', value: 'fill' },
	{ label: '调整', value: 'adjust' }
]

const sourceOptions = [
	{ label: '全部来源', value: '' },
	{ label: '销售单', value: 'sale' },
	{ label: '灌装单', value: 'filling' },
	{ label: '手工修复', value: 'manual_fix' },
	{ label: '手工录入', value: 'manual' }
]

const typeLabel = computed(() => typeOptions[filters.typeIndex]?.label || '全部类型')
const sourceLabel = computed(() => sourceOptions[filters.sourceIndex]?.label || '全部来源')

watch(
	() => props.initialBottleNo,
	(value) => {
		const bottleNo = normalizeBottleNo(value)
		if (!bottleNo) return
		filters.bottleNo = bottleNo
		runSearch()
	},
	{ immediate: true }
)

async function runSearch() {
	loading.value = true
	try {
		const res = await listBottleMovementsV1({
			bottleNo: normalizeBottleNo(filters.bottleNo),
			type: typeOptions[filters.typeIndex]?.value || '',
			sourceType: sourceOptions[filters.sourceIndex]?.value || '',
			dateStart: filters.dateStart,
			dateEnd: filters.dateEnd,
			page: 1,
			pageSize: 20
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return
		}
		list.value = Array.isArray(res?.data) ? res.data : []
		paging.value = res?.paging || paging.value
	} finally {
		loading.value = false
	}
}

function resetSearch() {
	filters.bottleNo = ''
	filters.typeIndex = 0
	filters.sourceIndex = 0
	filters.dateStart = ''
	filters.dateEnd = ''
	list.value = []
	paging.value = { page: 1, pageSize: 20, total: 0, hasMore: false }
}

function onTypeChange(event) {
	const index = Number(event?.detail?.value || 0)
	filters.typeIndex = Number.isFinite(index) ? index : 0
}

function onSourceChange(event) {
	const index = Number(event?.detail?.value || 0)
	filters.sourceIndex = Number.isFinite(index) ? index : 0
}

function onDateChange(key, event) {
	filters[key] = normalizeText(event?.detail?.value)
}

function typeText(type) {
	const map = { out: '出瓶', back: '回瓶', fill: '灌装', adjust: '调整' }
	return map[type] || type || '-'
}

function sourceText(sourceType) {
	const map = { sale: '销售单', filling: '灌装单', manual_fix: '手工修复', manual: '手工录入' }
	return map[sourceType] || sourceType || '-'
}

function displayDate(item) {
	return normalizeText(item?.event_day) || formatDateTime(item?.event_at || item?.date)
}

function goBottle(item) {
	const bottleNo = normalizeBottleNo(item?.bottle_no)
	uni.navigateTo({
		url: bottleNo ? `/pages/pda/bottle-query?keyword=${encodeURIComponent(bottleNo)}` : '/pages/pda/bottle-query'
	})
}
</script>

<style scoped>
.filters {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 20rpx;
}

.actions-row {
	margin-top: 24rpx;
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

.meta-text,
.note-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.item-actions {
	display: flex;
	gap: 12rpx;
}

@media (max-width: 680px) {
	.filters {
		grid-template-columns: 1fr;
	}
}
</style>
