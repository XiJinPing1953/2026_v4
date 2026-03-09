<template>
	<AppPage title="总账" subtitle="科目汇总记录">
		<AppFilterBar
			searchLabel="查询"
			@search="loadData"
			@reset="resetFilter"
		>
			<view class="field">
				<picker :range="accountList" range-key="label" @change="onAccountChange">
					<view class="picker-box">
						{{ currentAccountLabel }}
					</view>
				</picker>
			</view>
			<view class="field">
				<picker mode="date" @change="onStartDateChange">
					<view class="picker-box">{{ filter.dateStart || '开始日期' }}</view>
				</picker>
			</view>
			<view class="field">
				<picker mode="date" @change="onEndDateChange">
					<view class="picker-box">{{ filter.dateEnd || '结束日期' }}</view>
				</picker>
			</view>
		</AppFilterBar>

		<AppTable
			:columns="columns"
			:rows="list"
			:loading="loading"
			:empty="list.length === 0"
			empty-title="无记录"
		/>
	</AppPage>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppFilterBar from '@/components/base/AppFilterBar.vue'
import AppTable from '@/components/base/AppTable.vue'
import { getGeneralLedgerV1 } from '@/services/ledger'
import { listAccountsV1 } from '@/services/account'

const loading = ref(false)
const list = ref([])
const accountList = ref([])
const filter = reactive({
	account_code: '',
	dateStart: '',
	dateEnd: ''
})

const columns = [
	{ key: 'date', label: '日期', width: '1.5fr' },
	{ key: 'summary', label: '摘要', width: '2fr' },
	{ key: 'debit', label: '借方', align: 'right', format: (v) => v ? Number(v).toFixed(2) : '' },
	{ key: 'credit', label: '贷方', align: 'right', format: (v) => v ? Number(v).toFixed(2) : '' },
	{ key: 'direction', label: '方向', width: '0.5fr', align: 'center' },
	{ key: 'balance', label: '余额', align: 'right', format: (v) => Number(v).toFixed(2) }
]

const currentAccountLabel = computed(() => {
	if (!filter.account_code) return '选择科目'
	const acc = accountList.value.find(a => a.code === filter.account_code)
	return acc ? `${acc.code} ${acc.name}` : filter.account_code
})

onMounted(async () => {
	await loadAccounts()
})

async function loadAccounts() {
	const res = await listAccountsV1({ is_active: true, limit: 1000 })
	if (res.data) {
		accountList.value = res.data.map(a => ({
			...a,
			label: `${a.code} ${a.name}`
		}))
	}
}

function onAccountChange(e) {
	const acc = accountList.value[e.detail.value]
	filter.account_code = acc.code
	loadData()
}

function onStartDateChange(e) {
	filter.dateStart = e.detail.value
}

function onEndDateChange(e) {
	filter.dateEnd = e.detail.value
}

async function loadData() {
	if (!filter.account_code) {
		uni.showToast({ title: '请选择科目', icon: 'none' })
		return
	}
	try {
		loading.value = true
		const res = await getGeneralLedgerV1(filter)
		list.value = res.data || []
	} catch (e) {
		console.error(e)
		uni.showToast({ title: '加载失败', icon: 'none' })
	} finally {
		loading.value = false
	}
}

function resetFilter() {
	filter.account_code = ''
	filter.dateStart = ''
	filter.dateEnd = ''
	list.value = []
}
</script>

<style scoped>
.field {
	display: flex;
	flex-direction: column;
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
