<template>
	<AppPage :class="['reweigh-page pda-compact-page pda-compact-page--inner', !current.frozen && 'reweigh-page--editing']" :title="isReturn ? '回瓶复秤' : '罐装复秤'" :subtitle="isReturn ? '蓝牙吊秤 · 回瓶称重' : '蓝牙吊秤 · 逐瓶核算'" icon="bottle" hideBottleQuery>
		<AppSection v-if="!nativeSupported" title="请使用原生 PDA">
			<text class="hint">本模块使用 PDA 扫描头和 NVK 蓝牙吊秤，请在 PDA 应用中打开。</text>
		</AppSection>
		<template v-else>
			<text v-if="!canCreate" class="notice notice--error">当前账号没有复秤保存权限。</text>
			<text v-if="storageError" class="notice notice--error">草稿未能保存：{{ storageError }}。请保留本页，恢复本机存储后再试。</text>


			<view class="round-summary">
				<text class="round-count">本轮已保存 {{ roundReady && round ? round.bottle_count : '—' }} 瓶</text>
				<AppButton kind="ghost" @click="roundDetails = !roundDetails">{{ roundDetails ? '收起' : '本轮设置' }}</AppButton>
			</view>
			<text v-if="pendingRound" class="notice">还没确认新一轮是否开始，请点“重试开始本轮”。</text>
			<view v-if="roundDetails || !round || pendingRound" class="facts">
				<view class="actions">
					<AppButton :disabled="busy || !canCreate || Boolean(current.bottleNo && !current.receipt?.complete)" @click="onStartRound">{{ pendingRound ? '重试开始本轮' : round ? '开始新一轮' : '开始本轮' }}</AppButton>
					<AppButton v-if="isReturn" kind="neutral" :disabled="busy" @click="refreshRound">刷新瓶数</AppButton>
				</view>
				<text class="hint">{{ isReturn ? '同瓶重称只算一瓶' : '本机、本账号统计，同瓶只算一瓶' }}{{ round ? ' · ' + roundTime : '' }}</text>
			</view>
			<text v-if="historySyncing" class="hint">正在读取本轮记录…</text>
			<text v-if="historySyncError" class="notice notice--error">{{ historySyncError }}</text>
			<PdaWeighScale :minimum-weight="captureMinimum" :snapshot="snapshot" :selected="Boolean(current.bottleNo)" :captured="Boolean(current.capture)" :gross="current.grossWeight" :tare="current.preview?.bottle?.tare_weight" :busy="busy" @connect="connect" @disconnect="disconnect" />
			<AppSection v-if="!current.frozen" :title="current.bottleNo ? current.bottleNo + ' 号瓶' : '请扫码选瓶'">
				<text v-if="error" class="notice notice--error" role="alert">{{ error }}</text>
				<text v-else-if="message && !current.capture" class="hint" role="status">{{ message }}</text>
				<text v-if="current.bottleNo" :class="['weigh-label', current.capture ? 'weigh-label--ready' : 'weigh-label--pending']">{{ current.capture ? '已称好' : '还没称好' }}</text>
				<AppButton v-if="!current.bottleNo" kind="ghost" @click="manualOpen = !manualOpen">手输瓶号 {{ manualOpen ? '收起' : '展开' }}</AppButton>
				<view v-if="!current.bottleNo && (manualOpen || !scannerReady)">
				<PdaBottleSuggestField
					:model-value="current.bottleNo || bottleKeyword" label="瓶号" placeholder="按 PDA 扫码键，或输入瓶号"
					:disabled="locked || busy || Boolean(current.bottleNo) || !snapshot.is_connected || !canCreate || !readyForBottle"
					@update:modelValue="value => bottleKeyword = value" @select="onBottleSelected" @confirm="onSelectKeyword"
				/>
				<AppButton v-if="!current.bottleNo" size="sm" kind="neutral" :disabled="locked || busy || !snapshot.is_connected || !canCreate || !readyForBottle" @click="onSelectKeyword">确认瓶号</AppButton>
				</view>
				<text v-if="current.preview && !current.capture" class="hint">皮重 {{ weight(current.preview.bottle.tare_weight) }} kg</text>
				<text v-if="current.preview?.previous || current.preview?.mode === 'correct'" class="notice">{{ isReturn ? '这瓶已有回瓶记录，保存后采用本次重量' : '这瓶已有罐装记录，保存后更正原记录' }}</text>
				<view v-if="current.capture" class="result">
					<text class="result-label">{{ isReturn ? '回瓶毛重' : '本次灌装量' }}</text>
					<text class="result-value">{{ weight(isReturn ? current.grossWeight : current.preview?.fill_weight) }} <text class="unit">kg</text></text>
					<text v-if="!isReturn && factsOpen" class="hint">罐装量 = 本次毛重 − 上次回瓶毛重</text>
					<view class="result-secondary">
						<text>{{ isReturn ? '皮重' : '毛重' }} {{ weight(isReturn ? current.preview?.bottle.tare_weight : current.grossWeight) }} kg</text>
						<text>净重 {{ weight(current.preview?.net_weight) }} kg</text>
					</view>
					<text v-if="factsOpen" class="hint">净重 = 毛重 − 皮重</text>
				</view>
				<AppButton v-if="current.preview" kind="ghost" @click="factsOpen = !factsOpen">称重详情 {{ factsOpen ? '收起' : '展开' }}</AppButton>
				<view v-if="current.preview && factsOpen" class="facts">
					<text>档案皮重：{{ weight(current.preview.bottle.tare_weight) }} kg</text>
					<template v-if="isReturn">
						<text v-if="current.preview.previous">原回瓶毛重：{{ weight(current.preview.previous.gross_weight) }} kg</text>
						<text class="hint">回瓶复秤时间：{{ current.date }}</text>

					</template>
					<template v-else>
						<text>上次回瓶毛重：{{ weight(current.preview.basis.gross_weight) }} kg</text>
						<text class="hint">回瓶日期：{{ current.preview.basis.date }} · 灌装时间：{{ current.date }}</text>

					</template>
				</view>
				<view v-if="current.bottleNo && !current.frozen" class="actions">
					<AppButton kind="neutral" :disabled="busy || !snapshot.is_connected || Boolean(pendingSession) || !canCreate" @click="startMeasurement">{{ current.capture ? '重新称重' : '本瓶称重' }}</AppButton>
					<AppButton v-if="pendingSession" kind="ghost" @click="cancelMeasurement">停止取重</AppButton>
				</view>

				<view v-if="current.capture && current.preview?.mode === 'correct'" class="correction">
					<text class="result-label">原记录与本次称重</text>
					<text class="difference">{{ reweighChangeText(current.preview) }}</text>
					<AppInput :model-value="current.reason" label="更正原因" :disabled="locked || busy" @update:modelValue="value => setText('reason', value)" />
				</view>
				<AppButton v-if="current.bottleNo && !showRemark && !current.remark" size="sm" kind="ghost" @click="showRemark = true">添加备注</AppButton>
				<AppInput v-if="current.bottleNo && (showRemark || current.remark)" :model-value="current.remark" label="备注（可选）" :disabled="locked || busy" @update:modelValue="value => setText('remark', value)" />
				<AppButton v-if="current.bottleNo" kind="ghost" :disabled="busy" @click="onNext">放弃这瓶</AppButton>
				<view :class="['weigh-footer', keyboardOpen && 'weigh-footer--keyboard']">
					<AppButton :loading="busy" :disabled="busy || !current.capture || !canCreate || locked || !readyForBottle" @click="submit">{{ isReturn ? '保存回瓶复秤' : current.preview?.mode === 'correct' ? '确认更正记录' : '保存罐装复秤' }}</AppButton>
				</view>
			</AppSection>

			<AppSection v-if="current.frozen" :title="receiptTitle(current.receipt)">
				<text v-if="error" class="notice notice--error" role="alert">{{ error }}</text>
				<text class="hint">{{ current.receipt?.message || '还没确认是否保存成功，请点查询保存结果。' }}</text>
				<view class="result-secondary"><text>{{ current.bottleNo }} 号瓶</text><text>毛重 {{ weight(current.grossWeight) }} kg</text><text>净重 {{ weight(current.preview?.net_weight) }} kg</text></view>
				<AppButton size="sm" kind="ghost" @click="showReceiptDetails = !showReceiptDetails">{{ showReceiptDetails ? '收起详情' : '查看详情' }}</AppButton>
				<text v-if="showReceiptDetails && current.receipt?.fillingId" class="identifier">{{ isReturn ? '回瓶复秤记录' : '灌装单' }}：{{ current.receipt.fillingId }}</text>
				<text v-if="showReceiptDetails" class="identifier">操作编号：{{ current.operationId }}</text>
				<view class="actions">
					<AppButton size="sm" kind="neutral" :disabled="busy" @click="query()">查询保存结果</AppButton>
					<AppButton v-if="!current.receipt?.complete" size="sm" kind="neutral" :disabled="busy" @click="query(current.operationId, true)">重试保存</AppButton>
					<AppButton :disabled="!canNext" @click="onNext">下一瓶</AppButton>
				</view>
				<text v-if="!current.receipt?.saved" class="hint">还没确认是否保存成功，请查询或重试这笔记录。</text>
			</AppSection>

			<AppSection v-for="group in historyGroups" :key="group.title" :title="group.title">
				<template #actions><AppButton size="sm" kind="ghost" @click="showHistory = !showHistory">{{ showHistory ? '收起' : '展开' }}（{{ group.items.length }}）</AppButton></template>
				<view v-if="showHistory">
				<view v-for="item in group.items.slice().reverse()" :key="item.operationId" class="history-row">
					<text>{{ item.bottleNo }} 号瓶 · {{ isReturn ? '回瓶毛重' : '本次灌装量' }} {{ weight(isReturn ? item.grossWeight : item.preview?.fill_weight) }} kg</text>
					<text :class="['hint', !item.receipt?.complete ? 'pending' : '']">{{ receiptTitle(item.receipt) }}</text>
					<text class="history-time">{{ reweighHistoryTime(item) }}</text>
					<text v-if="!item.receipt?.complete" class="hint">{{ item.receipt?.message }}</text>
					<view v-if="!item.receipt?.complete" class="actions">
						<AppButton size="sm" kind="neutral" :disabled="busy" @click="query(item.operationId)">查询状态</AppButton>
						<AppButton size="sm" kind="neutral" :disabled="busy" @click="query(item.operationId, true)">重试处理</AppButton>
					</view>
				</view>
				</view>
			</AppSection>
		</template>
	</AppPage>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import PdaWeighScale from './PdaWeighScale.vue'
