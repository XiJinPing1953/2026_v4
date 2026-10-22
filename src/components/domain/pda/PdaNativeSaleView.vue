<template>
	<AppPage class="pda-compact-page pda-compact-page--inner native-sale" hideBottleQuery>
		<view class="sale-steps" aria-label="销售步骤">
			<view v-for="(title, index) in titles" :key="title" :class="['sale-step', step === index + 1 && 'sale-step--active']">
				<text>{{ index + 1 }} {{ title }}</text>
			</view>
		</view>
		<view v-if="draftStatus.available" class="notice">
			<text class="strong">有一单还没处理完</text>
			<view class="buttons"><AppButton @click="restore">继续这单</AppButton><AppButton kind="outline" @click="discard">放弃草稿</AppButton></view>
		</view>
		<text v-if="draftStatus.state === 'error'" class="error">{{ draftStatus.message }}</text>
		<view v-if="receipt" class="notice" aria-live="polite">
			<text class="strong">{{ receipt.status === 'saved' ? '已保存' : receipt.sourceSaved === true ? '销售单已保存，还有信息待核对' : '保存结果' }}</text>
			<text>{{ receipt.message }}</text>
			<text v-for="warning in receipt.warnings" :key="warning" class="error">{{ warning }}</text>
			<view class="buttons">
				<AppButton v-if="submissionLocked && receipt.status !== 'saved'" :loading="submitting" @click="query">查询保存结果</AppButton>
				<AppButton v-if="receipt.status === 'unknown'" kind="outline" :disabled="submitting" @click="save(true)">重试这单</AppButton>
				<AppButton v-if="receipt.sourceSaved === true" :disabled="submitting" @click="openNext">开下一单</AppButton>
			</view>
		</view>
		<view v-if="changes.length" class="notice">
			<text class="strong">资料有变化，请核对</text>
			<text v-for="change in changes" :key="change">{{ change }}</text>
			<AppButton :disabled="busy || locked" @click="applyChanges">更新资料，返回核对</AppButton>
		</view>
		<text v-if="error && step !== 2 && step !== 3" class="error" role="alert">{{ error }}</text>
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
					<text v-if="error" class="error" role="alert">{{ error }}</text>
					<text v-else-if="!current || !weighed(current) || !message.includes('这瓶称好了')">{{ message }}</text>
					<view v-if="current && weighed(current)" class="weights"><text>毛重 {{ current.gross }}</text><text>皮重 {{ current.tare }}</text><text>净重 {{ current.net }} kg</text></view>
					<view v-if="current" class="buttons"><AppButton kind="outline" :disabled="busy || locked" @click="reweigh(current)">重新称重</AppButton><AppButton kind="ghost" :disabled="busy || locked" @click="remove(current)">删除</AppButton></view>
				</view>
				<view class="buttons"><AppButton kind="ghost" :disabled="busy || locked" @click="manualOpen = !manualOpen">手输瓶号 {{ manualOpen ? '收起' : '展开' }}</AppButton><AppButton v-if="rows.length" kind="outline" @click="recordsOpen = !recordsOpen">本单 {{ rows.length }} 瓶 {{ recordsOpen ? '收起' : '查看' }}</AppButton></view>
				<view v-if="manualOpen" class="manual-bottle">
					<PdaBottleSuggestField v-model="bottleInput" label="瓶号" placeholder="也可输入瓶号" :disabled="busy || locked" @select="selectManualBottle" @confirm="addManualBottle" />
					<AppButton kind="outline" :disabled="busy || locked || !bottleInput.trim()" @click="addManualBottle">确认瓶号</AppButton>
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
				<view v-for="group in previewGroups" :key="group.title" class="details">
					<text class="strong">{{ group.title }} {{ group.rows.length }} 瓶</text>
					<text v-if="!group.rows.length">本次没有{{ group.title }}</text>
					<view v-for="row in group.rows" :key="row.rowId" class="preview-row"><text class="strong">{{ row.bottleNo }} 号</text><view class="weights"><text>毛重 {{ row.gross }}</text><text>皮重 {{ row.tare }}</text><text>净重 {{ row.net }} kg</text></view></view>
				</view>
				<AppButton kind="outline" @click="previewDetailsOpen = !previewDetailsOpen">其他信息和存瓶 {{ previewDetailsOpen ? '收起' : '展开' }}</AppButton>
				<view v-if="previewDetailsOpen" class="details">
					<text>日期：{{ form.date }}</text><text>配送员：{{ form.delivery1 || '未填写' }} {{ form.delivery2 }}</text><text>车辆：{{ form.vehicleNo || '未填写' }}</text>
					<text v-if="form.remark">备注：{{ form.remark }}</text>
					<text>原存瓶 {{ form.depositCount }} 瓶 · 本单后预计 {{ form.depositRows.length }} 瓶</text>
					<text>瓶号：{{ form.depositRows.map(row => row.bottle_no).join('、') || '无' }}</text>
				</view>
			</template>
			<view :class="['sale-footer', keyboardOpen && 'sale-footer--keyboard']">
				<AppButton v-if="step > 1" kind="outline" :disabled="busy || locked" @click="go(step - 1)">上一步</AppButton>
				<AppButton v-if="step < 4" :loading="busy" :disabled="locked || (step === 3 && !rows.length && !outRows.length)" @click="go(step + 1)">{{ nextLabel }}</AppButton>
				<AppButton v-else :loading="submitting" :disabled="busy || locked" @click="save(false)">确认保存</AppButton>
			</view>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
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

