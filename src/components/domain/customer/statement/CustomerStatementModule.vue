<template>
	<AppPage title="客户对账" :subtitle="subtitle" icon="wallet">
		<template #headerActions>
			<view class="statement-header-actions">
				<picker class="header-date-picker" mode="date" @change="onRowsDateFromChange">
					<AppButton size="sm" kind="neutral" :disabled="rowsLoading || analysisLoading">{{ headerRowsDateFromText }}</AppButton>
				</picker>
				<picker class="header-date-picker" mode="date" @change="onRowsDateToChange">
					<AppButton size="sm" kind="neutral" :disabled="rowsLoading || analysisLoading">{{ headerRowsDateToText }}</AppButton>
				</picker>
				<AppButton size="sm" kind="primary" :loading="rowsLoading || analysisLoading" @click="searchRows(true)">查询日期</AppButton>
				<AppButton
					size="sm"
					:kind="rowsDatePreset === 'year' ? 'primary' : 'ghost'"
					:disabled="rowsLoading || analysisLoading"
					@click="onRowsYearQuick"
				>
					本年累计
				</AppButton>
				<AppButton
					size="sm"
					:kind="rowsDatePreset === 'month' ? 'primary' : 'ghost'"
					:disabled="rowsLoading || analysisLoading"
					@click="onRowsMonthQuick"
				>
					本月累计
				</AppButton>
				<AppButton
					size="sm"
					kind="outline"
					:loading="exportingStatement"
					:disabled="loading || rowsLoading || analysisLoading"
					@click="onExportStatement"
				>
					导出对账单
				</AppButton>
				<AppButton
					size="sm"
					kind="outline"
					:loading="exportingAccountingLedger"
					:disabled="loading || rowsLoading || analysisLoading"
					@click="onExportAccountingLedger"
				>
					会计导出
				</AppButton>
				<AppButton size="sm" kind="neutral" :disabled="loading || rowsLoading || analysisLoading" @click="refreshAll">刷新</AppButton>
				<AppButton size="sm" kind="neutral" @click="onBack">返回</AppButton>
			</view>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="应收余额(未扣冲抵)" :value="formatSummaryMoney(summaryReceivableBalanceDisplay)" hint="元" icon="alert" />
				<AppStatCard class="summary-card" label="可冲抵余额" :value="formatSummaryMoney(summaryPrepayBalanceDisplay)" hint="元" icon="check-circle" />
				<AppStatCard class="summary-card" label="净欠款(扣冲抵后)" :value="formatSummaryMoney(summaryNetBalanceDisplay)" hint="元" icon="wallet" @click="onOpenNetDebtSaleSources" />
				<AppStatCard class="summary-card" label="最近回款" :value="summaryLastReceiptText" hint="日期" icon="calendar" />
			</view>
		</template>

		<view class="content-shell">
			<AppSection title="客户总览">
				<view class="overview-grid">
					<view class="overview-item">
						<text class="overview-label">客户名称</text>
						<text class="overview-value">{{ customer.name || '-' }}</text>
					</view>
					<view class="overview-item">
						<text class="overview-label">联系人</text>
						<text class="overview-value">{{ customer.contact || '-' }}</text>
					</view>
					<view class="overview-item">
						<text class="overview-label">电话</text>
						<text class="overview-value">{{ customer.phone || '-' }}</text>
					</view>
					<view class="overview-item">
						<text class="overview-label">计价单位</text>
						<text class="overview-value">{{ priceUnitText(customer.default_price_unit) }}</text>
					</view>
					<view class="overview-item">
						<text class="overview-label">默认单价</text>
						<text class="overview-value">{{ defaultUnitPriceText }}</text>
					</view>
					<view class="overview-item">
						<text class="overview-label">累计营收</text>
						<text class="overview-value">¥{{ formatMoney(overviewShouldReceiveTotal) }}</text>
						<text class="overview-meta">{{ overviewScopeText }}</text>
					</view>
					<view class="overview-item">
						<text class="overview-label">累计实收</text>
						<text class="overview-value">¥{{ formatMoney(overviewAmountReceivedTotal) }}</text>
						<text class="overview-meta">{{ overviewScopeText }}</text>
					</view>
					<view class="overview-item">
						<text class="overview-label">其中预付款</text>
						<text class="overview-value">¥{{ formatMoney(overviewPrepayManualBalance) }}</text>
						<text class="overview-meta">{{ overviewScopeText }}</text>
					</view>
					<view class="overview-item">
						<text class="overview-label">其中冲抵池</text>
						<text class="overview-value">¥{{ formatMoney(overviewOffsetCreditBalance) }}</text>
						<text class="overview-meta">{{ overviewScopeText }}</text>
					</view>
				</view>
			</AppSection>

			<AppSection title="账务操作">
				<template #actions>
					<view v-if="activeOperationTab === 'opening_debt'" class="section-actions">
						<AppButton size="sm" kind="ghost" @click="resetOpeningDebtForm">重置</AppButton>
						<AppButton v-if="isEditingOpeningDebt" size="sm" kind="outline" @click="cancelOpeningDebtEditing">取消编辑</AppButton>
						<AppButton size="sm" kind="primary" :loading="openingDebtSubmitting" @click="onCreateOpeningDebtEntry">
							{{ openingDebtPrimaryActionLabel }}
						</AppButton>
					</view>
					<view v-else-if="activeOperationTab === 'other_fee'" class="section-actions">
						<AppButton size="sm" kind="ghost" @click="resetOtherFeeForm">重置</AppButton>
						<AppButton v-if="isEditingOtherFee" size="sm" kind="outline" @click="cancelOtherFeeEditing">取消编辑</AppButton>
						<AppButton size="sm" kind="primary" :loading="otherFeeSubmitting" @click="onCreateOtherFeeEntry">
							{{ otherFeePrimaryActionLabel }}
						</AppButton>
					</view>
					<view v-else-if="activeOperationTab === 'prepay'" class="section-actions">
						<AppButton size="sm" kind="ghost" @click="resetPrepayForm">重置</AppButton>
						<AppButton size="sm" kind="primary" :loading="prepaySubmitting" @click="onCreatePrepayEntry">录入预付</AppButton>
					</view>
					<view v-else-if="activeOperationTab === 'offset_entry'" class="section-actions">
						<AppButton size="sm" kind="ghost" @click="resetOffsetEntryForm">重置</AppButton>
						<AppButton size="sm" kind="neutral" @click="activeOperationTab = 'offset'">去冲抵分配</AppButton>
						<AppButton size="sm" kind="primary" :loading="offsetEntrySubmitting" @click="onCreateOffsetEntry">录入冲抵池</AppButton>
					</view>
					<view v-else-if="activeOperationTab === 'offset'" class="section-actions">
						<AppButton size="sm" kind="ghost" @click="resetOffsetAllocateForm">重置</AppButton>
						<AppButton size="sm" kind="neutral" :loading="offsetPoolLoading" @click="loadOffsetCreditPool(true)">刷新来源</AppButton>
						<AppButton
							size="sm"
							kind="primary"
							:loading="offsetAllocating"
							:disabled="selectedOffsetReceiptCount <= 0"
							@click="onAllocateOffsetCredit"
						>
							提交冲抵
						</AppButton>
					</view>
					<view v-else-if="activeOperationTab === 'receipt'" class="section-actions">
						<AppButton size="sm" kind="ghost" @click="resetReceiptForm">重置</AppButton>
						<AppButton v-if="isEditingReceipt" size="sm" kind="outline" @click="cancelReceiptEditing">取消编辑</AppButton>
						<AppButton size="sm" kind="neutral" :disabled="isEditingReceipt" :loading="previewing" @click="onPreview">预览分配</AppButton>
						<AppButton size="sm" kind="primary" :loading="submitting" @click="onCreateAutoReceipt">{{ receiptPrimaryActionLabel }}</AppButton>
						<AppButton size="sm" kind="outline" :disabled="isEditingReceipt || !previewPlan" :loading="confirming" @click="onConfirmAllocation">确认入账</AppButton>
					</view>
				</template>

				<view class="operation-head">
					<text class="operation-current">当前操作：{{ activeOperationTabLabel }}</text>
				</view>
				<view class="operation-tabs-scroll">
					<AppTabs :model-value="activeOperationTab" :items="operationTabs" @update:modelValue="onOperationTabChange" />
				</view>

				<view v-if="activeOperationTab === 'receipt'" class="operation-panel">
					<view class="receipt-grid receipt-grid--four">
						<AppInput
							v-model="receiptForm.amount"
							label="收款金额(元)"
							:placeholder="moneyInputPlaceholder"
							size="sm"
							:readonly="isEditingCashierReceipt"
							@blur="onReceiptAmountBlur"
						/>
						<AppInput
							v-model="receiptForm.roundingAmount"
							label="抹零金额(元)"
							:placeholder="moneyInputPlaceholder"
							size="sm"
							:readonly="isEditingCashierReceipt"
							@blur="onReceiptRoundingAmountBlur"
						/>
						<picker class="picker-block" mode="date" :disabled="isEditingCashierReceipt" @change="onBizDateChange">
							<AppInput v-model="receiptForm.bizDate" label="业务日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<picker
							class="picker-block"
							mode="selector"
							:range="receiptPaymentMethodOptions"
							range-key="label"
							:value="receiptPaymentMethodIndex"
							:disabled="isEditingCashierReceipt"
							@change="onReceiptPaymentMethodChange"
						>
							<AppInput :model-value="receiptPaymentMethodLabel" label="收款方式" placeholder="请选择收款方式" readonly size="sm" />
						</picker>
						<picker
							class="picker-block"
							mode="selector"
							:range="receiptAllocationModeOptions"
							range-key="label"
							:value="receiptAllocationModeIndex"
							@change="onReceiptAllocationModeChange"
						>
							<AppInput :model-value="receiptAllocationModeLabel" label="分配模式" placeholder="请选择模式" readonly size="sm" />
						</picker>
						<picker v-if="receiptForm.allocationMode === 'period'" class="picker-block" mode="date" @change="onAllocationStartDateChange">
							<AppInput v-model="receiptForm.allocationStartDate" label="分配开始日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<picker v-if="receiptForm.allocationMode === 'period'" class="picker-block" mode="date" @change="onAllocationEndDateChange">
							<AppInput v-model="receiptForm.allocationEndDate" label="分配结束日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<AppInput v-model="receiptForm.note" class="grid-span-4" label="备注" placeholder="可选" size="sm" :readonly="isEditingCashierReceipt" />
					</view>
					<text v-if="receiptForm.allocationMode === 'period'" class="section-hint">分配口径：仅冲销所选日期区间内应收；现金超出部分自动计入预付款/冲抵池，抹零需全部落到应收目标。</text>
					<text v-if="receiptForm.allocationMode === 'period'" class="section-hint section-hint--accent">
						当前区间累计欠款：¥{{ formatMoney(receiptPeriodRangeOutstandingTotal) }}（{{ receiptPeriodRangeTargetCount }} 笔）
					</text>
					<text v-else class="section-hint">分配口径：仅冲销勾选单据；现金剩余自动计入预付款/冲抵池，抹零需全部落到勾选目标。</text>
					<text v-if="isEditingCashierReceipt" class="section-hint section-hint--warning">当前收款单来源于出纳登记，仅支持调整分配；金额、业务日期、收款方式与备注请在“出纳收款登记”处理。</text>

					<view v-if="receiptForm.allocationMode === 'checked'" class="checked-target-box">
						<view class="checked-target-head">
							<text>勾选待分配单据（按日期升序自动分配）</text>
							<text>已选 {{ checkedAllocationSelectedCount }} 笔 · 累计 ¥{{ formatMoney(checkedAllocationSelectedTotal) }}</text>
						</view>
						<checkbox-group class="checked-target-list" @change="onCheckedTargetsChange">
							<label v-for="row in checkedTargetCandidates" :key="row.key" class="checked-target-item">
								<checkbox :value="row.key" :checked="isAllocationTargetChecked(row.key)" color="#2563eb" />
								<view class="checked-target-item__body">
									<text class="checked-target-item__title">{{ row.title }}</text>
									<text class="checked-target-item__meta">日期 {{ row.date || '-' }} · 欠款 ¥{{ formatMoney(row.outstanding) }}</text>
								</view>
							</label>
						</checkbox-group>
						<text v-if="checkedTargetCandidates.length === 0" class="preview-empty">当前无可勾选欠款单据，可切换到时间段分配。</text>
					</view>

					<view v-if="previewPlan" class="preview-box">
						<view class="preview-summary">
							<text>本次收款：¥{{ formatMoney(previewPlan.amount) }}</text>
							<text>本次抹零：¥{{ formatMoney(previewPlan.rounding_amount) }}</text>
							<text>预计冲欠：¥{{ formatMoney(previewPlan.allocated_total) }}</text>
							<text>抹零冲欠：¥{{ formatMoney(previewPlan.rounding_allocated_total) }}</text>
							<text>预计形成预付：¥{{ formatMoney(previewPlan.prepay_amount) }}</text>
						</view>
						<view v-if="editableAllocations.length" class="alloc-list">
							<view class="alloc-head">
								<text class="col-sale">目标单据</text>
								<text class="col-outstanding">欠款前</text>
								<text class="col-amount">分配金额</text>
							</view>
							<view v-for="row in editableAllocations" :key="row.key" class="alloc-row">
								<text class="col-sale">{{ row.targetTitle }}</text>
								<text class="col-outstanding">¥{{ formatMoney(row.outstandingBefore) }}</text>
								<view class="col-amount">
									<AppInput
										:model-value="row.allocateAmount"
										placeholder="0"
										size="sm"
										@update:model-value="(value) => onAllocationInput(row.key, value)"
									/>
								</view>
							</view>
						</view>
						<text v-else class="preview-empty">当前预览无可冲销欠款，登记后将全部进入预付款。</text>
					</view>
				</view>

					<view v-else-if="activeOperationTab === 'offset'" class="operation-panel">
						<view class="checked-target-box">
							<view class="checked-target-head">
								<text>冲抵来源池（仅可用余额）</text>
								<text>已选 {{ selectedOffsetReceiptCount }} 笔 · 共 {{ offsetPoolPager.total }} 条 · 第 {{ offsetPoolPager.page }} / {{ offsetPoolTotalPages }} 页</text>
							</view>
							<AppList :loading="offsetPoolLoading" :empty="offsetPoolRows.length === 0" empty-title="暂无可用冲抵来源">
								<AppListItem
								v-for="row in offsetPoolRows"
								:key="row._id"
								:title="`${row.source_sale_date || row.biz_date || '-'} · 冲抵来源`"
								:subtitle="`单据 ${row._id}`"
								status="冲抵池"
								status-kind="warning"
								icon="wallet"
								icon-class="bg-warning"
							>
								<template #right>
									<view class="mini-amounts">
										<text>来源 ¥{{ formatMoney(row.amount) }}</text>
										<text>已分配 ¥{{ formatMoney(row.allocated_amount) }}</text>
										<text>可用 ¥{{ formatMoney(row.unallocated_amount) }}</text>
									</view>
								</template>
								<template #default>
									<text v-if="row.note" class="row-detail">{{ row.note }}</text>
								</template>
								<template #footer>
									<view class="row-actions">
										<AppButton
											size="sm"
											:kind="isOffsetSourceSelected(row) ? 'primary' : 'ghost'"
											@click="onToggleOffsetReceipt(row)"
										>
											{{ isOffsetSourceSelected(row) ? '已选择' : '选择来源' }}
										</AppButton>
									</view>
								</template>
							</AppListItem>
						</AppList>
						<view v-if="offsetPoolPager.total > 0" class="pager-row">
							<AppButton size="sm" kind="neutral" :disabled="offsetPoolLoading || offsetPoolPager.page <= 1" @click="onOffsetPoolPrev">上一页</AppButton>
							<AppButton size="sm" kind="neutral" :disabled="offsetPoolLoading || !offsetPoolPager.hasMore" @click="onOffsetPoolNext">下一页</AppButton>
						</view>
					</view>

					<view class="receipt-grid receipt-grid--four">
						<AppInput :model-value="selectedOffsetReceiptSummary" label="已选来源" placeholder="请选择冲抵来源" readonly size="sm" />
						<AppInput
							v-model="offsetAllocateForm.amount"
							label="本次冲抵金额(元)"
							:placeholder="moneyInputPlaceholder"
							size="sm"
							@blur="onOffsetAllocateAmountBlur"
						/>
						<picker
							class="picker-block"
							mode="selector"
							:range="offsetAllocationModeOptions"
							range-key="label"
							:value="offsetAllocationModeIndex"
							@change="onOffsetAllocationModeChange"
						>
							<AppInput :model-value="offsetAllocationModeLabel" label="分配模式" placeholder="请选择模式" readonly size="sm" />
						</picker>
						<picker v-if="offsetAllocateForm.allocationMode === 'period'" class="picker-block" mode="date" @change="onOffsetAllocationStartDateChange">
							<AppInput v-model="offsetAllocateForm.allocationStartDate" label="分配开始日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<picker v-if="offsetAllocateForm.allocationMode === 'period'" class="picker-block" mode="date" @change="onOffsetAllocationEndDateChange">
							<AppInput v-model="offsetAllocateForm.allocationEndDate" label="分配结束日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
					</view>
					<text v-if="offsetAllocateForm.allocationMode === 'period'" class="section-hint">
						分配口径：单笔来源 + 时间段。仅冲销区间内应收，剩余保留在该来源可用余额中。
					</text>
					<text v-if="offsetAllocateForm.allocationMode === 'period'" class="section-hint section-hint--accent">
						当前区间累计欠款：¥{{ formatMoney(offsetPeriodRangeOutstandingTotal) }}（{{ offsetPeriodRangeTargetCount }} 笔）
					</text>
					<text v-else class="section-hint">
						分配口径：单笔来源 + 勾选目标（支持多选）。仅消耗本来源可用余额，不回滚历史分配。
					</text>

					<view v-if="offsetAllocateForm.allocationMode === 'checked'" class="checked-target-box">
						<view class="checked-target-head">
							<text>勾选冲抵目标（销售/流量/历史欠款/其他费用）</text>
							<text>已选 {{ offsetCheckedTargetSelectedCount }} 笔 · 累计 ¥{{ formatMoney(offsetCheckedTargetSelectedTotal) }}</text>
						</view>
						<checkbox-group class="checked-target-list" @change="onOffsetCheckedTargetsChange">
							<label v-for="row in checkedTargetCandidates" :key="`offset-${row.key}`" class="checked-target-item">
								<checkbox :value="row.key" :checked="isOffsetAllocationTargetChecked(row.key)" color="#2563eb" />
								<view class="checked-target-item__body">
									<text class="checked-target-item__title">{{ row.title }}</text>
									<text class="checked-target-item__meta">日期 {{ row.date || '-' }} · 欠款 ¥{{ formatMoney(row.outstanding) }}</text>
								</view>
							</label>
						</checkbox-group>
						<text v-if="checkedTargetCandidates.length === 0" class="preview-empty">当前无可冲抵欠款目标，可切换到时间段分配。</text>
					</view>
				</view>

				<view v-else-if="activeOperationTab === 'prepay'" class="operation-panel">
					<view class="receipt-grid">
						<AppInput
							v-model="prepayForm.amount"
							label="预付金额(元)"
							:placeholder="moneyInputPlaceholder"
							size="sm"
							@blur="onPrepayAmountBlur"
						/>
						<picker class="picker-block" mode="date" @change="onPrepayBizDateChange">
							<AppInput v-model="prepayForm.bizDate" label="业务日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<picker class="picker-block" mode="selector" :range="receiptPaymentMethodOptions" range-key="label" :value="prepayPaymentMethodIndex" @change="onPrepayPaymentMethodChange">
							<AppInput :model-value="prepayPaymentMethodLabel" label="收款方式" placeholder="请选择收款方式" readonly size="sm" />
						</picker>
						<picker class="picker-block" mode="selector" :range="prepayApplyStrategyOptions" range-key="label" :value="prepayApplyStrategyIndex" @change="onPrepayApplyStrategyChange">
							<AppInput :model-value="prepayApplyStrategyLabel" label="抵扣策略" placeholder="请选择策略" readonly size="sm" />
						</picker>
						<picker v-if="prepayForm.applyStrategy === 'allocate_period'" class="picker-block" mode="date" @change="onPrepayAllocationStartDateChange">
							<AppInput v-model="prepayForm.allocationStartDate" label="分配开始日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<picker v-if="prepayForm.applyStrategy === 'allocate_period'" class="picker-block" mode="date" @change="onPrepayAllocationEndDateChange">
							<AppInput v-model="prepayForm.allocationEndDate" label="分配结束日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<AppInput v-model="prepayForm.note" label="备注" placeholder="可选" size="sm" />
					</view>
					<text class="section-hint">
						当前策略：{{ prepayApplyStrategyLabel }}。仅入预付时不冲历史欠款/其他费用；立即按区间冲欠时仅冲销区间内应收，剩余金额自动保留为预付款。
					</text>
				</view>

				<view v-else-if="activeOperationTab === 'offset_entry'" class="operation-panel">
					<view class="receipt-grid">
						<AppInput
							v-model="offsetEntryForm.amount"
							label="冲抵金额(元)"
							:placeholder="moneyInputPlaceholder"
							size="sm"
							@blur="onOffsetEntryAmountBlur"
						/>
						<picker class="picker-block" mode="date" @change="onOffsetEntryBizDateChange">
							<AppInput v-model="offsetEntryForm.bizDate" label="业务日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<picker class="picker-block" mode="selector" :range="receiptPaymentMethodOptions" range-key="label" :value="offsetEntryPaymentMethodIndex" @change="onOffsetEntryPaymentMethodChange">
							<AppInput :model-value="offsetEntryPaymentMethodLabel" label="赔付方式" placeholder="请选择方式" readonly size="sm" />
						</picker>
						<AppInput v-model="offsetEntryForm.note" label="备注" placeholder="建议写明赔偿原因" size="sm" />
					</view>
					<text class="section-hint">该金额仅入冲抵池，不自动冲销；可在“冲抵分配”中手工分配到目标欠款。</text>
				</view>

				<view v-else-if="activeOperationTab === 'opening_debt'" class="operation-panel">
					<view class="receipt-grid">
						<AppInput
							v-model="openingDebtForm.amount"
							label="欠款金额(元)"
							:placeholder="moneyInputPlaceholder"
							size="sm"
							@blur="onOpeningDebtAmountBlur"
						/>
						<picker class="picker-block" mode="date" @change="onOpeningDebtBizDateChange">
							<AppInput v-model="openingDebtForm.bizDate" label="业务日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<AppInput v-model="openingDebtForm.note" class="grid-span-2" label="备注" placeholder="可选" size="sm" />
					</view>

					<view class="recent-toggle-row">
						<text class="section-hint">近20条历史欠款默认收起</text>
						<AppButton size="sm" kind="neutral" @click="toggleOpeningDebtRecent">
							{{ openingDebtRecentExpanded ? '收起记录' : '查看最近记录' }}
						</AppButton>
					</view>
					<AppList v-if="openingDebtRecentExpanded" :loading="loading" :empty="recentOpeningDebts.length === 0" empty-title="暂无历史欠款">
						<AppListItem
							v-for="row in recentOpeningDebts"
							:key="row._id"
							:title="`${row.biz_date || '-'} · 历史欠款`"
							:subtitle="`单据 ${row._id}`"
							:status="paymentStatusText(row.payment_status)"
							:status-kind="paymentStatusKind(row.payment_status)"
							icon="alert"
							icon-class="bg-warning"
						>
							<template #right>
								<view class="mini-amounts">
									<text>应收 ¥{{ formatMoney(row.amount) }}</text>
									<text v-if="resolveOpeningDebtRoundingAmount(row) > 0" class="mini-amounts__rounding">
										抹零 ¥{{ formatMoney(resolveOpeningDebtRoundingAmount(row)) }}（计费应收 ¥{{ formatMoney(resolveOpeningDebtEffectiveShouldReceive(row)) }}）
									</text>
									<text>已收 ¥{{ formatMoney(row.amount_received) }}</text>
									<text v-if="toNumber(row.receipt_rounding_amount, 0) > 0" class="mini-amounts__receipt-rounding">收款抹零 ¥{{ formatMoney(row.receipt_rounding_amount) }}</text>
									<text>未收 ¥{{ formatMoney(row.outstanding) }}</text>
								</view>
							</template>
							<template #default>
								<text v-if="row.note" class="row-detail">{{ row.note }}</text>
							</template>
							<template #footer>
								<view class="row-actions">
									<AppButton size="sm" kind="ghost" @click="onEditOpeningDebt(row)">编辑</AppButton>
									<AppButton size="sm" kind="outline" @click="onRemoveOpeningDebt(row)">删除</AppButton>
								</view>
							</template>
						</AppListItem>
					</AppList>
				</view>

				<view v-else-if="activeOperationTab === 'other_fee'" class="operation-panel">
					<view class="receipt-grid">
						<AppInput
							v-model="otherFeeForm.amount"
							label="费用金额(元)"
							:placeholder="moneyInputPlaceholder"
							size="sm"
							@blur="onOtherFeeAmountBlur"
						/>
						<picker class="picker-block" mode="date" @change="onOtherFeeBizDateChange">
							<AppInput v-model="otherFeeForm.bizDate" label="业务日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
						</picker>
						<AppInput v-model="otherFeeForm.note" class="grid-span-2" label="备注" placeholder="可选" size="sm" />
					</view>

					<view class="recent-toggle-row">
						<text class="section-hint">近20条其他费用默认收起</text>
						<AppButton size="sm" kind="neutral" @click="toggleOtherFeeRecent">
							{{ otherFeeRecentExpanded ? '收起记录' : '查看最近记录' }}
						</AppButton>
					</view>
					<AppList v-if="otherFeeRecentExpanded" :loading="loading" :empty="recentOtherFees.length === 0" empty-title="暂无其他费用">
						<AppListItem
							v-for="row in recentOtherFees"
							:key="row._id"
							:title="`${row.biz_date || '-'} · 其他费用`"
							:subtitle="`单据 ${row._id}`"
							:status="paymentStatusText(row.payment_status)"
							:status-kind="paymentStatusKind(row.payment_status)"
							icon="wallet"
							icon-class="bg-warning"
						>
							<template #right>
								<view class="mini-amounts">
									<text>应收 ¥{{ formatMoney(row.amount) }}</text>
									<text>已收 ¥{{ formatMoney(row.amount_received) }}</text>
									<text v-if="toNumber(row.receipt_rounding_amount, 0) > 0" class="mini-amounts__receipt-rounding">收款抹零 ¥{{ formatMoney(row.receipt_rounding_amount) }}</text>
									<text>未收 ¥{{ formatMoney(row.outstanding) }}</text>
								</view>
							</template>
							<template #default>
								<text v-if="row.note" class="row-detail">{{ row.note }}</text>
							</template>
							<template #footer>
								<view class="row-actions">
									<AppButton size="sm" kind="ghost" @click="onEditOtherFee(row)">编辑</AppButton>
									<AppButton size="sm" kind="outline" @click="onRemoveOtherFee(row)">删除</AppButton>
								</view>
							</template>
						</AppListItem>
					</AppList>
				</view>

				<view v-else class="operation-panel">
					<view class="recent-toggle-row">
						<text class="section-hint">近20条收款单默认收起</text>
						<AppButton size="sm" kind="neutral" @click="toggleReceiptRecent">
							{{ receiptRecentExpanded ? '收起记录' : '查看最近记录' }}
						</AppButton>
					</view>
					<AppList v-if="receiptRecentExpanded" :loading="loading" :empty="recentReceipts.length === 0" empty-title="暂无收款单">
						<AppListItem
							v-for="row in recentReceipts"
							:key="row._id"
							:title="`${row.biz_date || '-'} · 收款单`"
							:subtitle="`单据 ${row._id}`"
							:status="paymentMethodText(row.payment_method)"
							status-kind="info"
							icon="wallet"
							icon-class="bg-success"
						>
							<template #right>
								<view class="mini-amounts">
									<text>收款 ¥{{ formatMoney(row.amount) }}</text>
									<text v-if="toNumber(row.rounding_allocated_amount, 0) > 0">抹零 ¥{{ formatMoney(row.rounding_allocated_amount) }}</text>
									<text>已分配 ¥{{ formatMoney(row.allocated_amount) }}</text>
									<text>预付+ ¥{{ formatMoney(row.unallocated_amount) }}</text>
								</view>
							</template>
							<template #default>
								<text v-if="receiptSourceTypeText(row.source_type || row.meta?.source_type)" class="row-detail row-detail--source">
									来源：{{ receiptSourceTypeText(row.source_type || row.meta?.source_type) }}
								</text>
								<text class="row-detail">{{ receiptAllocationText(row) }}</text>
								<text class="row-detail row-detail--alloc-scope">{{ receiptAllocationDateScopeText(row) }}</text>
								<text v-if="row.note" class="row-detail">{{ row.note }}</text>
							</template>
							<template #footer>
								<view class="row-actions">
									<AppButton size="sm" kind="ghost" @click="onEditReceipt(row)">
										{{ isCashierReceiptRow(row) ? '调整分配' : '编辑' }}
									</AppButton>
									<AppButton size="sm" kind="outline" :disabled="isCashierReceiptRow(row)" @click="onRemoveReceipt(row)">删除</AppButton>
								</view>
							</template>
						</AppListItem>
					</AppList>
				</view>
			</AppSection>

			<AppSection v-if="isFlowCustomer" title="流量结算">
				<template #actions>
					<AppButton size="sm" kind="ghost" @click="resetFlowForm()">重置</AppButton>
					<AppButton v-if="isEditingFlowSettlement" size="sm" kind="outline" @click="cancelFlowEditing">取消编辑</AppButton>
					<AppButton size="sm" kind="neutral" :loading="flowPreviewLoading" @click="onPreviewFlowSettlement">预览</AppButton>
					<AppButton size="sm" kind="primary" :loading="flowSubmitting" @click="onCreateFlowSettlement">{{ flowPrimaryActionLabel }}</AppButton>
				</template>

				<view class="flow-grid">
					<picker class="picker-block" mode="date" @change="onFlowBizDateChange">
						<AppInput v-model="flowForm.bizDate" label="结算日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<AppInput v-model="flowForm.flowIndexPrev" label="上次表数" placeholder="请输入上次表数" size="sm" />
					<AppInput v-model="flowForm.flowIndexCurr" label="本次表数" placeholder="请输入本次表数" size="sm" />
					<AppInput :model-value="flowMeterDiffText" label="表数差值" placeholder="自动计算" readonly size="sm" />
					<AppInput v-model="flowForm.flowTheoryRatio" label="理论系数" placeholder="默认空" size="sm" />
					<view class="flow-grid__note">
						<AppInput v-model="flowForm.note" label="备注" placeholder="可选" size="sm" />
					</view>
				</view>
				<text class="formula-hint">公式：表数差值 = 本次表数 - 上次表数；理论重量 = 表数差值 × 理论系数；阶段亏损 = 阶段实际重量 - 理论重量</text>

				<view v-if="flowPreview" class="preview-box">
					<view class="preview-summary">
						<text>重量统计：{{ flowPeriodText }}</text>
						<text>表数起点：{{ flowMeterStartText }}</text>
						<text>纳入销售 {{ flowPreview.period_sale_count || 0 }} 笔</text>
					</view>
					<text v-if="flowPreview.period_note" class="preview-note">{{ flowPreview.period_note }}</text>
					<view class="analysis-grid">
						<view class="analysis-card">
							<text class="analysis-card__label">用气量</text>
							<text class="analysis-card__value">{{ formatFlowNumber(flowPreview.flow_volume_m3) }} m3</text>
						</view>
						<view class="analysis-card">
							<text class="analysis-card__label">理论重量</text>
							<text class="analysis-card__value">{{ formatNullableWeight(flowPreview.theory_weight_kg) }}</text>
						</view>
						<view class="analysis-card">
							<text class="analysis-card__label">阶段实际重量</text>
							<text class="analysis-card__value">{{ formatNullableWeight(flowPreview.actual_weight_kg) }}</text>
						</view>
						<view class="analysis-card">
							<text class="analysis-card__label">阶段亏损</text>
							<text class="analysis-card__value">{{ formatNullableWeight(flowPreview.loss_weight_kg) }}</text>
						</view>
						<view class="analysis-card">
							<text class="analysis-card__label">本次应收</text>
							<text class="analysis-card__value">¥{{ formatMoney(flowPreview.should_receive) }}</text>
						</view>
					</view>
				</view>
			</AppSection>

			<AppSection v-if="isKgCustomer || isBottleCustomer" title="经营分析">
				<view class="quick-date-strip">
					<AppDatePresetBar v-model="analysisDatePreset" @update:modelValue="onAnalysisDatePresetChange" />
				</view>
				<view class="analysis-filter-grid">
					<picker class="picker-block" mode="date" @change="onAnalysisDateFromChange">
						<AppInput v-model="analysisFilters.dateFrom" label="开始日期" placeholder="选择开始日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<picker class="picker-block" mode="date" @change="onAnalysisDateToChange">
						<AppInput v-model="analysisFilters.dateTo" label="结束日期" placeholder="选择结束日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<AppButton size="sm" kind="primary" :loading="analysisLoading" @click="searchAnalysis">查询分析</AppButton>
				</view>
				<text v-if="isKgCustomer" class="section-hint">当前按所选时间范围统计；全历史汇总待后续接预计算</text>
				<view v-if="analysisLoading" class="analysis-placeholder">经营分析加载中...</view>

				<template v-else>
					<view v-if="isKgCustomer" class="analysis-grid">
						<view class="analysis-card analysis-card--accent">
							<text class="analysis-card__label">客户阶段理论损耗</text>
							<text v-if="analysis.requires_date_range" class="analysis-card__value">待选择日期范围</text>
							<text v-else class="analysis-card__value">{{ formatNullableWeight(analysis.kg_loss_weight) }}</text>
							<text v-if="analysis.requires_date_range" class="analysis-card__hint">请选择开始日期和结束日期后再计算，避免全历史统计过慢</text>
							<text v-else class="analysis-card__hint">仅统计钢瓶理论正损耗，不并入整车差异</text>
						</view>
					</view>

					<template v-if="isBottleCustomer">
						<view class="bottle-compare-grid">
							<AppInput
								v-model="bottleReferencePrice"
								label="每公斤参考售价"
								placeholder="仅本页分析使用"
								size="sm"
							/>
						</view>
						<view class="analysis-grid">
							<view class="analysis-card">
								<text class="analysis-card__label">阶段销售重量</text>
								<text class="analysis-card__value">{{ formatNullableWeight(analysis.bottle_reference_weight) }}</text>
							</view>
							<view class="analysis-card">
								<text class="analysis-card__label">按瓶应收</text>
								<text class="analysis-card__value">¥{{ formatMoney(analysis.bottle_should_receive_total) }}</text>
							</view>
							<view class="analysis-card">
								<text class="analysis-card__label">参考kg金额</text>
								<text class="analysis-card__value">{{ bottleReferenceAmountText }}</text>
							</view>
							<view class="analysis-card">
								<text class="analysis-card__label">按瓶/按kg价差</text>
								<text class="analysis-card__value">{{ bottleReferenceGapText }}</text>
								<text class="analysis-card__hint">仅用于经营对比，不参与账务</text>
							</view>
						</view>
					</template>
				</template>
			</AppSection>

			<AppSection v-if="isFlowCustomer" title="流量结算单（近20条）">
				<AppList :loading="loading" :empty="recentFlowSettlements.length === 0" empty-title="暂无流量结算单">
					<AppListItem
						v-for="row in recentFlowSettlements"
						:key="row._id"
						:title="`${row.biz_date || '-'} · 流量结算`"
						:subtitle="`单据 ${row._id}`"
						:status="paymentStatusText(row.payment_status)"
						:status-kind="paymentStatusKind(row.payment_status)"
						icon="chart-bar"
						icon-class="bg-info"
					>
						<template #right>
							<view class="mini-amounts">
								<text>应收 ¥{{ formatMoney(row.should_receive) }}</text>
								<text>实收 ¥{{ formatMoney(row.amount_received) }}</text>
								<text v-if="toNumber(row.receipt_rounding_amount, 0) > 0" class="mini-amounts__receipt-rounding">收款抹零 ¥{{ formatMoney(row.receipt_rounding_amount) }}</text>
								<text>未收 ¥{{ formatMoney(row.outstanding) }}</text>
							</view>
						</template>
						<template #default>
							<view class="row-detail-grid">
								<text>用气量 {{ formatFlowNumber(row.flow_volume_m3) }} m3</text>
								<text>上次表数 {{ formatFlowNumber(row.flow_index_prev) }}</text>
								<text>本次表数 {{ formatFlowNumber(row.flow_index_curr) }}</text>
								<text>理论重量 {{ formatNullableWeight(row.theory_weight_kg) }}</text>
								<text>实际重量 {{ formatNullableWeight(row.actual_weight_kg) }}</text>
								<text>阶段亏损 {{ formatNullableWeight(row.loss_weight_kg) }}</text>
								<text v-if="row.note">{{ row.note }}</text>
							</view>
						</template>
						<template #footer>
							<view class="row-actions">
								<AppButton size="sm" kind="ghost" @click="onEditFlowSettlement(row)">编辑</AppButton>
								<AppButton size="sm" kind="outline" @click="onRemoveFlowSettlement(row)">删除</AppButton>
							</view>
						</template>
					</AppListItem>
				</AppList>
			</AppSection>

			<AppSection title="销售明细（近100条）">
				<AppList :loading="loading" :empty="recentSalesDisplayRows.length === 0" empty-title="暂无销售明细">
					<AppListItem
						v-for="row in recentSalesDisplayRows"
						:key="row.record_key || row._id"
						:title="`${row.date || '-'} · ${bizModeText(row.biz_mode)}`"
						:subtitle="`单据 ${row._id}`"
						:status="paymentStatusText(row.payment_status)"
						:status-kind="paymentStatusKind(row.payment_status)"
						icon="document"
						icon-class="bg-primary"
					>
						<template #default>
							<view class="mini-amounts mini-amounts--left">
								<text>应收 ¥{{ formatMoney(row.should_receive) }}</text>
									<text v-if="resolveSaleRoundingAmount(row) > 0" class="mini-amounts__rounding">
										抹零 ¥{{ formatMoney(resolveSaleRoundingAmount(row)) }}（计费应收 ¥{{ formatMoney(resolveSaleEffectiveShouldReceive(row)) }}）
									</text>
									<text>实收 ¥{{ formatMoney(resolveSaleOffsetApplied(row) > 0 ? resolveSaleManualReceived(row) : resolveSalePostedReceived(row)) }}</text>
									<text v-if="toNumber(row.receipt_rounding_amount, 0) > 0" class="mini-amounts__receipt-rounding">收款抹零 ¥{{ formatMoney(row.receipt_rounding_amount) }}</text>
									<text v-if="resolveSaleOffsetApplied(row) > 0" class="mini-amounts__offset">
										{{ formatSaleOffsetLine(row) }}
									</text>
									<text v-if="resolveSaleOffsetTargetApplied(row) > 0" class="mini-amounts__offset-target">
										{{ formatSaleOffsetTargetLine(row) }}
									</text>
									<text v-if="resolveSaleOffsetApplied(row) > 0" class="mini-amounts__posted">
										入账 ¥{{ formatMoney(resolveSalePostedReceived(row)) }}
									</text>
									<text>未收 ¥{{ formatMoney(row.outstanding) }}</text>
								<text v-if="isSaleRecordRow(row)" class="mini-amounts__movement">
									本单出瓶 {{ resolveSaleOutBottleCount(row) }} · 本单回瓶 {{ resolveSaleBackBottleCount(row) }} · 存瓶(截止本单) {{ resolveSaleDepositBalanceCount(row) }}
								</text>
								<text v-if="isSaleRecordRow(row)" class="mini-amounts__detail">
									本单出瓶明细：{{ resolveSaleOutDetailText(row) }}
								</text>
								<text v-if="isSaleRecordRow(row)" class="mini-amounts__detail">
									本单回瓶明细：{{ resolveSaleBackDetailText(row) }}
								</text>
								<text v-if="isSaleRecordRow(row) && resolveSaleDepositDetailText(row)" class="mini-amounts__deposit-detail">
									存瓶明细：{{ resolveSaleDepositDetailText(row) }}
								</text>
								<text
									v-if="resolveSaleOffsetApplied(row) <= 0 && resolveSaleOverCollected(row) > 0 && resolveSaleOffsetEnabled(row, true)"
									class="mini-amounts__warning"
								>
									多收 ¥{{ formatMoney(resolveSaleOverCollected(row)) }}（可入冲抵池，需手工分配）
								</text>
								<text
									v-if="resolveSaleOffsetApplied(row) <= 0 && resolveSaleOverCollected(row) > 0 && !resolveSaleOffsetEnabled(row, true)"
									class="mini-amounts__warning"
								>
									多收 ¥{{ formatMoney(resolveSaleOverCollected(row)) }}（未入冲抵池）
								</text>
							</view>
						</template>
						<template #footer>
							<AppButton v-if="isSaleRecordRow(row)" size="sm" kind="ghost" @click="onOpenSale(row._id)">查看销售单</AppButton>
							<AppButton v-else size="sm" kind="ghost" @click="onEditFlowSettlement(row)">编辑结算单</AppButton>
						</template>
					</AppListItem>
				</AppList>
			</AppSection>

			<AppSection title="账务流水">
				<template #actions>
					<view class="section-actions">
						<text class="section-hint">共 {{ rowsPager.total }} 条 · 第 {{ rowsPager.page }} / {{ rowsTotalPages }} 页</text>
					</view>
				</template>
				<view class="quick-date-strip">
					<AppDatePresetBar v-model="rowsDatePreset" :items="rowsDatePresetItems" @update:modelValue="onRowsDatePresetChange" />
				</view>

				<AppList :loading="rowsLoading" :empty="statementRows.length === 0" empty-title="暂无流水">
					<AppListItem
						v-for="row in statementRows"
						:key="`${row.row_type}-${row.row_id}`"
						:title="statementRowTitle(row)"
						:subtitle="row.biz_date || '-'"
						:status="statementRowStatus(row)"
						:status-kind="statementRowStatusKind(row)"
						icon="list"
						icon-class="bg-teal"
					>
						<template #right>
							<view class="mini-amounts">
								<text v-if="row.row_type === 'sale'">应收 ¥{{ formatMoney(row.amount) }}</text>
								<text v-if="row.row_type === 'sale' && toNumber(row.receipt_rounding_amount, 0) > 0" class="mini-amounts__receipt-rounding">收款抹零 ¥{{ formatMoney(row.receipt_rounding_amount) }}</text>
								<text v-if="row.row_type === 'sale'">未收 ¥{{ formatMoney(row.outstanding) }}</text>
								<text v-if="row.row_type === 'flow_settlement'">应收 ¥{{ formatMoney(row.amount) }}</text>
								<text v-if="row.row_type === 'flow_settlement' && toNumber(row.receipt_rounding_amount, 0) > 0" class="mini-amounts__receipt-rounding">收款抹零 ¥{{ formatMoney(row.receipt_rounding_amount) }}</text>
								<text v-if="row.row_type === 'flow_settlement'">未收 ¥{{ formatMoney(row.outstanding) }}</text>
								<text v-if="row.row_type === 'opening_debt'">应收 ¥{{ formatMoney(row.amount) }}</text>
								<text v-if="row.row_type === 'opening_debt' && resolveOpeningDebtRoundingAmount(row) > 0" class="mini-amounts__rounding">
									抹零 ¥{{ formatMoney(resolveOpeningDebtRoundingAmount(row)) }}（计费应收 ¥{{ formatMoney(resolveOpeningDebtEffectiveShouldReceive(row)) }}）
								</text>
								<text v-if="row.row_type === 'opening_debt' && toNumber(row.receipt_rounding_amount, 0) > 0" class="mini-amounts__receipt-rounding">收款抹零 ¥{{ formatMoney(row.receipt_rounding_amount) }}</text>
								<text v-if="row.row_type === 'opening_debt'">未收 ¥{{ formatMoney(row.outstanding) }}</text>
								<text v-if="row.row_type === 'other_fee'">应收 ¥{{ formatMoney(row.amount) }}</text>
								<text v-if="row.row_type === 'other_fee' && toNumber(row.receipt_rounding_amount, 0) > 0" class="mini-amounts__receipt-rounding">收款抹零 ¥{{ formatMoney(row.receipt_rounding_amount) }}</text>
								<text v-if="row.row_type === 'other_fee'">未收 ¥{{ formatMoney(row.outstanding) }}</text>
								<text v-if="row.row_type === 'receipt'">收款 ¥{{ formatMoney(row.amount) }}</text>
								<text v-if="row.row_type === 'receipt' && toNumber(row.rounding_allocated_amount, 0) > 0">抹零 ¥{{ formatMoney(row.rounding_allocated_amount) }}</text>
								<text v-if="row.row_type === 'receipt'">预付+ ¥{{ formatMoney(row.prepay_delta) }}</text>
								<text v-if="row.row_type === 'allocation'">分配 ¥{{ formatMoney(row.amount) }}</text>
							</view>
						</template>
						<template #default>
							<text v-if="statementRowDetail(row)" class="row-detail">{{ statementRowDetail(row) }}</text>
						</template>
					</AppListItem>
				</AppList>
				<view v-if="rowsPager.total > 0" class="pager-row">
					<AppButton size="sm" kind="neutral" :disabled="rowsLoading || rowsPager.page <= 1" @click="onRowsPrev">上一页</AppButton>
					<AppButton size="sm" kind="neutral" :disabled="rowsLoading || !rowsPager.hasMore" @click="onRowsNext">下一页</AppButton>
				</view>
			</AppSection>
		</view>
	</AppPage>
