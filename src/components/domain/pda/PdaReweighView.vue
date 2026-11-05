<template>
	<AppPage :class="['reweigh-page pda-compact-page pda-compact-page--inner', !current.frozen && 'reweigh-page--editing']" :title="isFloor ? (isReturn ? '地秤回瓶复秤' : '地秤罐装复秤') : isReturn ? '回瓶复秤' : '罐装复秤'" :subtitle="isFloor ? '蓝牙地秤 · 逐瓶核算' : isReturn ? '蓝牙吊秤 · 回瓶称重' : '蓝牙吊秤 · 逐瓶核算'" icon="bottle" hideBottleQuery>
		<AppSection v-if="!nativeSupported" title="请使用原生 PDA">
			<text class="hint">本模块使用 PDA 扫描头和蓝牙秤，请在 PDA 应用中打开。</text>
		</AppSection>
		<AppSection v-else-if="draftLoading" title="正在恢复当前作业"><text class="hint" role="status">正在读取当前轮次和未确认保存的记录…</text></AppSection>
		<template v-else>
			<text v-if="!canCreate" class="notice notice--error">当前账号没有复秤保存权限。</text>
			<text v-if="storageError" class="notice notice--error">草稿未能保存：{{ storageError }}。请保留本页，恢复本机存储后再试。</text>


			<view class="round-card">
			<view class="round-summary">
				<view class="round-main">
				<text class="round-count">{{ round ? '本轮已保存 ' + (roundReady ? round.bottle_count : '—') + ' 瓶' : localRoundEnded ? '本轮已结束' : '本轮尚未开始' }}</text>
				<AppButton v-if="round" class="detail-link" kind="ghost" size="sm" @click="roundDetails = !roundDetails">{{ roundDetails ? '收起本轮详情 ⌃' : '本轮详情 ›' }}</AppButton>
				</view>
				<AppButton kind="outline" v-if="(round || pendingEndRound) && !pendingRound" :disabled="busy || !canCreate" @click="onEndRound">{{ pendingEndRound ? '重试结束本轮' : '结束本轮' }}</AppButton>
				<AppButton kind="outline" v-else :disabled="busy || !canCreate || Boolean(pendingEndRound)" @click="onStartRound">{{ pendingRound ? '重试开始本轮' : '开始新一轮' }}</AppButton>
			</view>
			<text v-if="pendingEndRound" class="notice">结束结果还未确认，请点“重试结束本轮”；已保存记录保留。</text>
			<text v-if="pendingRound" class="notice">还没确认新一轮是否开始，请点“重试开始本轮”。</text>
			<view v-if="round && roundDetails" class="round-details">
				<view class="round-detail-text">
					<text class="hint">同瓶重称只算一瓶</text>
					<text class="hint">{{ isReturn ? '本轮回瓶统计' : '本机、本账号统计' }} · {{ roundTime }}</text>
				</view>
				<AppButton kind="neutral" size="sm" :disabled="busy" @click="refreshRound">刷新瓶数</AppButton>
			</view>
			<text v-if="historySyncing" class="hint">正在读取本轮记录…</text>
			<text v-if="historySyncError" class="notice notice--error">{{ historySyncError }}</text>
			<view v-if="!isReturn" class="printer-strip">
				<text>{{ printer.status.value }}</text>
				<AppButton kind="outline" size="sm" :disabled="printer.connecting.value || printer.busy.value" @click="printer.connect">{{ printer.connected.value ? '重连' : '连接' }}</AppButton>
			</view>
			<PdaDailyTemperature v-if="!isReturn" :active="form.active.value" :disabled="busy || !canCreate" />
			</view>
			<view class="work-card">
			<PdaFloorScale v-if="isFloor" :snapshot="snapshot" :busy="busy" :active="form.active.value" @connect="connect" @disconnect="disconnect" />
			<PdaWeighScale embedded v-else :minimum-weight="captureMinimum" :snapshot="snapshot" :selected="Boolean(current.bottleNo)" :captured="Boolean(current.capture)" :gross="current.grossWeight" :tare="current.preview?.bottle?.tare_weight" :busy="busy" @connect="connect" @disconnect="disconnect" />
			<text v-if="isFloor && calibrationBlocksReweigh" class="notice notice--error">当前地秤尚未完成砝码复核，请到 PDA 首页的“秤台校准”复核。</text>
			<AppSection class="work-section" v-if="!current.frozen" :title="current.bottleNo ? current.bottleNo + ' 号瓶' : '请扫码选瓶'">
				<text v-if="error" class="notice notice--error" role="alert">{{ error }}</text>
				<text v-else-if="message && !current.capture" class="hint" role="status">{{ message }}</text>
				<text v-if="!current.bottleNo && !message && !error" class="hint">按扫描键选择钢瓶</text>
				<text v-if="current.bottleNo" :class="['weigh-label', (isFloor ? current.capture?.stable : current.capture) ? 'weigh-label--ready' : 'weigh-label--pending']">{{ isFloor ? (current.capture?.stable ? '重量稳定' : '称重中') : current.capture ? '已称好' : '还没称好' }}</text>
				<AppButton class="detail-link manual-toggle" v-if="!current.bottleNo" kind="ghost" @click="manualOpen = !manualOpen">手输瓶号 {{ manualOpen ? '收起 ⌃' : '›' }}</AppButton>
				<view v-if="!current.bottleNo && (manualOpen || !scannerReady)">
				<PdaBottleSuggestField
					:model-value="current.bottleNo || bottleKeyword" label="瓶号" placeholder="按 PDA 扫码键，或输入瓶号"
					:disabled="locked || busy || Boolean(current.bottleNo) || !snapshot.is_connected || !canCreate || !readyForBottle"
					@update:modelValue="value => bottleKeyword = value" @select="onBottleSelected" @confirm="onSelectKeyword"
				/>
				<AppButton v-if="!current.bottleNo" size="sm" kind="neutral" :disabled="locked || busy || !snapshot.is_connected || !canCreate || !readyForBottle" @click="onSelectKeyword">确认瓶号</AppButton>
				</view>
				<text v-if="current.preview && !current.capture" class="hint">皮重 {{ weight(current.preview.bottle.tare_weight) }} kg</text>
				<text v-if="previousNotice" class="notice">{{ previousNotice }}</text>
				<view v-if="current.capture" class="result">
					<text class="result-label">{{ isReturn ? '回瓶毛重' : '本次灌装量' }}</text>
					<text class="result-value">{{ weight(isReturn ? current.grossWeight : current.preview?.fill_weight) }} <text class="unit">kg</text></text>
					<text v-if="!isReturn && factsOpen" class="hint">罐装量 = 本次毛重 − 上次回瓶毛重</text>
					<view v-if="!isReturn && current.receipt?.saved" class="print-result">
					<text>{{ printer.messages.value[current.operationId] || '可补打这笔记录的标签' }}</text>
					<text v-if="printer.reason(current)" class="hint">{{ printer.reason(current) }}</text>
					<AppButton v-else kind="outline" :disabled="printer.busy.value" @click="printer.reprint(current)">补打标签</AppButton>
				</view>
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
				<view v-if="!isFloor && current.bottleNo && !current.frozen" class="actions">
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
					<AppButton :loading="busy" :disabled="busy || !current.capture || !canCreate || locked || !readyForBottle || (isFloor && !form.readingReady.value)" @click="submit">{{ isReturn ? '保存回瓶复秤' : current.preview?.mode === 'correct' ? '确认更正记录' : '保存罐装复秤' }}</AppButton>
				</view>
			</AppSection>

			<AppSection class="work-section" v-if="current.frozen" :title="submitting ? '正在保存' : receiptTitle(current.receipt)">
				<text v-if="error" class="notice notice--error" role="alert">{{ error }}</text>
				<text class="hint">{{ submitting ? '正在提交并确认保存结果，请稍候。' : current.receipt?.saved ? '记录已保存，可以继续下一瓶；处理详情可到复秤记录查询。' : current.receipt?.message || '还没确认是否保存成功，请点查询保存结果。' }}</text>
				<PdaHebeiSubmissionStatus v-if="!isReturn && current.receipt?.saved" :active="form.active.value" :filling-id="current.receipt.fillingId" />
				<view v-if="!isReturn && current.receipt?.saved" class="print-result">
					<text>{{ printer.messages.value[current.operationId] || '可补打这笔记录的标签' }}</text>
					<text v-if="printer.reason(current)" class="hint">{{ printer.reason(current) }}</text>
					<AppButton v-else kind="outline" :disabled="printer.busy.value" @click="printer.reprint(current)">补打标签</AppButton>
				</view>
				<view class="result-secondary"><text>{{ current.bottleNo }} 号瓶</text><text>毛重 {{ weight(current.grossWeight) }} kg</text><text>净重 {{ weight(current.preview?.net_weight) }} kg</text></view>
				<AppButton size="sm" kind="ghost" @click="showReceiptDetails = !showReceiptDetails">{{ showReceiptDetails ? '收起详情' : '查看详情' }}</AppButton>
				<text v-if="showReceiptDetails && current.receipt?.fillingId" class="identifier">{{ isReturn ? '回瓶复秤记录' : '灌装单' }}：{{ current.receipt.fillingId }}</text>
				<text v-if="showReceiptDetails" class="identifier">操作编号：{{ current.operationId }}</text>
				<view class="actions">
					<AppButton v-if="!current.receipt?.saved" size="sm" kind="neutral" :disabled="busy" @click="query()">查询保存结果</AppButton>
					<AppButton v-if="!current.receipt?.saved" size="sm" kind="neutral" :disabled="busy" @click="query(current.operationId, true)">重试保存</AppButton>
					<AppButton :disabled="!canNext" @click="onNext">下一瓶</AppButton>
				</view>
				<text v-if="!submitting && !current.receipt?.saved" class="hint">还没确认是否保存成功，请查询或重试这笔记录。</text>
			</AppSection>

			</view>

			<PdaReweighHistorySection v-for="group in historyGroups" :key="group.title" :title="group.title" :items="group.items" :is-return="isReturn" :busy="busy" :printer="printer" @query="query" />
		</template>
	</AppPage>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import { usePdaFillingPrinter } from '@/composables/pda/usePdaFillingPrinter'
