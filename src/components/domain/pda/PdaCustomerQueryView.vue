<template>
	<AppPage title="客户查询" subtitle="只读摘要" icon="user" hideBottleQuery>
		<AppSection title="筛选">
			<view class="filters">
				<AppInput v-model="keyword" label="客户名称 / 联系人 / 手机" placeholder="请输入客户关键词" @confirm="runSearch" />
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
			<AppList :loading="loading" :empty="list.length === 0" empty-title="暂无客户数据">
				<AppListItem
					v-for="item in list"
					:key="item._id"
					:title="item.name || '-'"
					:subtitle="`${item.contact || '-'} · ${item.phone || '-'}`"
					icon="user"
				>
					<template #meta>
						<view class="meta-row">
							<AppTag kind="soft">{{ item.default_price_unit || 'kg' }}</AppTag>
							<text class="meta-text">单价 {{ formatMoney(item.default_unit_price) }}</text>
							<text class="meta-text">存瓶 {{ Number(item.deposit_count || 0) }}</text>
							<text class="meta-text">应收 {{ formatMoney(item.receivable_balance) }}</text>
							<text class="meta-text">预收 {{ formatMoney(item.prepay_balance) }}</text>
							<text class="meta-text">净额 {{ formatMoney(item.net_balance) }}</text>
						</view>
						<text v-if="depositText(item)" class="deposit-text">存瓶明细：{{ depositText(item) }}</text>
					</template>
					<template #footer>
						<view class="item-actions">
							<AppButton size="sm" kind="outline" @click="goSale(item)">新建销售</AppButton>
						</view>
					</template>
				</AppListItem>
			</AppList>
		</AppSection>
	</AppPage>
</template>

<script setup>
import { ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppTag from '@/components/base/AppTag.vue'
import { buildPdaSaleCreateUrl, listPdaCustomers } from '@/services/pda/customer'
import { formatMoney } from '@/services/pda/shared'

const keyword = ref('')
const loading = ref(false)
const list = ref([])
const paging = ref({ page: 1, pageSize: 20, total: 0, hasMore: false })

async function runSearch() {
	loading.value = true
	try {
		const res = await listPdaCustomers({
			keyword: keyword.value,
			page: 1,
			pageSize: 20,
			isActive: true
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
	keyword.value = ''
	list.value = []
	paging.value = { page: 1, pageSize: 20, total: 0, hasMore: false }
}

function depositText(item) {
	const source = Array.isArray(item?.deposit_bottle_nos) ? item.deposit_bottle_nos.filter(Boolean) : []
	if (!source.length) return ''
	if (source.length <= 6) return source.join(' / ')
	return `${source.slice(0, 6).join(' / ')} 等 ${source.length} 瓶`
}

function goSale(item) {
	uni.navigateTo({ url: buildPdaSaleCreateUrl(item) })
}
</script>

<style scoped>
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
.deposit-text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.item-actions {
	display: flex;
	gap: 12rpx;
}
</style>
