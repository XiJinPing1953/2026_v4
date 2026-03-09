<template>
	<AppPage :title="recordId ? '修改钢瓶档案' : '新建钢瓶档案'" subtitle="BOTTLE PROFILE" icon="bottle">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="submitting" @click="onCancel">取消</AppButton>
			<AppButton size="sm" kind="primary" :loading="submitting" icon="check-circle" @click="onSubmit">
				保存钢瓶档案
			</AppButton>
		</template>

		<view class="edit-container">
			<AppCard class="edit-header-card" padding="20rpx">
				<view class="edit-header-info">
					<view class="info-pill">
						<text class="pill-label">流向状态</text>
						<text class="pill-value">{{ statusLabel }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">启用状态</text>
						<text class="pill-value">{{ activeLabel }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">标准皮重</text>
						<text class="pill-value">{{ tareSummary }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">当前客户</text>
						<text class="pill-value">{{ holderSummary }}</text>
					</view>
				</view>
			</AppCard>

			<view class="form-body">
				<AppSection title="基础信息">
					<view class="form-grid">
						<view class="form-item span-2">
							<AppInput v-model="form.bottle_no" label="钢瓶编号" placeholder="请输入瓶身上唯一编号" prefix-icon="bottle" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.tare_weight" label="标准皮重" placeholder="0.00" size="sm" />
						</view>
						<view class="form-item">
							<picker class="picker-full" mode="selector" :range="statusOptions" range-key="label" @change="onStatusChange">
								<AppInput :model-value="statusLabel" label="当前流向" placeholder="请选择状态" disabled prefix-icon="list" size="sm" />
							</picker>
						</view>
						<view class="form-item span-2">
							<AppInput v-model="form.current_customer_name" label="持有客户" placeholder="当前所在客户名称" prefix-icon="user" size="sm" />
						</view>
					</view>
				</AppSection>

				<AppSection title="档案管理">
					<view class="form-grid">
						<view class="form-item">
							<picker class="picker-full" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
								<AppInput :model-value="activeLabel" label="启用状态" disabled prefix-icon="list" size="sm" />
							</picker>
						</view>
						<view class="form-item span-2">
							<AppInput v-model="form.remark" label="档案备注" placeholder="检修记录或其他说明" size="sm" />
						</view>
					</view>
				</AppSection>
			</view>

			<view class="safe-area-bottom"></view>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, reactive, ref, toRef, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppCard from '@/components/base/AppCard.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import { createBottleV1, getBottleV1, updateBottleV1 } from '@/services/bottle'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')
const submitting = ref(false)

const statusOptions = [
	{ label: '未知状态', value: 'unknown' },
	{ label: '在站内', value: 'in_station' },
	{ label: '在客户', value: 'at_customer' },
	{ label: '已报废', value: 'scrapped' },
	{ label: '已丢失', value: 'lost' }
]

const activeOptions = [
	{ label: '启用中', value: true },
	{ label: '已停用', value: false }
]

const form = reactive({
	bottle_no: '',
	tare_weight: '',
	status: 'unknown',
	current_customer_name: '',
	remark: '',
	is_active: true
})

const statusLabel = computed(() => {
	const item = statusOptions.find((opt) => opt.value === form.status)
	return item?.label || '未知状态'
})

const activeLabel = computed(() => (form.is_active ? '启用中' : '已停用'))

const tareSummary = computed(() => {
	const value = String(form.tare_weight || '').trim()
	return value ? `${value} kg` : '未填写'
})

const holderSummary = computed(() => {
	const value = String(form.current_customer_name || '').trim()
	return value || '库内待命'
})

function onStatusChange(e) {
	const idx = Number(e?.detail?.value)
	const item = statusOptions[idx]
	if (item) form.status = item.value
}

function onActiveChange(e) {
	const idx = Number(e?.detail?.value)
	const item = activeOptions[idx]
	if (item) form.is_active = Boolean(item.value)
}

async function loadRecord(id) {
	const res = await getBottleV1({ _id: id })
	if (res?.code !== 0 || !res?.data) {
		uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
		return
	}
	const doc = res.data
	form.bottle_no = doc.bottle_no || ''
	form.tare_weight = doc.tare_weight == null ? '' : String(doc.tare_weight)
	form.status = doc.status || 'unknown'
	form.current_customer_name = doc.current_customer_name || ''
	form.remark = doc.remark || ''
	form.is_active = Boolean(doc.is_active)
}

watch(
	recordId,
	async (id) => {
		if (!id) return
		await loadRecord(String(id))
	},
	{ immediate: true }
)

async function onSubmit() {
	if (submitting.value) return
	if (!String(form.bottle_no || '').trim()) {
		uni.showToast({ title: '钢瓶号必填', icon: 'none' })
		return
	}

	submitting.value = true
	try {
		const payload = {
			bottle_no: String(form.bottle_no || '').trim(),
			tare_weight: String(form.tare_weight || '').trim() === '' ? null : Number(form.tare_weight),
			status: form.status,
			current_customer_name: String(form.current_customer_name || '').trim(),
			remark: String(form.remark || '').trim(),
			is_active: form.is_active
		}

		const result = recordId.value
			? await updateBottleV1({ _id: recordId.value, ...payload })
			: await createBottleV1(payload)

		if (result?.code !== 0) {
			uni.showToast({ title: result?.msg || '保存失败', icon: 'none' })
			return
		}

		uni.showToast({ title: '保存成功', icon: 'success' })
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 400)
	} catch (err) {
		console.error('save bottle failed', err)
		uni.showToast({ title: '保存失败', icon: 'none' })
	} finally {
		submitting.value = false
	}
}

function onCancel() {
	uni.navigateBack({ delta: 1 })
}
</script>

<style scoped>
.edit-container {
	padding-bottom: 48rpx;
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.edit-header-card {
	box-shadow: 0 12rpx 32rpx rgba(15, 23, 42, 0.06);
}

.edit-header-info {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220rpx, 1fr));
	gap: 16rpx;
}

.info-pill {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	padding: 12rpx 16rpx;
	background: #f8fafc;
	border: 1rpx solid #eef2f7;
	border-radius: 16rpx;
}

.pill-label {
	font-size: 18rpx;
	color: var(--crm-text-muted);
	text-transform: uppercase;
	letter-spacing: 0.6rpx;
}

.pill-value {
	font-size: 26rpx;
	color: var(--crm-text);
	font-weight: 700;
}

.form-body {
	display: flex;
	flex-direction: column;
	gap: 18rpx;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16rpx;
}

.form-item {
	display: flex;
	flex-direction: column;
}

.span-2 {
	grid-column: span 2;
}

.safe-area-bottom {
	height: constant(safe-area-inset-bottom);
	height: env(safe-area-inset-bottom);
}

.form-body :deep(.section__header) {
	padding: 12rpx 20rpx;
}

.form-body :deep(.section__body) {
	padding: 20rpx;
}

@media (max-width: 720px) {
	.form-grid {
		grid-template-columns: 1fr;
	}
	.span-2 {
		grid-column: auto;
	}
}
</style>