</template>

<script setup>
import { computed, onMounted, reactive, ref, toRef, watch } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppSection from '@/components/base/AppSection.vue'
import AppTabs from '@/components/base/AppTabs.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import AppList from '@/components/base/AppList.vue'
import AppListItem from '@/components/base/AppListItem.vue'
import AppStatCard from '@/components/base/AppStatCard.vue'
import AppDatePresetBar from '@/components/base/AppDatePresetBar.vue'
import { buildDatePresetRange, detectDatePreset } from '@/utils/datePreset'
import {
	allocateOffsetCreditV1,
	confirmAllocationV1,
	createOpeningDebtEntryV1,
	createOtherFeeEntryV1,
	createPrepayEntryV1,
	createFlowSettlementV1,
	createReceiptV1,
	exportCustomerAccountingLedgerV1,
	exportCustomerStatementV1,
	getCustomerStatementAnalysisV1,
	getCustomerStatementV1,
	listOffsetCreditPoolV1,
	listCustomerStatementRowsV1,
	previewAllocationV1,
	previewFlowSettlementV1,
	removeOpeningDebtEntryV1,
	removeOtherFeeEntryV1,
	removeFlowSettlementV1,
	removeReceiptV1,
	updateOpeningDebtEntryV1,
	updateOtherFeeEntryV1,
	updateFlowSettlementV1,
	updateReceiptV1
} from '@/services/customerSettlement'
import {
	buildCustomerAccountingLedgerExportFileName,
	buildCustomerAccountingLedgerWorkbookXml,
	buildCustomerStatementExportFileName,
	buildCustomerStatementWorkbookXml,
	downloadWorkbookFile
} from '@/components/domain/customer/statement/exportWorkbook'

