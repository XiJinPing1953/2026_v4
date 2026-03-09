<template>
	<AppPage :title="recordId ? '编辑凭证' : '新建凭证'" subtitle="VOUCHER ENTRY" icon="document">
		<template #headerActions>
			<AppButton size="sm" kind="neutral" :disabled="submitting" @click="onCancel">取消</AppButton>
			<AppButton size="sm" kind="primary" :loading="submitting" icon="check-circle" @click="onSubmit">保存</AppButton>
		</template>

		<view class="edit-container">
			<AppCard class="edit-header-card" padding="20rpx">
				<view class="edit-header-info">
					<view class="info-pill">
						<text class="pill-label">日期</text>
						<text class="pill-value">{{ form.date }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">凭证号</text>
						<text class="pill-value">{{ voucherNoSummary }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">借方合计</text>
						<text class="pill-value">{{ totalDebit }}</text>
					</view>
					<view class="info-pill">
						<text class="pill-label">贷方合计</text>
						<text class="pill-value">{{ totalCredit }}</text>
					</view>
				</view>
			</AppCard>

			<view class="form-body">
				<AppSection title="凭证信息">
					<view class="form-grid">
						<view class="form-item span-2">
							<picker class="picker-block" mode="date" :value="form.date" @change="onDateChange">
								<view class="picker-trigger">
									<AppInput :model-value="form.date" label="日期" placeholder="YYYY-MM-DD" disabled size="sm" />
								</view>
							</picker>
						</view>
						<view class="form-item">
							<AppInput v-model="form.voucher_no" label="凭证号" placeholder="可选" size="sm" />
						</view>
						<view class="form-item">
							<AppInput v-model="form.summary" label="摘要" placeholder="必填" size="sm" />
						</view>
					</view>
				</AppSection>

				<AppSection title="分录">
					<view class="entry-card">
						<view v-if="entries.length === 0" class="entry-empty">
							<AppEmpty title="暂无分录" subtitle="点击下方按钮新增" />
						</view>
						<view v-else class="entry-list">
							<view v-for="(row, index) in entries" :key="index" class="entry-item">
								<view class="entry-grid">
									<AppInput v-model="row.account_code" label="科目编码" placeholder="必填" size="sm" />
									<AppInput v-model="row.account_name" label="科目名称" placeholder="必填" size="sm" />
									<picker class="picker-block" mode="selector" :range="directionOptions" range-key="label" @change="(e) => onDirectionChange(index, e)">
										<view class="picker-trigger">
											<AppInput :model-value="directionLabel(row.direction)" label="方向" disabled size="sm" />
										</view>
									</picker>
									<AppInput v-model="row.amount" label="金额" placeholder="数字" size="sm" />
									<AppInput v-model="row.summary" label="摘要" placeholder="可选" size="sm" />
								</view>
								<view class="entry-actions">
									<AppButton kind="ghost" size="sm" @click="removeEntry(index)">删除</AppButton>
								</view>
							</view>
						</view>
						<view class="summary">
							<text>借 {{ totalDebit }}</text>
							<text>贷 {{ totalCredit }}</text>
						</view>
						<view class="actions">
							<AppButton kind="ghost" @click="addEntry">新增分录</AppButton>
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
import AppEmpty from '@/components/base/AppEmpty.vue'
import { createVoucherV1, getVoucherV1, updateVoucherV1 } from '@/services/voucher'
import { validateVoucherDraftV1 } from '@/services/models'

const props = defineProps({
	recordId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')
const submitting = ref(false)
const initialized = ref(false)

function formatTodayUtc8() {
	const now = new Date()
	const utc8Time = now.getTime() + 8 * 60 * 60 * 1000
	const date = new Date(utc8Time)
	const y = date.getUTCFullYear()
	const m = String(date.getUTCMonth() + 1).padStart(2, '0')
	const d = String(date.getUTCDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

const form = reactive({
	date: formatTodayUtc8(),
	voucher_no: '',
	summary: ''
})

const entries = ref([])

const directionOptions = [
	{ label: '借', value: 'debit' },
	{ label: '贷', value: 'credit' }
]

const totalDebit = computed(() =>
	entries.value
		.reduce((sum, row) => (row.direction === 'debit' ? sum + Number(row.amount || 0) : sum), 0)
		.toFixed(2)
)
const totalCredit = computed(() =>
	entries.value
		.reduce((sum, row) => (row.direction === 'credit' ? sum + Number(row.amount || 0) : sum), 0)
		.toFixed(2)
)

const voucherNoSummary = computed(() => String(form.voucher_no || '').trim() || '自动生成')

function directionLabel(direction) {
	return direction === 'credit' ? '贷' : '借'
}

function onDirectionChange(index, e) {
	const idx = Number(e?.detail?.value)
	const item = directionOptions[idx]
	if (!item) return
	entries.value[index].direction = item.value
}

function addEntry() {
	entries.value.push({
		account_code: '',
		account_name: '',
		direction: 'debit',
		amount: '',
		summary: ''
	})
}

function removeEntry(index) {
	entries.value.splice(index, 1)
}

function onDateChange(e) {
	form.date = e?.detail?.value || ''
}

async function loadRecord(id) {
	const res = await getVoucherV1({ _id: id })
	if (res?.code !== 0 || !res?.data) {
		uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
		return
	}
	const doc = res.data
	form.date = doc.date || form.date
	form.voucher_no = doc.voucher_no || ''
	form.summary = doc.summary || ''
	entries.value = Array.isArray(doc.entries)
		? doc.entries.map((row) => ({
			account_code: row.account_code || '',
			account_name: row.account_name || '',
			direction: row.direction || 'debit',
			amount: row.amount == null ? '' : String(row.amount),
			summary: row.summary || ''
		}))
		: []
}

watch(
	recordId,
	async (id) => {
		if (initialized.value) return
		initialized.value = true
		if (!id) {
			addEntry()
			addEntry()
			return
		}
		await loadRecord(String(id))
	},
	{ immediate: true }
)

async function onSubmit() {
	if (submitting.value) return
	const payload = {
		date: form.date,
		voucher_no: String(form.voucher_no || '').trim(),
		summary: String(form.summary || '').trim(),
		entries: entries.value.map((row) => ({
			account_code: String(row.account_code || '').trim(),
			account_name: String(row.account_name || '').trim(),
			direction: row.direction,
			amount: Number(row.amount),
			summary: String(row.summary || '').trim()
		}))
	}
	const validation = validateVoucherDraftV1(payload)
	if (!validation.ok) {
		uni.showToast({ title: validation.msg || '校验失败', icon: 'none' })
		return
	}

	submitting.value = true
	try {
		const result = recordId.value
			? await updateVoucherV1({ _id: recordId.value, ...payload })
			: await createVoucherV1(payload)
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
		console.error('save voucher failed', err)
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

.entry-card {
	background: #fff;
	border: 1rpx solid var(--crm-border);
	border-radius: 16rpx;
	padding: 20rpx;
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.entry-list {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.entry-item {
	border: 1rpx solid #eef2f7;
	border-radius: 16rpx;
	padding: 16rpx;
	background: #f8fafc;
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.entry-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12rpx;
}

.entry-actions {
	display: flex;
	justify-content: flex-end;
}

.entry-empty {
	padding: 16rpx 0;
}

.summary {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 8rpx 12rpx;
	background: rgba(37, 99, 235, 0.08);
	border-radius: 12rpx;
}

.actions {
	display: flex;
	justify-content: flex-end;
}

.safe-area-bottom {
	height: constant(safe-area-inset-bottom);
	height: env(safe-area-inset-bottom);
}

.picker-block {
	display: block;
	width: 100%;
}

.picker-trigger {
	pointer-events: none;
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
	.entry-grid {
		grid-template-columns: 1fr;
	}
}
</style>