import PdaWeighScale from './PdaWeighScale.vue'
import PdaDailyTemperature from './PdaDailyTemperature.vue'
import PdaHebeiSubmissionStatus from './PdaHebeiSubmissionStatus.vue'
import PdaFloorScale from './PdaFloorScale.vue'
import PdaReweighHistorySection from './PdaReweighHistorySection.vue'
import PdaBottleSuggestField from '@/components/domain/pda/PdaBottleSuggestField.vue'
import { reweighChangeText, usePdaReweigh } from '@/composables/pda/usePdaReweigh'
import { reweighPreviousNotice } from '@/services/pda/reweighDraft'

const props = defineProps({ mode: { type: String, default: 'filling' }, scaleMode: { type: String, default: 'hanging' } })
const isReturn = props.mode === 'return'
const isFloor = props.scaleMode === 'floor'
const printer = usePdaFillingPrinter({ enabled: !isReturn, active: () => form?.active.value && form.nativeSupported, entries: () => [...form.history.value.filter(item => item.operationId !== form.current.value.operationId), form.current.value] })
const form = usePdaReweigh({ mode: props.mode, printing: isReturn ? null : printer, scaleMode: props.scaleMode })
const { draftLoading, captureMinimum, current, roundHistory, recoveryHistory, historySyncing, historySyncError, message, error, storageError, busy, submitting, scannerReady, pendingSession, snapshot, nativeSupported, locked, canCreate, canNext, round, roundReady, pendingRound, pendingEndRound, localRoundEnded, startRound, refreshRound,
	selectBottle, startMeasurement, cancelMeasurement, connect, disconnect, submit, query, nextBottle, activate, deactivate, setText, endRound,
	calibrationBlocksReweigh } = form
