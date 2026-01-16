<template>
	<AppPage title="销售录入" subtitle="统一录入瓶装/整车/代理出站">
		<view class="sale-edit">
			<AppSection title="基础信息">
				<SaleBasicInfoCard v-model="form" />
			</AppSection>

		<AppSection title="出瓶">
			<SaleBottleLinesCard v-model="outItems" />
		</AppSection>

		<AppSection title="回瓶">
			<SaleBottleLinesCard v-model="backItems" />
		</AppSection>

		<AppSection title="存瓶">
			<SaleDepositCard v-model="depositRows" />
		</AppSection>

		<AppSection title="代理出站">
			<SaleAgentSaleCard v-model="agentSaleRows" />
		</AppSection>

		<AppSection title="流量结算">
			<SaleFlowCard v-model="flow" />
		</AppSection>

		<AppSection title="整车">
			<SaleTruckCard v-model="truck" />
		</AppSection>

		<AppSection title="收款">
			<SaleSettlementCard v-model="settlement" />
		</AppSection>

			<AppSection>
				<AppButton @click="onSubmit">保存</AppButton>
				<AppButton kind="ghost" @click="onCancel">取消</AppButton>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { reactive, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppButton from '@/components/base/AppButton.vue'
import { createSaleV2 } from '@/services/sale'
import SaleBasicInfoCard from '@/components/domain/sale/SaleBasicInfoCard.vue'
import SaleBottleLinesCard from '@/components/domain/sale/SaleBottleLinesCard.vue'
import SaleDepositCard from '@/components/domain/sale/SaleDepositCard.vue'
import SaleFlowCard from '@/components/domain/sale/SaleFlowCard.vue'
import SaleTruckCard from '@/components/domain/sale/SaleTruckCard.vue'
import SaleAgentSaleCard from '@/components/domain/sale/SaleAgentSaleCard.vue'
import SaleSettlementCard from '@/components/domain/sale/SaleSettlementCard.vue'

const form = reactive({
	date: '',
	customerName: '',
	deliveryMan1: '',
	deliveryMan2: '',
	vehicleNo: '',
	priceUnit: 'kg',
	unitPrice: ''
})

const flow = reactive({
	flowPrev: '',
	flowCurr: '',
	flowVolume: '',
	flowRatio: ''
})

const truck = reactive({
	truckNo: '',
	truckOutGross: '',
	truckBackGross: '',
	truckSaleNet: ''
})

const settlement = reactive({
	paymentStatus: '未付',
	amountReceived: '',
	paymentNote: ''
})

const outItems = ref([])
const backItems = ref([])
const depositRows = ref([])
const agentSaleRows = ref([])

async function onSubmit() {
	try {
		const result = await createSaleV2({
			form,
			flow,
			truck,
			settlement,
			outItems: outItems.value,
			backItems: backItems.value,
			depositRows: depositRows.value,
			agentSaleRows: agentSaleRows.value
		})
		if (result?.code !== 0) return
		uni.showToast({ title: '保存成功', icon: 'success' })
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 400)
	} catch (err) {
		console.error('create sale failed', err)
		uni.showToast({ title: '保存失败', icon: 'none' })
	}
}

function onCancel() {}
</script>

<style scoped>
.sale-edit {
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}
</style>