const props = defineProps({
	recordId: { type: String, default: '' },
	scene: { type: String, default: '' },
	saleId: { type: String, default: '' }
})

const recordId = toRef(props, 'recordId')
const scene = toRef(props, 'scene')
const saleId = toRef(props, 'saleId')
const loading = ref(false)
const rowsLoading = ref(false)
const analysisLoading = ref(false)
const previewing = ref(false)
const submitting = ref(false)
const confirming = ref(false)
const prepaySubmitting = ref(false)
const offsetEntrySubmitting = ref(false)
const exportingStatement = ref(false)
const exportingAccountingLedger = ref(false)
const flowPreviewLoading = ref(false)
const flowSubmitting = ref(false)
const openingDebtSubmitting = ref(false)
const otherFeeSubmitting = ref(false)
const offsetPoolLoading = ref(false)
const offsetAllocating = ref(false)

const customer = ref({})
const recentSales = ref([])
const recentReceipts = ref([])
const recentFlowSettlements = ref([])
const recentOpeningDebts = ref([])
const recentOtherFees = ref([])
const previewPlan = ref(null)
const editableAllocations = ref([])
const statementRows = ref([])
const flowPreview = ref(null)
const bottleReferencePrice = ref('')
const checkedAllocationTargetKeys = ref([])
const offsetCheckedTargetKeys = ref([])
const offsetPoolRows = ref([])
const selectedOffsetReceipts = ref([])
const quickSceneApplied = ref(false)
const editingReceiptId = ref('')
const editingReceiptSourceType = ref('')
const editingFlowSettlementId = ref('')
const editingOpeningDebtId = ref('')
const editingOtherFeeId = ref('')
const activeOperationTab = ref('receipt')
const openingDebtRecentExpanded = ref(false)
const otherFeeRecentExpanded = ref(false)
const receiptRecentExpanded = ref(false)
const operationTabs = [
	{ label: '登记收款/分配', value: 'receipt' },
	{ label: '冲抵分配', value: 'offset' },
	{ label: '预付录入', value: 'prepay' },
	{ label: '冲抵池录入', value: 'offset_entry' },
	{ label: '历史欠款登记', value: 'opening_debt' },
	{ label: '其他费用', value: 'other_fee' },
	{ label: '收款单', value: 'receipt_list' }
]
const analysis = reactive({
	customer_price_unit: 'kg',
	requires_date_range: false,
	kg_loss_weight: 0,
	bottle_reference_weight: 0,
	bottle_reference_amount: null,
	bottle_reference_gap: null,
	bottle_should_receive_total: 0
})

const summary = reactive({
	receivable_balance: 0,
	prepay_balance: 0,
	prepay_manual_balance: 0,
	offset_credit_balance: 0,
	net_balance: 0,
	should_receive_total: 0,
	amount_received_total: 0,
	last_receipt_at: null
})
const summaryScope = reactive({
	date_from: '',
	date_to: '',
	receivable_balance: 0,
	prepay_balance: 0,
	prepay_manual_balance: 0,
	offset_credit_balance: 0,
	net_balance: 0,
	should_receive_total: 0,
	amount_received_total: 0,
	last_receipt_at: null
})

const receiptForm = reactive({
	amount: '',
	roundingAmount: '',
	bizDate: '',
	allocationMode: 'period',
	allocationStartDate: '',
	allocationEndDate: '',
	paymentMethod: 'cash',
	note: ''
})
const receiptPaymentMethodOptions = [
	{ label: '现金', value: 'cash' },
	{ label: '银行转账', value: 'bank' },
	{ label: '微信', value: 'wechat' },
	{ label: '支付宝', value: 'alipay' },
	{ label: '支票', value: 'check' }
]
const receiptAllocationModeOptions = [
	{ label: '时间段分配', value: 'period' },
	{ label: '勾选分配', value: 'checked' }
]
const offsetAllocationModeOptions = [
	{ label: '勾选分配（可多选）', value: 'checked' },
	{ label: '时间段分配', value: 'period' }
]
const prepayApplyStrategyOptions = [
	{ label: '仅入预付', value: 'hold_only' },
	{ label: '立即按区间冲欠', value: 'allocate_period' }
]

const prepayForm = reactive({
	amount: '',
	bizDate: '',
	paymentMethod: 'cash',
	applyStrategy: 'hold_only',
	allocationStartDate: '',
	allocationEndDate: '',
	note: ''
})
const offsetEntryForm = reactive({
	amount: '',
	bizDate: '',
	paymentMethod: 'cash',
	note: ''
})

const flowForm = reactive({
	bizDate: '',
	flowIndexPrev: '',
	flowIndexCurr: '',
	flowTheoryRatio: '',
	note: ''
})
const openingDebtForm = reactive({
	amount: '',
	bizDate: '',
	note: ''
})
const otherFeeForm = reactive({
	amount: '',
	bizDate: '',
	note: ''
})
const offsetAllocateForm = reactive({
	amount: '',
	allocationMode: 'checked',
	allocationStartDate: '',
	allocationEndDate: ''
})

const analysisFilters = reactive({
	dateFrom: '',
	dateTo: ''
})
const analysisDatePreset = ref('custom')

const rowFilters = reactive({
	dateFrom: '',
	dateTo: ''
})
const rowsDatePreset = ref('custom')
const rowsDatePresetItems = [
	{ label: '本年累计', value: 'year' },
	{ label: '本月累计', value: 'month' },
	{ label: '本周', value: 'week' },
	{ label: '今日', value: 'today' },
	{ label: '自定义', value: 'custom' }
]

const rowsPager = reactive({
	page: 1,
	pageSize: 50,
	total: 0,
	hasMore: false
})
const offsetPoolPager = reactive({
	page: 1,
	pageSize: 10,
	total: 0,
	hasMore: false
})

const subtitle = computed(() => {
	if (!customer.value?.name) return '客户账务总览与流水'
	return `${customer.value.name} · 对账流水`
})
const activeOperationTabLabel = computed(() => {
	return operationTabs.find((item) => item.value === activeOperationTab.value)?.label || '登记收款/分配'
})

const rowsTotalPages = computed(() => {
	const pages = Math.ceil(Number(rowsPager.total || 0) / Number(rowsPager.pageSize || 50))
	return pages > 0 ? pages : 1
})
const headerRowsDateFromText = computed(() => `开始 ${normalizeDate(rowFilters.dateFrom) || '--'}`)
const headerRowsDateToText = computed(() => `结束 ${normalizeDate(rowFilters.dateTo) || '--'}`)
const offsetPoolTotalPages = computed(() => {
	const pages = Math.ceil(Number(offsetPoolPager.total || 0) / Number(offsetPoolPager.pageSize || 10))
	return pages > 0 ? pages : 1
})
const isEditingReceipt = computed(() => Boolean(normalizeString(editingReceiptId.value)))
const isEditingCashierReceipt = computed(() => isCashierReceiptSourceType(editingReceiptSourceType.value))
const isEditingFlowSettlement = computed(() => Boolean(normalizeString(editingFlowSettlementId.value)))
const isEditingOpeningDebt = computed(() => Boolean(normalizeString(editingOpeningDebtId.value)))
const isEditingOtherFee = computed(() => Boolean(normalizeString(editingOtherFeeId.value)))
const receiptPrimaryActionLabel = computed(() => {
	if (!isEditingReceipt.value) return '登记收款'
	return isEditingCashierReceipt.value ? '保存分配' : '保存收款单'
})
const flowPrimaryActionLabel = computed(() => (isEditingFlowSettlement.value ? '保存结算单' : '生成结算单'))
const openingDebtPrimaryActionLabel = computed(() => (isEditingOpeningDebt.value ? '保存欠款' : '登记欠款'))
const otherFeePrimaryActionLabel = computed(() => (isEditingOtherFee.value ? '保存费用' : '登记费用'))

const hasSummaryScope = computed(() => Boolean(summaryScope.date_from && summaryScope.date_to))
const summaryReceivableBalanceDisplay = computed(() => (
	hasSummaryScope.value ? toNumber(summaryScope.receivable_balance, toNumber(summary.receivable_balance, 0)) : toNumber(summary.receivable_balance, 0)
))
const summaryPrepayBalanceDisplay = computed(() => (
	hasSummaryScope.value ? toNumber(summaryScope.prepay_balance, toNumber(summary.prepay_balance, 0)) : toNumber(summary.prepay_balance, 0)
))
const summaryNetBalanceDisplay = computed(() => (
	hasSummaryScope.value ? toNumber(summaryScope.net_balance, toNumber(summary.net_balance, 0)) : toNumber(summary.net_balance, 0)
))
const summaryLastReceiptAtDisplay = computed(() => {
	if (hasSummaryScope.value) {
		const scopedTs = Number(summaryScope.last_receipt_at || 0)
		if (Number.isFinite(scopedTs) && scopedTs > 0) return scopedTs
	}
	const fallbackTs = Number(summary.last_receipt_at || 0)
	return Number.isFinite(fallbackTs) && fallbackTs > 0 ? fallbackTs : 0
})
const summaryLastReceiptText = computed(() => {
	const ts = Number(summaryLastReceiptAtDisplay.value || 0)
	if (!Number.isFinite(ts) || ts <= 0) return '-'
	const d = new Date(ts)
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})
const overviewScopeText = computed(() => (
	hasSummaryScope.value ? `口径：${summaryScope.date_from} ~ ${summaryScope.date_to}` : '口径：全量'
))
const overviewShouldReceiveTotal = computed(() => (
	hasSummaryScope.value ? toNumber(summaryScope.should_receive_total, 0) : toNumber(summary.should_receive_total, 0)
))
const overviewAmountReceivedTotal = computed(() => (
	hasSummaryScope.value ? toNumber(summaryScope.amount_received_total, 0) : toNumber(summary.amount_received_total, 0)
))
const overviewPrepayManualBalance = computed(() => (
	hasSummaryScope.value
		? toNumber(summaryScope.prepay_manual_balance, toNumber(summary.prepay_manual_balance, 0))
		: toNumber(summary.prepay_manual_balance, 0)
))
const overviewOffsetCreditBalance = computed(() => (
	hasSummaryScope.value
		? toNumber(summaryScope.offset_credit_balance, toNumber(summary.offset_credit_balance, 0))
		: toNumber(summary.offset_credit_balance, 0)
))

