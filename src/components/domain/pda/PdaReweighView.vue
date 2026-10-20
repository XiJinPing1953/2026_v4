<template>
	<AppPage class="reweigh-page pda-compact-page pda-compact-page--inner" :title="isReturn ? '回瓶复秤' : '罐装复秤'" :subtitle="isReturn ? '蓝牙吊秤 · 回瓶称重' : '蓝牙吊秤 · 逐瓶核算'" icon="bottle" hideBottleQuery>
		<AppSection v-if="!nativeSupported" title="请使用原生 PDA">
			<text class="hint">本模块使用 PDA 扫描头和 NVK 蓝牙吊秤，请在 PDA 应用中打开。</text>
		</AppSection>
		<template v-else>
			<text v-if="!canCreate" class="notice notice--error">当前账号没有复秤保存权限。</text>
			<text v-if="storageError" class="notice notice--error">草稿未能保存：{{ storageError }}。请保留本页，恢复本机存储后再试。</text>
			<text v-if="error" class="notice notice--error">{{ error }}</text>
			<text v-if="message" class="notice" role="status">{{ message }}</text>

			<AppSection :title="isReturn ? '本轮回瓶复秤统计' : '本轮罐装复秤统计'">
				<view class="round-summary"><text class="result-value">{{ roundReady && round ? round.bottle_count : '—' }} <text class="unit">瓶</text></text>

				<text v-if="pendingRound" class="notice">开始结果待确认，请重试原请求；确认前暂停扫码称重。</text>
				<view class="actions">
					<AppButton size="sm" :disabled="busy || !canCreate || Boolean(current.bottleNo && !current.receipt?.complete)" @click="onStartRound">{{ pendingRound ? '重试开始本轮' : round ? '开始新一轮' : '开始本轮' }}</AppButton>
					<AppButton v-if="isReturn" size="sm" kind="neutral" :disabled="busy" @click="refreshRound">刷新统计</AppButton>
				</view>
				</view>
				<text class="hint">{{ isReturn ? '同瓶重称不重复计数' : '仅本机本账号 · 同瓶重称不重复计数' }}{{ round ? ' · ' + roundTime : '' }}</text>
			</AppSection>

			<AppSection title="吊秤">
				<view class="scale-strip">
					<text class="live-weight">{{ weight(snapshot.weight_kg) }} <text class="unit">kg</text></text>
					<AppTag :kind="snapshot.is_stable && snapshot.is_online ? 'success' : 'soft'">{{ scaleStatus }}</AppTag>
				</view>
				<text class="hint">0.5 kg 分度 · {{ scannerReady ? '可按扫描键选瓶' : '扫描头未就绪，请搜索瓶号' }}</text>
				<view class="actions">
					<AppButton size="sm" :loading="busy" :disabled="busy" @click="connect(false)">{{ snapshot.is_connected ? '重连吊秤' : '连接吊秤' }}</AppButton>
					<AppButton size="sm" kind="neutral" :disabled="busy" @click="connect(true)">更换吊秤</AppButton>
					<AppButton size="sm" kind="ghost" :disabled="busy || !snapshot.is_connected" @click="disconnect">断开</AppButton>

				</view>
			</AppSection>

			<AppSection v-if="!current.frozen" title="本瓶复秤">
				<PdaBottleSuggestField
					:model-value="current.bottleNo || bottleKeyword" label="瓶号" placeholder="按 PDA 扫码键，或输入瓶号"
					:disabled="locked || busy || Boolean(current.bottleNo) || !snapshot.is_connected || !canCreate || !readyForBottle"
					@update:modelValue="value => bottleKeyword = value" @select="onBottleSelected" @confirm="onSelectKeyword"
				/>
				<AppButton v-if="!current.bottleNo" size="sm" kind="neutral" :disabled="locked || busy || !snapshot.is_connected || !canCreate || !readyForBottle" @click="onSelectKeyword">确认瓶号</AppButton>
				<view v-if="current.preview" class="facts">
					<text>档案皮重：{{ weight(current.preview.bottle.tare_weight) }} kg</text>
					<template v-if="isReturn">
						<text v-if="current.preview.previous">原回瓶毛重：{{ weight(current.preview.previous.gross_weight) }} kg</text>
						<text class="hint">回瓶复秤时间：{{ current.date }}</text>
						<AppTag :kind="current.preview.previous ? 'warning' : 'soft'">{{ current.preview.previous ? '已有回瓶复秤，将保存新的称重依据' : '保存新的回瓶复秤依据' }}</AppTag>
					</template>
					<template v-else>
						<text>上次回瓶毛重：{{ weight(current.preview.basis.gross_weight) }} kg</text>
						<text class="hint">回瓶日期：{{ current.preview.basis.date }} · 灌装时间：{{ current.date }}</text>
						<AppTag :kind="current.preview.mode === 'correct' ? 'warning' : 'soft'">{{ current.preview.mode === 'correct' ? '更正本周期原灌装记录' : '新建本次灌装记录' }}</AppTag>
					</template>
				</view>
				<view v-if="current.bottleNo && !current.frozen" class="actions">
					<AppButton kind="neutral" :disabled="busy || !snapshot.is_connected || Boolean(pendingSession) || !canCreate" @click="startMeasurement">{{ current.capture ? '重新称重' : '本瓶称重' }}</AppButton>
					<AppButton v-if="pendingSession" kind="ghost" @click="cancelMeasurement">取消待称重</AppButton>
				</view>
				<text v-if="pendingSession" class="notice">正在等待 {{ current.bottleNo }} 号瓶稳定，请勿切换钢瓶。</text>
				<view v-if="current.capture" class="result">
					<text class="result-label">{{ isReturn ? '回瓶毛重' : '本次灌装量' }}</text>
					<text class="result-value">{{ weight(isReturn ? current.grossWeight : current.preview?.fill_weight) }} <text class="unit">kg</text></text>
					<text v-if="!isReturn" class="hint">复秤毛重 − 上次回瓶毛重</text>
					<view class="result-secondary">
						<text>{{ isReturn ? '皮重' : '毛重' }} {{ weight(isReturn ? current.preview?.bottle.tare_weight : current.grossWeight) }} kg</text>
						<text>{{ isReturn ? '净重' : '标签净重' }} {{ weight(current.preview?.net_weight) }} kg</text>
					</view>
					<text class="hint">{{ isReturn ? '净重 = 毛重 − 档案皮重，保留零值和负值。' : '标签净重 = 毛重 − 档案皮重' }}</text>
				</view>
				<view v-if="current.capture && current.preview?.mode === 'correct'" class="correction">
					<text class="result-label">原记录与本次称重</text>
					<text class="difference">{{ reweighChangeText(current.preview) }}</text>
					<AppInput :model-value="current.reason" label="更正原因" :disabled="locked || busy" @update:modelValue="value => setText('reason', value)" />
				</view>
				<AppButton v-if="current.bottleNo && !showRemark && !current.remark" size="sm" kind="ghost" @click="showRemark = true">添加备注</AppButton>
				<AppInput v-if="current.bottleNo && (showRemark || current.remark)" :model-value="current.remark" label="备注（可选）" :disabled="locked || busy" @update:modelValue="value => setText('remark', value)" />
				<view class="actions">
					<AppButton v-if="!current.frozen" :loading="busy" :disabled="busy || !current.capture || !canCreate || locked || !readyForBottle" @click="submit">{{ isReturn ? '保存回瓶复秤' : current.preview?.mode === 'correct' ? '确认更正原灌装记录' : '保存灌装记录' }}</AppButton>
					<AppButton v-if="current.bottleNo && !current.frozen" kind="ghost" :disabled="busy" @click="onNext">放弃本瓶草稿</AppButton>
				</view>
				<text class="hint">{{ isReturn ? '保存后作为灌装复秤的回瓶依据。' : '本阶段保存称重与灌装数据，暂不打印标签。' }}</text>
			</AppSection>

			<AppSection v-if="current.frozen" :title="receiptTitle(current.receipt)">
				<text class="hint">{{ current.receipt?.message || '提交内容已锁定，请查询原操作的保存结果。' }}</text>
				<view class="result-secondary"><text>{{ current.bottleNo }} 号瓶</text><text>毛重 {{ weight(current.grossWeight) }} kg</text><text>净重 {{ weight(current.preview?.net_weight) }} kg</text></view>
				<AppButton size="sm" kind="ghost" @click="showReceiptDetails = !showReceiptDetails">{{ showReceiptDetails ? '收起凭据' : '查看凭据' }}</AppButton>
				<text v-if="showReceiptDetails && current.receipt?.fillingId" class="identifier">{{ isReturn ? '回瓶复秤记录' : '灌装单' }}：{{ current.receipt.fillingId }}</text>
				<text v-if="showReceiptDetails" class="identifier">操作编号：{{ current.operationId }}</text>
				<view class="actions">
					<AppButton size="sm" kind="neutral" :disabled="busy" @click="query()">查询保存结果</AppButton>
					<AppButton v-if="!current.receipt?.complete" size="sm" kind="neutral" :disabled="busy" @click="query(current.operationId, true)">重试原操作</AppButton>
					<AppButton :disabled="!canNext" @click="onNext">下一瓶</AppButton>
				</view>
				<text v-if="!current.receipt?.saved" class="hint">保存未确认前请勿另建操作。重试始终使用原称重与原操作编号。</text>
			</AppSection>

			<AppSection v-if="history.length" title="本机已保存记录">
				<template #actions><AppButton size="sm" kind="ghost" @click="showHistory = !showHistory">{{ showHistory ? '收起' : '展开' }}（{{ history.length }}）</AppButton></template>
				<view v-if="showHistory">
				<view v-for="item in history.slice().reverse()" :key="item.operationId" class="history-row">
					<text>{{ item.bottleNo }} 号瓶 · {{ isReturn ? '回瓶毛重' : '本次灌装量' }} {{ weight(isReturn ? item.grossWeight : item.preview?.fill_weight) }} kg</text>
					<text :class="['hint', !item.receipt?.complete ? 'pending' : '']">{{ receiptTitle(item.receipt) }}</text>
					<text class="identifier">{{ item.receipt?.fillingId || item.operationId }}</text>
					<text v-if="!item.receipt?.complete" class="hint">{{ item.receipt?.message }}</text>
					<view v-if="!item.receipt?.complete" class="actions">
						<AppButton size="sm" kind="neutral" :disabled="busy" @click="query(item.operationId)">查询状态</AppButton>
						<AppButton size="sm" kind="neutral" :disabled="busy" @click="query(item.operationId, true)">重试后续处理</AppButton>
					</view>
				</view>
				</view>
			</AppSection>
		</template>
	</AppPage>
