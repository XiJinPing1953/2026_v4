<template>
	<AppPage class="pda-compact-page pda-compact-page--inner native-sale" hideBottleQuery>
		<text v-if="sale.crewNotice.value" class="warning-text">{{ sale.crewNotice.value }}</text>
		<view class="printer-bar">
			<text class="printer-status">{{ driverSaleFeedback(printer.status.value, '打印机连接异常，请重新连接。') }}</text>
			<AppButton kind="ghost" :disabled="printer.busy.value || printer.connecting.value" @click="printer.connect">{{ printer.connecting.value ? '连接中…' : printer.connected.value ? '更换打印机' : '连接打印机' }}</AppButton>
			<AppButton v-if="printer.busy.value" kind="outline" @click="printer.stop">停止打印</AppButton>
		</view>
		<view v-if="!receipt && !draftStatus.available" class="sale-steps" aria-label="销售步骤">
			<view v-for="(title, index) in titles" :key="title" :class="['sale-step', step === index + 1 && 'sale-step--active']">
				<text>{{ index + 1 }} {{ title }}</text>
			</view>
		</view>
		<view v-if="draftStatus.available" class="notice">
			<text class="strong">有一单还没处理完</text>
			<view class="buttons"><AppButton @click="restore">继续这单</AppButton><AppButton kind="outline" @click="discard">放弃草稿</AppButton></view>
		</view>
		<text v-if="draftStatus.state === 'error'" class="error">{{ driverSaleFeedback(draftStatus.message, '无法读取草稿，请联系办公室。') }}</text>
		<view v-if="receipt" class="notice" aria-live="polite">
			<text class="strong">{{ receipt.sourceSaved ? '销售单已保存' : submitting ? '正在确认保存结果' : receipt.sourceSaved === false ? '本单需核对' : '保存结果待确认' }}</text>
			<text v-if="receipt.sourceSaved || !submitting">{{ driverReceiptSummary(receipt) }}</text>
			<text v-for="(warning, index) in driverReceiptWarnings(receipt)" :key="index" class="error">{{ warning }}</text>
			<view class="receipt-actions">
				<AppButton v-if="receipt.sourceSaved === true" :disabled="submitting || printer.busy.value" @click="openNext">开下一单</AppButton>
				<AppButton v-if="!submitting && submissionLocked && receipt.sourceSaved !== true" :loading="submitting" @click="query">查询保存结果</AppButton>
				<AppButton v-if="!submitting && receipt.status === 'unknown'" kind="outline" :disabled="submitting" @click="save(true)">重试这单</AppButton>
				<AppButton v-if="receipt.sourceSaved === true && receipt.sourceExists !== false && receipt.saleId" kind="outline" :disabled="printer.busy.value" @click="printer.print(receipt.saleId)">补打两联</AppButton>
			</view>
		</view>
		<view v-if="changes.length" class="notice">
			<text class="strong">资料有变化，请核对</text>
			<text v-for="change in changes" :key="change">{{ driverSaleFeedback(change, '请重新核对客户和钢瓶资料。') }}</text>
			<AppButton :disabled="busy || locked" @click="applyChanges">更新资料，返回核对</AppButton>
		</view>
		<text v-if="error && (receipt?.sourceSaved !== true) && step !== 2 && step !== 3" class="error" role="alert">{{ driverSaleFeedback(error) }}</text>
		<view v-if="!draftStatus.available && receipt?.sourceSaved !== true" :class="['sale-content', locked && 'sale-content--locked']" :inert="locked || undefined">
			<template v-if="step === 1">
				<AppSection title="选客户">
					<PdaLookupSuggestField :model-value="customerKeyword" label="客户名称" placeholder="输入名称，或按实体键扫客户码" :disabled="busy || locked" :fetcher="searchCustomers" :map-item="mapCustomer" @update:modelValue="sale.setCustomerKeyword" @select="selectCustomer" />
					<view v-if="selectedCustomer" class="customer">
						<text class="strong">{{ selectedCustomer.name }}</text>
						<text v-if="selectedCustomer.contact || selectedCustomer.phone">{{ selectedCustomer.contact }} {{ selectedCustomer.phone }}</text>
						<text>单价 {{ form.unitPrice || '未设置' }} 元/kg</text>
					</view>
					<text v-if="pricingWarning" class="error">{{ pricingWarning }}</text>
				</AppSection>
				<AppButton kind="outline" :disabled="busy || locked" @click="otherOpen = !otherOpen">其他信息 {{ otherOpen ? '收起' : '展开' }}</AppButton>
				<view v-if="otherOpen" class="details">
					<text>销售日期</text>
					<picker mode="date" :value="form.date" :disabled="busy || locked" @change="form.date = $event.detail.value"><view class="date-field">{{ form.date }}</view></picker>
					<PdaLookupSuggestField v-for="slot in ['delivery1', 'delivery2']" :key="slot" v-model="form[slot]" :label="slot === 'delivery1' ? '配送员一' : '配送员二'" :disabled="busy || locked" :fetcher="searchDeliveries" :map-item="mapDelivery" @select="sale.applyDeliverySelection(slot, $event)" />
					<PdaLookupSuggestField v-model="form.vehicleNo" label="车辆" :disabled="busy || locked" :fetcher="searchVehicles" :map-item="mapVehicle" @select="sale.applyVehicleSelection" />
					<AppInput v-model="form.remark" label="备注（选填）" :disabled="busy || locked" />
				</view>
			</template>
			<template v-else-if="step === 2 || step === 3">
				<view class="direction-heading"><text class="strong">{{ directionLabel }}</text><text>已称 {{ completeCount }} 瓶</text></view>
				<text class="customer-line">客户：{{ form.customerName }}</text>
				<PdaWeighScale :minimum-weight="captureMinimum" :snapshot="snapshot" :selected="Boolean(current)" :captured="Boolean(current && weighed(current))" :gross="current?.gross" :tare="current?.tare" :positive-net="direction === 'out'" :busy="busy" :disabled="locked" @connect="connect" @disconnect="disconnect" />
				<view class="current-bottle" aria-live="polite">
					<text class="strong">{{ current ? `${current.bottleNo} 号瓶` : `请扫描${directionLabel}` }}</text>
					<text v-if="current" :class="['weigh-label', weighed(current) ? 'weigh-label--ready' : 'weigh-label--pending']">{{ weighed(current) ? '已称好' : '还没称好' }}</text>
					<text v-if="error" class="error" role="alert">{{ driverSaleFeedback(error) }}</text>
					<text v-else-if="!current || !weighed(current) || !message.includes('这瓶称好了')">{{ driverSaleFeedback(message) }}</text>
					<view v-if="current && weighed(current)" class="weights"><text>毛重 {{ current.gross }}</text><text>皮重 {{ current.tare }}</text><text>净重 {{ current.net }} kg</text></view>
					<view v-if="current" class="buttons"><AppButton kind="outline" :disabled="busy || locked" @click="reweigh(current)">重新称重</AppButton><AppButton kind="ghost" :disabled="busy || locked" @click="remove(current)">删除</AppButton></view>
				</view>
				<view class="buttons"><AppButton kind="ghost" :disabled="busy || locked" @click="toggleManual">{{ manualOpen ? '取消手输' : '手输瓶号' }}</AppButton><AppButton v-if="rows.length" kind="outline" @click="recordsOpen = !recordsOpen">本单 {{ rows.length }} 瓶 {{ recordsOpen ? '收起' : '查看' }}</AppButton></view>
				<view v-if="manualOpen" class="manual-bottle">
					<PdaBottleSuggestField v-model="bottleInput" label="瓶号" placeholder="输入钢瓶编号" :disabled="busy || locked" @select="selectManualBottle" @confirm="addManualBottle">
						<template #action><AppButton :disabled="busy || locked || !bottleInput.trim()" @click="addManualBottle">确认瓶号</AppButton></template>
					</PdaBottleSuggestField>
				</view>
				<view v-if="recordsOpen && rows.length" class="bottle-list">
					<view v-for="row in rows" :key="row.rowId" :class="['bottle-row', row.rowId === currentId && 'bottle-row--current']">
						<view class="row-heading"><text class="strong">{{ row.bottleNo }} 号</text><text :class="['weigh-label', weighed(row) ? 'weigh-label--ready' : 'weigh-label--pending']">{{ weighed(row) ? '已称好' : '还没称好' }}</text></view>
						<view class="weights"><text>毛重 {{ row.gross || '—' }}</text><text>皮重 {{ row.tare || '—' }}</text><text>净重 {{ row.net || '—' }} kg</text></view>
						<view class="buttons"><AppButton kind="outline" :disabled="busy || locked" @click="reweigh(row)">重新称重</AppButton><AppButton kind="ghost" :disabled="busy || locked" @click="remove(row)">删除</AppButton></view>
					</view>
				</view>
			</template>
			<template v-else>
				<view class="customer"><text class="strong">{{ form.customerName }}</text><text>出瓶 {{ outRows.length }} 瓶 · 回瓶 {{ backRows.length }} 瓶</text><text>单价 {{ form.unitPrice }} 元/kg</text></view>
				<text>保存后直接打印两联：留底联、客户联，底部可签名。</text>
				<view v-for="group in previewGroups" :key="group.title" class="details">
					<text class="strong">{{ group.title }} {{ group.rows.length }} 瓶</text>
					<text v-if="!group.rows.length">本次没有{{ group.title }}</text>
					<view v-for="row in group.rows" :key="row.rowId" class="preview-row"><text class="strong">{{ row.bottleNo }} 号</text><view class="weights"><text>毛重 {{ row.gross }}</text><text>皮重 {{ row.tare }}</text><text>净重 {{ row.net }} kg</text></view></view>
				</view>
				<AppButton kind="outline" @click="previewDetailsOpen = !previewDetailsOpen">配送信息 {{ previewDetailsOpen ? '收起' : '展开' }}</AppButton>
				<view v-if="previewDetailsOpen" class="details">
					<text>日期：{{ form.date }}</text><text>配送员：{{ form.delivery1 || '未填写' }} {{ form.delivery2 }}</text><text>车辆：{{ form.vehicleNo || '未填写' }}</text>
					<text v-if="form.remark">备注：{{ form.remark }}</text>
				</view>
			</template>
			<view :class="['sale-footer', (keyboardOpen || manualOpen) && 'sale-footer--keyboard']">
				<AppButton v-if="step > 1" kind="outline" :disabled="busy || locked" @click="previous">上一步</AppButton>
				<AppButton v-if="step < 4" :loading="busy" :disabled="locked || pendingManual || (step === 3 && !rows.length && !outRows.length)" @click="advance">{{ nextLabel }}</AppButton>
				<AppButton v-else :loading="submitting" :disabled="busy || locked || printer.busy.value" @click="save(false)">保存并打印两联</AppButton>
			</view>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { driverSaleFeedback, driverReceiptWarnings, driverReceiptSummary } from '@/services/pda/driverSaleFeedback'