const customerPriceUnit = computed(() => normalizeString(customer.value?.default_price_unit) || 'kg')
const isFlowCustomer = computed(() => customerPriceUnit.value === 'm3')
const isKgCustomer = computed(() => customerPriceUnit.value === 'kg')
const isBottleCustomer = computed(() => customerPriceUnit.value === 'bottle')
const defaultUnitPriceText = computed(() => {
	const value = toNullableNumber(customer.value?.default_unit_price)
	if (value == null) return '-'
	return `¥${formatMoney(value)} / ${priceUnitText(customerPriceUnit.value)}`
})
const latestFlowIndexCurr = computed(() => {
	const row = recentFlowSettlements.value[0]
	return row ? toNullableNumber(row.flow_index_curr) : null
})
const flowPeriodText = computed(() => {
	if (!flowPreview.value) return '-'
	const start = normalizeString(flowPreview.value.period_start_date)
	const end = normalizeString(flowPreview.value.period_end_date)
	if (start && end) return `${start} ~ ${end}`
	return end || start || '-'
})
const flowMeterStartText = computed(() => {
	if (!flowPreview.value) return '-'
	return normalizeString(flowPreview.value.meter_period_label) || '历史上次表数'
})
const flowMeterDiffText = computed(() => calcFlowMeterDiff(flowForm.flowIndexPrev, flowForm.flowIndexCurr))
const bottleReferenceAmount = computed(() => {
	const price = toNullableNumber(bottleReferencePrice.value)
	if (price == null || price < 0) return null
	return fix2(toNumber(analysis.bottle_reference_weight, 0) * price)
})
const bottleReferenceGap = computed(() => {
	if (bottleReferenceAmount.value == null) return null
	return fix2(toNumber(analysis.bottle_should_receive_total, 0) - bottleReferenceAmount.value)
})
const bottleReferenceAmountText = computed(() => {
	if (bottleReferenceAmount.value == null) return '待输入参考单价'
	return `¥${formatMoney(bottleReferenceAmount.value)}`
})
const bottleReferenceGapText = computed(() => {
	if (bottleReferenceGap.value == null) return '待输入参考单价'
	return `¥${formatMoney(bottleReferenceGap.value)}`
})
const receiptPaymentMethodIndex = computed(() => {
	const normalized = normalizeReceiptPaymentMethod(receiptForm.paymentMethod)
	const idx = receiptPaymentMethodOptions.findIndex((item) => item.value === normalized)
	return idx >= 0 ? idx : 0
})
const receiptPaymentMethodLabel = computed(() => {
	return receiptPaymentMethodOptions[receiptPaymentMethodIndex.value]?.label || '现金'
})
const receiptAllocationModeIndex = computed(() => {
	const normalized = normalizeReceiptAllocationMode(receiptForm.allocationMode)
	const idx = receiptAllocationModeOptions.findIndex((item) => item.value === normalized)
	return idx >= 0 ? idx : 0
})
const receiptAllocationModeLabel = computed(() => {
	return receiptAllocationModeOptions[receiptAllocationModeIndex.value]?.label || '时间段分配'
})
const offsetAllocationModeIndex = computed(() => {
	const normalized = normalizeReceiptAllocationMode(offsetAllocateForm.allocationMode)
	const idx = offsetAllocationModeOptions.findIndex((item) => item.value === normalized)
	return idx >= 0 ? idx : 0
})
const offsetAllocationModeLabel = computed(() => {
	return offsetAllocationModeOptions[offsetAllocationModeIndex.value]?.label || '勾选分配（可多选）'
})
const prepayPaymentMethodIndex = computed(() => {
	const normalized = normalizeReceiptPaymentMethod(prepayForm.paymentMethod)
	const idx = receiptPaymentMethodOptions.findIndex((item) => item.value === normalized)
	return idx >= 0 ? idx : 0
})
const prepayPaymentMethodLabel = computed(() => {
	return receiptPaymentMethodOptions[prepayPaymentMethodIndex.value]?.label || '现金'
})
const offsetEntryPaymentMethodIndex = computed(() => {
	const normalized = normalizeReceiptPaymentMethod(offsetEntryForm.paymentMethod)
	const idx = receiptPaymentMethodOptions.findIndex((item) => item.value === normalized)
	return idx >= 0 ? idx : 0
})
const offsetEntryPaymentMethodLabel = computed(() => {
	return receiptPaymentMethodOptions[offsetEntryPaymentMethodIndex.value]?.label || '现金'
})
const prepayApplyStrategyIndex = computed(() => {
	const normalized = normalizePrepayApplyStrategy(prepayForm.applyStrategy)
	const idx = prepayApplyStrategyOptions.findIndex((item) => item.value === normalized)
	return idx >= 0 ? idx : 0
})
const prepayApplyStrategyLabel = computed(() => {
	return prepayApplyStrategyOptions[prepayApplyStrategyIndex.value]?.label || '仅入预付'
})
const moneyInputPlaceholder = computed(() => (isFlowCustomer.value ? '请输入正数（最多3位小数）' : '请输入正数'))
const checkedTargetCandidates = computed(() => {
	const saleRows = (Array.isArray(recentSales.value) ? recentSales.value : [])
		.filter((row) => toNumber(row?.outstanding, 0) > 0)
		.map((row) => {
			const targetId = normalizeString(row?._id)
			return {
				key: `sale:${targetId}`,
				targetType: 'sale',
				targetId,
				date: normalizeString(row?.date),
				title: `销售单 ${normalizeString(row?.date) || '-'} / ${targetId.slice(-6)}`,
				outstanding: fix2(toNumber(row?.outstanding, 0))
			}
		})
		.filter((row) => Boolean(row.targetId))
	const flowRows = (Array.isArray(recentFlowSettlements.value) ? recentFlowSettlements.value : [])
		.filter((row) => toNumber(row?.outstanding, 0) > 0)
		.map((row) => {
			const targetId = normalizeString(row?._id)
			return {
				key: `flow_settlement:${targetId}`,
				targetType: 'flow_settlement',
				targetId,
				date: normalizeString(row?.biz_date),
				title: `流量结算 ${normalizeString(row?.biz_date) || '-'} / ${targetId.slice(-6)}`,
				outstanding: fix2(toNumber(row?.outstanding, 0))
			}
		})
		.filter((row) => Boolean(row.targetId))
	const openingDebtRows = (Array.isArray(recentOpeningDebts.value) ? recentOpeningDebts.value : [])
		.filter((row) => toNumber(row?.outstanding, 0) > 0)
		.map((row) => {
			const targetId = normalizeString(row?._id)
			return {
				key: `opening_debt:${targetId}`,
				targetType: 'opening_debt',
				targetId,
				date: normalizeString(row?.biz_date),
				title: `历史欠款 ${normalizeString(row?.biz_date) || '-'} / ${targetId.slice(-6)}`,
				outstanding: fix2(toNumber(row?.outstanding, 0))
			}
		})
		.filter((row) => Boolean(row.targetId))
	const otherFeeRows = (Array.isArray(recentOtherFees.value) ? recentOtherFees.value : [])
		.filter((row) => toNumber(row?.outstanding, 0) > 0)
		.map((row) => {
			const targetId = normalizeString(row?._id)
			return {
				key: `other_fee:${targetId}`,
				targetType: 'other_fee',
				targetId,
				date: normalizeString(row?.biz_date),
				title: `其他费用 ${normalizeString(row?.biz_date) || '-'} / ${targetId.slice(-6)}`,
				outstanding: fix2(toNumber(row?.outstanding, 0))
			}
		})
		.filter((row) => Boolean(row.targetId))
	return [...saleRows, ...flowRows, ...openingDebtRows, ...otherFeeRows].sort((a, b) => {
		if (a.date !== b.date) return a.date < b.date ? -1 : 1
		return a.key < b.key ? -1 : 1
	})
})
const checkedTargetOutstandingMap = computed(() => {
	const map = new Map()
	;(Array.isArray(checkedTargetCandidates.value) ? checkedTargetCandidates.value : []).forEach((row) => {
		const key = normalizeString(row?.key)
		if (!key) return
		map.set(key, fix2(toNumber(row?.outstanding, 0)))
	})
	return map
})
const checkedAllocationSelectedCount = computed(() => {
	const keys = Array.isArray(checkedAllocationTargetKeys.value) ? checkedAllocationTargetKeys.value : []
	const uniqueKeys = Array.from(new Set(keys.map((item) => normalizeString(item)).filter(Boolean)))
	return uniqueKeys.filter((key) => checkedTargetOutstandingMap.value.has(key)).length
})
const checkedAllocationSelectedTotal = computed(() => {
	const keys = Array.isArray(checkedAllocationTargetKeys.value) ? checkedAllocationTargetKeys.value : []
	const uniqueKeys = Array.from(new Set(keys.map((item) => normalizeString(item)).filter(Boolean)))
	const total = uniqueKeys.reduce((sum, key) => {
		if (!checkedTargetOutstandingMap.value.has(key)) return sum
		return sum + toNumber(checkedTargetOutstandingMap.value.get(key), 0)
	}, 0)
	return fix2(total)
})
const receiptPeriodRangeSummary = computed(() => {
	const start = normalizeDate(receiptForm.allocationStartDate)
	const end = normalizeDate(receiptForm.allocationEndDate)
	if (!start || !end || start > end) {
		return {
			total: 0,
			count: 0
		}
	}
	const rows = Array.isArray(checkedTargetCandidates.value) ? checkedTargetCandidates.value : []
	let total = 0
	let count = 0
	rows.forEach((row) => {
		const date = normalizeDate(row?.date)
		if (!date) return
		if (date < start || date > end) return
		const outstanding = fix2(toNumber(row?.outstanding, 0))
		if (!(outstanding > 0)) return
		total += outstanding
		count += 1
	})
	return {
		total: fix2(total),
		count
	}
})
const receiptPeriodRangeOutstandingTotal = computed(() => receiptPeriodRangeSummary.value.total)
const receiptPeriodRangeTargetCount = computed(() => receiptPeriodRangeSummary.value.count)
const offsetCheckedTargetSelectedCount = computed(() => {
	const keys = Array.isArray(offsetCheckedTargetKeys.value) ? offsetCheckedTargetKeys.value : []
	const uniqueKeys = Array.from(new Set(keys.map((item) => normalizeString(item)).filter(Boolean)))
	return uniqueKeys.filter((key) => checkedTargetOutstandingMap.value.has(key)).length
})
const offsetCheckedTargetSelectedTotal = computed(() => {
	const keys = Array.isArray(offsetCheckedTargetKeys.value) ? offsetCheckedTargetKeys.value : []
	const uniqueKeys = Array.from(new Set(keys.map((item) => normalizeString(item)).filter(Boolean)))
	const total = uniqueKeys.reduce((sum, key) => {
		if (!checkedTargetOutstandingMap.value.has(key)) return sum
		return sum + toNumber(checkedTargetOutstandingMap.value.get(key), 0)
	}, 0)
	return fix2(total)
})
const offsetPeriodRangeSummary = computed(() => {
	const start = normalizeDate(offsetAllocateForm.allocationStartDate)
	const end = normalizeDate(offsetAllocateForm.allocationEndDate)
	if (!start || !end || start > end) {
		return {
			total: 0,
			count: 0
		}
	}
	const rows = Array.isArray(checkedTargetCandidates.value) ? checkedTargetCandidates.value : []
	let total = 0
	let count = 0
	rows.forEach((row) => {
		const date = normalizeDate(row?.date)
		if (!date) return
		if (date < start || date > end) return
		const outstanding = fix2(toNumber(row?.outstanding, 0))
		if (!(outstanding > 0)) return
		total += outstanding
		count += 1
	})
	return {
		total: fix2(total),
		count
	}
})
const offsetPeriodRangeOutstandingTotal = computed(() => offsetPeriodRangeSummary.value.total)
const offsetPeriodRangeTargetCount = computed(() => offsetPeriodRangeSummary.value.count)
const selectedOffsetReceiptIds = computed(() => {
	return Array.from(
		new Set(
			(Array.isArray(selectedOffsetReceipts.value) ? selectedOffsetReceipts.value : [])
				.map((row) => normalizeString(row?._id))
				.filter(Boolean)
		)
	)
})
const selectedOffsetReceiptCount = computed(() => selectedOffsetReceiptIds.value.length)
const selectedOffsetReceiptAvailableTotal = computed(() => {
	return fix2(
		(Array.isArray(selectedOffsetReceipts.value) ? selectedOffsetReceipts.value : []).reduce(
			(sum, row) => sum + toNumber(row?.unallocated_amount, 0),
			0
		)
	)
})
const selectedOffsetReceiptSummary = computed(() => {
	if (selectedOffsetReceiptCount.value <= 0) return '-'
	return `已选 ${selectedOffsetReceiptCount.value} 笔（可用合计 ¥${formatMoney(selectedOffsetReceiptAvailableTotal.value)}）`
})
const recentSalesDisplayRows = computed(() => {
	const saleRows = (Array.isArray(recentSales.value) ? recentSales.value : []).map((row) => ({
		...row,
		record_type: 'sale',
		record_key: `sale:${normalizeString(row?._id)}`
	}))
	if (!isFlowCustomer.value) return saleRows
	const flowRows = (Array.isArray(recentFlowSettlements.value) ? recentFlowSettlements.value : []).map((row) => ({
		...row,
		date: normalizeDate(row?.biz_date),
		biz_mode: 'flow_settlement',
		record_type: 'flow_settlement',
		record_key: `flow_settlement:${normalizeString(row?._id)}`
	}))
	return [...flowRows, ...saleRows]
		.sort((a, b) => {
			const leftDate = normalizeDate(a?.date)
			const rightDate = normalizeDate(b?.date)
			if (leftDate !== rightDate) return leftDate < rightDate ? 1 : -1
			const leftId = normalizeString(a?._id)
			const rightId = normalizeString(b?._id)
			return leftId < rightId ? 1 : -1
		})
		.slice(0, 100)
})