</template>

<script setup>
import { computed, ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppTag from '@/components/base/AppTag.vue'
import PdaBottleSuggestField from '@/components/domain/pda/PdaBottleSuggestField.vue'
import { reweighChangeText, usePdaReweigh } from '@/composables/pda/usePdaReweigh'

const props = defineProps({ mode: { type: String, default: 'filling' } })
const isReturn = props.mode === 'return'
const { current, history, message, error, storageError, busy, scannerReady, pendingSession, snapshot, nativeSupported, locked, canCreate, canNext, round, roundReady, pendingRound, startRound, refreshRound,
	selectBottle, startMeasurement, cancelMeasurement, connect, disconnect, submit, query, nextBottle, activate, deactivate, setText } = usePdaReweigh({ mode: props.mode })
const readyForBottle = computed(() => !isReturn || (roundReady.value && Boolean(round.value?._id)))
const roundTime = computed(() => {
	const timestamp = Number(round.value?.created_at)
	if (!Number.isFinite(timestamp) || timestamp <= 0) return '—'
	return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')
})
const bottleKeyword = ref('')
const showRemark = ref(false), showReceiptDetails = ref(false), showHistory = ref(false)
const weight = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(1)
const scaleStatus = computed(() => !snapshot.value.is_connected ? '未连接' : !snapshot.value.is_online ? '等待秤值' : snapshot.value.is_stable ? '稳定' : '动态中')
const receiptTitle = receipt => receipt?.complete ? '已保存，处理完成' : receipt?.saved ? '已保存，后续处理待完成' : '保存结果待确认'
function onBottleSelected(bottle) { return selectBottle(bottle?.bottle_no || bottleKeyword.value) }
function onSelectKeyword() { return selectBottle(bottleKeyword.value) }
async function onNext() { if (await nextBottle()) { bottleKeyword.value = ''; showRemark.value = false; showReceiptDetails.value = false } }
async function onStartRound() { if (await startRound()) bottleKeyword.value = '' }
defineExpose({ activate, deactivate })
</script>

<style scoped>
.notice { display: block; padding: 12rpx 16rpx; margin-bottom: 0; border-radius: var(--crm-radius-sm); background: #eff6ff; color: #1e40af; font-size: 25rpx; line-height: 1.6; }
.notice--error { background: #fff7ed; color: #9a3412; }
.scale-strip, .actions, .result-secondary { display: flex; flex-wrap: wrap; align-items: center; gap: 16rpx; }
.round-summary { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; flex-wrap: wrap; }
.round-summary .actions { margin: 0; }
.scale-strip { justify-content: space-between; margin-bottom: 12rpx; }
.live-weight { font-size: 48rpx; font-weight: 700; }
.unit { font-size: 26rpx; font-weight: 400; }
.hint { display: block; color: var(--crm-text-muted); font-size: 24rpx; line-height: 1.6; }
.actions { margin: 12rpx 0; }
.facts { display: flex; flex-direction: column; align-items: flex-start; gap: 8rpx; padding: 12rpx 0; font-size: 27rpx; }
.result { margin: 12rpx 0; padding: 16rpx; border: 2rpx solid #93c5fd; border-radius: var(--crm-radius-sm); background: #eff6ff; }
.result-label { display: block; font-size: 28rpx; font-weight: 600; }
.result-value { display: block; margin: 8rpx 0; font-size: 48rpx; font-weight: 800; color: #1e40af; }
.result-secondary { margin: 12rpx 0 6rpx; font-size: 26rpx; }
.correction { margin: 20rpx 0; padding: 20rpx; background: #fff7ed; border-radius: var(--crm-radius-sm); }
.difference { display: block; white-space: pre-line; font-size: 25rpx; line-height: 1.8; padding: 14rpx 0; }
.identifier { display: block; overflow-wrap: anywhere; font-size: 23rpx; color: var(--crm-text-muted); margin-top: 12rpx; }
.history-row { padding: 20rpx 0; border-bottom: 1rpx solid var(--crm-border); font-size: 27rpx; }
.history-row:last-child { border-bottom: 0; }
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