import PdaWeighScale from './PdaWeighScale.vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import PdaLookupSuggestField from './PdaLookupSuggestField.vue'
import PdaBottleSuggestField from './PdaBottleSuggestField.vue'
import { usePdaNativeSale } from '@/composables/pda/usePdaNativeSale'
import { listPdaCustomers, resolvePdaCustomerPricing } from '@/services/pda/customer'
import { listPdaDeliveries } from '@/services/pda/delivery'
import { listPdaVehicles } from '@/services/pda/vehicle'

const { printer, captureMinimum, sale, step, direction, outRows, backRows, rows, current, currentId, snapshot, busy, locked, error, message, changes, weighed,
	chooseBottle, selectCustomer, go, connect, disconnect, reweigh, remove, save, query, restore, discard, nextSale, applyChanges, activate, deactivate } = usePdaNativeSale()
const { form, selectedCustomer, customerKeyword, draftStatus, receipt, submissionLocked, submitting } = sale
const titles = ['客户', '出瓶', '回瓶', '确认']
const manualOpen = ref(false), recordsOpen = ref(false)
const otherOpen = ref(false)
const previewDetailsOpen = ref(false)
const bottleInput = ref('')
const keyboardOpen = ref(false)
const pendingManual = computed(() => manualOpen.value && Boolean(bottleInput.value.trim()))
function toggleManual() {
	manualOpen.value = !manualOpen.value
	if (!manualOpen.value) { bottleInput.value = ''; uni.hideKeyboard() }
}
async function changeStep(next) {
	await go(next)
	if (step.value === next) { manualOpen.value = false; bottleInput.value = ''; recordsOpen.value = false }
}
function advance() { if (!pendingManual.value) return changeStep(step.value + 1) }
function previous() { return changeStep(step.value - 1) }
const directionLabel = computed(() => direction.value === 'back' ? '回瓶' : '出瓶')
const completeCount = computed(() => rows.value.filter(weighed).length)
const pricingWarning = computed(() => selectedCustomer.value ? resolvePdaCustomerPricing(selectedCustomer.value).msg || '' : '')
const previewGroups = computed(() => [{ title: '出瓶', rows: outRows.value }, { title: '回瓶', rows: backRows.value }])
const nextLabel = computed(() => step.value === 1 ? '下一步：出瓶' : step.value === 2 ? (rows.value.length ? '下一步：回瓶' : '没有出瓶，跳过') : rows.value.length ? '下一步：确认' : outRows.value.length ? '没有回瓶，跳过' : '请先称一只瓶')
const mapCustomer = item => ({ key: item._id, title: item.name, subtitle: [item.contact, item.phone, item.address].filter(Boolean).join(' · '), raw: item })
const mapDelivery = item => ({ key: item._id, title: item.name, raw: item })
const mapVehicle = item => ({ key: item._id, title: item.plate_no, raw: item })
async function searchCustomers(keyword) {
	try {
		const result = await listPdaCustomers({ keyword, page: 1, pageSize: 12, isActive: true, includeDeposit: false })
		if (result?.code !== 0) throw new Error(result?.msg || '客户查询失败')
		return result.data || []
	} catch (cause) {
		if (step.value === 1 && !selectedCustomer.value && keyword === customerKeyword.value) error.value = cause.message || '客户查询失败，请重试'
		return []
	}
}
async function searchDeliveries(keyword) { const result = await listPdaDeliveries({ keyword, page: 1, pageSize: 12, isActive: true }); return result?.code === 0 ? result.data || [] : [] }
async function searchVehicles(keyword) { const result = await listPdaVehicles({ keyword, page: 1, pageSize: 12, isActive: true }); return result?.code === 0 ? result.data || [] : [] }
async function addManualBottle() { if (await chooseBottle(bottleInput.value)) { bottleInput.value = ''; uni.hideKeyboard() } }
async function selectManualBottle(bottle) { if (bottle?.bottle_no && await chooseBottle(bottle.bottle_no)) { bottleInput.value = ''; uni.hideKeyboard() } }
async function openNext() { if (await nextSale()) { manualOpen.value = false; recordsOpen.value = false; bottleInput.value = ''; otherOpen.value = false; previewDetailsOpen.value = false } }
function keyboardChanged(event) { keyboardOpen.value = Number(event.height) > 0 }
if (typeof uni.onKeyboardHeightChange === 'function') uni.onKeyboardHeightChange(keyboardChanged)
onBeforeUnmount(() => { if (typeof uni.offKeyboardHeightChange === 'function') uni.offKeyboardHeightChange(keyboardChanged) })
defineExpose({ activateBarcodeSession: activate, deactivateBarcodeSession: deactivate })
</script>