function toNumber(value, fallback = 0) {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

function toNullableNumber(value) {
	if (value === '' || value == null) return null
	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

function fix2(value) {
	const num = Number(value)
	return Number.isFinite(num) ? Number(num.toFixed(2)) : 0
}

function normalizeDecimalText(value) {
	const raw = value == null ? '' : String(value).trim()
	if (!raw) return ''
	if (/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return raw
	const num = Number(raw)
	if (!Number.isFinite(num)) return ''
	return String(num)
}

function pow10BigInt(digits) {
	const value = Number(digits)
	if (!Number.isFinite(value) || value <= 0) return 1n
	return 10n ** BigInt(Math.floor(value))
}

function scaleBigInt(value, fromScale, toScale) {
	if (fromScale === toScale) return value
	if (fromScale < toScale) {
		return value * pow10BigInt(toScale - fromScale)
	}
	return value / pow10BigInt(fromScale - toScale)
}

function toScaledBigInt(value, scaleDigits) {
	const normalized = normalizeDecimalText(value)
	if (!normalized) return null
	const sourceScale = countDecimalPlaces(normalized)
	const parsed = parseScaledBigInt(normalized, sourceScale)
	if (parsed == null) return null
	const digits = Math.max(Math.floor(Number(scaleDigits || 0)), 0)
	return scaleBigInt(parsed, sourceScale, digits)
}

function formatScaledBigIntFixed(value, scaleDigits) {
	const digits = Math.max(Math.floor(Number(scaleDigits || 0)), 0)
	const negative = value < 0n
	const absValue = negative ? -value : value
	const source = absValue.toString().padStart(digits + 1, '0')
	if (digits <= 0) return `${negative ? '-' : ''}${source}`
	const integerPart = source.slice(0, -digits) || '0'
	const decimalPart = source.slice(-digits)
	return `${negative ? '-' : ''}${integerPart}.${decimalPart}`
}

function truncateDecimal(value, scale = 2) {
	const digits = Math.max(Math.floor(Number(scale || 0)), 0)
	const scaled = toScaledBigInt(value, digits)
	if (scaled == null) return null
	const factor = 10 ** digits
	if (!Number.isFinite(factor) || factor <= 0) return Number(scaled)
	return Number(scaled) / factor
}

function formatMoney(value) {
	const precision = isFlowCustomer.value ? 3 : 2
	const scaled = toScaledBigInt(value, precision)
	if (scaled == null) return formatScaledBigIntFixed(0n, precision)
	return formatScaledBigIntFixed(scaled, precision)
}

function formatSummaryMoney(value) {
	return formatMoney(value)
}

function formatNullableNumber(value) {
	const num = toNullableNumber(value)
	if (num == null) return '-'
	return String(num)
}

function formatFlowNumber(value) {
	const scaled = toScaledBigInt(value, 3)
	if (scaled == null) return '-'
	return formatScaledBigIntFixed(scaled, 3)
}

function formatFlowInput(value) {
	const scaled = toScaledBigInt(value, 3)
	if (scaled == null) return ''
	return formatScaledBigIntFixed(scaled, 3)
}

function formatNullableWeight(value) {
	const num = toNullableNumber(value)
	if (num == null) return '-'
	return `${num} kg`
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeDate(value) {
	const text = normalizeString(value)
	if (!text) return ''
	const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (matched) return matched[0]
	const parsed = Date.parse(text)
	if (!Number.isFinite(parsed) || parsed <= 0) return ''
	const date = new Date(parsed)
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function countDecimalPlaces(text) {
	const source = normalizeString(text)
	const dotIndex = source.indexOf('.')
	if (dotIndex < 0) return 0
	return Math.max(source.length - dotIndex - 1, 0)
}

function parseScaledBigInt(text, scaleDigits) {
	const source = normalizeString(text)
	if (!source) return null
	const match = source.match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
	if (!match) return null
	const sign = match[1] === '-' ? -1n : 1n
	const integerPart = match[2] || '0'
	const decimalPart = (match[3] || '').padEnd(scaleDigits, '0').slice(0, scaleDigits)
	const combined = `${integerPart}${decimalPart}`.replace(/^0+(?=\d)/, '') || '0'
	return sign * BigInt(combined)
}

function formatScaledBigInt(value, scaleDigits) {
	const negative = value < 0n
	const absValue = negative ? -value : value
	const source = absValue.toString().padStart(scaleDigits + 1, '0')
	if (scaleDigits <= 0) return `${negative ? '-' : ''}${source}`
	const integerPart = source.slice(0, -scaleDigits) || '0'
	const decimalPart = source.slice(-scaleDigits).replace(/0+$/, '')
	return `${negative ? '-' : ''}${integerPart}${decimalPart ? `.${decimalPart}` : ''}`
}

function calcFlowMeterDiff(prevValue, currValue) {
	const prevText = normalizeString(prevValue)
	const currText = normalizeString(currValue)
	if (!prevText || !currText) return ''
	const scaleDigits = Math.max(countDecimalPlaces(prevText), countDecimalPlaces(currText))
	const prev = parseScaledBigInt(prevText, scaleDigits)
	const curr = parseScaledBigInt(currText, scaleDigits)
	if (prev == null || curr == null) return ''
	const diff = curr - prev
	return formatScaledBigInt(diff >= 0n ? diff : 0n, scaleDigits)
}

function normalizePaymentStatus(value) {
	const text = normalizeString(value)
	if (text === 'paid' || text === '已结清') return 'paid'
	if (text === 'partial' || text === '部分付') return 'partial'
	return 'unpaid'
}

function normalizeReceiptPaymentMethod(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'cash' || text === '现金') return 'cash'
	if (text === 'bank' || text === '银行' || text === '转账' || text === '银行转账') return 'bank'
	if (text === 'wechat' || text === '微信') return 'wechat'
	if (text === 'alipay' || text === '支付宝') return 'alipay'
	if (text === 'check' || text === 'cheque' || text === '支票') return 'check'
	return 'cash'
}

function normalizeReceiptAllocationMode(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'checked') return 'checked'
	return 'period'
}

function normalizePrepayApplyStrategy(value) {
	const text = normalizeString(value).toLowerCase()
	if (text === 'allocate_period' || text === 'period' || text === '立即按区间冲欠') return 'allocate_period'
	return 'hold_only'
}

function paymentStatusText(value) {
	const status = normalizePaymentStatus(value)
	if (status === 'paid') return '已结清'
	if (status === 'partial') return '部分付'
	return '未付款'
}

function paymentStatusKind(value) {
	const status = normalizePaymentStatus(value)
	if (status === 'paid') return 'success'
	if (status === 'partial') return 'warning'
	return 'danger'
}

function paymentMethodText(value) {
	const method = normalizeReceiptPaymentMethod(value)
	if (method === 'bank') return '银行转账'
	if (method === 'wechat') return '微信'
	if (method === 'alipay') return '支付宝'
	if (method === 'check') return '支票'
	return '现金'
}

function receiptSourceTypeText(value) {
	const sourceType = normalizeString(value)
	if (!sourceType) return ''
	if (sourceType === 'cashier_intake') return '出纳登记'
	if (sourceType === 'customer_statement' || sourceType === 'customer_statement_manual') return '客户对账登记'
	if (sourceType === 'customer_prepay_manual') return '预付录入'
	if (sourceType === 'customer_offset_credit_manual_compensation') return '冲抵池录入'
	if (sourceType === 'offset_manual_allocate') return '冲抵分配'
	if (sourceType === 'sale_auto_prepay' || sourceType === 'flow_auto_prepay') return '自动冲销'
	if (sourceType.startsWith('sale_offset_credit')) return '销售冲抵入池'
	return sourceType
}

function isCashierReceiptSourceType(value) {
	return normalizeString(value) === 'cashier_intake'
}

function isCashierReceiptRow(row) {
	return isCashierReceiptSourceType(row?.source_type || row?.meta?.source_type)
}

function receiptAllocationText(row) {
	const roundingAllocated = toNumber(row?.rounding_allocated_amount, 0)
	const amount = toNumber(row?.amount, 0)
	const mode = normalizeReceiptAllocationMode(row?.allocation_mode)
	const sourceType = normalizeString(row?.source_type || row?.meta?.source_type)
	const sourceText = receiptSourceTypeText(sourceType)
	if (mode === 'checked') {
		const count = Array.isArray(row?.allocation_targets) ? row.allocation_targets.length : 0
		const modeText = `分配模式：勾选分配（${count} 笔目标）`
		if (roundingAllocated > 0) {
			return sourceText
				? `收款 ¥${formatMoney(amount)}，抹零 ¥${formatMoney(roundingAllocated)} · 来源 ${sourceText} · ${modeText}`
				: `收款 ¥${formatMoney(amount)}，抹零 ¥${formatMoney(roundingAllocated)} · ${modeText}`
		}
		return sourceText ? `${modeText} · 来源 ${sourceText}` : modeText
	}
	const start = normalizeDate(row?.allocation_start_date)
	const end = normalizeDate(row?.allocation_end_date)
	const modeText = start && end ? `分配模式：时间段 ${start} ~ ${end}` : '分配模式：时间段'
	if (roundingAllocated > 0) {
		return sourceText
			? `收款 ¥${formatMoney(amount)}，抹零 ¥${formatMoney(roundingAllocated)} · 来源 ${sourceText} · ${modeText}`
			: `收款 ¥${formatMoney(amount)}，抹零 ¥${formatMoney(roundingAllocated)} · ${modeText}`
	}
	return sourceText ? `${modeText} · 来源 ${sourceText}` : modeText
}

function receiptAllocationDateScopeText(row) {
	const allocatedAmount = toNumber(row?.allocated_amount, 0) + toNumber(row?.rounding_allocated_amount, 0)
	if (!(allocatedAmount > 0)) return '分配日期：暂未分配'
	const targetStart = normalizeDate(row?.allocation_target_date_start)
	const targetEnd = normalizeDate(row?.allocation_target_date_end)
	const targetDateCount = Math.max(toNumber(row?.allocation_target_date_count, 0), 0)
	if (targetStart && targetEnd) {
		if (targetStart === targetEnd) return `分配到销售日期：${targetStart}`
		const suffix = targetDateCount > 0 ? `（共${targetDateCount}天）` : ''
		return `分配到销售日期：${targetStart} ~ ${targetEnd}${suffix}`
	}
	const mode = normalizeReceiptAllocationMode(row?.allocation_mode)
	if (mode === 'period') {
		const start = normalizeDate(row?.allocation_start_date)
		const end = normalizeDate(row?.allocation_end_date)
		if (start && end) return start === end ? `分配日期范围：${start}` : `分配日期范围：${start} ~ ${end}`
		if (start) return `分配日期范围：${start}`
	}
	const checkedCount = Array.isArray(row?.allocation_targets) ? row.allocation_targets.length : 0
	if (checkedCount > 0) return `分配到销售单：${checkedCount}笔`
	return '分配日期：已分配'
}

function showConfirmModal({ title, content, confirmText = '确认' }) {
	return new Promise((resolve) => {
		uni.showModal({
			title,
			content,
			confirmText,
			cancelText: '取消',
			success: (res) => resolve(Boolean(res?.confirm)),
			fail: () => resolve(false)
		})
	})
}

function priceUnitText(value) {
	const text = normalizeString(value)
	if (text === 'm3') return 'm3'
	if (text === 'bottle') return '瓶'
	return 'kg'
}

function bizModeText(value) {
	const text = normalizeString(value)
	if (text === 'flow_settlement') return '流量结算'
	if (text === 'truck') return '整车'
	if (text === 'agent_sale') return '代理销售'
	return '瓶装'
}

function isSaleRecordRow(row) {
	return normalizeString(row?.record_type || 'sale') === 'sale'
}

function resolveSaleEffectiveShouldReceive(row) {
	const effective = toNullableNumber(row?.should_receive_effective)
	if (effective != null) return fix2(effective)
	return fix2(toNumber(row?.should_receive, 0))
}

function resolveSalePostedReceived(row) {
	const posted = toNullableNumber(row?.posted_amount_received)
	if (posted != null) return fix2(posted)
	return fix2(toNumber(row?.amount_received, 0))
}

function resolveSaleOffsetApplied(row) {
	return fix2(toNumber(row?.offset_applied_amount, 0))
}

function resolveSaleOffsetEnabled(row, fallback = false) {
	const raw = row?.offset_enabled
	if (raw == null || raw === '') return Boolean(fallback)
	if (typeof raw === 'boolean') return raw
	if (typeof raw === 'number') return raw !== 0
	const text = normalizeString(raw).toLowerCase()
	if (!text) return Boolean(fallback)
	if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true
	if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false
	return Boolean(fallback)
}

function sortSaleOffsetSources(list = []) {
	return (list || []).slice().sort((a, b) => {
		const left = normalizeDate(a?.date)
		const right = normalizeDate(b?.date)
		if (left === right) return 0
		if (!left) return 1
		if (!right) return -1
		return left < right ? -1 : 1
	})
}

function resolveSaleOffsetSources(row) {
	const source = Array.isArray(row?.offset_sources) ? row.offset_sources : []
	const grouped = new Map()
	source.forEach((item) => {
		const date = normalizeDate(item?.date)
		const amount = fix2(toNumber(item?.amount, 0))
		if (!(amount > 0)) return
		grouped.set(date, fix2(toNumber(grouped.get(date), 0) + amount))
	})
	return sortSaleOffsetSources(
		Array.from(grouped.entries()).map(([date, amount]) => ({ date, amount }))
	)
}

function formatSaleOffsetSourcesText(row) {
	const list = resolveSaleOffsetSources(row)
	if (!list.length) return ''
	const datedRows = list.filter((item) => normalizeDate(item?.date))
	if (!datedRows.length) return ''
	return datedRows.map((item) => `${item.date}¥${formatMoney(item.amount)}`).join(' + ')
}

function resolveSaleOffsetTargetApplied(row) {
	return fix2(toNumber(row?.offset_target_amount, 0))
}

function resolveSaleOffsetTargets(row) {
	const source = Array.isArray(row?.offset_targets) ? row.offset_targets : []
	const grouped = new Map()
	source.forEach((item) => {
		const date = normalizeDate(item?.date)
		const amount = fix2(toNumber(item?.amount, 0))
		if (!(amount > 0)) return
		grouped.set(date, fix2(toNumber(grouped.get(date), 0) + amount))
	})
	return sortSaleOffsetSources(
		Array.from(grouped.entries()).map(([date, amount]) => ({ date, amount }))
	)
}

function formatSaleOffsetTargetsText(row) {
	const list = resolveSaleOffsetTargets(row)
	if (!list.length) return ''
	const datedRows = list.filter((item) => normalizeDate(item?.date))
	if (!datedRows.length) return ''
	return datedRows.map((item) => `${item.date}¥${formatMoney(item.amount)}`).join(' + ')
}

function resolveSaleManualReceived(row) {
	const manual = toNullableNumber(row?.manual_amount_received)
	if (manual != null) return fix2(manual)
	return fix2(resolveSalePostedReceived(row) - resolveSaleOffsetApplied(row))
}

function formatSaleOffsetLine(row) {
	const offsetAmount = resolveSaleOffsetApplied(row)
	const sourceText = formatSaleOffsetSourcesText(row)
	if (sourceText) return `冲抵 ¥${formatMoney(offsetAmount)}（${sourceText}）`
	return `冲抵 ¥${formatMoney(offsetAmount)}`
}

function formatSaleOffsetTargetLine(row) {
	const offsetAmount = resolveSaleOffsetTargetApplied(row)
	const targetText = formatSaleOffsetTargetsText(row)
	if (targetText) return `已冲抵到 ¥${formatMoney(offsetAmount)}（${targetText}）`
	return `已冲抵到 ¥${formatMoney(offsetAmount)}`
}

function resolveSaleOverCollected(row) {
	const effectiveShouldReceive = resolveSaleEffectiveShouldReceive(row)
	if (effectiveShouldReceive <= 0) return 0
	const amountReceived = resolveSalePostedReceived(row)
	const overCollected = fix2(amountReceived - effectiveShouldReceive)
	return overCollected > 0 ? overCollected : 0
}

function resolveSaleRoundingAmount(row) {
	const direct = toNullableNumber(row?.rounding_amount)
	if (direct != null) {
		const rounded = fix2(direct)
		return rounded > 0 ? rounded : 0
	}
	const shouldReceive = fix2(toNumber(row?.should_receive, 0))
	const effectiveShouldReceive = resolveSaleEffectiveShouldReceive(row)
	const diff = fix2(Math.abs(shouldReceive - effectiveShouldReceive))
	return diff > 0 ? diff : 0
}

function resolveOpeningDebtRoundingAmount(row) {
	const direct = toNullableNumber(row?.rounding_amount ?? row?.meta?.rounding_amount)
	if (direct != null) return Math.max(toNumber(direct, 0), 0)
	const rawAmount = toNumber(row?.amount, 0)
	const effective = toNullableNumber(row?.should_receive_effective ?? row?.meta?.should_receive_effective)
	if (effective == null) return 0
	const diff = toNumber(rawAmount - toNumber(effective, 0), 0)
	return diff > 0 ? diff : 0
}

function resolveOpeningDebtEffectiveShouldReceive(row) {
	const direct = toNullableNumber(row?.should_receive_effective ?? row?.meta?.should_receive_effective)
	if (direct != null) return Math.max(toNumber(direct, 0), 0)
	const rawAmount = toNumber(row?.amount, 0)
	const rounding = resolveOpeningDebtRoundingAmount(row)
	const effective = toNumber(rawAmount - rounding, 0)
	return effective > 0 ? effective : 0
}

function resolveSaleOutBottleCount(row) {
	const count = Math.floor(toNumber(row?.out_bottle_count, 0))
	return count > 0 ? count : 0
}

function resolveSaleBackBottleCount(row) {
	const count = Math.floor(toNumber(row?.back_bottle_count, 0))
	return count > 0 ? count : 0
}

function resolveSaleDepositBalanceCount(row) {
	const count = Math.floor(toNumber(row?.deposit_balance_count, 0))
	return count > 0 ? count : 0
}

function formatSaleBottlePreviewText(previewList, total, truncated) {
	const list = Array.isArray(previewList)
		? previewList.map((item) => normalizeString(item).toUpperCase()).filter(Boolean)
		: []
	if (!list.length) return '无'
	const text = list.join('、')
	if (truncated || total > list.length) return `${text} 等${total}只`
	return text
}

function resolveSaleOutDetailText(row) {
	const total = resolveSaleOutBottleCount(row)
	const previewList = Array.isArray(row?.out_bottles_preview) ? row.out_bottles_preview : []
	return formatSaleBottlePreviewText(previewList, total, Boolean(row?.out_bottles_truncated))
}

function resolveSaleBackDetailText(row) {
	const total = resolveSaleBackBottleCount(row)
	const previewList = Array.isArray(row?.back_bottles_preview) ? row.back_bottles_preview : []
	return formatSaleBottlePreviewText(previewList, total, Boolean(row?.back_bottles_truncated))
}

function resolveSaleDepositDetailText(row) {
	const previewList = Array.isArray(row?.deposit_balance_bottles_preview)
		? row.deposit_balance_bottles_preview
			.map((item) => normalizeString(item).toUpperCase())
			.filter(Boolean)
		: []
	if (!previewList.length) return ''
	const total = resolveSaleDepositBalanceCount(row)
	const truncated = Boolean(row?.deposit_balance_bottles_truncated) || total > previewList.length
	const text = previewList.join('、')
	if (truncated) return `${text} 等${total}只`
	return text
}

function todayYmd() {
	const d = new Date()
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function currentMonthRange() {
	const d = new Date()
	const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
	return {
		dateFrom: start,
		dateTo: todayYmd()
	}
}

function currentYearRange() {
	const d = new Date()
	const start = `${d.getFullYear()}-01-01`
	return {
		dateFrom: start,
		dateTo: todayYmd()
	}
}

function onOperationTabChange(value) {
	const next = normalizeString(value)
	if (!operationTabs.some((item) => item.value === next)) return
	activeOperationTab.value = next
}

function toggleOpeningDebtRecent() {
	openingDebtRecentExpanded.value = !openingDebtRecentExpanded.value
}

function toggleOtherFeeRecent() {
	otherFeeRecentExpanded.value = !otherFeeRecentExpanded.value
}

function toggleReceiptRecent() {
	receiptRecentExpanded.value = !receiptRecentExpanded.value
}

function resetReceiptForm() {
	editingReceiptId.value = ''
	editingReceiptSourceType.value = ''
	const today = todayYmd()
	receiptForm.amount = ''
	receiptForm.roundingAmount = ''
	receiptForm.note = ''
	receiptForm.bizDate = today
	receiptForm.allocationMode = 'period'
	receiptForm.allocationStartDate = today
	receiptForm.allocationEndDate = today
	receiptForm.paymentMethod = 'cash'
	checkedAllocationTargetKeys.value = []
	previewPlan.value = null
	editableAllocations.value = []
}

function isAllocationTargetChecked(key) {
	const text = normalizeString(key)
	if (!text) return false
	return checkedAllocationTargetKeys.value.includes(text)
}

function isOffsetAllocationTargetChecked(key) {
	const text = normalizeString(key)
	if (!text) return false
	return offsetCheckedTargetKeys.value.includes(text)
}

function onCheckedTargetsChange(e) {
	const values = Array.isArray(e?.detail?.value) ? e.detail.value : []
	const normalized = values.map((item) => normalizeString(item)).filter(Boolean)
	checkedAllocationTargetKeys.value = Array.from(new Set(normalized))
	previewPlan.value = null
	editableAllocations.value = []
}

function onOffsetCheckedTargetsChange(e) {
	const values = Array.isArray(e?.detail?.value) ? e.detail.value : []
	const normalized = values.map((item) => normalizeString(item)).filter(Boolean)
	offsetCheckedTargetKeys.value = Array.from(new Set(normalized))
}

function onOffsetAllocationModeChange(e) {
	const idx = Number(e?.detail?.value)
	const item = offsetAllocationModeOptions[idx]
	const nextMode = normalizeReceiptAllocationMode(item?.value)
	offsetAllocateForm.allocationMode = nextMode
	if (nextMode === 'checked') {
		offsetAllocateForm.allocationStartDate = ''
		offsetAllocateForm.allocationEndDate = ''
		return
	}
	const selectedRows = Array.isArray(selectedOffsetReceipts.value) ? selectedOffsetReceipts.value : []
	const dates = selectedRows
		.map((row) => normalizeDate(row?.source_sale_date) || normalizeDate(row?.biz_date))
		.filter(Boolean)
		.sort()
	const fallbackStart = dates[0] || todayYmd()
	const fallbackEnd = dates[dates.length - 1] || fallbackStart
	if (!offsetAllocateForm.allocationStartDate) offsetAllocateForm.allocationStartDate = fallbackStart
	if (!offsetAllocateForm.allocationEndDate) offsetAllocateForm.allocationEndDate = fallbackEnd
}

function onReceiptAllocationModeChange(e) {
	const idx = Number(e?.detail?.value)
	const item = receiptAllocationModeOptions[idx]
	const nextMode = normalizeReceiptAllocationMode(item?.value)
	receiptForm.allocationMode = nextMode
	previewPlan.value = null
	editableAllocations.value = []
	if (nextMode === 'checked') {
		receiptForm.allocationStartDate = ''
		receiptForm.allocationEndDate = ''
		return
	}
	if (!receiptForm.allocationStartDate) receiptForm.allocationStartDate = receiptForm.bizDate || todayYmd()
	if (!receiptForm.allocationEndDate) receiptForm.allocationEndDate = receiptForm.bizDate || todayYmd()
	checkedAllocationTargetKeys.value = []
}

function parseAllocationTargetKeys(keys = []) {
	return keys
		.map((key) => normalizeString(key))
		.filter(Boolean)
		.map((key) => {
			const parts = key.split(':')
			if (parts.length < 2) return null
			const rawType = normalizeString(parts[0])
			const targetType = rawType === 'flow_settlement' || rawType === 'opening_debt' || rawType === 'other_fee'
				? rawType
				: 'sale'
			const targetId = parts.slice(1).join(':')
			if (!targetId) return null
			return {
				target_type: targetType,
				target_id: targetId
			}
		})
		.filter(Boolean)
}

function buildCheckedAllocationTargets() {
	const keys = Array.isArray(checkedAllocationTargetKeys.value) ? checkedAllocationTargetKeys.value : []
	return parseAllocationTargetKeys(keys)
}

function buildOffsetAllocationTargets() {
	const keys = Array.isArray(offsetCheckedTargetKeys.value) ? offsetCheckedTargetKeys.value : []
	return parseAllocationTargetKeys(keys)
}

function validateOffsetAllocationRange() {
	const start = normalizeString(offsetAllocateForm.allocationStartDate)
	const end = normalizeString(offsetAllocateForm.allocationEndDate)
	if (!start || !end) {
		uni.showToast({ title: '请选择冲抵开始/结束日期', icon: 'none' })
		return null
	}
	if (start > end) {
		uni.showToast({ title: '冲抵开始日期不能晚于结束日期', icon: 'none' })
		return null
	}
	return { start, end }
}

function buildOffsetAllocationPayload() {
	const mode = normalizeReceiptAllocationMode(offsetAllocateForm.allocationMode)
	if (mode === 'period') {
		const range = validateOffsetAllocationRange()
		if (!range) return null
		return {
			allocationMode: 'period',
			allocationStartDate: range.start,
			allocationEndDate: range.end,
			allocationTargets: []
		}
	}
	const targets = buildOffsetAllocationTargets()
	if (!targets.length) {
		uni.showToast({ title: '请先勾选冲抵目标', icon: 'none' })
		return null
	}
	return {
		allocationMode: 'checked',
		allocationStartDate: '',
		allocationEndDate: '',
		allocationTargets: targets
	}
}

function buildReceiptAllocationPayload() {
	const mode = normalizeReceiptAllocationMode(receiptForm.allocationMode)
	if (mode === 'period') {
		const range = validateReceiptAllocationRange()
		if (!range) return null
		return {
			allocationMode: 'period',
			allocationStartDate: range.start,
			allocationEndDate: range.end,
			allocationTargets: []
		}
	}
	const targets = buildCheckedAllocationTargets()
	if (!targets.length) {
		uni.showToast({ title: '请先勾选待分配单据', icon: 'none' })
		return null
	}
	return {
		allocationMode: 'checked',
		allocationStartDate: '',
		allocationEndDate: '',
		allocationTargets: targets
	}
}

function applyQuickReceiveScene() {
	if (quickSceneApplied.value) return
	if (normalizeString(scene.value) !== 'quickReceive') return
	const targetSaleId = normalizeString(saleId.value)
	if (!targetSaleId) return
	activeOperationTab.value = 'receipt'
	receiptForm.allocationMode = 'checked'
	receiptForm.allocationStartDate = ''
	receiptForm.allocationEndDate = ''
	checkedAllocationTargetKeys.value = [`sale:${targetSaleId}`]
	if (!receiptForm.bizDate) receiptForm.bizDate = todayYmd()
	quickSceneApplied.value = true
}

function resetPrepayForm() {
	const today = todayYmd()
	prepayForm.amount = ''
	prepayForm.bizDate = today
	prepayForm.paymentMethod = 'cash'
	prepayForm.applyStrategy = 'hold_only'
	prepayForm.allocationStartDate = today
	prepayForm.allocationEndDate = today
	prepayForm.note = ''
}

function resetOffsetEntryForm() {
	const today = todayYmd()
	offsetEntryForm.amount = ''
	offsetEntryForm.bizDate = today
	offsetEntryForm.paymentMethod = 'cash'
	offsetEntryForm.note = ''
}

function validateReceiptAllocationRange() {
	const start = normalizeString(receiptForm.allocationStartDate)
	const end = normalizeString(receiptForm.allocationEndDate)
	if (!start || !end) {
		uni.showToast({ title: '请选择分配开始/结束日期', icon: 'none' })
		return null
	}
	if (start > end) {
		uni.showToast({ title: '分配开始日期不能晚于结束日期', icon: 'none' })
		return null
	}
	return { start, end }
}

function validatePrepayAllocationRange() {
	const start = normalizeString(prepayForm.allocationStartDate)
	const end = normalizeString(prepayForm.allocationEndDate)
	if (!start || !end) {
		uni.showToast({ title: '请选择预付分配开始/结束日期', icon: 'none' })
		return null
	}
	if (start > end) {
		uni.showToast({ title: '预付分配开始日期不能晚于结束日期', icon: 'none' })
		return null
	}
	return { start, end }
}

function syncFlowFormDefaults() {
	if (!flowForm.bizDate) flowForm.bizDate = todayYmd()
	if (!normalizeString(flowForm.flowIndexPrev) && latestFlowIndexCurr.value != null) {
		flowForm.flowIndexPrev = formatFlowInput(latestFlowIndexCurr.value)
	}
}

function resetFlowForm(options = {}) {
	editingFlowSettlementId.value = ''
	const preservePrev = options.preservePrev !== false
	flowForm.bizDate = todayYmd()
	flowForm.flowIndexPrev = preservePrev && latestFlowIndexCurr.value != null ? formatFlowInput(latestFlowIndexCurr.value) : ''
	flowForm.flowIndexCurr = ''
	flowForm.flowTheoryRatio = ''
	flowForm.note = ''
	flowPreview.value = null
}

function resetOpeningDebtForm() {
	editingOpeningDebtId.value = ''
	openingDebtForm.amount = ''
	openingDebtForm.bizDate = todayYmd()
	openingDebtForm.note = ''
}

function resetOtherFeeForm() {
	editingOtherFeeId.value = ''
	otherFeeForm.amount = ''
	otherFeeForm.bizDate = todayYmd()
	otherFeeForm.note = ''
}

function dedupeOffsetSourceRows(rows = []) {
	const map = new Map()
	for (const row of Array.isArray(rows) ? rows : []) {
		const id = normalizeString(row?._id)
		if (!id) continue
		map.set(id, { ...row, _id: id })
	}
	return Array.from(map.values())
}

function isOffsetSourceSelected(row) {
	const id = normalizeString(row?._id)
	if (!id) return false
	return selectedOffsetReceiptIds.value.includes(id)
}

function syncOffsetAmountWithAvailable({ force = false } = {}) {
	const total = selectedOffsetReceiptAvailableTotal.value
	if (!force) {
		const current = Number(offsetAllocateForm.amount)
		if (Number.isFinite(current) && current > total) {
			offsetAllocateForm.amount = total > 0 ? formatMoney(total) : ''
			return
		}
		if (normalizeString(offsetAllocateForm.amount)) return
	}
	offsetAllocateForm.amount = total > 0 ? formatMoney(total) : ''
}

function resetOffsetAllocateForm(options = {}) {
	const keepSelection = Boolean(options.keepSelection)
	if (!keepSelection) {
		selectedOffsetReceipts.value = []
	}
	const today = todayYmd()
	offsetAllocateForm.amount = ''
	offsetAllocateForm.allocationMode = 'checked'
	offsetAllocateForm.allocationStartDate = today
	offsetAllocateForm.allocationEndDate = today
	offsetCheckedTargetKeys.value = []
	syncOffsetAmountWithAvailable({ force: true })
}

function onToggleOffsetReceipt(row) {
	const receiptId = normalizeString(row?._id)
	if (!receiptId) return
	if (isOffsetSourceSelected(row)) {
		selectedOffsetReceipts.value = selectedOffsetReceipts.value.filter((item) => normalizeString(item?._id) !== receiptId)
		syncOffsetAmountWithAvailable({ force: true })
		return
	}
	selectedOffsetReceipts.value = dedupeOffsetSourceRows([...selectedOffsetReceipts.value, row])
	offsetCheckedTargetKeys.value = []
	if (normalizeReceiptAllocationMode(offsetAllocateForm.allocationMode) === 'period') {
		const sourceDate = normalizeDate(row?.source_sale_date) || normalizeDate(row?.biz_date)
		if (sourceDate) {
			if (!offsetAllocateForm.allocationStartDate || offsetAllocateForm.allocationStartDate > sourceDate) {
				offsetAllocateForm.allocationStartDate = sourceDate
			}
			if (!offsetAllocateForm.allocationEndDate || offsetAllocateForm.allocationEndDate < sourceDate) {
				offsetAllocateForm.allocationEndDate = sourceDate
			}
		}
	}
	syncOffsetAmountWithAvailable({ force: true })
}

function cancelOpeningDebtEditing() {
	resetOpeningDebtForm()
}

function onEditOpeningDebt(row) {
	const debtId = normalizeString(row?._id)
	if (!debtId) return
	activeOperationTab.value = 'opening_debt'
	editingOpeningDebtId.value = debtId
	openingDebtForm.amount = formatMoney(row?.amount)
	openingDebtForm.bizDate = normalizeDate(row?.biz_date) || todayYmd()
	openingDebtForm.note = normalizeString(row?.note)
	uni.showToast({ title: '已加载历史欠款，修改后点保存欠款', icon: 'none' })
}

async function onRemoveOpeningDebt(row) {
	const debtId = normalizeString(row?._id)
	if (!debtId || !recordId.value) return
	const confirmed = await showConfirmModal({
		title: '删除历史欠款',
		content: '删除后将回退该笔历史欠款，确认继续吗？',
		confirmText: '删除'
	})
	if (!confirmed) return
	const res = await removeOpeningDebtEntryV1({
		openingDebtId: debtId,
		customerId: recordId.value
	})
	if (res?.code !== 0) {
		uni.showToast({ title: res?.msg || '删除失败', icon: 'none' })
		return
	}
	if (normalizeString(editingOpeningDebtId.value) === debtId) resetOpeningDebtForm()
	uni.showToast({ title: res?.msg || '历史欠款已删除', icon: 'success' })
	await refreshAll()
}

async function onCreateOpeningDebtEntry() {
	if (!recordId.value || openingDebtSubmitting.value) return
	const amount = Number(openingDebtForm.amount)
	if (!Number.isFinite(amount) || amount <= 0) {
		uni.showToast({ title: '请输入大于0的欠款金额', icon: 'none' })
		return
	}
	openingDebtSubmitting.value = true
	try {
		const isEditing = isEditingOpeningDebt.value
		const res = isEditing
			? await updateOpeningDebtEntryV1({
				openingDebtId: editingOpeningDebtId.value,
				customerId: recordId.value,
				amount,
				bizDate: openingDebtForm.bizDate,
				note: openingDebtForm.note,
				sourceType: 'customer_opening_debt_manual'
			})
			: await createOpeningDebtEntryV1({
				customerId: recordId.value,
				amount,
				bizDate: openingDebtForm.bizDate,
				note: openingDebtForm.note,
				sourceType: 'customer_opening_debt_manual'
			})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || (isEditing ? '保存失败' : '登记失败'), icon: 'none' })
			return
		}
		uni.showToast({ title: res?.msg || (isEditing ? '历史欠款已保存' : '历史欠款已登记'), icon: 'success' })
		resetOpeningDebtForm()
		await refreshAll()
	} finally {
		openingDebtSubmitting.value = false
	}
}

function cancelOtherFeeEditing() {
	resetOtherFeeForm()
}

function onEditOtherFee(row) {
	const otherFeeId = normalizeString(row?._id)
	if (!otherFeeId) return
	activeOperationTab.value = 'other_fee'
	editingOtherFeeId.value = otherFeeId
	otherFeeForm.amount = formatMoney(row?.amount)
	otherFeeForm.bizDate = normalizeDate(row?.biz_date) || todayYmd()
	otherFeeForm.note = normalizeString(row?.note)
	uni.showToast({ title: '已加载其他费用，修改后点保存费用', icon: 'none' })
}

async function onRemoveOtherFee(row) {
	const otherFeeId = normalizeString(row?._id)
	if (!otherFeeId || !recordId.value) return
	const confirmed = await showConfirmModal({
		title: '删除其他费用',
		content: '删除后将回退该笔其他费用，确认继续吗？',
		confirmText: '删除'
	})
	if (!confirmed) return
	const res = await removeOtherFeeEntryV1({
		otherFeeId,
		customerId: recordId.value
	})
	if (res?.code !== 0) {
		uni.showToast({ title: res?.msg || '删除失败', icon: 'none' })
		return
	}
	if (normalizeString(editingOtherFeeId.value) === otherFeeId) resetOtherFeeForm()
	uni.showToast({ title: res?.msg || '其他费用已删除', icon: 'success' })
	await refreshAll()
}

async function onCreateOtherFeeEntry() {
	if (!recordId.value || otherFeeSubmitting.value) return
	const amount = Number(otherFeeForm.amount)
	if (!Number.isFinite(amount) || amount <= 0) {
		uni.showToast({ title: '请输入大于0的费用金额', icon: 'none' })
		return
	}
	otherFeeSubmitting.value = true
	try {
		const isEditing = isEditingOtherFee.value
		const res = isEditing
			? await updateOtherFeeEntryV1({
				otherFeeId: editingOtherFeeId.value,
				customerId: recordId.value,
				amount,
				bizDate: otherFeeForm.bizDate,
				note: otherFeeForm.note,
				sourceType: 'customer_other_fee_manual'
			})
			: await createOtherFeeEntryV1({
				customerId: recordId.value,
				amount,
				bizDate: otherFeeForm.bizDate,
				note: otherFeeForm.note,
				sourceType: 'customer_other_fee_manual'
			})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || (isEditing ? '保存失败' : '登记失败'), icon: 'none' })
			return
		}
		uni.showToast({ title: res?.msg || (isEditing ? '其他费用已保存' : '其他费用已登记'), icon: 'success' })
		resetOtherFeeForm()
		await refreshAll()
	} finally {
		otherFeeSubmitting.value = false
	}
}