const historyGroups = computed(() => [
	{ title: '本轮称重记录', items: roundHistory.value },
	{ title: '其他轮次未确认保存的记录', items: recoveryHistory.value }
].filter(group => group.items.length))
const readyForBottle = computed(() => Boolean(round.value?._id) && !pendingEndRound.value && (!isReturn || roundReady.value) && !calibrationBlocksReweigh.value)
const previousNotice = computed(() => reweighPreviousNotice(current.value.preview, isReturn))
const roundTime = computed(() => {
	const timestamp = Number(round.value?.created_at)
	if (!Number.isFinite(timestamp) || timestamp <= 0) return '—'
	return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')
})
const bottleKeyword = ref('')
const roundDetails = ref(false), factsOpen = ref(false), manualOpen = ref(false), keyboardOpen = ref(false)
const showRemark = ref(false), showReceiptDetails = ref(false)
const weight = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(1)
const receiptTitle = receipt => receipt?.saved ? '已保存' : '还没确认是否保存成功'
async function selectManual(value) { const accepted = await selectBottle(value); if (accepted) uni.hideKeyboard(); return accepted }
function onBottleSelected(bottle) { return selectManual(bottle?.bottle_no || bottleKeyword.value) }
function onSelectKeyword() { return selectManual(bottleKeyword.value) }
async function onNext() { if (await nextBottle()) { bottleKeyword.value = ''; factsOpen.value = false; manualOpen.value = false; showRemark.value = false; showReceiptDetails.value = false } }
async function onStartRound() { if (await startRound()) bottleKeyword.value = '' }
async function onEndRound() { if (await endRound()) { bottleKeyword.value = ''; manualOpen.value = false; roundDetails.value = false; showReceiptDetails.value = false } }
function keyboardChanged(event) { keyboardOpen.value = Number(event.height) > 0 }
if (typeof uni.onKeyboardHeightChange === 'function') uni.onKeyboardHeightChange(keyboardChanged)
onBeforeUnmount(() => { if (typeof uni.offKeyboardHeightChange === 'function') uni.offKeyboardHeightChange(keyboardChanged) })
defineExpose({ activate, deactivate })
</script>

