<template>
	<AppPage :title="isEdit ? '编辑科目' : '新增科目'" subtitle="维护会计科目信息">
		<AppSection title="基本信息">
			<AppInput v-model="form.code" label="科目代码" placeholder="例如：1001" :disabled="isEdit" />
			<AppInput v-model="form.name" label="科目名称" placeholder="例如：库存现金" />
			
			<view class="form-row">
				<view class="field">
					<text class="field__label">科目类别</text>
					<picker :range="types" @change="onTypeChange">
						<view class="picker-box">
							{{ form.type || '请选择' }}
						</view>
					</picker>
				</view>
				<view class="field">
					<text class="field__label">余额方向</text>
					<picker :range="directions" @change="onDirectionChange">
						<view class="picker-box">
							{{ form.direction || '请选择' }}
						</view>
					</picker>
				</view>
			</view>

			<AppInput v-model="form.level" label="级次" type="number" placeholder="1" />
			<AppInput v-model="form.parent_code" label="上级科目代码" placeholder="为空则为一级科目" />
			<AppInput v-model="form.remark" label="备注" placeholder="选填" />
		</AppSection>

		<AppSection title="状态">
			<view class="switch-row">
				<text>是否启用</text>
				<switch :checked="form.is_active" @change="e => form.is_active = e.detail.value" />
			</view>
		</AppSection>

		<view class="actions">
			<AppButton kind="primary" @click="submit" :loading="submitting">保存</AppButton>
		</view>
	</AppPage>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppButton from '@/components/base/AppButton.vue'
import { createAccountV1, updateAccountV1, getAccountV1 } from '@/services/account'

const types = ['资产', '负债', '权益', '成本', '损益']
const directions = ['借', '贷']

const isEdit = ref(false)
const submitting = ref(false)
const form = reactive({
	_id: '',
	code: '',
	name: '',
	type: '',
	direction: '',
	level: '1',
	parent_code: '',
	is_active: true,
	remark: ''
})

onLoad(async (options) => {
	if (options.id) {
		isEdit.value = true
		await loadDetail(options.id)
	}
})

async function loadDetail(id) {
	try {
		const res = await getAccountV1({ id })
		if (res.data) {
			Object.assign(form, res.data)
		}
	} catch (e) {
		uni.showToast({ title: '加载失败', icon: 'none' })
	}
}

function onTypeChange(e) {
	form.type = types[e.detail.value]
}

function onDirectionChange(e) {
	form.direction = directions[e.detail.value]
}

async function submit() {
	if (!form.code || !form.name || !form.type || !form.direction) {
		uni.showToast({ title: '请填写完整', icon: 'none' })
		return
	}

	try {
		submitting.value = true
		if (isEdit.value) {
			await updateAccountV1(form)
		} else {
			await createAccountV1(form)
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
</script>

<style scoped>
.form-row {
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
.switch-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 10rpx 0;
}
.actions {
	margin-top: 40rpx;
}
</style>
