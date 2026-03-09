<template>
	<AppPage :title="isEdit ? '编辑凭证' : '录入凭证'" subtitle="借贷必相等">
		<AppSection title="基本信息">
			<view class="form-row">
				<view class="field">
					<text class="field__label">日期</text>
					<picker mode="date" @change="onDateChange">
						<view class="picker-box">
							{{ form.date || '请选择日期' }}
						</view>
					</picker>
				</view>
				<AppInput v-model="form.summary" label="凭证摘要" placeholder="例如：收到货款" />
			</view>
		</AppSection>

		<AppSection title="分录明细" :subtitle="`借: ${totalDebit} / 贷: ${totalCredit}`">
			<view v-for="(entry, index) in form.entries" :key="index" class="entry-card">
				<view class="entry-header">
					<text class="entry-index">#{{ index + 1 }}</text>
					<text class="entry-delete" @click="removeEntry(index)" v-if="form.entries.length > 2">删除</text>
				</view>
				
				<view class="field">
					<text class="field__label">科目</text>
					<picker :range="accountList" range-key="label" @change="(e) => onAccountChange(e, index)">
						<view class="picker-box">
							{{ entry.account_name ? `${entry.account_code} ${entry.account_name}` : '选择科目' }}
						</view>
					</picker>
				</view>
				
				<view class="entry-row">
					<view class="field">
						<text class="field__label">方向</text>
						<picker :range="directions" @change="(e) => onDirectionChange(e, index)">
							<view class="picker-box">
								{{ entry.direction || '选择' }}
							</view>
						</picker>
					</view>
					<AppInput v-model="entry.amount" label="金额" type="digit" placeholder="0.00" />
				</view>

				<AppInput v-model="entry.summary" label="分录摘要" placeholder="同凭证摘要" />
			</view>

			<AppButton kind="ghost" @click="addEntry">+ 添加分录</AppButton>
		</AppSection>

		<view class="actions">
			<view v-if="isEdit && form.status === 'draft'">
				<AppButton kind="primary" @click="postVoucher" :loading="posting">过账</AppButton>
			</view>
			<view v-if="isEdit && form.status === 'posted'">
				<AppButton kind="danger" @click="unpostVoucher" :loading="posting">反过账</AppButton>
			</view>
			<AppButton @click="submit" :loading="submitting" :disabled="form.status === 'posted'">保存</AppButton>
		</view>
	</AppPage>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppButton from '@/components/base/AppButton.vue'
import { createVoucherV1, updateVoucherV1, getVoucherV1, postVoucherV1, unpostVoucherV1 } from '@/services/voucher'
import { listAccountsV1 } from '@/services/account'

const directions = ['借', '贷']
const isEdit = ref(false)
const submitting = ref(false)
const posting = ref(false)
const accountList = ref([])

const form = reactive({
	_id: '',
	date: new Date().toISOString().split('T')[0],
	summary: '',
	status: 'draft',
	entries: [
		{ account_code: '', account_name: '', direction: '借', amount: '', summary: '' },
		{ account_code: '', account_name: '', direction: '贷', amount: '', summary: '' }
	]
})

onLoad(async (options) => {
	await loadAccounts()
	if (options.id) {
		isEdit.value = true
		await loadDetail(options.id)
	}
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

async function loadDetail(id) {
	try {
		const res = await getVoucherV1({ id })
		if (res.data) {
			Object.assign(form, res.data)
		}
	} catch (e) {
		uni.showToast({ title: '加载失败', icon: 'none' })
	}
}

function onDateChange(e) {
	form.date = e.detail.value
}

function onAccountChange(e, index) {
	const idx = e.detail.value
	const account = accountList.value[idx]
	form.entries[index].account_code = account.code
	form.entries[index].account_name = account.name
}

function onDirectionChange(e, index) {
	form.entries[index].direction = directions[e.detail.value]
}

function addEntry() {
	form.entries.push({ account_code: '', account_name: '', direction: '借', amount: '', summary: form.summary })
}

function removeEntry(index) {
	form.entries.splice(index, 1)
}

const totalDebit = computed(() => {
	return form.entries
		.filter(e => e.direction === '借')
		.reduce((sum, e) => sum + Number(e.amount || 0), 0)
		.toFixed(2)
})

const totalCredit = computed(() => {
	return form.entries
		.filter(e => e.direction === '贷')
		.reduce((sum, e) => sum + Number(e.amount || 0), 0)
		.toFixed(2)
})

async function submit() {
	if (totalDebit.value !== totalCredit.value) {
		uni.showToast({ title: '借贷不平衡', icon: 'none' })
		return
	}
	if (!form.date || !form.summary) {
		uni.showToast({ title: '请填写日期和摘要', icon: 'none' })
		return
	}

	try {
		submitting.value = true
		if (isEdit.value) {
			await updateVoucherV1(form)
		} else {
			await createVoucherV1(form)
		}
		uni.showToast({ title: '保存成功' })
		setTimeout(() => uni.navigateBack(), 1000)
	} catch (e) {
		console.error(e)
		uni.showToast({ title: '保存失败', icon: 'none' })
	} finally {
		submitting.value = false
	}
}

async function postVoucher() {
	try {
		posting.value = true
		await postVoucherV1({ _id: form._id })
		uni.showToast({ title: '过账成功' })
		loadDetail(form._id)
	} catch (e) {
		uni.showToast({ title: '过账失败', icon: 'none' })
	} finally {
		posting.value = false
	}
}

async function unpostVoucher() {
	try {
		posting.value = true
		await unpostVoucherV1({ _id: form._id })
		uni.showToast({ title: '反过账成功' })
		loadDetail(form._id)
	} catch (e) {
		uni.showToast({ title: '操作失败', icon: 'none' })
	} finally {
		posting.value = false
	}
}
</script>

<style scoped>
.form-row, .entry-row {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 20rpx;
}
.field {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}
.field__label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
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
.entry-card {
	background: var(--crm-bg);
	padding: 20rpx;
	border-radius: 12rpx;
	margin-bottom: 20rpx;
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}
.entry-header {
	display: flex;
	justify-content: space-between;
	font-size: 24rpx;
	font-weight: bold;
}
.entry-delete {
	color: #ef4444;
}
.actions {
	margin-top: 40rpx;
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}
</style>
