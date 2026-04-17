<template>
	<AppPage title="钢瓶查询" subtitle="只读查询" icon="bottle" hideBottleQuery>
		<AppSection title="筛选">
			<view class="filters">
				<AppInput v-model="filters.keyword" label="瓶号 / 关键词" placeholder="请输入瓶号" @confirm="runSearch" />
				<picker class="picker-block" mode="selector" :range="statusOptions" range-key="label" @change="onStatusChange">
					<view class="picker-trigger">
						<AppInput :model-value="statusLabel" label="流向" readonly />
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
							<AppTag kind="soft">{{ item.status || 'unknown' }}</AppTag>
							<text class="meta-text">空瓶重 {{ formatWeight(item.tare_weight) }} kg</text>
							<text class="meta-text">检验 {{ item.bottle_next_check_date || item.bottle_check_date || '-' }}</text>
						</view>
					</template>
					<template #footer>
						<view class="item-actions">
							<AppButton size="sm" kind="neutral" @click="goMovement(item)">流转记录</AppButton>
							<AppButton size="sm" kind="outline" @click="goFilling(item)">灌装带入</AppButton>
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
import { buildPdaFillingCreateUrl, buildPdaMovementQueryUrl, listPdaBottles } from '@/services/pda/bottle'
import { formatWeight, normalizeText } from '@/services/pda/shared'

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

async function runSearch() {
	loading.value = true
	try {
		const res = await listPdaBottles({
			keyword: filters.keyword,
			status: statusOptions[filters.statusIndex]?.value || '',
			page: 1,
			pageSize: 20
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return
		}
		list.value = res.data || []
		paging.value = res.paging || paging.value
	} finally {
		loading.value = false
	}
}

function resetSearch() {
	filters.keyword = ''
	filters.statusIndex = 0
	list.value = []
	paging.value = { page: 1, pageSize: 20, total: 0, hasMore: false }
}

function onStatusChange(event) {
	const index = Number(event?.detail?.value || 0)
	filters.statusIndex = Number.isFinite(index) ? index : 0
}

function goMovement(item) {
	uni.navigateTo({ url: buildPdaMovementQueryUrl(item?.bottle_no) })
}

function goFilling(item) {
	uni.navigateTo({ url: buildPdaFillingCreateUrl(item?.bottle_no) })
}
</script>

<style scoped>
.filters {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 20rpx;
}

.picker-block {
	display: block;
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

.meta-text {
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

	.actions-row {
		justify-content: stretch;
	}

	.item-actions {
		width: 100%;
	}
}
</style>