import PdaBottleSuggestField from '@/components/domain/pda/PdaBottleSuggestField.vue'
import { reweighChangeText, usePdaReweigh } from '@/composables/pda/usePdaReweigh'
import { reweighHistoryTime } from '@/services/pda/reweighDraft'

const props = defineProps({ mode: { type: String, default: 'filling' } })
const isReturn = props.mode === 'return'
const { captureMinimum, current, roundHistory, recoveryHistory, historySyncing, historySyncError, message, error, storageError, busy, scannerReady, pendingSession, snapshot, nativeSupported, locked, canCreate, canNext, round, roundReady, pendingRound, startRound, refreshRound,
	selectBottle, startMeasurement, cancelMeasurement, connect, disconnect, submit, query, nextBottle, activate, deactivate, setText } = usePdaReweigh({ mode: props.mode })
const historyGroups = computed(() => [
	{ title: '本轮已保存记录', items: roundHistory.value },
	{ title: '其他轮次待处理记录', items: recoveryHistory.value }
].filter(group => group.items.length))
const readyForBottle = computed(() => !isReturn || (roundReady.value && Boolean(round.value?._id)))
const roundTime = computed(() => {
	const timestamp = Number(round.value?.created_at)
	if (!Number.isFinite(timestamp) || timestamp <= 0) return '—'
	return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')
})
const bottleKeyword = ref('')
const roundDetails = ref(false), factsOpen = ref(false), manualOpen = ref(false), keyboardOpen = ref(false)
const showRemark = ref(false), showReceiptDetails = ref(false), showHistory = ref(false)
const weight = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(1)
const receiptTitle = receipt => receipt?.complete ? '已保存' : receipt?.saved ? '记录已保存，还有信息待核对' : '还没确认是否保存成功'
function onBottleSelected(bottle) { return selectBottle(bottle?.bottle_no || bottleKeyword.value) }
function onSelectKeyword() { return selectBottle(bottleKeyword.value) }
async function onNext() { if (await nextBottle()) { bottleKeyword.value = ''; factsOpen.value = false; manualOpen.value = false; showRemark.value = false; showReceiptDetails.value = false } }
async function onStartRound() { if (await startRound()) bottleKeyword.value = '' }
function keyboardChanged(event) { keyboardOpen.value = Number(event.height) > 0 }
if (typeof uni.onKeyboardHeightChange === 'function') uni.onKeyboardHeightChange(keyboardChanged)
onBeforeUnmount(() => { if (typeof uni.offKeyboardHeightChange === 'function') uni.offKeyboardHeightChange(keyboardChanged) })
defineExpose({ activate, deactivate })
</script>