<style lang="scss" scoped>
@import './pdaCompact.scss';
.native-sale { font-size: 16px; color: #213448; }
.printer-bar, .buttons, .receipt-actions, .sale-steps, .sale-footer, .weights { display: grid; grid-gap: 8px; align-items: center; }
.printer-bar { grid-template-columns: minmax(0, 1fr) auto; background: #fff; border: 1px solid #d9e2ec; border-radius: 10px; padding: 0 10px; margin-bottom: 12px; }
.printer-status, .customer-line { color: #47596c; font-size: 14px; line-height: 1.5; }
.sale-steps { grid-template-columns: repeat(4, minmax(0, 1fr)); grid-gap: 4px; margin-bottom: 14px; }
.sale-step { text-align: center; padding: 6px 0 8px; border-bottom: 3px solid #d9e2ec; color: #526475; font-size: 14px; }
.sale-step--active { border-color: #0666ad; color: #075ba0; font-weight: 700; }
.sale-content, .details, .customer, .current-bottle, .notice, .bottle-list, .bottle-row { display: grid; grid-template-columns: minmax(0, 1fr); grid-gap: 12px; align-content: start; }
.sale-content { padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
.sale-content--locked { pointer-events: none; opacity: .65; }
.notice, .details, .customer, .current-bottle, .bottle-row { padding: 14px; border: 1px solid #d9e2ec; border-radius: 10px; background: #fff; }
.notice { margin-bottom: 12px; line-height: 1.5; }
.strong { font-size: 18px; font-weight: 700; }
.error { display: block; padding: 10px 12px; background: #fff4eb; color: #932f17; line-height: 1.5; overflow-wrap: break-word; }
.buttons, .receipt-actions { grid-template-columns: repeat(auto-fit, minmax(106px, 1fr)); }
.receipt-actions > :first-child { grid-column: 1 / -1; }
.direction-heading, .row-heading { display: flex; align-items: center; justify-content: space-between; }
.direction-heading .strong { font-size: 22px; }
.current-bottle { background: #f2f8fd; border-color: #b7d4e9; }
.weigh-label { font-size: 15px; font-weight: 700; }
.weigh-label--ready { color: #166534; }
.weigh-label--pending { color: #922d1b; }
.weights { grid-template-columns: repeat(3,minmax(0,1fr)); font-size: 14px; }
.manual-bottle { padding: 12px; border: 1px solid #b7d4e9; border-radius: 10px; background: #fff; }
.bottle-row--current { border-left: 3px solid #075db3; }
.date-field { padding: 12px; background: #edf3f8; border-radius: 6px; }
.preview-row { padding-top: 8px; border-top: 1px solid #e2e8f0; }
.sale-footer { position: fixed; bottom: 0; left: 0; right: 0; grid-template-columns: auto minmax(0, 1fr); padding: 8px 12px calc(8px + env(safe-area-inset-bottom)); background: #fff; border-top: 1px solid #cbd5e1; z-index: 20; }
.sale-footer > :only-child { grid-column: 1 / -1; }
.sale-footer--keyboard { position: static; padding: 12px 0; background: transparent; }
.native-sale :deep(.btn) { min-height: 48px; height: auto; padding: 8px 12px; line-height: 1.25; font-size: 16px; }
.native-sale :deep(.controls) { display: grid; grid-template-columns: repeat(auto-fit,minmax(90px,1fr)); grid-gap: 8px; }
.native-sale :deep(.reading .number) { margin-right: 6px; }
.native-sale :deep(.field__input) { font-size: 16px; }
.native-sale :deep(.field__label) { font-size: 14px; }
.native-sale :deep(.section__title) { font-size: 18px; }
</style>
