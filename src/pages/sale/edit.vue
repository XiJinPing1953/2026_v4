<template>
	<AppPage title="销售录入" subtitle="统一录入瓶装/整车/代理出站">
		<AppSection title="基础信息">
			<AppCard>
				<AppInput v-model="form.date" label="日期" placeholder="YYYY-MM-DD" />
				<AppInput v-model="form.customerName" label="客户" placeholder="客户名称" />
				<AppInput v-model="form.deliveryMan" label="配送员" placeholder="姓名/组合" />
				<AppInput v-model="form.vehicleNo" label="车辆" placeholder="车牌或编号" />
				<AppInput v-model="form.priceUnit" label="计价单位" placeholder="kg / bottle / m3" />
				<AppInput v-model="form.unitPrice" label="单价" placeholder="数字" />
			</AppCard>
		</AppSection>

		<AppSection title="出瓶">
			<AppCard>
				<AppEmpty title="待接入出瓶明细" subtitle="后续替换为明细录入组件" />
			</AppCard>
		</AppSection>

		<AppSection title="回瓶">
			<AppCard>
				<AppEmpty title="待接入回瓶明细" subtitle="后续替换为明细录入组件" />
			</AppCard>
		</AppSection>

		<AppSection title="存瓶">
			<AppCard>
				<AppEmpty title="待接入存瓶录入" subtitle="后续替换为存瓶选择组件" />
			</AppCard>
		</AppSection>

		<AppSection title="流量结算">
			<AppCard>
				<AppInput v-model="form.flowPrev" label="上次表数" placeholder="数字" />
				<AppInput v-model="form.flowCurr" label="本次表数" placeholder="数字" />
				<AppInput v-model="form.flowVolume" label="用气量" placeholder="m3" />
				<AppInput v-model="form.flowRatio" label="理论系数" placeholder="可选" />
			</AppCard>
		</AppSection>

		<AppSection title="整车">
			<AppCard>
				<AppInput v-model="form.truckNo" label="TRUCK 瓶号" placeholder="TRUCK-xxxx" />
				<AppInput v-model="form.truckOutGross" label="出厂毛重" placeholder="kg" />
				<AppInput v-model="form.truckBackGross" label="回厂毛重" placeholder="kg" />
				<AppInput v-model="form.truckSaleNet" label="计费净重" placeholder="kg" />
			</AppCard>
		</AppSection>

		<AppSection title="代理出站">
			<AppCard>
				<AppEmpty title="待接入代理出站行" subtitle="后续替换为代理行录入组件" />
			</AppCard>
		</AppSection>

		<AppSection title="收款">
			<AppCard>
				<AppInput v-model="form.paymentStatus" label="付款状态" placeholder="未付 / 挂账" />
				<AppInput v-model="form.amountReceived" label="已收金额" placeholder="数字" />
				<AppInput v-model="form.paymentNote" label="备注" placeholder="可选" />
			</AppCard>
		</AppSection>

		<AppSection>
			<AppButton @click="onSubmit">保存</AppButton>
			<AppButton kind="ghost" @click="onCancel">取消</AppButton>
		</AppSection>
	</AppPage>
</template>

<script setup>
import { reactive } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppCard from '@/components/base/AppCard.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import { normalizeSaleDraft } from '@/services/models'

const form = reactive({
	date: '',
	customerName: '',
	deliveryMan: '',
	vehicleNo: '',
	priceUnit: 'kg',
	unitPrice: '',
	flowPrev: '',
	flowCurr: '',
	flowVolume: '',
	flowRatio: '',
	truckNo: '',
	truckOutGross: '',
	truckBackGross: '',
	truckSaleNet: '',
	paymentStatus: '未付',
	amountReceived: '',
	paymentNote: ''
})

function onSubmit() {
	const payload = normalizeSaleDraft({
		date: form.date,
		customerName: form.customerName,
		delivery1: form.deliveryMan,
		carNo: form.vehicleNo,
		priceUnit: form.priceUnit,
		unitPrice: form.unitPrice,
		flow_index_prev: form.flowPrev,
		flow_index_curr: form.flowCurr,
		flow_volume_m3: form.flowVolume,
		flow_theory_ratio: form.flowRatio,
		truckNo: form.truckNo,
		truckOutGross: form.truckOutGross,
		truckBackGross: form.truckBackGross,
		truckSaleNet: form.truckSaleNet,
		paymentStatus: form.paymentStatus,
		amountReceived: form.amountReceived,
		paymentNote: form.paymentNote,
		outItems: [],
		backItems: [],
		depositRows: [],
		agentSaleRows: []
	})
	void payload
}

function onCancel() {}
</script>

<style scoped>
</style>