function syncAnalysisFilterDefaults(force = false) {
	if (customerPriceUnit.value !== 'kg') return
	if (!force && analysisFilters.dateFrom && analysisFilters.dateTo) return
	const range = currentMonthRange()
	analysisFilters.dateFrom = range.dateFrom
	analysisFilters.dateTo = range.dateTo
	syncAnalysisDatePreset()
}

function syncRowsFilterDefaults(force = false) {
	if (!force && rowFilters.dateFrom && rowFilters.dateTo) return
	const range = currentYearRange()
	rowFilters.dateFrom = range.dateFrom
	rowFilters.dateTo = range.dateTo
	syncRowsDatePreset()
}

function buildStatementSummaryScopeParams() {
	const dateFrom = normalizeDate(rowFilters.dateFrom)
	const dateTo = normalizeDate(rowFilters.dateTo)
	if (!dateFrom || !dateTo || dateFrom > dateTo) return { summaryDateFrom: '', summaryDateTo: '' }
	return { summaryDateFrom: dateFrom, summaryDateTo: dateTo }
}

function applyStatementSummary(data = {}) {
	const nextSummary = data.summary || {}
	summary.receivable_balance = toNumber(nextSummary.receivable_balance, 0)
	summary.prepay_balance = toNumber(nextSummary.prepay_balance, 0)
	summary.prepay_manual_balance = toNumber(nextSummary.prepay_manual_balance, 0)
	summary.offset_credit_balance = toNumber(
		nextSummary.offset_credit_balance,
		Math.max(toNumber(nextSummary.prepay_balance, 0) - toNumber(nextSummary.prepay_manual_balance, 0), 0)
	)
	summary.net_balance = toNumber(nextSummary.net_balance, 0)
	summary.should_receive_total = toNumber(nextSummary.should_receive_total, 0)
	summary.amount_received_total = toNumber(nextSummary.amount_received_total, 0)
	summary.last_receipt_at = nextSummary.last_receipt_at == null ? null : Number(nextSummary.last_receipt_at) || null

	const nextScope = data.summary_scope || {}
	const dateFrom = normalizeDate(nextScope.date_from)
	const dateTo = normalizeDate(nextScope.date_to)
	if (dateFrom && dateTo && dateFrom <= dateTo) {
		summaryScope.date_from = dateFrom
		summaryScope.date_to = dateTo
		summaryScope.receivable_balance = toNumber(nextScope.receivable_balance, toNumber(nextSummary.receivable_balance, 0))
		summaryScope.prepay_balance = toNumber(nextScope.prepay_balance, toNumber(nextSummary.prepay_balance, 0))
		summaryScope.prepay_manual_balance = toNumber(
			nextScope.prepay_manual_balance,
			toNumber(nextSummary.prepay_manual_balance, 0)
		)
		summaryScope.offset_credit_balance = toNumber(
			nextScope.offset_credit_balance,
			Math.max(
				toNumber(nextScope.prepay_balance, toNumber(nextSummary.prepay_balance, 0))
					- toNumber(nextScope.prepay_manual_balance, toNumber(nextSummary.prepay_manual_balance, 0)),
				0
			)
		)
		summaryScope.net_balance = toNumber(nextScope.net_balance, toNumber(nextSummary.net_balance, 0))
		summaryScope.should_receive_total = toNumber(nextScope.should_receive_total, 0)
		summaryScope.amount_received_total = toNumber(nextScope.amount_received_total, 0)
		summaryScope.last_receipt_at = nextScope.last_receipt_at == null
			? (nextSummary.last_receipt_at == null ? null : Number(nextSummary.last_receipt_at) || null)
			: Number(nextScope.last_receipt_at) || null
	} else {
		summaryScope.date_from = ''
		summaryScope.date_to = ''
		summaryScope.receivable_balance = 0
		summaryScope.prepay_balance = 0
		summaryScope.prepay_manual_balance = 0
		summaryScope.offset_credit_balance = 0
		summaryScope.net_balance = 0
		summaryScope.should_receive_total = 0
		summaryScope.amount_received_total = 0
		summaryScope.last_receipt_at = null
	}
}

async function loadStatement({ summaryOnly = false } = {}) {
	if (!recordId.value) return
	if (!summaryOnly) loading.value = true
	try {
		const summaryScopeParams = buildStatementSummaryScopeParams()
		const res = await getCustomerStatementV1({
			customerId: recordId.value,
			summaryDateFrom: summaryScopeParams.summaryDateFrom,
			summaryDateTo: summaryScopeParams.summaryDateTo,
			summaryOnly
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '加载失败', icon: 'none' })
			return
		}
		const data = res?.data || {}
		customer.value = data.customer || customer.value || {}
		applyStatementSummary(data)
		if (summaryOnly) return
		recentSales.value = Array.isArray(data.recent_sales) ? data.recent_sales : []
		recentReceipts.value = Array.isArray(data.recent_receipts) ? data.recent_receipts : []
		recentFlowSettlements.value = Array.isArray(data.recent_flow_settlements) ? data.recent_flow_settlements : []
		recentOpeningDebts.value = Array.isArray(data.recent_opening_debts) ? data.recent_opening_debts : []
		recentOtherFees.value = Array.isArray(data.recent_other_fees) ? data.recent_other_fees : []
		syncFlowFormDefaults()
		syncAnalysisFilterDefaults()
	} finally {
		if (!summaryOnly) loading.value = false
	}
}

async function loadAnalysis() {
	if (!recordId.value) return
	if (customerPriceUnit.value === 'kg' && (!analysisFilters.dateFrom || !analysisFilters.dateTo)) {
		analysis.customer_price_unit = 'kg'
		analysis.requires_date_range = true
		analysis.kg_loss_weight = null
		analysis.bottle_reference_weight = 0
		analysis.bottle_reference_amount = null
		analysis.bottle_reference_gap = null
		analysis.bottle_should_receive_total = 0
		return
	}
	analysisLoading.value = true
	try {
		const res = await getCustomerStatementAnalysisV1({
			customerId: recordId.value,
			dateFrom: analysisFilters.dateFrom,
			dateTo: analysisFilters.dateTo,
			bottleReferencePrice: bottleReferencePrice.value
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '经营分析加载失败', icon: 'none' })
			analysis.customer_price_unit = normalizeString(customer.value?.default_price_unit) || 'kg'
			analysis.requires_date_range = false
			analysis.kg_loss_weight = 0
			analysis.bottle_reference_weight = 0
			analysis.bottle_reference_amount = null
			analysis.bottle_reference_gap = null
			analysis.bottle_should_receive_total = 0
			return
		}
		const data = res?.data || {}
		analysis.customer_price_unit = normalizeString(data.customer_price_unit) || 'kg'
		analysis.requires_date_range = Boolean(data.requires_date_range)
		analysis.kg_loss_weight = data.kg_loss_weight == null ? null : toNumber(data.kg_loss_weight, 0)
		analysis.bottle_reference_weight = toNumber(data.bottle_reference_weight, 0)
		analysis.bottle_reference_amount = data.bottle_reference_amount == null ? null : toNumber(data.bottle_reference_amount, 0)
		analysis.bottle_reference_gap = data.bottle_reference_gap == null ? null : toNumber(data.bottle_reference_gap, 0)
		analysis.bottle_should_receive_total = toNumber(data.bottle_should_receive_total, 0)
	} finally {
		analysisLoading.value = false
	}
}

async function loadRows() {
	if (!recordId.value) return
	rowsLoading.value = true
	try {
		const res = await listCustomerStatementRowsV1({
			customerId: recordId.value,
			dateFrom: rowFilters.dateFrom,
			dateTo: rowFilters.dateTo,
			page: rowsPager.page,
			pageSize: rowsPager.pageSize
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '流水加载失败', icon: 'none' })
			statementRows.value = []
			rowsPager.total = 0
			rowsPager.hasMore = false
			return
		}
		statementRows.value = Array.isArray(res.data) ? res.data : []
		const paging = res.paging || {}
		rowsPager.page = Number(paging.page || rowsPager.page || 1)
		rowsPager.pageSize = Number(paging.pageSize || rowsPager.pageSize || 50)
		rowsPager.total = Number(paging.total || res.total || 0)
		rowsPager.hasMore = Boolean(paging.hasMore)
	} finally {
		rowsLoading.value = false
	}
}

async function loadOffsetCreditPool(reset = false) {
	if (!recordId.value) return
	if (reset) offsetPoolPager.page = 1
	offsetPoolLoading.value = true
	try {
		const res = await listOffsetCreditPoolV1({
			customerId: recordId.value,
			onlyUnallocated: true,
			page: offsetPoolPager.page,
			pageSize: offsetPoolPager.pageSize
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '冲抵来源加载失败', icon: 'none' })
			offsetPoolRows.value = []
			offsetPoolPager.total = 0
			offsetPoolPager.hasMore = false
			return
		}
		offsetPoolRows.value = Array.isArray(res.data) ? res.data : []
		const paging = res.paging || {}
		offsetPoolPager.page = Number(paging.page || offsetPoolPager.page || 1)
		offsetPoolPager.pageSize = Number(paging.pageSize || offsetPoolPager.pageSize || 10)
		offsetPoolPager.total = Number(paging.total || res.total || 0)
		offsetPoolPager.hasMore = Boolean(paging.hasMore)
		const selectedMap = new Map(
			(Array.isArray(selectedOffsetReceipts.value) ? selectedOffsetReceipts.value : [])
				.map((row) => [normalizeString(row?._id), row])
				.filter((entry) => Boolean(entry[0]))
		)
		for (const row of offsetPoolRows.value) {
			const id = normalizeString(row?._id)
			if (id && selectedMap.has(id)) selectedMap.set(id, { ...row })
		}
		selectedOffsetReceipts.value = dedupeOffsetSourceRows(Array.from(selectedMap.values()))
			.filter((row) => toNumber(row?.unallocated_amount, 0) > 0)
		if (offsetPoolPager.total <= 0) selectedOffsetReceipts.value = []
		syncOffsetAmountWithAvailable()
	} finally {
		offsetPoolLoading.value = false
	}
}

async function refreshAll() {
	syncRowsFilterDefaults()
	await loadStatement()
	await Promise.all([loadRows(), loadAnalysis(), loadOffsetCreditPool()])
}

function onOffsetPoolPrev() {
	if (offsetPoolPager.page <= 1) return
	offsetPoolPager.page -= 1
	loadOffsetCreditPool()
}

function onOffsetPoolNext() {
	if (!offsetPoolPager.hasMore) return
	offsetPoolPager.page += 1
	loadOffsetCreditPool()
}

async function searchAnalysis() {
	await loadAnalysis()
}

async function onPreviewFlowSettlement() {
	if (!recordId.value || flowPreviewLoading.value) return
	flowPreviewLoading.value = true
	try {
		const res = await previewFlowSettlementV1({
			customerId: recordId.value,
			bizDate: flowForm.bizDate,
			flowIndexPrev: flowForm.flowIndexPrev,
			flowIndexCurr: flowForm.flowIndexCurr,
			flowTheoryRatio: flowForm.flowTheoryRatio,
			note: flowForm.note
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '预览失败', icon: 'none' })
			return
		}
		flowPreview.value = res?.data || null
	} finally {
		flowPreviewLoading.value = false
	}
}

async function onCreateFlowSettlement() {
	if (!recordId.value || flowSubmitting.value) return
	flowSubmitting.value = true
	try {
		const isEditing = isEditingFlowSettlement.value
		const res = isEditing
			? await updateFlowSettlementV1({
				flowSettlementId: editingFlowSettlementId.value,
				customerId: recordId.value,
				bizDate: flowForm.bizDate,
				flowIndexPrev: flowForm.flowIndexPrev,
				flowIndexCurr: flowForm.flowIndexCurr,
				flowTheoryRatio: flowForm.flowTheoryRatio,
				note: flowForm.note
			})
			: await createFlowSettlementV1({
				customerId: recordId.value,
				bizDate: flowForm.bizDate,
				flowIndexPrev: flowForm.flowIndexPrev,
				flowIndexCurr: flowForm.flowIndexCurr,
				flowTheoryRatio: flowForm.flowTheoryRatio,
				note: flowForm.note
			})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || (isEditing ? '保存结算单失败' : '生成结算单失败'), icon: 'none' })
			return
		}
		uni.showToast({ title: res?.msg || (isEditing ? '流量结算单已保存' : '流量结算单已创建'), icon: 'success' })
		const nextPrev = toNullableNumber(res?.data?.flow_index_curr)
		resetFlowForm({ preservePrev: false })
		if (nextPrev != null) flowForm.flowIndexPrev = formatFlowInput(nextPrev)
		await refreshAll()
	} finally {
		flowSubmitting.value = false
	}
}

function cancelFlowEditing() {
	resetFlowForm()
}

function onEditFlowSettlement(row) {
	const flowId = normalizeString(row?._id)
	if (!flowId) return
	editingFlowSettlementId.value = flowId
	flowForm.bizDate = normalizeDate(row?.biz_date) || todayYmd()
	flowForm.flowIndexPrev = formatFlowInput(row?.flow_index_prev)
	flowForm.flowIndexCurr = formatFlowInput(row?.flow_index_curr)
	flowForm.flowTheoryRatio = row?.flow_theory_ratio == null ? '' : String(row.flow_theory_ratio)
	flowForm.note = normalizeString(row?.note)
	flowPreview.value = null
	uni.showToast({ title: '已加载结算单，修改后点保存结算单', icon: 'none' })
}

