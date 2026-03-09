<template>
	<AppPage title="科目表" subtitle="会计科目管理">
		<AppFilterBar
			searchLabel="搜索"
			@search="loadData"
			@reset="resetFilter"
		>
			<AppInput v-model="filter.keyword" placeholder="科目代码或名称" />
			<template #actions>
				<AppButton kind="ghost" @click="resetFilter">重置</AppButton>
				<AppButton @click="loadData">查询</AppButton>
				<AppButton @click="goEdit()">新增科目</AppButton>
			</template>
		</AppFilterBar>

		<AppList
			:loading="loading"
			:empty="list.length === 0"
			empty-title="暂无科目"
			empty-subtitle="点击新增创建第一个科目"
		>
			<AppListItem
				v-for="item in list"
				:key="item._id"
				:title="`${item.code} ${item.name}`"
				:subtitle="item.remark || '无备注'"
				clickable
				@click="goEdit(item._id)"
			>
				<template #headerActions>
					<AppTag :kind="item.is_active ? 'success' : 'default'">
						{{ item.is_active ? '启用' : '停用' }}
					</AppTag>
				</template>
				<template #meta>
					<text>{{ item.type }}</text>
					<text>·</text>
					<text>{{ item.direction }}</text>
					<text>·</text>
					<text>级次: {{ item.level }}</text>
				</template>
			</AppListItem>
		</AppList>
	</AppPage>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppFilterBar from '@/components/base/AppFilterBar.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppTag from '@/components/base/AppTag.vue'
import { listAccountsV1 } from '@/services/account'

const loading = ref(false)
const list = ref([])
const filter = reactive({
	keyword: ''
})

onMounted(() => {
	loadData()
})

async function loadData() {
	try {
		loading.value = true
		const res = await listAccountsV1({
			keyword: filter.keyword
		})
		list.value = res.data || []
	} catch (e) {
		console.error(e)
		uni.showToast({ title: '加载失败', icon: 'none' })
	} finally {
		loading.value = false
	}
}

function resetFilter() {
	filter.keyword = ''
	loadData()
}

function goEdit(id) {
	const url = id 
		? `/pages/accounting/account/edit?id=${id}` 
		: '/pages/accounting/account/edit'
	uni.navigateTo({ url })
}
</script>