<style scoped>
.printer-strip { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:16px; padding-top:8px; margin-top:4px; border-top:1px solid #e2e8f0; }
.printer-strip > text { min-width:0; overflow-wrap:anywhere; }
.print-result { display:flex; flex-direction:column; gap:8px; margin:12px 0; font-size:16px; }
.printer-strip :deep(.btn), .print-result :deep(.btn) { min-height:48px; font-size:16px; }
.reweigh-page { font-size: 16px; }
.reweigh-page--editing { padding-bottom: calc(88px + env(safe-area-inset-bottom)); }
.round-count { display:block; font-size:18px; font-weight:700; line-height:1.5; }
.round-card, .work-card { background:#fff; border:1px solid #cbd5e1; border-radius:8px; }
.round-card { padding:12px; }
.round-main { flex:1; min-width:0; }
.round-details { display:flex; align-items:center; justify-content:space-between; gap:8px; border-top:1px solid #e2e8f0; padding-top:8px; margin-top:4px; }
.round-detail-text { flex:1; min-width:0; }
.reweigh-page .round-main .detail-link { justify-content:flex-start; padding:0; min-height:44px; height:44px; }
.work-card { overflow:hidden; }
.work-card > .work-section { border:0; border-top:1px solid #e2e8f0; border-radius:0; }
.reweigh-page .work-section :deep(.section__header) { border-bottom:0; padding:12px 12px 0; }
.reweigh-page .work-section :deep(.section__body) { padding:8px 12px; }
.reweigh-page .work-section .manual-toggle { margin:4px 0 0; padding-left:0; justify-content:flex-start; min-height:44px; height:44px; }
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
.round-summary { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.round-summary > :deep(.btn) { padding:0 12px; }
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
