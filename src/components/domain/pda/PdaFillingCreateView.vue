<template>
	<AppPage title="灌装录入" subtitle="normal_fill" icon="document" hideBottleQuery>
		<AppSection title="单据字段">
			<view class="form-grid">
				<picker class="picker-block" mode="date" :value="form.date" @change="onDateChange">
					<view class="picker-trigger">
						<AppInput :model-value="form.date" label="日期" readonly placeholder="请选择日期" />
					</view>
				</picker>
				<PdaBottleSuggestField
					v-model="form.bottleNo"
					label="瓶号"
					placeholder="请输入钢瓶号"
					@blur="normalizeBottleInput"
					@confirm="normalizeBottleInput"
				/>
				<AppInput v-model="form.fillWeight" label="灌装重量(kg)" placeholder="请输入灌装重量" type="digit" />
				<AppInput :model-value="form.operator" label="操作员" readonly />
			</view>
			<view class="textarea-field">
				<text class="textarea-label">备注</text>
				<textarea v-model="form.remark" class="textarea-control" maxlength="120" placeholder="可选备注" />
			</view>
			<view class="actions-row">
				<AppButton kind="neutral" @click="goBottleQuery">查钢瓶</AppButton>
				<AppButton :loading="submitting" @click="onSubmit">提交灌装单</AppButton>
			</view>
		</AppSection>
	</AppPage>
</template>

<script setup>
import { watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import PdaBottleSuggestField from '@/components/domain/pda/PdaBottleSuggestField.vue'
import { usePdaFillingForm } from '@/composables/pda/usePdaFillingForm'
import { normalizeBottleNo } from '@/services/pda/shared'

const props = defineProps({
	initialBottleNo: { type: String, default: '' }
})

const { form, submitting, normalizeBottleInput, submit } = usePdaFillingForm()

watch(
	() => props.initialBottleNo,
	(value) => {
		const bottleNo = normalizeBottleNo(value)
		if (bottleNo) form.value.bottleNo = bottleNo
	},
	{ immediate: true }
)

function onDateChange(event) {
	form.value.date = event?.detail?.value || form.value.date
}

function goBottleQuery() {
	const bottleNo = normalizeBottleNo(form.value.bottleNo)
	uni.navigateTo({
		url: bottleNo ? `/pages/pda/bottle-query?keyword=${encodeURIComponent(bottleNo)}` : '/pages/pda/bottle-query'
	})
}

async function onSubmit() {
	const res = await submit()
	uni.showToast({
		title: res?.code === 0 ? '灌装单已提交' : res?.msg || '提交失败',
		icon: 'none'
	})
}
</script>

<style scoped>
.form-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 20rpx;
}

.textarea-field {
	margin-top: 24rpx;
	display: flex;
	flex-direction: column;
	gap: 10rpx;
}

.textarea-label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
}

.textarea-control {
	min-height: 180rpx;
	padding: 20rpx 24rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	font-size: 28rpx;
	color: var(--crm-text);
	box-sizing: border-box;
}

.actions-row {
	margin-top: 24rpx;
	display: flex;
	gap: 16rpx;
	justify-content: flex-end;
}

@media (max-width: 680px) {
	.form-grid {
		grid-template-columns: 1fr;
	}
}
</style>
