<template>
	<AppPage title="账期管理" :subtitle="subtitle" icon="calendar">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="loading" @click="onSearch">刷新</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="账期总数" :value="summary.total" hint="期" icon="list" />
				<AppStatCard class="summary-card" label="已结账" :value="summary.closed" hint="期" icon="check-circle" />
				<AppStatCard class="summary-card" label="未结账" :value="summary.open" hint="期" icon="minus-circle" />
			</view>
		</template>

		<view class="list-shell">
			<AppSection title="新建账期">
				<template #actions>
					<AppButton size="sm" kind="primary" :loading="creating" :disabled="creating" @click="onCreate">创建账期</AppButton>
				</template>
				<view class="form-grid">
					<AppInput v-model="newPeriod" label="账期" placeholder="YYYY-MM" size="sm" />
				</view>
			</AppSection>

			<AppSection title="账期列表">
				<template #actions>
					<text class="section-hint">共 {{ list.length }} 期</text>
				</template>
				<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无账期">
					<AppListItem
						v-for="item in list"
						:key="item._id"
						:title="item.period"
						:subtitle="item.status === 'closed' ? '已结账' : '未结账'"
						icon="calendar"
						:icon-class="item.status === 'closed' ? 'bg-emerald' : 'bg-warning'"
					>
						<template #footer>
							<AppButton
								size="sm"
								:kind="item.status === 'closed' ? 'ghost' : 'primary'"
								@click="onToggle(item)"
							>
								{{ item.status === 'closed' ? '反结账' : '结账' }}
							</AppButton>
						</template>
					</AppListItem>
				</AppList>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { useQuery } from '@/composables/useQuery'
import { closePeriodV1, createPeriodV1, listPeriodsV1, reopenPeriodV1 } from '@/services/period'

const list = ref([])
const newPeriod = ref('')
const creating = ref(false)

const subtitle = computed(() => {
	if (!list.value.length) return '结账/反结账'
	return `当前共 ${list.value.length} 期`
})

const summary = computed(() => {
	const total = list.value.length
	const closed = list.value.filter((item) => item.status === 'closed').length
	const open = total - closed
	return { total, closed, open }
})

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listPeriodsV1()
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '查询失败', icon: 'none' })
			return []
		}
		return Array.isArray(res.data) ? res.data : []
	},
	{
		immediate: false,
		initialData: [],
		cacheTTL: 20000,
		throttleMs: 300,
		cacheKey: 'period:list'
	}
)

async function onSearch() {
	const data = await fetchList()
	list.value = data || []
}

async function onCreate() {
	if (!String(newPeriod.value || '').trim()) {
		uni.showToast({ title: '账期必填', icon: 'none' })
		return
	}
	if (creating.value) return
	creating.value = true
	try {
		const res = await createPeriodV1({ period: newPeriod.value })
		if (res?.code === 0) {
			uni.showToast({ title: '创建成功', icon: 'success' })
			newPeriod.value = ''
			await onSearch()
			return
		}
		uni.showToast({ title: res?.msg || '创建失败', icon: 'none' })
	} finally {
		creating.value = false
	}
}

async function onToggle(item) {
	if (!item?.period) return
	const action = item.status === 'closed' ? reopenPeriodV1 : closePeriodV1
	const res = await action({ period: item.period })
	if (res?.code === 0) {
		uni.showToast({ title: item.status === 'closed' ? '已反结账' : '已结账', icon: 'success' })
		await onSearch()
		return
	}
	uni.showToast({ title: res?.msg || '操作失败', icon: 'none' })
}

onMounted(() => {
	onSearch()
})

defineExpose({
	refresh: onSearch
})
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

.form-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240rpx, 1fr));
	gap: 16rpx;
	align-items: end;
}

.section-hint {
	font-size: 22rpx;
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