async function onRemoveFlowSettlement(row) {
	const flowId = normalizeString(row?._id)
	if (!flowId || !recordId.value) return
	const confirmed = await showConfirmModal({
		title: '删除流量结算单',
		content: '删除后会从对账中移除该结算单，确认继续吗？',
		confirmText: '删除'
	})
	if (!confirmed) return
	const res = await removeFlowSettlementV1({
		flowSettlementId: flowId,
		customerId: recordId.value
	})
	if (res?.code !== 0) {
		uni.showToast({ title: res?.msg || '删除失败', icon: 'none' })
		return
	}
	if (normalizeString(editingFlowSettlementId.value) === flowId) resetFlowForm()
	uni.showToast({ title: res?.msg || '流量结算单已删除', icon: 'success' })
	await refreshAll()
}

async function onPreview() {
	if (!recordId.value || previewing.value) return
	const amount = receiptForm.amount === '' ? 0 : Number(receiptForm.amount)
	const roundingAmount = receiptForm.roundingAmount === '' ? 0 : Number(receiptForm.roundingAmount)
	if (!Number.isFinite(amount) || amount < 0) {
		uni.showToast({ title: '收款金额不能小于0', icon: 'none' })
		return
	}
	if (!Number.isFinite(roundingAmount) || roundingAmount < 0) {
		uni.showToast({ title: '抹零金额不能小于0', icon: 'none' })
		return
	}
	if (!(amount > 0 || roundingAmount > 0)) {
		uni.showToast({ title: '收款金额和抹零金额不能同时为0', icon: 'none' })
		return
	}
	const allocationPayload = buildReceiptAllocationPayload()
	if (!allocationPayload) return
	previewing.value = true
	try {
		const res = await previewAllocationV1({
			customerId: recordId.value,
			amount,
			roundingAmount,
			allocationMode: allocationPayload.allocationMode,
			allocationStartDate: allocationPayload.allocationStartDate,
			allocationEndDate: allocationPayload.allocationEndDate,
			allocationTargets: allocationPayload.allocationTargets
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '预览失败', icon: 'none' })
			return
		}
		previewPlan.value = res.data || null
		const alloc = Array.isArray(res?.data?.allocations) ? res.data.allocations : []
		editableAllocations.value = alloc.map((item) => {
			const targetType = normalizeString(item.target_type) || 'sale'
			const targetId = normalizeString(item.target_id || item.sale_id)
			return {
				key: `${targetType}:${targetId}`,
				targetType,
				targetId,
				targetTitle: normalizeString(item.target_title) || `${normalizeString(item.sale_date)} / ${String(targetId).slice(-6)}`,
				outstandingBefore: toNumber(item.outstanding_before, 0),
				allocateAmount: formatMoney(item.allocate_amount)
			}
		})
	} finally {
		previewing.value = false
	}
}

function buildManualAllocations() {
	return editableAllocations.value
		.map((item) => ({
			target_type: item.targetType,
			target_id: item.targetId,
			allocate_amount: Number(item.allocateAmount)
		}))
		.filter((item) => Number.isFinite(item.allocate_amount) && item.allocate_amount > 0)
}

async function onCreateAutoReceipt() {
	if (!recordId.value || submitting.value) return
	const amount = receiptForm.amount === '' ? 0 : Number(receiptForm.amount)
	const roundingAmount = receiptForm.roundingAmount === '' ? 0 : Number(receiptForm.roundingAmount)
	if (!Number.isFinite(amount) || amount < 0) {
		uni.showToast({ title: '收款金额不能小于0', icon: 'none' })
		return
	}
	if (!Number.isFinite(roundingAmount) || roundingAmount < 0) {
		uni.showToast({ title: '抹零金额不能小于0', icon: 'none' })
		return
	}
	if (!(amount > 0 || roundingAmount > 0)) {
		uni.showToast({ title: '收款金额和抹零金额不能同时为0', icon: 'none' })
		return
	}
	const allocationPayload = buildReceiptAllocationPayload()
	if (!allocationPayload) return
	submitting.value = true
	try {
		const isEditing = isEditingReceipt.value
		const res = isEditing
			? await updateReceiptV1({
				receiptId: editingReceiptId.value,
				customerId: recordId.value,
				amount,
				roundingAmount,
				bizDate: receiptForm.bizDate,
				allocationMode: allocationPayload.allocationMode,
				allocationStartDate: allocationPayload.allocationStartDate,
				allocationEndDate: allocationPayload.allocationEndDate,
				allocationTargets: allocationPayload.allocationTargets,
				paymentMethod: receiptForm.paymentMethod,
				note: receiptForm.note
			})
			: await createReceiptV1({
				customerId: recordId.value,
				amount,
				roundingAmount,
				bizDate: receiptForm.bizDate,
				allocationMode: allocationPayload.allocationMode,
				allocationStartDate: allocationPayload.allocationStartDate,
				allocationEndDate: allocationPayload.allocationEndDate,
				allocationTargets: allocationPayload.allocationTargets,
				paymentMethod: receiptForm.paymentMethod,
				note: receiptForm.note,
				sourceType: 'customer_statement'
			})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || (isEditing ? '保存失败' : '登记失败'), icon: 'none' })
			return
		}
		uni.showToast({ title: res?.msg || (isEditing ? '收款单已保存' : '登记成功'), icon: 'success' })
		resetReceiptForm()
		await refreshAll()
	} finally {
		submitting.value = false
	}
}

function cancelReceiptEditing() {
	resetReceiptForm()
}

function onEditReceipt(row) {
	const receiptId = normalizeString(row?._id)
	if (!receiptId) return
	activeOperationTab.value = 'receipt'
	editingReceiptId.value = receiptId
	editingReceiptSourceType.value = normalizeString(row?.source_type || row?.meta?.source_type)
	receiptForm.amount = formatMoney(row?.amount)
	const roundingAmount = toNumber(row?.rounding_amount, 0)
	receiptForm.roundingAmount = roundingAmount > 0 ? formatMoney(roundingAmount) : ''
	receiptForm.bizDate = normalizeDate(row?.biz_date) || todayYmd()
	receiptForm.paymentMethod = normalizeReceiptPaymentMethod(row?.payment_method)
	receiptForm.note = normalizeString(row?.note)
	const mode = normalizeReceiptAllocationMode(row?.allocation_mode)
	receiptForm.allocationMode = mode
	if (mode === 'checked') {
		receiptForm.allocationStartDate = ''
		receiptForm.allocationEndDate = ''
		const targets = Array.isArray(row?.allocation_targets) ? row.allocation_targets : []
		checkedAllocationTargetKeys.value = targets
			.map((item) => {
				const rawType = normalizeString(item?.target_type)
				const targetType = rawType === 'flow_settlement' || rawType === 'opening_debt' || rawType === 'other_fee'
					? rawType
					: 'sale'
				const targetId = normalizeString(item?.target_id)
				if (!targetId) return ''
				return `${targetType}:${targetId}`
			})
			.filter(Boolean)
	} else {
		receiptForm.allocationStartDate = normalizeDate(row?.allocation_start_date) || receiptForm.bizDate
		receiptForm.allocationEndDate = normalizeDate(row?.allocation_end_date) || receiptForm.bizDate
		checkedAllocationTargetKeys.value = []
	}
	previewPlan.value = null
	editableAllocations.value = []
	uni.showToast({
		title: isCashierReceiptRow(row) ? '已加载出纳收款单，仅可调整分配' : '已加载收款单，修改后点保存收款单',
		icon: 'none'
	})
}

async function onRemoveReceipt(row) {
	const receiptId = normalizeString(row?._id)
	if (!receiptId || !recordId.value) return
	if (isCashierReceiptRow(row)) {
		uni.showToast({ title: '出纳登记来源收款单请在出纳登记中作废处理', icon: 'none' })
		return
	}
	const confirmed = await showConfirmModal({
		title: '删除收款单',
		content: '删除后会回滚该收款单分配，确认继续吗？',
		confirmText: '删除'
	})
	if (!confirmed) return
	const res = await removeReceiptV1({
		receiptId,
		customerId: recordId.value
	})
	if (res?.code !== 0) {
		uni.showToast({ title: res?.msg || '删除失败', icon: 'none' })
		return
	}
	if (normalizeString(editingReceiptId.value) === receiptId) resetReceiptForm()
	uni.showToast({ title: res?.msg || '收款单已作废', icon: 'success' })
	await refreshAll()
}

async function onConfirmAllocation() {
	if (!recordId.value || confirming.value || !previewPlan.value) return
	const amount = receiptForm.amount === '' ? 0 : Number(receiptForm.amount)
	const roundingAmount = receiptForm.roundingAmount === '' ? 0 : Number(receiptForm.roundingAmount)
	if (!Number.isFinite(amount) || amount < 0) {
		uni.showToast({ title: '收款金额不能小于0', icon: 'none' })
		return
	}
	if (!Number.isFinite(roundingAmount) || roundingAmount < 0) {
		uni.showToast({ title: '抹零金额不能小于0', icon: 'none' })
		return
	}
	if (!(amount > 0 || roundingAmount > 0)) {
		uni.showToast({ title: '收款金额和抹零金额不能同时为0', icon: 'none' })
		return
	}
	const allocationPayload = buildReceiptAllocationPayload()
	if (!allocationPayload) return
	confirming.value = true
	try {
		const res = await confirmAllocationV1({
			customerId: recordId.value,
			amount,
			roundingAmount,
			bizDate: receiptForm.bizDate,
			allocationMode: allocationPayload.allocationMode,
			allocationStartDate: allocationPayload.allocationStartDate,
			allocationEndDate: allocationPayload.allocationEndDate,
			allocationTargets: allocationPayload.allocationTargets,
			paymentMethod: receiptForm.paymentMethod,
			note: receiptForm.note,
			sourceType: 'customer_statement_manual',
			allocations: buildManualAllocations()
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '确认入账失败', icon: 'none' })
			return
		}
		uni.showToast({ title: res?.msg || '确认入账成功', icon: 'success' })
		resetReceiptForm()
		await refreshAll()
	} finally {
		confirming.value = false
	}
}

async function onCreatePrepayEntry() {
	if (!recordId.value || prepaySubmitting.value) return
	const amount = Number(prepayForm.amount)
	if (!Number.isFinite(amount) || amount <= 0) {
		uni.showToast({ title: '请输入大于0的预付金额', icon: 'none' })
		return
	}
	const strategy = normalizePrepayApplyStrategy(prepayForm.applyStrategy)
	let range = null
	if (strategy === 'allocate_period') {
		range = validatePrepayAllocationRange()
		if (!range) return
	}
	prepaySubmitting.value = true
	try {
		const res = await createPrepayEntryV1({
			customerId: recordId.value,
			amount,
			bizDate: prepayForm.bizDate,
			paymentMethod: prepayForm.paymentMethod,
			note: prepayForm.note,
			applyStrategy: strategy,
			allocationMode: 'period',
			allocationStartDate: range?.start || '',
			allocationEndDate: range?.end || '',
			sourceType: 'customer_prepay_manual'
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '预付录入失败', icon: 'none' })
			return
		}
		uni.showToast({ title: res?.msg || '预付录入成功', icon: 'success' })
		resetPrepayForm()
		await refreshAll()
	} finally {
		prepaySubmitting.value = false
	}
}

async function onCreateOffsetEntry() {
	if (!recordId.value || offsetEntrySubmitting.value) return
	const amount = Number(offsetEntryForm.amount)
	if (!Number.isFinite(amount) || amount <= 0) {
		uni.showToast({ title: '请输入大于0的冲抵金额', icon: 'none' })
		return
	}
	offsetEntrySubmitting.value = true
	try {
		const res = await createPrepayEntryV1({
			customerId: recordId.value,
			amount,
			bizDate: offsetEntryForm.bizDate,
			paymentMethod: offsetEntryForm.paymentMethod,
			note: offsetEntryForm.note,
			applyStrategy: 'hold_only',
			entryKind: 'offset_credit',
			allocationMode: 'period',
			allocationStartDate: offsetEntryForm.bizDate,
			allocationEndDate: offsetEntryForm.bizDate,
			sourceType: 'customer_offset_credit_manual_compensation'
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '冲抵池录入失败', icon: 'none' })
			return
		}
		uni.showToast({ title: '冲抵池录入成功', icon: 'success' })
		resetOffsetEntryForm()
		await refreshAll()
		activeOperationTab.value = 'offset'
	} finally {
		offsetEntrySubmitting.value = false
	}
}

function resolveStatementExportRange() {
	const dateFrom = normalizeString(rowFilters.dateFrom)
	const dateTo = normalizeString(rowFilters.dateTo)
	if (!dateFrom || !dateTo) {
		uni.showToast({ title: '请先选择流水开始和结束日期', icon: 'none' })
		return null
	}
	if (dateFrom > dateTo) {
		uni.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' })
		return null
	}
	return { dateFrom, dateTo }
}

async function onExportStatement() {
	if (!recordId.value || exportingStatement.value) return
	const range = resolveStatementExportRange()
	if (!range) return
	exportingStatement.value = true
	uni.showLoading({ title: '正在导出...', mask: true })
	try {
		const res = await exportCustomerStatementV1({
			customerId: recordId.value,
			dateFrom: range.dateFrom,
			dateTo: range.dateTo
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '导出失败', icon: 'none' })
			return
		}
		const payload = res?.data || {}
		const workbookText = buildCustomerStatementWorkbookXml(payload)
		const fileName = buildCustomerStatementExportFileName(payload)
		const downloaded = await downloadWorkbookFile(workbookText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持导出，请联系管理员', icon: 'none', duration: 2800 })
			return
		}
		uni.showToast({ title: '对账单已导出', icon: 'success' })
	} finally {
		uni.hideLoading()
		exportingStatement.value = false
	}
}

async function onExportAccountingLedger() {
	if (!recordId.value || exportingAccountingLedger.value) return
	const range = resolveStatementExportRange()
	if (!range) return
	exportingAccountingLedger.value = true
	uni.showLoading({ title: '正在导出...', mask: true })
	try {
		const res = await exportCustomerAccountingLedgerV1({
			customerId: recordId.value,
			dateFrom: range.dateFrom,
			dateTo: range.dateTo
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '会计导出失败', icon: 'none' })
			return
		}
		const payload = res?.data || {}
		const workbookText = buildCustomerAccountingLedgerWorkbookXml(payload)
		const fileName = buildCustomerAccountingLedgerExportFileName(payload)
		const downloaded = await downloadWorkbookFile(workbookText, fileName)
		if (!downloaded) {
			uni.showToast({ title: '当前端暂不支持导出，请联系管理员', icon: 'none', duration: 2800 })
			return
		}
		uni.showToast({ title: '会计明细账已导出', icon: 'success' })
	} finally {
		uni.hideLoading()
		exportingAccountingLedger.value = false
	}
}

function onAllocationInput(key, value) {
	editableAllocations.value = editableAllocations.value.map((item) => {
		if (item.key !== key) return item
		return {
			...item,
			allocateAmount: String(value || '')
		}
	})
}

function statementRowTitle(row) {
	if (row?.row_type === 'receipt') return `收款单 ${row?.receipt_id || row?.row_id || ''}`
	if (row?.row_type === 'allocation') {
		const targetTitle = normalizeString(row?.meta?.target_title)
		if (targetTitle) return `分配到 ${targetTitle}`
		return `分配到销售单 ${row?.sale_id || ''}`
	}
	if (row?.row_type === 'flow_settlement') return `流量结算单 ${row?.row_id || ''}`
	if (row?.row_type === 'opening_debt') return `历史欠款 ${row?.row_id || ''}`
	if (row?.row_type === 'other_fee') return `其他费用 ${row?.row_id || ''}`
	return `销售单 ${row?.sale_id || row?.row_id || ''}`
}

function statementRowStatus(row) {
	if (row?.row_type === 'receipt') return '收款'
	if (row?.row_type === 'allocation') return '分配'
	if (row?.row_type === 'flow_settlement') return paymentStatusText(row?.meta?.payment_status)
	if (row?.row_type === 'opening_debt') return paymentStatusText(row?.meta?.payment_status || row?.payment_status)
	if (row?.row_type === 'other_fee') return paymentStatusText(row?.meta?.payment_status || row?.payment_status)
	return paymentStatusText(row?.meta?.payment_status || row?.payment_status)
}

function statementRowStatusKind(row) {
	if (row?.row_type === 'receipt') return 'success'
	if (row?.row_type === 'allocation') return 'warning'
	if (row?.row_type === 'flow_settlement') return paymentStatusKind(row?.meta?.payment_status)
	if (row?.row_type === 'opening_debt') return paymentStatusKind(row?.meta?.payment_status || row?.payment_status)
	if (row?.row_type === 'other_fee') return paymentStatusKind(row?.meta?.payment_status || row?.payment_status)
	return paymentStatusKind(row?.meta?.payment_status || row?.payment_status)
}

function statementRowDetail(row) {
	if (row?.row_type === 'receipt') {
		const parts = []
		const roundingAllocated = toNumber(row?.rounding_allocated_amount, 0)
		if (roundingAllocated > 0) {
			parts.push(`收款 ¥${formatMoney(row?.amount)}，抹零 ¥${formatMoney(roundingAllocated)}`)
		}
		const sourceText = receiptSourceTypeText(row?.meta?.source_type)
		if (sourceText) parts.push(`来源 ${sourceText}`)
		const method = normalizeString(row?.meta?.payment_method)
		if (method) parts.push(`方式 ${paymentMethodText(method)}`)
		const startDate = normalizeString(row?.meta?.allocation_start_date)
		const endDate = normalizeString(row?.meta?.allocation_end_date)
		if (startDate && endDate) parts.push(`分配区间 ${startDate}~${endDate}`)
		const note = normalizeString(row?.note)
		if (note) parts.push(note)
		return parts.join(' · ')
	}
	if (row?.row_type === 'flow_settlement') {
		const parts = []
		const volume = toNullableNumber(row?.meta?.flow_volume_m3)
		const loss = toNullableNumber(row?.meta?.loss_weight_kg)
		if (volume != null) parts.push(`用气量 ${formatFlowNumber(volume)} m3`)
		if (loss != null) parts.push(`阶段亏损 ${loss} kg`)
		return parts.join(' · ')
	}
	if (row?.row_type === 'allocation') {
		const sourceType = normalizeString(row?.meta?.source_type)
		const kind = normalizeString(row?.meta?.allocate_kind)
		const kindText = kind === 'rounding' ? '抹零分配' : '收款分配'
		const sourceText = receiptSourceTypeText(sourceType)
		if (sourceText) return `${kindText} · 来源 ${sourceText}`
		return kindText
	}
	if (row?.row_type === 'opening_debt') {
		const parts = []
		const roundingAmount = resolveOpeningDebtRoundingAmount(row)
		if (roundingAmount > 0) {
			parts.push(`抹零 ¥${formatMoney(roundingAmount)}`)
		}
		const note = normalizeString(row?.note)
		if (note) parts.push(note)
		return parts.join(' · ')
	}
	if (row?.row_type === 'other_fee') {
		return normalizeString(row?.note)
	}
	return normalizeString(row?.note)
}

function onRowsDateFromChange(e) {
	rowFilters.dateFrom = normalizeString(e?.detail?.value)
	syncRowsDatePreset()
}

function onRowsDateToChange(e) {
	rowFilters.dateTo = normalizeString(e?.detail?.value)
	syncRowsDatePreset()
}

function onBizDateChange(e) {
	receiptForm.bizDate = normalizeString(e?.detail?.value)
	if (normalizeReceiptAllocationMode(receiptForm.allocationMode) !== 'period') return
	if (!receiptForm.allocationStartDate) receiptForm.allocationStartDate = receiptForm.bizDate
	if (!receiptForm.allocationEndDate) receiptForm.allocationEndDate = receiptForm.bizDate
}

function normalizeFlowMoneyInput(value) {
	const text = normalizeString(value)
	if (!text) return ''
	const normalized = text.replace(/,/g, '')
	const scaled = toScaledBigInt(normalized, 3)
	if (scaled == null) return text
	return formatScaledBigIntFixed(scaled, 3)
}

function onPrepayAmountBlur() {
	if (!isFlowCustomer.value) return
	prepayForm.amount = normalizeFlowMoneyInput(prepayForm.amount)
}

function onOffsetEntryAmountBlur() {
	if (!isFlowCustomer.value) return
	offsetEntryForm.amount = normalizeFlowMoneyInput(offsetEntryForm.amount)
}

