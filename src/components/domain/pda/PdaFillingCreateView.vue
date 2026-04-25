<template>
	<AppPage title="灌装录入" subtitle="normal_fill" icon="document" hideBottleQuery>
		<AppSection title="单据字段">
			<view :class="['barcode-status', barcodeSessionReady ? 'barcode-status--active' : '']">
				<text class="barcode-status__title">物理扫码</text>
				<text class="barcode-status__text">当前目标：{{ barcodeTargetLabel }}</text>
				<text class="barcode-status__text">{{ barcodeHint }}</text>
				<text v-if="lastBarcodeText" class="barcode-status__text">最近扫码：{{ lastBarcodeText }}</text>
			</view>
			<view :class="['scale-card', `scale-card--${scaleStatusKind}`]">
				<view class="scale-card__head">
					<view class="scale-card__head-text">
						<text class="scale-card__title">C606+称重仪表</text>
						<text class="scale-card__status">{{ scaleStatusText }}</text>
					</view>
					<AppButton size="sm" kind="neutral" :loading="scaleLoading" @click.stop="onRefreshScale">立即刷新</AppButton>
				</view>
				<view class="scale-grid">
					<view class="scale-cell">
						<text class="scale-cell__label">当前重量</text>
						<text class="scale-cell__value">{{ scaleWeightText }}</text>
					</view>
					<view class="scale-cell">
						<text class="scale-cell__label">稳定状态</text>
						<text class="scale-cell__value">{{ scaleSnapshot.isStable ? '稳定' : '未稳定' }}</text>
					</view>
					<view class="scale-cell">
						<text class="scale-cell__label">通讯状态</text>
						<text class="scale-cell__value">{{ scaleSnapshot.isOnline ? '在线' : '离线' }}</text>
					</view>
					<view class="scale-cell">
						<text class="scale-cell__label">最后更新时间</text>
						<text class="scale-cell__value">{{ scaleLastUpdatedText }}</text>
					</view>
				</view>
				<text v-if="scaleErrorText" class="scale-card__error">{{ scaleErrorText }}</text>
			</view>
			<view class="form-grid">
				<picker class="picker-block" mode="date" :value="form.date" @change="onDateChange">
					<view class="picker-trigger">
						<AppInput :model-value="form.date" label="日期" readonly placeholder="请选择日期" />
					</view>
				</picker>
				<view :class="['capture-field', isBarcodeTargetActive(PDA_CAPTURE_TARGETS.FILLING_BOTTLE_NO) ? 'capture-field--active' : '']" @click="onActivateBottleBarcode()">
					<PdaBottleSuggestField
						v-model="form.bottleNo"
						label="瓶号"
						placeholder="请输入钢瓶号"
						@blur="normalizeBottleInput"
						@confirm="normalizeBottleInput"
						@input="onBottleInput"
						@focus="onActivateBottleBarcode(false)"
						@select="onBottleSelected"
					/>
					<view class="capture-actions">
						<AppButton size="sm" kind="neutral" @click.stop="onActivateBottleBarcode">扫码瓶号</AppButton>
					</view>
				</view>
				<view class="capture-field">
					<AppInput
						v-model="form.afterFillTotalWeight"
						label="充后总重(kg)"
						placeholder="用于换算灌装重量"
						type="digit"
						@input="onAfterFillTotalWeightInput"
					/>
					<view class="capture-actions">
						<AppButton size="sm" kind="neutral" :loading="resolvingFillWeight" @click.stop="onResolveFillWeight">按总重换算</AppButton>
					</view>
					<text class="capture-hint">{{ totalWeightHint }}</text>
				</view>
				<AppInput v-model="form.fillWeight" label="灌装重量(kg)" placeholder="请输入灌装重量" type="digit" />
				<AppInput :model-value="form.operator" label="操作员" readonly />
			</view>
			<text v-if="form.fillWeightResolved" class="hint-text">已按当前瓶号和{{ fillWeightSourceText }}完成灌装重量换算，可继续人工校对后提交。</text>
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
import { computed, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import PdaBottleSuggestField from '@/components/domain/pda/PdaBottleSuggestField.vue'
import { usePdaFillingForm } from '@/composables/pda/usePdaFillingForm'
import { usePdaScale } from '@/composables/pda/usePdaScale'
import { resolvePdaBottleByQrCode } from '@/services/pda/bottle'
import { enterBarcodeSession, leaveBarcodeSession, PDA_CAPTURE_TARGETS, setActiveBarcodeTarget } from '@/services/pda/capture'
import { normalizeBottleNo, normalizeQrCode, normalizeText } from '@/services/pda/shared'

const props = defineProps({
	initialBottleNo: { type: String, default: '' }
})

const { form, submitting, resolvingFillWeight, normalizeBottleInput, applyBottleSelection, setAfterFillTotalWeight, resolveFillWeightFromTotal, submit } =
	usePdaFillingForm()
const {
	snapshot: scaleSnapshot,
	loading: scaleLoading,
	requestError: scaleRequestError,
	weightText: scaleWeightText,
	statusText: scaleStatusText,
	statusKind: scaleStatusKind,
	lastUpdatedText: scaleLastUpdatedText,
	usableStableSnapshot,
	refresh: refreshScale,
	resumePolling,
	pausePolling
} = usePdaScale({ scaleCode: 'filling_scale_main' })
const barcodeSessionReady = ref(false)
const activeBarcodeTarget = ref(PDA_CAPTURE_TARGETS.FILLING_BOTTLE_NO)
const barcodeHint = ref('进入页面后可直接按 PDA 扫码键录入瓶号。')
const lastBarcodeText = ref('')

const barcodeTargetLabel = computed(() => {
	if (activeBarcodeTarget.value === PDA_CAPTURE_TARGETS.FILLING_BOTTLE_NO) return '瓶号'
	return '未启用'
})

const scaleErrorText = computed(() => {
	if (scaleRequestError.value) return scaleRequestError.value
	if (!scaleSnapshot.value.hasData) return scaleSnapshot.value.errorMessage || ''
	if (!scaleSnapshot.value.isOnline) return scaleSnapshot.value.errorMessage || '秤离线'
	return ''
})

const totalWeightHint = computed(() => {
	const manualText = normalizeText(form.value.afterFillTotalWeight)
	if (manualText) return '已录入手工总重，换算时会优先生效。'
	if (usableStableSnapshot.value?.weightKg > 0) {
		return `当前 C606+ 稳定毛重 ${Number(usableStableSnapshot.value.weightKg).toFixed(3)} kg，留空可直接按总重换算。`
	}
	if (scaleSnapshot.value.isOnline) return 'C606+ 在线但当前未稳定，手工输入仍可兜底。'
	return '可手工输入；留空时会尝试使用 C606+ 稳定毛重。'
})

const fillWeightSourceText = computed(() => (form.value.captureMeta?.totalWeight?.source === 'scale_gateway' ? 'C606+稳定毛重' : '总重'))

watch(
	() => props.initialBottleNo,
	(value) => {
		const bottleNo = normalizeBottleNo(value)
		if (bottleNo) form.value.bottleNo = bottleNo
	},
	{ immediate: true }
)

function buildBottleTargetMeta() {
	return {
		page: 'pda-filling',
		target: PDA_CAPTURE_TARGETS.FILLING_BOTTLE_NO,
		label: '瓶号',
		scope: 'filling',
		field: 'bottleNo'
	}
}

function onDateChange(event) {
	form.value.date = event?.detail?.value || form.value.date
}

function onBottleInput() {
	form.value.fillWeightResolved = false
}

function onBottleSelected(bottle) {
	applyBottleSelection(bottle)
	form.value.fillWeightResolved = false
}

function isBarcodeTargetActive(target) {
	return activeBarcodeTarget.value === target
}

async function activateBarcodeTarget(targetMeta, options = {}) {
	const res = await setActiveBarcodeTarget(targetMeta)
	if (res?.code !== 0) {
		barcodeHint.value = res?.msg || '物理扫码目标设置失败'
		if (options.toast !== false) showToast(barcodeHint.value)
		return res
	}
	activeBarcodeTarget.value = targetMeta?.target || ''
	barcodeHint.value = targetMeta?.label ? `当前目标：${targetMeta.label}，请按 PDA 扫码键。` : '当前未启用物理扫码目标。'
	if (options.toast !== false && targetMeta?.label) showToast(`已切换到${targetMeta.label}扫码`)
	return res
}

async function activateBarcodeSession() {
	void resumePolling()
	const sessionRes = await enterBarcodeSession({
		page: 'pda-filling',
		onResult: onBarcodeScanned
	})
	if (sessionRes?.code !== 0) {
		barcodeSessionReady.value = false
		barcodeHint.value = sessionRes?.msg || '物理扫码会话初始化失败'
		return sessionRes
	}
	barcodeSessionReady.value = true
	return activateBarcodeTarget(buildBottleTargetMeta(), { toast: false })
}

async function deactivateBarcodeSession(reason = '') {
	barcodeSessionReady.value = false
	pausePolling()
	return leaveBarcodeSession({ page: 'pda-filling', reason })
}

async function onActivateBottleBarcode(showTip = true) {
	if (!barcodeSessionReady.value) {
		const readyRes = await activateBarcodeSession()
		if (readyRes?.code !== 0) return
	}
	await activateBarcodeTarget(buildBottleTargetMeta(), { toast: showTip })
}

async function onBarcodeScanned(payload = {}) {
	const rawText = normalizeQrCode(payload?.rawText)
	lastBarcodeText.value = rawText
	if (!rawText) {
		barcodeHint.value = '未读取到有效钢瓶二维码，请重试或手工输入瓶号。'
		showToast('扫码内容无效，请重试')
		return
	}
	barcodeHint.value = `已收到${payload?.symbology || '条码'}，正在匹配钢瓶。`
	const bottleRes = await resolvePdaBottleByQrCode(rawText)
	if (bottleRes?.code !== 0 || !bottleRes?.data) {
		barcodeHint.value = '未命中钢瓶 PDA 码，请改用手工输入。'
		showToast(bottleRes?.msg || '未找到匹配钢瓶')
		return
	}
	applyBottleSelection(bottleRes.data)
	form.value.fillWeightResolved = false
	barcodeHint.value = `已回填瓶号 ${bottleRes.data.bottle_no || ''}。`
	showToast(`已回填 ${bottleRes.data.bottle_no || ''}`)
}

function onAfterFillTotalWeightInput(value) {
	setAfterFillTotalWeight(value, {
		source: 'manual',
		raw: value == null ? '' : String(value),
		scale_code: '',
		sampled_at: null,
		gateway_at: null
	})
}

function goBottleQuery() {
	const bottleNo = normalizeBottleNo(form.value.bottleNo)
	uni.navigateTo({
		url: bottleNo ? `/pages/pda/bottle-query?keyword=${encodeURIComponent(bottleNo)}` : '/pages/pda/bottle-query'
	})
}

function showToast(message) {
	uni.showToast({ title: message, icon: 'none' })
}

async function onResolveFillWeight() {
	const res = await resolveFillWeightFromTotal({
		scaleSnapshot: usableStableSnapshot.value || scaleSnapshot.value
	})
	showToast(res?.code === 0 ? '灌装重量已换算' : res?.msg || '换算失败')
}

async function onRefreshScale() {
	const res = await refreshScale()
	showToast(res?.code === 0 ? '秤状态已刷新' : res?.msg || '秤状态刷新失败')
}

async function onSubmit() {
	const res = await submit()
	showToast(res?.code === 0 ? '灌装单已提交' : res?.msg || '提交失败')
}

defineExpose({
	activateBarcodeSession,
	deactivateBarcodeSession
})
</script>

<style scoped>
.barcode-status {
	margin-bottom: 20rpx;
	padding: 18rpx 20rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid #dbeafe;
	background: #f8fbff;
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.barcode-status--active {
	border-color: #93c5fd;
	background: #eff6ff;
}

.barcode-status__title {
	font-size: 24rpx;
	font-weight: 700;
	color: #0b5cab;
}

.barcode-status__text {
	font-size: 22rpx;
	color: var(--crm-text-muted);
	line-height: 1.5;
}

.scale-card {
	margin-bottom: 20rpx;
	padding: 20rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid #dbeafe;
	background: #f8fbff;
	display: flex;
	flex-direction: column;
	gap: 16rpx;
}

.scale-card--stable {
	border-color: #86efac;
	background: #f0fdf4;
}

.scale-card--moving {
	border-color: #fcd34d;
	background: #fffbeb;
}

.scale-card--offline {
	border-color: #fecaca;
	background: #fef2f2;
}

.scale-card__head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16rpx;
}

.scale-card__head-text {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.scale-card__title {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.scale-card__status {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.scale-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16rpx;
}

.scale-cell {
	padding: 16rpx;
	border-radius: var(--crm-radius-sm);
	background: rgba(255, 255, 255, 0.76);
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.scale-cell__label {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.scale-cell__value {
	font-size: 28rpx;
	font-weight: 700;
	color: var(--crm-text);
	word-break: break-all;
}

.scale-card__error {
	font-size: 22rpx;
	color: #b91c1c;
	line-height: 1.5;
}

.form-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 20rpx;
}

.capture-field {
	display: flex;
	flex-direction: column;
	gap: 12rpx;
}

.capture-field--active {
	padding: 16rpx;
	border-radius: var(--crm-radius-sm);
	border: 1rpx solid #93c5fd;
	background: #f8fbff;
}

.capture-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
}

.capture-hint {
	font-size: 22rpx;
	line-height: 1.6;
	color: var(--crm-text-muted);
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

.hint-text {
	margin-top: 16rpx;
	display: block;
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

@media (max-width: 680px) {
	.form-grid {
		grid-template-columns: 1fr;
	}

	.scale-grid {
		grid-template-columns: 1fr;
	}
}
</style>