<style scoped>
.reweigh-page { font-size: 16px; }
.reweigh-page--editing { padding-bottom: calc(88px + env(safe-area-inset-bottom)); }
.round-count { font-size: 18px; font-weight: 700; }
.weigh-label { display: block; font-size: 18px; font-weight: 700; margin: 8px 0; }
.weigh-label--ready { color: #166534; }
.weigh-label--pending { color: #b42318; }
.weigh-footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 12px 18px calc(12px + env(safe-area-inset-bottom)); background: #fff; border-top: 1px solid #cbd5e1; z-index: 20; }
.weigh-footer > :deep(.btn) { width: 100%; }
.weigh-footer--keyboard { position: static; padding: 12px 0; }
.reweigh-page :deep(.btn) { font-size: 16px; min-height: 48px; }
.reweigh-page :deep(.field__input) { font-size: 16px; }
.reweigh-page :deep(.section__title) { font-size: 18px; }
.notice { display: block; padding: 12rpx 16rpx; margin-bottom: 0; border-radius: var(--crm-radius-sm); background: #eff6ff; color: #1e40af; font-size: 16px; line-height: 1.6; }
.notice--error { background: #fff7ed; color: #9a3412; }
.scale-strip, .actions, .result-secondary { display: flex; flex-wrap: wrap; align-items: center; gap: 16rpx; }
.round-summary { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; flex-wrap: wrap; }
.round-summary .actions { margin: 0; }
.scale-strip { justify-content: space-between; margin-bottom: 12rpx; }
.live-weight { font-size: 32px; font-weight: 700; }
.unit { font-size: 16px; font-weight: 400; }
.hint { display: block; color: var(--crm-text-muted); font-size: 14px; line-height: 1.6; }
.actions { margin: 12rpx 0; }
.facts { display: flex; flex-direction: column; align-items: flex-start; gap: 8rpx; padding: 12rpx 0; font-size: 16px; }
.result { margin: 12rpx 0; padding: 16rpx; border: 2rpx solid #86d3a2; border-radius: var(--crm-radius-sm); background: #ecfdf3; }
.result-label { display: block; font-size: 18px; font-weight: 600; }
.result-value { display: block; margin: 8rpx 0; font-size: 32px; font-weight: 800; color: #166534; }
.result-secondary { margin: 12rpx 0 6rpx; font-size: 16px; }
.correction { margin: 20rpx 0; padding: 20rpx; background: #fff7ed; border-radius: var(--crm-radius-sm); }
.difference { display: block; white-space: pre-line; font-size: 16px; line-height: 1.8; padding: 14rpx 0; }
.identifier { display: block; overflow-wrap: anywhere; font-size: 23rpx; color: var(--crm-text-muted); margin-top: 12rpx; }
.history-row { padding: 20rpx 0; border-bottom: 1rpx solid var(--crm-border); font-size: 16px; }
.history-row:last-child { border-bottom: 0; }
.history-time { display: block; margin-top: 8rpx; font-size: 16px; font-weight: 700; }
.pending { color: #9a3412; }
/* Compact only this PDA workflow; leave shared and Chrome sales pages unchanged. */
.reweigh-page :deep(.page__body--padded) { gap: 14rpx; padding: 0 18rpx; }
.reweigh-page :deep(.page__header) { padding: 16rpx 20rpx 0; margin-bottom: 14rpx; }
.reweigh-page :deep(.header__top) { gap: 16rpx; padding-bottom: 16rpx; }
.reweigh-page :deep(.header__icon-box) { width: 56rpx; height: 56rpx; }
.reweigh-page :deep(.header__content) { min-width: 0; }
.reweigh-page :deep(.section__header) { padding: 12rpx 18rpx; }
.reweigh-page :deep(.section__body) { padding: 16rpx 18rpx; }
</style>

<style scoped lang="scss">
@import './pdaCompact.scss';
</style>
