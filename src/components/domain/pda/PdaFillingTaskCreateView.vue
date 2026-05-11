<template>
	<AppPage :title="title" subtitle="CREATE TASK" icon="document" hideBottleQuery>
		<template #headerActions>
			<AppButton size="sm" kind="neutral" @click="goBoard">返回看板</AppButton>
		</template>

		<AppSection title="扫码创建">
			<view :class="['barcode-status', barcodeSessionReady ? 'barcode-status--active' : '']">
				<text class="barcode-status__title">物理扫码</text>
				<text class="barcode-status__text">{{ barcodeHint }}</text>
				<text v-if="lastBarcodeText" class="barcode-status__text">最近扫码：{{ lastBarcodeText }}</text>
			</view>

			<view v-if="station" class="station-strip">
				<view>
					<text class="station-title">{{ station.stationName }}</text>
					<text class="station-sub">当前重量 {{ weightText(station.scale?.weightKg) }}</text>
				</view>
				<AppTag :kind="statusKind(station.status)">{{ statusLabel(station.status) }}</AppTag>
			</view>

			<view class="form-grid">
				<view :class="['capture-field', barcodeSessionReady ? 'capture-field--active' : '']" @click="onActivateBottleBarcode()">
					<PdaBottleSuggestField
						v-model="form.bottleNo"
						label="瓶号"
						placeholder="扫描或输入钢瓶号"
						@input="onBottleInput"
						@focus="onActivateBottleBarcode(false)"
						@select="onBottleSelected"
					/>
					<view class="capture-actions">
						<AppButton size="sm" kind="neutral" @click.stop="onActivateBottleBarcode">扫码瓶号</AppButton>
					</view>
				</view>
				<AppInput
					:model-value="form.targetNetWeight"
					label="建议目标/目标净充（kg）"
					placeholder="例如：20.0"
					type="digit"
					@input="onTargetInput"
				/>
				<AppInput v-model="form.remark" label="备注" placeholder="可选" />
			</view>

			<view class="actions-row">
				<AppButton kind="neutral" :loading="loadingStation" @click="loadStation">刷新工位</AppButton>
				<AppButton kind="primary" :loading="submitting" @click="onCreateTask">生成待启动任务</AppButton>
			</view>
		</AppSection>
	</AppPage>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppTag from '@/components/base/AppTag.vue'
import PdaBottleSuggestField from '@/components/domain/pda/PdaBottleSuggestField.vue'
import { resolvePdaBottleByQrCode } from '@/services/pda/bottle'
import { enterBarcodeSession, leaveBarcodeSession, PDA_CAPTURE_TARGETS, setActiveBarcodeTarget } from '@/services/pda/capture'
import {
	createPdaFillingTaskV1,
	formatPdaFillingWeight,
	getPdaFillingStationV1,
	getPdaFillingStatusKind,
	getPdaFillingStatusLabel
} from '@/services/pda/fillingTask'
import { normalizeBottleNo, normalizeQrCode } from '@/services/pda/shared'

const props = defineProps({
	stationCode: { type: String, default: '' }
})

const station = ref(null)
const loadingStation = ref(false)
const submitting = ref(false)
const barcodeSessionReady = ref(false)
const barcodeHint = ref('进入页面后可直接按 PDA 扫码键录入瓶号。')
const lastBarcodeText = ref('')
const form = reactive({
	bottleNo: '',
	targetNetWeight: '',
	remark: ''
})

const title = computed(() => (station.value?.stationName ? `${station.value.stationName} - 扫气瓶` : '扫气瓶创建任务'))

function weightText(value) {
	return formatPdaFillingWeight(value, 1)
}

function statusLabel(status) {
	return getPdaFillingStatusLabel(status)
}

function statusKind(status) {
	return getPdaFillingStatusKind(status)
}

async function loadStation() {
	if (!props.stationCode) {
		showToast('请先选择工位')
		uni.redirectTo({ url: '/pages/pda/filling-board' })
		return
	}
	loadingStation.value = true
	try {
		const res = await getPdaFillingStationV1({ station_code: props.stationCode })
		if (res.code !== 0) {
			showToast(res.msg || '工位加载失败')
			return
		}
		station.value = res.data
	} finally {
		loadingStation.value = false
	}
}

function buildBottleTargetMeta() {
	return {
		page: 'pda-filling-task-create',
		target: PDA_CAPTURE_TARGETS.FILLING_BOTTLE_NO,
		label: '瓶号',
		scope: 'filling',
		field: 'bottleNo'
	}
}

