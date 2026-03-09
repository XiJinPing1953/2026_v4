<template>
	<AppPage title="凭证管理" subtitle="录入与查询记账凭证">
		<AppFilterBar
			searchLabel="查询"
			@search="loadData"
			@reset="resetFilter"
		>
			<AppInput v-model="filter.keyword" placeholder="摘要搜索" />
			<view class="picker-wrap">
				<picker :range="statusOptions" range-key="label" @change="onStatusChange">
					<view class="picker-box">
						{{ currentStatusLabel }}
					</view>
				</picker>
			</view>
			<template #actions>
				<AppButton kind="ghost" @click="resetFilter">重置</AppButton>
				<AppButton @click="loadData">查询</AppButton>
				<AppButton @click="goEdit()">录入凭证</AppButton>
			</template>
		</AppFilterBar>

		<AppList
			:loading="loading"
			:empty="list.length === 0"
			empty-title="暂无凭证"
			empty-subtitle="点击录入第一张凭证"
		>
			<AppListItem
				v-for="item in list"
				:key="item._id"
				:title="item.summary"
				:subtitle="item.date"
				clickable
				@click="goEdit(item._id)"
			>
				<template #headerActions>
					<AppTag :kind="getStatusKind(item.status)">
						{{ getStatusLabel(item.status) }}
					</AppTag>
				</template>
				<template #meta>
					<text>总金额: {{ formatMoney(item.total_amount) }}</text>
					<text>·</text>
					<text>分录数: {{ item.entries ? item.entries.length : 0 }}</text>
				</template>
			</AppListItem>
		</AppList>
	</AppPage>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppFilterBar from '@/components/base/AppFilterBar.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppTag from '@/components/base/AppTag.vue'
import { listVouchersV1 } from '@/services/voucher'

const loading = ref(false)
const list = ref([])
const filter = reactive({
	keyword: '',
	status: ''
})

const statusOptions = [
	{ label: '全部状态', value: '' },
	{ label: '草稿', value: 'draft' },
	{ label: '已过账', value: 'posted' }
]

const currentStatusLabel = computed(() => {
	const opt = statusOptions.find(o => o.value === filter.status)
	return opt ? opt.label : '状态'
})

onMounted(() => {
	loadData()
})

async function loadData() {
	try {
		loading.value = true
		const res = await listVouchersV1({
			keyword: filter.keyword,
			status: filter.status,
			page: 1,
			pageSize: 50
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
	filter.status = ''
	loadData()
}

function onStatusChange(e) {
	filter.status = statusOptions[e.detail.value].value
}

function goEdit(id) {
	const url = id 
		? `/pages/accounting/voucher/edit?id=${id}` 
		: '/pages/accounting/voucher/edit'
	uni.navigateTo({ url })
}

function getStatusKind(status) {
	return status === 'posted' ? 'success' : 'warning'
}

function getStatusLabel(status) {
	return status === 'posted' ? '已过账' : '草稿'
}

function formatMoney(val) {
	return Number(val || 0).toFixed(2)
}
</script>

<style scoped>
.picker-wrap {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}
.picker-box {
	border: 1rpx solid var(--crm-border);
	border-radius: 14rpx;
	background: #fff;
	padding: 0 14rpx;
	height: 84rpx;
	display: flex;
	align-items: center;
	font-size: 28rpx;
	color: var(--crm-text);
}
</style>
