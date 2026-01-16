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
					:key="item.id"
					:title="item.customerName"
					:subtitle="item.date"
					:status="item.status"
					status-kind="info"
					clickable
					@click="onOpen(item)"
				>
					<template #meta>
						<AppTag kind="soft">{{ item.priceUnit }}</AppTag>
						<text>应收 {{ item.shouldReceive }}</text>
						<text>已收 {{ item.amountReceived }}</text>
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

const loading = ref(false)
const list = ref([])

const filters = reactive({
	keyword: '',
	dateStart: '',
	dateEnd: '',
	priceUnit: ''
})

function onSearch() {}
function onReset() {
	filters.keyword = ''
	filters.dateStart = ''
	filters.dateEnd = ''
	filters.priceUnit = ''
}
function onAdd() {}
function onOpen(item) {}
function onEdit(item) {}
function onDetail(item) {}
</script>

<style scoped>
</style>
