<template>
	<AppPage title="销售单详情" :subtitle="detail.customer_name || '销售单详情'" icon="document">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" @click="onBack">返回</AppButton>
			<AppButton size="sm" kind="outline" :loading="removing" @click="onRemove">删除单据</AppButton>
			<AppButton size="sm" kind="primary" @click="onEdit" icon="document">编辑单据</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="销售日期" :value="detail.date || '-'" icon="calendar" />
				<AppStatCard class="summary-card" label="应收总额" :value="detail.should_receive ?? '-'" hint="元" icon="wallet" />
				<AppStatCard class="summary-card" label="付款状态" :value="paymentStatusText(detail.payment_status)" icon="credit-card" />
				<AppStatCard class="summary-card" label="业务模式" :value="bizModeText(detail.biz_mode)" icon="list" />
			</view>
		</template>

		<template #tabs>
			<AppTabs v-model="activeTab" :items="tabItems" />
		</template>

		<view class="detail-container">
			<view v-if="activeTab === 'details'" class="tab-content">
				<AppSection title="基础信息">
					<view class="info-grid">
						<view class="info-item">
							<text class="info-label">客户名称</text>
							<text class="info-value">{{ detail.customer_name || '-' }}</text>
						</view>
						<view class="info-item">
							<text class="info-label">销售日期</text>
							<text class="info-value">{{ detail.date || '-' }}</text>
						</view>
						<view class="info-item">
							<text class="info-label">计价单位</text>
							<text class="info-value">{{ detail.price_unit || '-' }}</text>
						</view>
						<view class="info-item">
							<text class="info-label">单价</text>
							<text class="info-value">¥{{ detail.unit_price ?? '-' }}</text>
						</view>
						<view class="info-item span-2">
							<text class="info-label">备注</text>
							<text class="info-value">{{ detail.remark || '无' }}</text>
						</view>
					</view>
				</AppSection>

				<AppSection title="结算信息">
					<view class="info-grid">
						<view class="info-item">
							<text class="info-label">支付方式</text>
							<text class="info-value">{{ paymentMethodText(detail.payment_method) }}</text>
						</view>
						<view class="info-item">
							<text class="info-label">实收金额</text>
							<text class="info-value highlight-text">¥{{ detail.amount_received ?? '0.00' }}</text>
						</view>
						<view class="info-item">
							<text class="info-label">抹零金额</text>
							<text class="info-value">¥{{ detail.rounding_amount ?? '0.00' }}</text>
						</view>
						<view class="info-item span-2">
							<text class="info-label">付款状态</text>
							<AppTag :kind="paymentStatusKind(detail.payment_status)">
								{{ paymentStatusText(detail.payment_status) }}
							</AppTag>
						</view>
						<view class="info-item span-2">
							<text class="info-label">收款备注</text>
							<text class="info-value">{{ detail.payment_note || '无' }}</text>
						</view>
					</view>
				</AppSection>
			</view>

			<view v-if="activeTab === 'related'" class="tab-content">
				<AppSection title="关联明细">
					<view class="placeholder-content">
						<AppEmpty title="暂无关联明细" subtitle="暂不支持在详情页查看详细瓶装行，请点击编辑查看" />
					</view>
				</AppSection>
			</view>
		</view>
	</AppPage>
</template>

<script setup>
import { ref, toRef, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppTag from '@/components/base/AppTag.vue'
import AppTabs from '@/components/base/AppTabs.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import { getSaleV2, removeSaleV2 } from '@/services/sale'
import { useQuery } from '@/composables/useQuery'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')
const detail = ref({})
const activeTab = ref('details')
const removing = ref(false)

const tabItems = [
	{ label: '详情', value: 'details' },
	{ label: '关联项', value: 'related' }
]

const { run: fetchDetail } = useQuery(
	async (id) => {
		const res = await getSaleV2({ _id: id })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
			return null
		}
		return res.data || null
	},
	{
		immediate: false,
		initialData: null,
		cacheTTL: 10000,
		throttleMs: 300,
		cacheKey: (id) => `sale:detail:${id}`
	}
)

watch(
	recordId,
	async (id) => {
		if (!id) return
		const data = await fetchDetail(String(id))
		if (data) detail.value = data
	},
	{ immediate: true }
)

function bizModeText(value) {
	const map = {
		bottle: '瓶装',
		truck: '整车',
		agent_sale: '代理出站'
	}
	return map[value] || value || '-'
}

function paymentMethodText(value) {
	const map = {
		on_account: '挂账',
		cash: '现金',
		bank: '银行转账',
		wechat: '微信',
		alipay: '支付宝'
	}
	return map[value] || '挂账'
}

function paymentStatusText(value) {
	const map = {
		paid: '已结清',
		partial: '部分付',
		unpaid: '未付款',
		'已结清': '已结清',
		'部分付': '部分付',
		'未付款': '未付款'
	}
	return map[value] || '未知'
}

function paymentStatusKind(status) {
	const map = {
		paid: 'success',
		partial: 'warning',
		unpaid: 'danger',
		'已结清': 'success',
		'部分付': 'warning',
		'未付款': 'danger'
	}
	return map[status] || 'info'
}

function onEdit() {
	if (!recordId.value) return
	uni.navigateTo({ url: `/pages/sale/edit?_id=${encodeURIComponent(recordId.value)}` })
}

function onBack() {
	uni.navigateBack({ delta: 1 })
}

async function onRemove() {
	if (!recordId.value || removing.value) return
	const confirmRes = await uni.showModal({
		title: '删除销售单',
		content: '删除后将同步移除对应流转事件（已过账凭证不允许删除）。确认继续？',
		showCancel: true
	})
	if (!confirmRes.confirm) return
	removing.value = true
	try {
		const res = await removeSaleV2({ recordId: recordId.value })
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '删除失败', icon: 'none' })
			return
		}
		uni.showToast({ title: res?.msg || '删除成功', icon: 'success' })
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 300)
	} finally {
		removing.value = false
	}
}
</script>

<style scoped>
.detail-container {
	padding-bottom: 48rpx;
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

.tab-content {
	display: flex;
	flex-direction: column;
	gap: 24rpx;
}

.info-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 20rpx;
}

.info-item {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.span-2 {
	grid-column: span 2;
}

.info-label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.info-value {
	font-size: 28rpx;
	color: var(--crm-text);
	font-weight: 600;
}

.highlight-text {
	color: var(--crm-primary);
}

.placeholder-content {
	padding: 48rpx 0;
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

@media (max-width: 720px) {
	.info-grid {
		grid-template-columns: 1fr;
	}
	.span-2 {
		grid-column: auto;
	}
}
</style>