function onReceiptAmountBlur() {
	if (!isFlowCustomer.value) return
	receiptForm.amount = normalizeFlowMoneyInput(receiptForm.amount)
}

function onReceiptRoundingAmountBlur() {
	if (!isFlowCustomer.value) return
	receiptForm.roundingAmount = normalizeFlowMoneyInput(receiptForm.roundingAmount)
}

function onOpeningDebtAmountBlur() {
	if (!isFlowCustomer.value) return
	openingDebtForm.amount = normalizeFlowMoneyInput(openingDebtForm.amount)
}

function onOtherFeeAmountBlur() {
	if (!isFlowCustomer.value) return
	otherFeeForm.amount = normalizeFlowMoneyInput(otherFeeForm.amount)
}

function onOffsetAllocateAmountBlur() {
	if (!isFlowCustomer.value) return
	offsetAllocateForm.amount = normalizeFlowMoneyInput(offsetAllocateForm.amount)
}

function onOffsetAllocationStartDateChange(e) {
	offsetAllocateForm.allocationStartDate = normalizeString(e?.detail?.value)
}

function onOffsetAllocationEndDateChange(e) {
	offsetAllocateForm.allocationEndDate = normalizeString(e?.detail?.value)
}

function onOpeningDebtBizDateChange(e) {
	openingDebtForm.bizDate = normalizeString(e?.detail?.value)
}

function onOtherFeeBizDateChange(e) {
	otherFeeForm.bizDate = normalizeString(e?.detail?.value)
}

function onPrepayBizDateChange(e) {
	prepayForm.bizDate = normalizeString(e?.detail?.value)
	if (prepayForm.applyStrategy !== 'allocate_period') return
	if (!prepayForm.allocationStartDate) prepayForm.allocationStartDate = prepayForm.bizDate
	if (!prepayForm.allocationEndDate) prepayForm.allocationEndDate = prepayForm.bizDate
}

function onOffsetEntryBizDateChange(e) {
	offsetEntryForm.bizDate = normalizeString(e?.detail?.value)
}

function onAllocationStartDateChange(e) {
	receiptForm.allocationStartDate = normalizeString(e?.detail?.value)
}

function onAllocationEndDateChange(e) {
	receiptForm.allocationEndDate = normalizeString(e?.detail?.value)
}

function onReceiptPaymentMethodChange(e) {
	const idx = Number(e?.detail?.value)
	const item = receiptPaymentMethodOptions[idx]
	if (!item) return
	receiptForm.paymentMethod = item.value
}

function onPrepayPaymentMethodChange(e) {
	const idx = Number(e?.detail?.value)
	const item = receiptPaymentMethodOptions[idx]
	if (!item) return
	prepayForm.paymentMethod = item.value
}

function onOffsetEntryPaymentMethodChange(e) {
	const idx = Number(e?.detail?.value)
	const item = receiptPaymentMethodOptions[idx]
	if (!item) return
	offsetEntryForm.paymentMethod = item.value
}

function onPrepayApplyStrategyChange(e) {
	const idx = Number(e?.detail?.value)
	const item = prepayApplyStrategyOptions[idx]
	if (!item) return
	prepayForm.applyStrategy = item.value
	if (item.value === 'allocate_period') {
		if (!prepayForm.allocationStartDate) prepayForm.allocationStartDate = prepayForm.bizDate || todayYmd()
		if (!prepayForm.allocationEndDate) prepayForm.allocationEndDate = prepayForm.bizDate || todayYmd()
	}
}

function onPrepayAllocationStartDateChange(e) {
	prepayForm.allocationStartDate = normalizeString(e?.detail?.value)
}

function onPrepayAllocationEndDateChange(e) {
	prepayForm.allocationEndDate = normalizeString(e?.detail?.value)
}

function onFlowBizDateChange(e) {
	flowForm.bizDate = normalizeString(e?.detail?.value)
}

function onAnalysisDateFromChange(e) {
	analysisFilters.dateFrom = normalizeString(e?.detail?.value)
	syncAnalysisDatePreset()
}

function onAnalysisDateToChange(e) {
	analysisFilters.dateTo = normalizeString(e?.detail?.value)
	syncAnalysisDatePreset()
}

async function onAnalysisDatePresetChange(value) {
	analysisDatePreset.value = value
	if (value === 'custom') return
	const range = buildDatePresetRange(value, new Date())
	analysisFilters.dateFrom = range.dateStart
	analysisFilters.dateTo = range.dateEnd
	await searchAnalysis()
}

function syncAnalysisDatePreset() {
	analysisDatePreset.value = detectDatePreset(analysisFilters.dateFrom, analysisFilters.dateTo, new Date())
}

async function applyRowsDatePreset(value) {
	const preset = normalizeString(value) || 'custom'
	rowsDatePreset.value = preset
	if (preset === 'custom') return
	const range = buildDatePresetRange(preset, new Date())
	rowFilters.dateFrom = range.dateStart
	rowFilters.dateTo = range.dateEnd
	await searchRows(true)
}

async function onRowsYearQuick() {
	await applyRowsDatePreset('year')
}

async function onRowsMonthQuick() {
	await applyRowsDatePreset('month')
}

async function onRowsDatePresetChange(value) {
	await applyRowsDatePreset(value)
}

function syncRowsDatePreset() {
	rowsDatePreset.value = detectDatePreset(rowFilters.dateFrom, rowFilters.dateTo, new Date(), { includeYear: true })
}

async function searchRows(reset = false) {
	if (reset) rowsPager.page = 1
	await Promise.all([loadRows(), loadStatement({ summaryOnly: true })])
}

function onRowsPrev() {
	if (rowsPager.page <= 1) return
	rowsPager.page -= 1
	loadRows()
}

function onRowsNext() {
	if (!rowsPager.hasMore) return
	rowsPager.page += 1
	loadRows()
}

async function onAllocateOffsetCredit() {
	if (!recordId.value || offsetAllocating.value) return
	const selectedSources = dedupeOffsetSourceRows(selectedOffsetReceipts.value)
		.filter((row) => toNumber(row?.unallocated_amount, 0) > 0)
		.sort((a, b) => {
			const leftDate = normalizeDate(a?.source_sale_date) || normalizeDate(a?.biz_date)
			const rightDate = normalizeDate(b?.source_sale_date) || normalizeDate(b?.biz_date)
			if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1
			const leftId = normalizeString(a?._id)
			const rightId = normalizeString(b?._id)
			return leftId < rightId ? -1 : 1
		})
	if (!selectedSources.length) {
		uni.showToast({ title: '请先选择至少一笔冲抵来源', icon: 'none' })
		return
	}
	const allocationPayload = buildOffsetAllocationPayload()
	if (!allocationPayload) return
	const available = fix2(selectedSources.reduce((sum, row) => sum + toNumber(row?.unallocated_amount, 0), 0))
	if (!(available > 0)) {
		uni.showToast({ title: '所选来源无可用冲抵余额', icon: 'none' })
		return
	}
	let amount = Number(offsetAllocateForm.amount)
	if (!Number.isFinite(amount) || amount <= 0) {
		uni.showToast({ title: '请输入大于0的冲抵金额', icon: 'none' })
		return
	}
	if (amount > available) amount = available

	offsetAllocating.value = true
	try {
		const previewRes = await previewAllocationV1({
			customerId: recordId.value,
			amount,
			allocationMode: allocationPayload.allocationMode,
			allocationStartDate: allocationPayload.allocationStartDate,
			allocationEndDate: allocationPayload.allocationEndDate,
			allocationTargets: allocationPayload.allocationTargets
		})
		if (previewRes?.code !== 0) {
			uni.showToast({ title: previewRes?.msg || '冲抵分配失败', icon: 'none' })
			return
		}
		const maxAllocatable = toNumber(previewRes?.data?.allocated_total, 0)
		if (!(maxAllocatable > 0)) {
			uni.showToast({
				title: allocationPayload.allocationMode === 'period' ? '当前时间段内无可冲抵欠款' : '当前勾选目标无可冲抵欠款',
				icon: 'none'
			})
			return
		}
		const amountToAllocate = Math.min(amount, maxAllocatable)
		let remaining = amountToAllocate
		let allocatedTotal = 0
		let appliedSourceCount = 0
		let failedMsg = ''
		for (const source of selectedSources) {
			if (!(remaining > 0)) break
			const receiptId = normalizeString(source?._id)
			if (!receiptId) continue
			const sourceAvailable = Math.max(toNumber(source?.unallocated_amount, 0), 0)
			if (!(sourceAvailable > 0)) continue
			const applyAmount = Math.min(remaining, sourceAvailable)
			const res = await allocateOffsetCreditV1({
				customerId: recordId.value,
				receiptId,
				amount: applyAmount,
				allocationMode: allocationPayload.allocationMode,
				allocationStartDate: allocationPayload.allocationStartDate,
				allocationEndDate: allocationPayload.allocationEndDate,
				allocationTargets: allocationPayload.allocationTargets
			})
			if (res?.code !== 0) {
				failedMsg = normalizeString(res?.msg) || '冲抵分配失败'
				break
			}
			const allocatedDelta = toNumber(res?.data?.allocated_total, 0)
			if (!(allocatedDelta > 0)) break
			allocatedTotal = fix2(allocatedTotal + allocatedDelta)
			remaining = fix2(Math.max(remaining - allocatedDelta, 0))
			appliedSourceCount += 1
		}
		if (!(allocatedTotal > 0)) {
			uni.showToast({ title: failedMsg || '冲抵分配失败', icon: 'none' })
			return
		}
		offsetCheckedTargetKeys.value = []
		await refreshAll()
		const nextRemaining = fix2(Math.max(amountToAllocate - allocatedTotal, 0))
		const nextAvailable = selectedOffsetReceiptAvailableTotal.value
		if (nextRemaining > 0) {
			const suggested = Math.min(nextRemaining, nextAvailable)
			offsetAllocateForm.amount = suggested > 0 ? formatMoney(suggested) : ''
		} else {
			offsetAllocateForm.amount = nextAvailable > 0 ? formatMoney(nextAvailable) : ''
		}
		if (failedMsg) {
			uni.showToast({
				title: `已冲抵 ¥${formatMoney(allocatedTotal)}，部分来源失败：${failedMsg}`,
				icon: 'none',
				duration: 2800
			})
		} else {
			uni.showToast({
				title: `冲抵成功（来源 ${appliedSourceCount} 笔，合计 ¥${formatMoney(allocatedTotal)}）`,
				icon: 'success'
			})
		}
	} finally {
		offsetAllocating.value = false
	}
}

function onOpenSale(id) {
	const saleId = normalizeString(id)
	if (!saleId) return
	uni.navigateTo({ url: `/pages/sale/detail?_id=${encodeURIComponent(saleId)}` })
}

function onOpenNetDebtSaleSources() {
	const customerId = normalizeString(recordId.value)
	if (!customerId) return
	const params = {
		customerId,
		keyword: normalizeString(customer.value?.name),
		dateStart: normalizeDate(summaryScope.date_from || rowFilters.dateFrom),
		dateEnd: normalizeDate(summaryScope.date_to || rowFilters.dateTo),
		settlementScope: 'net_outstanding_non_zero'
	}
	const query = Object.entries(params)
		.filter(([, value]) => normalizeString(value))
		.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
		.join('&')
	uni.navigateTo({ url: `/pages/sale/list?${query}` })
}

function onBack() {
	uni.navigateBack({ delta: 1 })
}

watch(
	recordId,
	async (id) => {
		if (!id) return
		quickSceneApplied.value = false
		activeOperationTab.value = 'receipt'
		openingDebtRecentExpanded.value = false
		otherFeeRecentExpanded.value = false
		receiptRecentExpanded.value = false
		resetReceiptForm()
		resetPrepayForm()
		resetOffsetEntryForm()
		resetFlowForm({ preservePrev: false })
		resetOpeningDebtForm()
		resetOtherFeeForm()
		resetOffsetAllocateForm()
		offsetPoolRows.value = []
		offsetPoolPager.page = 1
		offsetPoolPager.total = 0
		offsetPoolPager.hasMore = false
		analysisFilters.dateFrom = ''
		analysisFilters.dateTo = ''
		analysisDatePreset.value = 'custom'
		rowsDatePreset.value = detectDatePreset(rowFilters.dateFrom, rowFilters.dateTo, new Date(), { includeYear: true })
		await refreshAll()
		applyQuickReceiveScene()
	},
	{ immediate: true }
)

watch(
	bottleReferencePrice,
	() => {
		if (!isBottleCustomer.value) return
		loadAnalysis()
	}
)

onMounted(() => {
	if (!receiptForm.bizDate) receiptForm.bizDate = todayYmd()
	if (!prepayForm.bizDate) prepayForm.bizDate = todayYmd()
	if (!offsetEntryForm.bizDate) offsetEntryForm.bizDate = todayYmd()
	if (!flowForm.bizDate) flowForm.bizDate = todayYmd()
	if (!openingDebtForm.bizDate) openingDebtForm.bizDate = todayYmd()
	if (!otherFeeForm.bizDate) otherFeeForm.bizDate = todayYmd()
})
</script>

<style scoped>
.content-shell {
	display: flex;
	flex-direction: column;
	gap: 16rpx;
	padding-bottom: 48rpx;
}

.summary-row {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220rpx, 1fr));
	gap: 16rpx;
	width: 100%;
}

.quick-date-strip {
	display: flex;
	align-items: center;
	justify-content: flex-start;
	overflow-x: auto;
	padding-bottom: 8rpx;
}

.operation-head {
	margin-bottom: 8rpx;
}

.operation-current {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.operation-tabs-scroll {
	overflow-x: auto;
	padding-bottom: 8rpx;
}

.operation-tabs-scroll :deep(.tabs) {
	min-width: max-content;
}

.operation-panel {
	display: flex;
	flex-direction: column;
}

.statement-header-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	justify-content: flex-end;
}

.header-date-picker {
	display: block;
}

.recent-toggle-row {
	margin-top: 12rpx;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
}

:deep(.summary-card .stat__content) {
	align-items: center;
	gap: 16rpx;
}

:deep(.summary-card .stat__value-wrap) {
	align-items: flex-start;
}

:deep(.summary-card .stat__value) {
	text-align: left;
	font-size: 24px;
}

:deep(.summary-card .stat__icon) {
	margin-left: 12rpx;
}

.overview-grid,
.analysis-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(260rpx, 1fr));
	gap: 12rpx;
}

.overview-item,
.analysis-card {
	display: flex;
	flex-direction: column;
	gap: 6rpx;
	padding: 16rpx;
	border: 1rpx solid var(--crm-border);
	border-radius: 12rpx;
	background: #f8fafc;
}

.analysis-card--accent {
	background: #eff6ff;
	border-color: #bfdbfe;
}

.overview-label,
.analysis-card__label {
	font-size: 21rpx;
	color: var(--crm-text-muted);
}

.overview-value,
.analysis-card__value {
	font-size: 26rpx;
	font-weight: 700;
	color: var(--crm-text);
}

.overview-meta {
	font-size: 20rpx;
	color: #64748b;
}

.analysis-card__hint {
	font-size: 21rpx;
	color: var(--crm-text-muted);
}

.analysis-placeholder {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.receipt-grid,
.filter-grid,
.flow-grid,
.bottle-compare-grid,
.analysis-filter-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12rpx;
}

.receipt-grid--four {
	grid-template-columns: repeat(4, minmax(0, 1fr));
}

.grid-span-4 {
	grid-column: 1 / -1;
}

.grid-span-2 {
	grid-column: 1 / -1;
}

.filter-grid {
	grid-template-columns: repeat(3, minmax(0, 1fr));
	align-items: end;
}

.analysis-filter-grid {
	grid-template-columns: repeat(3, minmax(0, 1fr));
	align-items: end;
	margin-bottom: 12rpx;
}

.flow-grid {
	grid-template-columns: repeat(4, minmax(0, 1fr));
	align-items: end;
}

.flow-grid__note {
	grid-column: span 3;
}

.section-actions {
	display: flex;
	align-items: center;
	gap: 12rpx;
}

.picker-block {
	display: block;
	width: 100%;
}

.formula-hint,
.section-hint,
.preview-empty,
.row-detail {
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.formula-hint {
	display: block;
	margin-top: 12rpx;
}

.section-hint--warning {
	color: #b45309;
	font-weight: 600;
}

.section-hint--accent {
	color: #0f766e;
	font-weight: 700;
}

.row-detail--source {
	color: #0f766e;
	font-weight: 700;
}

.row-detail--alloc-scope {
	color: #0f766e;
	font-weight: 600;
}

.preview-box {
	margin-top: 12rpx;
	padding: 12rpx;
	border-radius: 12rpx;
	background: #f8fafc;
	border: 1rpx solid #e2e8f0;
	display: flex;
	flex-direction: column;
	gap: 10rpx;
}

.preview-summary {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	font-size: 22rpx;
	color: #334155;
}

.preview-note {
	font-size: 22rpx;
	color: #475569;
}

.checked-target-box {
	margin-top: 12rpx;
	padding: 12rpx;
	border-radius: 12rpx;
	background: #f8fafc;
	border: 1rpx solid #e2e8f0;
	display: flex;
	flex-direction: column;
	gap: 10rpx;
}

.checked-target-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12rpx;
	font-size: 22rpx;
	color: #334155;
}

.checked-target-list {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.checked-target-item {
	display: flex;
	align-items: center;
	gap: 10rpx;
	padding: 8rpx 10rpx;
	border-radius: 10rpx;
	border: 1rpx solid #dbe7ff;
	background: #ffffff;
}

.checked-target-item__body {
	display: flex;
	flex-direction: column;
	gap: 2rpx;
	min-width: 0;
}

.checked-target-item__title {
	font-size: 22rpx;
	color: #0f172a;
}

.checked-target-item__meta {
	font-size: 20rpx;
	color: #64748b;
}

.alloc-list {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}

.alloc-head,
.alloc-row {
	display: grid;
	grid-template-columns: 1.6fr 1fr 1fr;
	gap: 10rpx;
	align-items: center;
}

.alloc-head {
	font-size: 21rpx;
	color: var(--crm-text-muted);
	font-weight: 600;
}

.alloc-row {
	font-size: 22rpx;
	color: #0f172a;
}

.col-sale {
	min-width: 0;
}

.col-outstanding {
	text-align: right;
}

.col-amount {
	min-width: 160rpx;
}

.mini-amounts {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 4rpx;
	font-size: 21rpx;
	color: #0f172a;
}

.mini-amounts--left {
	align-items: flex-start;
}

.mini-amounts__warning {
	color: #b45309;
	font-weight: 700;
}

.mini-amounts__offset {
	color: #b45309;
	font-weight: 700;
}

.mini-amounts__offset-target {
	color: #92400e;
	font-weight: 700;
}

.mini-amounts__rounding {
	color: #0f766e;
	font-weight: 700;
}

.mini-amounts__receipt-rounding {
	color: #0f766e;
	font-weight: 700;
}

.mini-amounts__posted {
	color: #1d4ed8;
	font-weight: 700;
}

.mini-amounts__movement {
	color: #475569;
}

.mini-amounts__detail {
	color: #475569;
	max-width: 720rpx;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.mini-amounts__deposit-detail {
	color: #64748b;
	max-width: 720rpx;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.row-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 10rpx;
	justify-content: flex-end;
}

.row-detail-grid {
	display: flex;
	flex-wrap: wrap;
	gap: 12rpx;
	font-size: 22rpx;
	color: var(--crm-text-muted);
}

.pager-row {
	margin-top: 12rpx;
	display: flex;
	justify-content: flex-end;
	gap: 12rpx;
}

@media (max-width: 760px) {
	.receipt-grid,
	.filter-grid,
	.flow-grid,
	.bottle-compare-grid,
	.analysis-filter-grid {
		grid-template-columns: 1fr;
	}

	.flow-grid__note {
		grid-column: auto;
	}

	.alloc-head,
	.alloc-row {
		grid-template-columns: 1fr;
		gap: 6rpx;
	}

	.col-outstanding {
		text-align: left;
	}

	.section-actions {
		flex-direction: column;
		align-items: flex-start;
	}

	.statement-header-actions {
		justify-content: flex-start;
	}

	.recent-toggle-row {
		flex-direction: column;
		align-items: flex-start;
	}

	.receipt-grid--four {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.receipt-grid--four .grid-span-4 {
		grid-column: 1 / -1;
	}
}

@media (max-width: 420px) {
	.receipt-grid--four {
		grid-template-columns: 1fr;
	}
}
</style>
