<template>
	<AppPage :title="recordId ? '修改科目' : '新建科目'" subtitle="ACCOUNT PROFILE" icon="list">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="submitting" @click="onCancel">取消</AppButton>
			<AppButton size="sm" kind="primary" :loading="submitting" icon="check-circle" @click="onSubmit">保存</AppButton>
		</template>

		<view class="edit-container">
			<AppCard class="edit-header-card" padding="20rpx">
				<view class="edit-header-info">
					<view class="info-pill">
						<text class="pill-label">科目类型</text>
						<text class="pill-value">{{ typeLabel }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">余额方向</text>
						<text class="pill-value">{{ directionLabel }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">启用状态</text>
						<text class="pill-value">{{ activeLabel }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">上级科目</text>
						<text class="pill-value">{{ parentSummary }}</text>
					</view>
				</view>
			</AppCard>

			<view class="form-body">
				<AppSection title="基础信息">
					<view class="form-grid">
						<view class="form-item">
							<AppInput v-model="form.code" label="科目编码" placeholder="必填" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.name" label="科目名称" placeholder="必填" size="sm" />
						</view>
						<view class="form-item">
							<picker class="picker-block" mode="selector" :range="typeOptions" range-key="label" @change="onTypeChange">
								<view class="picker-trigger">
									<AppInput :model-value="typeLabel" label="科目类型" disabled size="sm" />
								</view>
							</picker>
						</view>
						<view class="form-item">
							<picker class="picker-block" mode="selector" :range="directionOptions" range-key="label" @change="onDirectionChange">
								<view class="picker-trigger">
									<AppInput :model-value="directionLabel" label="余额方向" disabled size="sm" />
								</view>
							</picker>
						</view>
					</view>
				</AppSection>

				<AppSection title="层级与状态">
					<view class="form-grid">
						<view class="form-item">
							<AppInput v-model="form.parent_code" label="上级科目" placeholder="可选" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.level" label="级次" placeholder="可选" size="sm" />
						</view>
						<view class="form-item">
							<picker class="picker-block" mode="selector" :range="activeOptions" range-key="label" @change="onActiveChange">
								<view class="picker-trigger">
									<AppInput :model-value="activeLabel" label="状态" disabled size="sm" />
								</view>
							</picker>
						</view>
						<view class="form-item">
							<AppInput v-model="form.remark" label="备注" placeholder="可选" size="sm" />
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
import { createAccountV1, getAccountV1, updateAccountV1 } from '@/services/account'
import { validateAccountDraftV1 } from '@/services/models'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')
const submitting = ref(false)

const typeOptions = [
	{ label: '资产', value: 'asset' },
	{ label: '负债', value: 'liability' },
	{ label: '权益', value: 'equity' },
	{ label: '收入', value: 'revenue' },
	{ label: '费用', value: 'expense' },
	{ label: '成本', value: 'cost' },
	{ label: '其他', value: 'other' }
]

const directionOptions = [
	{ label: '借', value: 'debit' },
	{ label: '贷', value: 'credit' }
]

const activeOptions = [
	{ label: '启用', value: true },
	{ label: '停用', value: false }
]

const form = reactive({
	code: '',
	name: '',
	type: 'asset',
	direction: 'debit',
	level: '',
	parent_code: '',
	is_active: true,
	remark: ''
})

const typeLabel = computed(() => typeOptions.find((item) => item.value === form.type)?.label || '资产')
const directionLabel = computed(() => (form.direction === 'credit' ? '贷' : '借'))
const activeLabel = computed(() => (form.is_active ? '启用' : '停用'))
const parentSummary = computed(() => String(form.parent_code || '').trim() || '无')

function onTypeChange(e) {
	const idx = Number(e?.detail?.value)
	const item = typeOptions[idx]
	if (item) form.type = item.value
}

function onDirectionChange(e) {
	const idx = Number(e?.detail?.value)
	const item = directionOptions[idx]
	if (item) form.direction = item.value
}

function onActiveChange(e) {
	const idx = Number(e?.detail?.value)
	const item = activeOptions[idx]
	if (!item) return
	form.is_active = Boolean(item.value)
}

async function loadRecord(id) {
	const res = await getAccountV1({ _id: id })
	if (res?.code !== 0 || !res?.data) {
		uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
		return
	}
	const doc = res.data
	form.code = doc.code || ''
	form.name = doc.name || ''
	form.type = doc.type || 'asset'
	form.direction = doc.direction || 'debit'
	form.level = doc.level == null ? '' : String(doc.level)
	form.parent_code = doc.parent_code || ''
	form.is_active = Boolean(doc.is_active)
	form.remark = doc.remark || ''
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
	const validation = validateAccountDraftV1(form)
	if (!validation.ok) {
		uni.showToast({ title: validation.msg || '校验失败', icon: 'none' })
		return
	}

	submitting.value = true
	try {
		const payload = {
			code: String(form.code || '').trim(),
			name: String(form.name || '').trim(),
			type: form.type,
			direction: form.direction,
			parent_code: String(form.parent_code || '').trim() || null,
			is_active: form.is_active,
			remark: String(form.remark || '').trim()
		}
		if (String(form.level || '').trim()) {
			payload.level = Number(form.level)
		}

		const result = recordId.value
			? await updateAccountV1({ _id: recordId.value, ...payload })
			: await createAccountV1(payload)

		if (!result || typeof result.code !== 'number') {
			uni.showToast({ title: '保存失败：无返回结果', icon: 'none' })
			return
		}
		if (result.code !== 0) {
			uni.showToast({ title: result.msg || '保存失败', icon: 'none' })
			return
		}

		uni.showToast({ title: '保存成功', icon: 'success' })
		setTimeout(() => {
			uni.navigateBack({ delta: 1 })
		}, 400)
	} catch (err) {
		console.error('save account failed', err)
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

.safe-area-bottom {
	height: constant(safe-area-inset-bottom);
	height: env(safe-area-inset-bottom);
}

.picker-block {
	display: block;
	width: 100%;
}

.form-body :deep(.section__header) {
	padding: 12rpx 20rpx;
}

.form-body :deep(.section__body) {
	padding: 20rpx;
}

.picker-trigger {
	pointer-events: none;
}

@media (max-width: 720px) {
	.form-grid {
		grid-template-columns: 1fr;
	}
}
</style>
