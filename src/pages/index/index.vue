<template>
	<AppPage title="工作台" subtitle="CRM 概览与快捷入口">
		<AppSection title="概览">
			<view class="grid">
				<AppStatCard label="异常" :value="stats.anomaly" hint="待处理" />
				<AppStatCard label="本月销售" :value="stats.sales" hint="元" />
				<AppStatCard label="在客户" :value="stats.atCustomer" hint="瓶" />
				<AppStatCard label="在站" :value="stats.inStation" hint="瓶" />
			</view>
		</AppSection>

		<AppSection title="快捷操作">
			<view class="actions">
				<AppButton @click="go('/pages/sale/edit')">新增销售记录</AppButton>
				<AppButton kind="ghost" @click="go('/pages/bottle/anomaly')">流转异常</AppButton>
			</view>
		</AppSection>

		<AppSection title="提示">
			<AppEmpty title="已完成基础骨架" subtitle="下一步开始迁移销售/瓶子核心页面" />
		</AppSection>
	</AppPage>
</template>

<script setup>
import { reactive } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppEmpty from '@/components/base/AppEmpty.vue'
import { useAuthGuard } from '@/composables/useAuthGuard'

const { requireLogin } = useAuthGuard()
requireLogin()

const stats = reactive({
	anomaly: '-',
	sales: '-',
	atCustomer: '-',
	inStation: '-'
})

function go(url) {
	uni.navigateTo({ url })
}
</script>

<style scoped>
.grid {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: 12rpx;
}
.actions {
	display: flex;
	gap: 12rpx;
	flex-direction: column;
}
</style>
