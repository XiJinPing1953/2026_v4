<template>
	<AppPage title="销售列表" subtitle="按条件筛选并管理销售单">
		<AppFilterBar @search="onSearch" @reset="onReset">
			<AppInput v-model="filters.keyword" label="客户/车牌" placeholder="搜索客户或车牌" />
			<AppInput v-model="filters.dateStart" label="开始日期" placeholder="YYYY-MM-DD" />
			<AppInput v-model="filters.dateEnd" label="结束日期" placeholder="YYYY-MM-DD" />
			<AppInput v-model="filters.priceUnit" label="计价单位" placeholder="kg / bottle / m3" />
		</AppFilterBar>

		<AppSection title="销售单">
			<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无销售单">
				<AppListItem
					v-for="item in list"
					:key="item._id"
					:title="item.customer_name"
					:subtitle="item.date"
					:status="item.payment_status"
					status-kind="info"
					clickable
					@click="onOpen(item)"
				>
					<template #meta>
						<AppTag kind="soft">{{ item.price_unit }}</AppTag>
						<text>应收 {{ item.should_receive }}</text>
						<text>已收 {{ item.amount_received }}</text>
					</template>
					<template #footer>
						<AppButton kind="ghost" size="sm" @click.stop="onEdit(item)">编辑</AppButton>
						<AppButton size="sm" @click.stop="onDetail(item)">详情</AppButton>
					</template>
				</AppListItem>
			</AppList>
		</AppSection>

		<AppSection title="快捷">
			<AppButton @click="onAdd">新增销售</AppButton>
		</AppSection>
	</AppPage>
</template>

<script setup>
import { reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppFilterBar from '@/components/base/AppFilterBar.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppTag from '@/components/base/AppTag.vue'

import { useQuery } from '@/composables/useQuery'
import { listSalesV2 } from '@/services/sale'

const list = ref([])

const { loading, run: fetchList } = useQuery(
	async () => {
		const res = await listSalesV2({
			keyword: filters.keyword,
			dateStart: filters.dateStart,
			dateEnd: filters.dateEnd,
			priceUnit: filters.priceUnit,
			page: 1,
			pageSize: 50
		})
		if (res?.code !== 0) return []
		return res.data || []
	},
	{ immediate: false, initialData: [] }
)

const filters = reactive({
	keyword: '',
	dateStart: '',
	dateEnd: '',
	priceUnit: ''
})

async function onSearch() {
	const data = await fetchList()
	list.value = data || []
}
function onReset() {
	filters.keyword = ''
	filters.dateStart = ''
	filters.dateEnd = ''
	filters.priceUnit = ''
	list.value = []
}
function onAdd() {
	uni.navigateTo({ url: '/pages/sale/edit' })
}
function onOpen(item) {
	void item
}
function onEdit(item) {
	void item
}
function onDetail(item) {
	void item
}
</script>

<style scoped>
</style>