const { captureMinimum, sale, step, direction, outRows, backRows, rows, current, currentId, snapshot, busy, locked, error, message, changes, weighed,
	chooseBottle, selectCustomer, go, connect, disconnect, reweigh, remove, save, query, restore, discard, nextSale, applyChanges, activate, deactivate } = usePdaNativeSale()
const { form, selectedCustomer, customerKeyword, draftStatus, receipt, submissionLocked, submitting } = sale
const titles = ['客户', '出瓶', '回瓶', '确认']
const manualOpen = ref(false), recordsOpen = ref(false)
const otherOpen = ref(false)
const previewDetailsOpen = ref(false)
const bottleInput = ref('')
const keyboardOpen = ref(false)
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
		const result = await listPdaCustomers({ keyword, page: 1, pageSize: 12, isActive: true })
		if (result?.code !== 0) throw new Error(result?.msg || '客户查询失败')
		return result.data || []
	} catch (cause) { error.value = cause.message || '客户查询失败，请重试'; return [] }
}
async function searchDeliveries(keyword) { const result = await listPdaDeliveries({ keyword, page: 1, pageSize: 12, isActive: true }); return result?.code === 0 ? result.data || [] : [] }
async function searchVehicles(keyword) { const result = await listPdaVehicles({ keyword, page: 1, pageSize: 12, isActive: true }); return result?.code === 0 ? result.data || [] : [] }
async function addManualBottle() { if (await chooseBottle(bottleInput.value)) { bottleInput.value = ''; uni.hideKeyboard() } }
async function selectManualBottle(bottle) { if (bottle?.bottle_no && await chooseBottle(bottle.bottle_no)) { bottleInput.value = ''; uni.hideKeyboard() } }
function openNext() { if (nextSale()) { manualOpen.value = false; recordsOpen.value = false; bottleInput.value = ''; otherOpen.value = false; previewDetailsOpen.value = false } }
function keyboardChanged(event) { keyboardOpen.value = Number(event.height) > 0 }
if (typeof uni.onKeyboardHeightChange === 'function') uni.onKeyboardHeightChange(keyboardChanged)
onBeforeUnmount(() => { if (typeof uni.offKeyboardHeightChange === 'function') uni.offKeyboardHeightChange(keyboardChanged) })
defineExpose({ activateBarcodeSession: activate, deactivateBarcodeSession: deactivate })
</script>

<style lang="scss" scoped>
@import './pdaCompact.scss';
.native-sale { font-size: 16px; }
.sale-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8rpx; margin-bottom: 16rpx; }
.sale-step { padding: 18rpx 4rpx; text-align: center; border-radius: 12rpx; background: #e8edf2; color: #475569; font-size: 14px; white-space: nowrap; }
.sale-step--active { background: #075db3; color: #fff; font-weight: 700; }
.sale-content { display: flex; flex-direction: column; gap: 16rpx; padding-bottom: calc(160rpx + env(safe-area-inset-bottom)); }
.sale-content--locked { pointer-events: none; opacity: 0.65; }
.strong { font-weight: 700; font-size: 18px; }
.notice, .details, .customer, .current-bottle, .scale-strip { display: flex; flex-direction: column; gap: 14rpx; padding: 20rpx; border: 1rpx solid #d9e2ec; border-radius: 16rpx; background: #fff; }
.notice { margin-bottom: 16rpx; background: #eff6ff; }
.error { display: block; color: #a12b16; background: #fff3eb; padding: 16rpx; line-height: 1.5; overflow-wrap: anywhere; }
.buttons { display: flex; align-items: center; flex-wrap: wrap; gap: 12rpx; }
.direction-heading, .row-heading { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; }
.direction-heading .strong { font-size: 22px; }
.customer-line { color: #475569; }
.scale-reading { display: flex; align-items: baseline; gap: 12rpx; }
.scale-number { font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; }
.scale-status { margin-left: auto; font-size: 14px; }
.current-bottle { border: 2rpx solid #075db3; background: #f0f7ff; }
.weigh-label { font-size: 16px; font-weight: 700; }
.weigh-label--ready { color: #166534; }
.weigh-label--pending { color: #b42318; }
.weights { display: flex; flex-wrap: wrap; gap: 8rpx 18rpx; font-size: 14px; }
.manual-bottle { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 12rpx; }
.bottle-list { display: flex; flex-direction: column; gap: 12rpx; }
.bottle-row { display: flex; flex-direction: column; gap: 10rpx; border-bottom: 1rpx solid #d9e2ec; background: #fff; padding: 16rpx; }
.bottle-row--current { border-left: 6rpx solid #075db3; }
.date-field { padding: 22rpx; background: #f1f5f9; border-radius: 12rpx; }
.preview-row { padding: 10rpx 0; border-top: 1rpx solid #e2e8f0; }
.sale-footer { position: fixed; bottom: 0; left: 0; right: 0; display: flex; gap: 16rpx; padding: 20rpx 24rpx calc(20rpx + env(safe-area-inset-bottom)); background: #fff; border-top: 1rpx solid #cbd5e1; z-index: 20; }
.sale-footer > :last-child { flex: 1; }
.sale-footer--keyboard { position: static; padding: 16rpx 0; }
.native-sale :deep(.btn) { min-height: 48px; font-size: 16px; }
.native-sale :deep(.field__input) { font-size: 16px; }
.native-sale :deep(.field__label) { font-size: 14px; }
.native-sale :deep(.section__title) { font-size: 18px; }
</style>
