<template>
	<AppPage title="试算平衡" :subtitle="subtitle" icon="wallet">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="科目数" :value="summary.total" hint="个" icon="list" />
				<AppStatCard class="summary-card" label="借方合计" :value="summary.debit" hint="元" icon="check-circle" />
				<AppStatCard class="summary-card" label="贷方合计" :value="summary.credit" hint="元" icon="minus-circle" />
				<AppStatCard class="summary-card" label="余额合计" :value="summary.balance" hint="元" icon="document" />
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="查询条件">
				<template #actions>
					<AppButton kind="ghost" size="sm" @click="onReset">重置</AppButton>
					<AppButton size="sm" kind="primary" @click="onSearch">查询</AppButton>
				</template>

				<view class="filter-grid">
					<AppInput v-model="filters.period" label="账期" placeholder="YYYY-MM" size="sm" />
					<picker class="picker-block" mode="date" :value="filters.dateStart" @change="onDateStartChange">
						<view class="picker-trigger">
							<AppInput :model-value="filters.dateStart" label="开始日期" placeholder="YYYY-MM-DD" disabled size="sm" />
						</view>
					</picker>
					<picker class="picker-block" mode="date" :value="filters.dateEnd" @change="onDateEndChange">
						<view class="picker-trigger">
							<AppInput :model-value="filters.dateEnd" label="结束日期" placeholder="YYYY-MM-DD" disabled size="sm" />
						</view>
					</picker>
				</view>
			</AppSection>

			<AppSection title="余额表">
				<template #actions>
					<text class="section-hint">共 {{ list.length }} 个</text>
				</template>

				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无记录">
					<AppListItem
						v-for="item in list"
						:key="item.account_code"
						:title="item.account_name"
						:subtitle="item.account_code"
						icon="list"
						icon-class="bg-info"
					>
						<template #meta>
							<view class="meta-tags">
								<text class="meta-text">借 {{ item.debit }}</text>
								<text class="meta-text">贷 {{ item.credit }}</text>
								<text class="meta-text">余额 {{ item.balance }}</text>
							</view>
						</template>
					</AppListItem>
				</AppList>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useQuery } from '@/composables/useQuery'
import { getTrialBalanceV1 } from '@/services/ledger'

const list = ref([])

const filters = reactive({
	period: '',
	dateStart: '',
	dateEnd: ''
})

const subtitle = computed(() => {
	if (!list.value.length) return '借贷平衡与余额查询'
	return `当前筛选 ${list.value.length} 条`
})

const summary = computed(() => {
	const total = list.value.length
	const debit = list.value.reduce((sum, item) => sum + Number(item.debit || 0), 0).toFixed(2)
	const credit = list.value.reduce((sum, item) => sum + Number(item.credit || 0), 0).toFixed(2)
	const balance = list.value.reduce((sum, item) => sum + Number(item.balance || 0), 0).toFixed(2)
	return { total, debit, credit, balance }
})

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await getTrialBalanceV1({
			period: filters.period,
			dateStart: filters.dateStart,
			dateEnd: filters.dateEnd,
			limit: 2000
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return []
		}
		return Array.isArray(res.data) ? res.data : []
	},
	{
		immediate: false,
		initialData: [],
		cacheTTL: 8000,
		throttleMs: 300,
		cacheKey: () => `trial:balance:${filters.period}:${filters.dateStart}:${filters.dateEnd}`
	}
)

async function onSearch() {
	const data = await fetchList()
	list.value = data || []
}

function onReset() {
	filters.period = ''
	filters.dateStart = ''
	filters.dateEnd = ''
	list.value = []
}

function onDateStartChange(e) {
	filters.dateStart = e?.detail?.value || ''
}

function onDateEndChange(e) {
	filters.dateEnd = e?.detail?.value || ''
}
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

.section-hint {
	font-size: 22rpx;
	color: var(--crm-text-muted);
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

.picker-trigger {
	pointer-events: none;
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