async function activateBarcodeTarget(options = {}) {
	const res = await setActiveBarcodeTarget(buildBottleTargetMeta())
	if (res?.code !== 0) {
		barcodeHint.value = res?.msg || '物理扫码目标设置失败'
		if (options.toast !== false) showToast(barcodeHint.value)
		return res
	}
	barcodeHint.value = '当前目标：瓶号，请按 PDA 扫码键。'
	if (options.toast !== false) showToast('已切换到瓶号扫码')
	return res
}

async function activateBarcodeSession() {
	const sessionRes = await enterBarcodeSession({
		page: 'pda-filling-task-create',
		onResult: onBarcodeScanned
	})
	if (sessionRes?.code !== 0) {
		barcodeSessionReady.value = false
		barcodeHint.value = sessionRes?.msg || '物理扫码会话初始化失败'
		return sessionRes
	}
	barcodeSessionReady.value = true
	return activateBarcodeTarget({ toast: false })
}

async function deactivateBarcodeSession(reason = '') {
	barcodeSessionReady.value = false
	return leaveBarcodeSession({ page: 'pda-filling-task-create', reason })
}

async function onActivateBottleBarcode(showTip = true) {
	if (!barcodeSessionReady.value) {
		const readyRes = await activateBarcodeSession()
		if (readyRes?.code !== 0) return
	}
	await activateBarcodeTarget({ toast: showTip })
}

async function onBarcodeScanned(payload = {}) {
	const rawText = normalizeQrCode(payload?.rawText)
	lastBarcodeText.value = rawText
	if (!rawText) {
		barcodeHint.value = '未读取到有效钢瓶二维码。'
		showToast('扫码内容无效')
		return
	}
	barcodeHint.value = '已收到扫码，正在匹配钢瓶。'
	const bottleRes = await resolvePdaBottleByQrCode(rawText)
	if (bottleRes?.code !== 0 || !bottleRes?.data) {
		barcodeHint.value = '未命中钢瓶 PDA 码。'
		showToast(bottleRes?.msg || '未找到匹配钢瓶')
		return
	}
	applyBottle(bottleRes.data)
	barcodeHint.value = `已回填瓶号 ${bottleRes.data.bottle_no || ''}。`
	showToast(`已回填 ${bottleRes.data.bottle_no || ''}`)
}

function applyBottle(bottle) {
	form.bottleNo = normalizeBottleNo(bottle?.bottle_no || bottle?.bottleNo || form.bottleNo)
	const suggested = Number(bottle?.suggested_fill_weight_kg ?? bottle?.suggestedFillWeightKg)
	if (Number.isFinite(suggested) && suggested > 0) {
		form.targetNetWeight = String(suggested)
	}
}

function onBottleInput() {
	form.bottleNo = normalizeBottleNo(form.bottleNo)
}

function onBottleSelected(bottle) {
	applyBottle(bottle)
}

function onTargetInput(value) {
	form.targetNetWeight = value == null ? '' : String(value)
}

async function onCreateTask() {
	if (submitting.value) return
	const bottleNo = normalizeBottleNo(form.bottleNo)
	const targetNetWeight = Number(form.targetNetWeight)
	if (!bottleNo) {
		showToast('请先扫描或输入瓶号')
		return
	}
	if (!(Number.isFinite(targetNetWeight) && targetNetWeight > 0)) {
		showToast('目标净充重量必须大于 0')
		return
	}
	submitting.value = true
	try {
		const res = await createPdaFillingTaskV1({
			station_code: props.stationCode,
			bottle_no: bottleNo,
			target_net_weight: targetNetWeight,
			remark: form.remark
		})
		if (res?.code !== 0) {
			showToast(res?.msg || '任务创建失败')
			return
		}
		showToast('任务已创建')
		uni.redirectTo({ url: `/pages/pda/filling-station?station_code=${encodeURIComponent(props.stationCode)}` })
	} finally {
		submitting.value = false
	}
}

function goBoard() {
	uni.redirectTo({ url: '/pages/pda/filling-board' })
}

function showToast(message) {
	uni.showToast({ title: message, icon: 'none' })
}

watch(
	() => props.stationCode,
	() => loadStation(),
	{ immediate: true }
)

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

.station-strip {
	margin-bottom: 20rpx;
	padding: 20rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: var(--crm-radius-sm);
	background: #fff;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16rpx;
}

.station-title,
.station-sub {
	display: block;
}

.station-title {
	font-size: 30rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.station-sub {
	margin-top: 6rpx;
	font-size: 24rpx;
	color: var(--crm-text-muted);
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

.capture-actions,
.actions-row {
	display: flex;
	flex-wrap: wrap;
	gap: 16rpx;
	justify-content: flex-end;
}

.actions-row {
	margin-top: 24rpx;
}

@media (max-width: 680px) {
	.form-grid {
		grid-template-columns: 1fr;
	}
}
</style>
