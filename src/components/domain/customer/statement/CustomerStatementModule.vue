<template>
	<AppPage title="客户对账" :subtitle="subtitle" icon="wallet">
		<template #headerActions>
			<AppButton
				size="sm"
				kind="outline"
				:loading="exportingStatement"
				:disabled="loading || rowsLoading || analysisLoading"
				@click="onExportStatement"
			>
				导出对账单
			</AppButton>
			<AppButton size="sm" kind="neutral" :disabled="loading || rowsLoading || analysisLoading" @click="refreshAll">刷新</AppButton>
			<AppButton size="sm" kind="neutral" @click="onBack">返回</AppButton>
		</template>

		<template #highlights>
			<view class="summary-row">
				<AppStatCard class="summary-card" label="应收未收" :value="formatSummaryMoney(summary.receivable_balance)" hint="元" icon="alert" />
				<AppStatCard class="summary-card" label="预付款余额" :value="formatSummaryMoney(summary.prepay_balance)" hint="元" icon="check-circle" />
				<AppStatCard class="summary-card" label="应收欠款" :value="formatSummaryMoney(summary.net_balance)" hint="元" icon="wallet" />
				<AppStatCard class="summary-card" label="最近回款" :value="lastReceiptText" hint="日期" icon="calendar" />
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

			<AppSection title="历史欠款登记">
				<template #actions>
					<AppButton size="sm" kind="ghost" @click="resetOpeningDebtForm">重置</AppButton>
					<AppButton v-if="isEditingOpeningDebt" size="sm" kind="outline" @click="cancelOpeningDebtEditing">取消编辑</AppButton>
					<AppButton size="sm" kind="primary" :loading="openingDebtSubmitting" @click="onCreateOpeningDebtEntry">
						{{ openingDebtPrimaryActionLabel }}
					</AppButton>
				</template>

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

				<AppList :loading="loading" :empty="recentOpeningDebts.length === 0" empty-title="暂无历史欠款">
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
								<text>已收 ¥{{ formatMoney(row.amount_received) }}</text>
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
			</AppSection>

			<AppSection title="收款单（近20条）">
				<AppList :loading="loading" :empty="recentReceipts.length === 0" empty-title="暂无收款单">
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
								<text>已分配 ¥{{ formatMoney(row.allocated_amount) }}</text>
								<text>预付+ ¥{{ formatMoney(row.unallocated_amount) }}</text>
							</view>
						</template>
						<template #default>
							<text class="row-detail">{{ receiptAllocationText(row) }}</text>
							<text v-if="row.note" class="row-detail">{{ row.note }}</text>
						</template>
						<template #footer>
							<view class="row-actions">
								<AppButton size="sm" kind="ghost" @click="onEditReceipt(row)">编辑</AppButton>
								<AppButton size="sm" kind="outline" @click="onRemoveReceipt(row)">删除</AppButton>
							</view>
						</template>
					</AppListItem>
				</AppList>
			</AppSection>

			<AppSection title="预付录入">
				<template #actions>
					<AppButton size="sm" kind="ghost" @click="resetPrepayForm">重置</AppButton>
					<AppButton size="sm" kind="primary" :loading="prepaySubmitting" @click="onCreatePrepayEntry">录入预付</AppButton>
				</template>

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
					当前策略：{{ prepayApplyStrategyLabel }}。仅入预付时不冲历史欠款；立即按区间冲欠时仅冲销区间内应收，剩余金额自动保留为预付款。
				</text>
			</AppSection>

			<AppSection title="冲抵分配">
				<template #actions>
					<AppButton size="sm" kind="ghost" @click="resetOffsetAllocateForm">重置</AppButton>
					<AppButton size="sm" kind="neutral" :loading="offsetPoolLoading" @click="loadOffsetCreditPool(true)">刷新来源</AppButton>
					<AppButton
						size="sm"
						kind="primary"
						:loading="offsetAllocating"
						:disabled="!selectedOffsetReceiptId"
						@click="onAllocateOffsetCredit"
					>
						提交冲抵
					</AppButton>
				</template>

				<view class="checked-target-box">
					<view class="checked-target-head">
						<text>冲抵来源池（仅可用余额）</text>
						<text>共 {{ offsetPoolPager.total }} 条 · 第 {{ offsetPoolPager.page }} / {{ offsetPoolTotalPages }} 页</text>
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
										:kind="selectedOffsetReceiptId === normalizeString(row._id) ? 'primary' : 'ghost'"
										@click="onSelectOffsetReceipt(row)"
									>
										{{ selectedOffsetReceiptId === normalizeString(row._id) ? '已选择' : '选择来源' }}
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

				<view class="receipt-grid">
					<AppInput :model-value="selectedOffsetReceiptSummary" label="已选来源" placeholder="请选择冲抵来源" readonly size="sm" />
					<AppInput
						v-model="offsetAllocateForm.amount"
						label="本次冲抵金额(元)"
						:placeholder="moneyInputPlaceholder"
						size="sm"
						@blur="onOffsetAllocateAmountBlur"
					/>
				</view>
				<text class="section-hint">分配口径：单笔来源 + 勾选目标。仅消耗本来源可用余额，不回滚历史分配。</text>

				<view class="checked-target-box">
					<view class="checked-target-head">
						<text>勾选冲抵目标（销售/流量/历史欠款）</text>
						<text>已选 {{ offsetCheckedTargetKeys.length }} 笔</text>
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
					<text v-if="checkedTargetCandidates.length === 0" class="preview-empty">当前无可冲抵欠款目标。</text>
				</view>
			</AppSection>

			<AppSection title="登记收款 / 分配">
				<template #actions>
					<AppButton size="sm" kind="ghost" @click="resetReceiptForm">重置</AppButton>
					<AppButton v-if="isEditingReceipt" size="sm" kind="outline" @click="cancelReceiptEditing">取消编辑</AppButton>
					<AppButton size="sm" kind="neutral" :disabled="isEditingReceipt" :loading="previewing" @click="onPreview">预览分配</AppButton>
					<AppButton size="sm" kind="primary" :loading="submitting" @click="onCreateAutoReceipt">{{ receiptPrimaryActionLabel }}</AppButton>
					<AppButton size="sm" kind="outline" :disabled="isEditingReceipt || !previewPlan" :loading="confirming" @click="onConfirmAllocation">确认入账</AppButton>
				</template>

				<view class="receipt-grid receipt-grid--four">
					<AppInput
						v-model="receiptForm.amount"
						label="收款金额(元)"
						:placeholder="moneyInputPlaceholder"
						size="sm"
						@blur="onReceiptAmountBlur"
					/>
					<picker class="picker-block" mode="date" @change="onBizDateChange">
						<AppInput v-model="receiptForm.bizDate" label="业务日期" placeholder="选择日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<picker class="picker-block" mode="selector" :range="receiptPaymentMethodOptions" range-key="label" :value="receiptPaymentMethodIndex" @change="onReceiptPaymentMethodChange">
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
					<AppInput v-model="receiptForm.note" class="grid-span-4" label="备注" placeholder="可选" size="sm" />
				</view>
				<text v-if="receiptForm.allocationMode === 'period'" class="section-hint">分配口径：仅冲销所选日期区间内的应收，超出部分自动计入预付款/冲抵款池。</text>
				<text v-else class="section-hint">分配口径：仅冲销勾选单据，勾选外单据不参与本次分配，剩余自动计入预付款/冲抵款池。</text>

				<view v-if="receiptForm.allocationMode === 'checked'" class="checked-target-box">
					<view class="checked-target-head">
						<text>勾选待分配单据（按日期升序自动分配）</text>
						<text>已选 {{ checkedAllocationTargetKeys.length }} 笔</text>
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
						<text>预计冲欠：¥{{ formatMoney(previewPlan.allocated_total) }}</text>
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
								<text v-if="resolveSaleOffsetApplied(row) > 0" class="mini-amounts__offset">
									{{ formatSaleOffsetLine(row) }}
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
					<AppDatePresetBar v-model="rowsDatePreset" @update:modelValue="onRowsDatePresetChange" />
				</view>
				<view class="filter-grid">
					<picker class="picker-block" mode="date" @change="onRowsDateFromChange">
						<AppInput v-model="rowFilters.dateFrom" label="开始日期" placeholder="选择开始日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<picker class="picker-block" mode="date" @change="onRowsDateToChange">
						<AppInput v-model="rowFilters.dateTo" label="结束日期" placeholder="选择结束日期" prefix-icon="calendar" readonly size="sm" />
					</picker>
					<AppButton size="sm" kind="primary" :loading="rowsLoading || analysisLoading" @click="searchRows(true)">查询流水</AppButton>
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
								<text v-if="row.row_type === 'sale'">未收 ¥{{ formatMoney(row.outstanding) }}</text>
								<text v-if="row.row_type === 'flow_settlement'">应收 ¥{{ formatMoney(row.amount) }}</text>
								<text v-if="row.row_type === 'flow_settlement'">未收 ¥{{ formatMoney(row.outstanding) }}</text>
								<text v-if="row.row_type === 'opening_debt'">应收 ¥{{ formatMoney(row.amount) }}</text>
								<text v-if="row.row_type === 'opening_debt'">未收 ¥{{ formatMoney(row.outstanding) }}</text>
								<text v-if="row.row_type === 'receipt'">收款 ¥{{ formatMoney(row.amount) }}</text>
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
	createPrepayEntryV1,
	createFlowSettlementV1,
	createReceiptV1,
	exportCustomerStatementV1,
	getCustomerStatementAnalysisV1,
	getCustomerStatementV1,
	listOffsetCreditPoolV1,
	listCustomerStatementRowsV1,
	previewAllocationV1,
	previewFlowSettlementV1,
	removeOpeningDebtEntryV1,
	removeFlowSettlementV1,
	removeReceiptV1,
	updateOpeningDebtEntryV1,
	updateFlowSettlementV1,
	updateReceiptV1
} from '@/services/customerSettlement'
import {
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
const exportingStatement = ref(false)
const flowPreviewLoading = ref(false)
const flowSubmitting = ref(false)
const openingDebtSubmitting = ref(false)
const offsetPoolLoading = ref(false)
const offsetAllocating = ref(false)

const customer = ref({})
const recentSales = ref([])
const recentReceipts = ref([])
const recentFlowSettlements = ref([])
const recentOpeningDebts = ref([])
const previewPlan = ref(null)
const editableAllocations = ref([])
const statementRows = ref([])
const flowPreview = ref(null)
const bottleReferencePrice = ref('')
const checkedAllocationTargetKeys = ref([])
const offsetCheckedTargetKeys = ref([])
const offsetPoolRows = ref([])
const selectedOffsetReceipt = ref(null)
const quickSceneApplied = ref(false)
const editingReceiptId = ref('')
const editingFlowSettlementId = ref('')
const editingOpeningDebtId = ref('')
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
	net_balance: 0,
	should_receive_total: 0,
	amount_received_total: 0,
	last_receipt_at: null
})
const summaryScope = reactive({
	date_from: '',
	date_to: '',
	should_receive_total: 0,
	amount_received_total: 0
})

const receiptForm = reactive({
	amount: '',
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
const offsetAllocateForm = reactive({
	amount: ''
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

const rowsTotalPages = computed(() => {
	const pages = Math.ceil(Number(rowsPager.total || 0) / Number(rowsPager.pageSize || 50))
	return pages > 0 ? pages : 1
})
const offsetPoolTotalPages = computed(() => {
	const pages = Math.ceil(Number(offsetPoolPager.total || 0) / Number(offsetPoolPager.pageSize || 10))
	return pages > 0 ? pages : 1
})
const isEditingReceipt = computed(() => Boolean(normalizeString(editingReceiptId.value)))
const isEditingFlowSettlement = computed(() => Boolean(normalizeString(editingFlowSettlementId.value)))
const isEditingOpeningDebt = computed(() => Boolean(normalizeString(editingOpeningDebtId.value)))
const receiptPrimaryActionLabel = computed(() => (isEditingReceipt.value ? '保存收款单' : '登记收款'))
const flowPrimaryActionLabel = computed(() => (isEditingFlowSettlement.value ? '保存结算单' : '生成结算单'))
const openingDebtPrimaryActionLabel = computed(() => (isEditingOpeningDebt.value ? '保存欠款' : '登记欠款'))

const lastReceiptText = computed(() => {
	const ts = Number(summary.last_receipt_at || 0)
	if (!Number.isFinite(ts) || ts <= 0) return '-'
	const d = new Date(ts)
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})
const hasSummaryScope = computed(() => Boolean(summaryScope.date_from && summaryScope.date_to))
const overviewScopeText = computed(() => (
	hasSummaryScope.value ? `口径：${summaryScope.date_from} ~ ${summaryScope.date_to}` : '口径：全量'
))
const overviewShouldReceiveTotal = computed(() => (
	hasSummaryScope.value ? toNumber(summaryScope.should_receive_total, 0) : toNumber(summary.should_receive_total, 0)
))
const overviewAmountReceivedTotal = computed(() => (
	hasSummaryScope.value ? toNumber(summaryScope.amount_received_total, 0) : toNumber(summary.amount_received_total, 0)
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
const prepayPaymentMethodIndex = computed(() => {
	const normalized = normalizeReceiptPaymentMethod(prepayForm.paymentMethod)
	const idx = receiptPaymentMethodOptions.findIndex((item) => item.value === normalized)
	return idx >= 0 ? idx : 0
})
const prepayPaymentMethodLabel = computed(() => {
	return receiptPaymentMethodOptions[prepayPaymentMethodIndex.value]?.label || '现金'
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
	return [...saleRows, ...flowRows, ...openingDebtRows].sort((a, b) => {
		if (a.date !== b.date) return a.date < b.date ? -1 : 1
		return a.key < b.key ? -1 : 1
	})
})
const selectedOffsetReceiptId = computed(() => normalizeString(selectedOffsetReceipt.value?._id))
const selectedOffsetReceiptAvailable = computed(() => fix2(toNumber(selectedOffsetReceipt.value?.unallocated_amount, 0)))
const selectedOffsetReceiptSummary = computed(() => {
	if (!selectedOffsetReceiptId.value) return '-'
	const sourceSaleDate = normalizeDate(selectedOffsetReceipt.value?.source_sale_date)
	const bizDate = normalizeDate(selectedOffsetReceipt.value?.biz_date)
	const dateText = sourceSaleDate || bizDate || '-'
	return `${dateText} / ${selectedOffsetReceiptId.value.slice(-6)}（可用 ¥${formatMoney(selectedOffsetReceiptAvailable.value)}）`
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

function receiptAllocationText(row) {
	const mode = normalizeReceiptAllocationMode(row?.allocation_mode)
	if (mode === 'checked') {
		const count = Array.isArray(row?.allocation_targets) ? row.allocation_targets.length : 0
		return `分配模式：勾选分配（${count} 笔目标）`
	}
	const start = normalizeDate(row?.allocation_start_date)
	const end = normalizeDate(row?.allocation_end_date)
	if (start && end) return `分配模式：时间段 ${start} ~ ${end}`
	return '分配模式：时间段'
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

function resetReceiptForm() {
	editingReceiptId.value = ''
	const today = todayYmd()
	receiptForm.amount = ''
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
			const targetType = rawType === 'flow_settlement' || rawType === 'opening_debt' ? rawType : 'sale'
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

function resetOffsetAllocateForm(options = {}) {
	const keepSelection = Boolean(options.keepSelection)
	if (!keepSelection) {
		selectedOffsetReceipt.value = null
	}
	offsetAllocateForm.amount = keepSelection && selectedOffsetReceiptId.value
		? formatMoney(selectedOffsetReceiptAvailable.value)
		: ''
	offsetCheckedTargetKeys.value = []
}

function onSelectOffsetReceipt(row) {
	const receiptId = normalizeString(row?._id)
	if (!receiptId) return
	selectedOffsetReceipt.value = { ...row }
	offsetAllocateForm.amount = formatMoney(row?.unallocated_amount)
	offsetCheckedTargetKeys.value = []
}

function cancelOpeningDebtEditing() {
	resetOpeningDebtForm()
}

function onEditOpeningDebt(row) {
	const debtId = normalizeString(row?._id)
	if (!debtId) return
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
	const range = currentMonthRange()
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
		summaryScope.should_receive_total = toNumber(nextScope.should_receive_total, 0)
		summaryScope.amount_received_total = toNumber(nextScope.amount_received_total, 0)
	} else {
		summaryScope.date_from = ''
		summaryScope.date_to = ''
		summaryScope.should_receive_total = 0
		summaryScope.amount_received_total = 0
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
		const selectedId = selectedOffsetReceiptId.value
		if (selectedId) {
			const hit = offsetPoolRows.value.find((row) => normalizeString(row?._id) === selectedId)
			if (hit) selectedOffsetReceipt.value = { ...hit }
			else if (offsetPoolPager.total <= 0) selectedOffsetReceipt.value = null
		}
		if (selectedOffsetReceiptId.value && !normalizeString(offsetAllocateForm.amount)) {
			offsetAllocateForm.amount = formatMoney(selectedOffsetReceiptAvailable.value)
		}
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
	const amount = Number(receiptForm.amount)
	if (!Number.isFinite(amount) || amount <= 0) {
		uni.showToast({ title: '请输入大于0的收款金额', icon: 'none' })
		return
	}
	const allocationPayload = buildReceiptAllocationPayload()
	if (!allocationPayload) return
	previewing.value = true
	try {
		const res = await previewAllocationV1({
			customerId: recordId.value,
			amount,
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
	const amount = Number(receiptForm.amount)
	if (!Number.isFinite(amount) || amount <= 0) {
		uni.showToast({ title: '请输入大于0的收款金额', icon: 'none' })
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
				bizDate: receiptForm.bizDate,
				allocationMode: allocationPayload.allocationMode,
				allocationStartDate: allocationPayload.allocationStartDate,
				allocationEndDate: allocationPayload.allocationEndDate,
				allocationTargets: allocationPayload.allocationTargets,
				paymentMethod: receiptForm.paymentMethod,
				note: receiptForm.note,
				sourceType: 'customer_statement'
			})
			: await createReceiptV1({
				customerId: recordId.value,
				amount,
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
	editingReceiptId.value = receiptId
	receiptForm.amount = formatMoney(row?.amount)
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
				const targetType = rawType === 'flow_settlement' || rawType === 'opening_debt' ? rawType : 'sale'
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
	uni.showToast({ title: '已加载收款单，修改后点保存收款单', icon: 'none' })
}

async function onRemoveReceipt(row) {
	const receiptId = normalizeString(row?._id)
	if (!receiptId || !recordId.value) return
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
	uni.showToast({ title: res?.msg || '收款单已删除', icon: 'success' })
	await refreshAll()
}

async function onConfirmAllocation() {
	if (!recordId.value || confirming.value || !previewPlan.value) return
	const amount = Number(receiptForm.amount)
	if (!Number.isFinite(amount) || amount <= 0) {
		uni.showToast({ title: '请输入大于0的收款金额', icon: 'none' })
		return
	}
	const allocationPayload = buildReceiptAllocationPayload()
	if (!allocationPayload) return
	confirming.value = true
	try {
		const res = await confirmAllocationV1({
			customerId: recordId.value,
			amount,
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
	return `销售单 ${row?.sale_id || row?.row_id || ''}`
}

function statementRowStatus(row) {
	if (row?.row_type === 'receipt') return '收款'
	if (row?.row_type === 'allocation') return '分配'
	if (row?.row_type === 'flow_settlement') return paymentStatusText(row?.meta?.payment_status)
	if (row?.row_type === 'opening_debt') return paymentStatusText(row?.meta?.payment_status || row?.payment_status)
	return paymentStatusText(row?.meta?.payment_status || row?.payment_status)
}

function statementRowStatusKind(row) {
	if (row?.row_type === 'receipt') return 'success'
	if (row?.row_type === 'allocation') return 'warning'
	if (row?.row_type === 'flow_settlement') return paymentStatusKind(row?.meta?.payment_status)
	if (row?.row_type === 'opening_debt') return paymentStatusKind(row?.meta?.payment_status || row?.payment_status)
	return paymentStatusKind(row?.meta?.payment_status || row?.payment_status)
}

function statementRowDetail(row) {
	if (row?.row_type === 'receipt') {
		const parts = []
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
		return sourceType ? `来源 ${sourceType}` : ''
	}
	if (row?.row_type === 'opening_debt') {
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

function onReceiptAmountBlur() {
	if (!isFlowCustomer.value) return
	receiptForm.amount = normalizeFlowMoneyInput(receiptForm.amount)
}

function onOpeningDebtAmountBlur() {
	if (!isFlowCustomer.value) return
	openingDebtForm.amount = normalizeFlowMoneyInput(openingDebtForm.amount)
}

function onOffsetAllocateAmountBlur() {
	if (!isFlowCustomer.value) return
	offsetAllocateForm.amount = normalizeFlowMoneyInput(offsetAllocateForm.amount)
}

function onOpeningDebtBizDateChange(e) {
	openingDebtForm.bizDate = normalizeString(e?.detail?.value)
}

function onPrepayBizDateChange(e) {
	prepayForm.bizDate = normalizeString(e?.detail?.value)
	if (prepayForm.applyStrategy !== 'allocate_period') return
	if (!prepayForm.allocationStartDate) prepayForm.allocationStartDate = prepayForm.bizDate
	if (!prepayForm.allocationEndDate) prepayForm.allocationEndDate = prepayForm.bizDate
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

async function onRowsDatePresetChange(value) {
	rowsDatePreset.value = value
	if (value === 'custom') return
	const range = buildDatePresetRange(value, new Date())
	rowFilters.dateFrom = range.dateStart
	rowFilters.dateTo = range.dateEnd
	await searchRows(true)
}

function syncRowsDatePreset() {
	rowsDatePreset.value = detectDatePreset(rowFilters.dateFrom, rowFilters.dateTo, new Date())
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
	const receiptId = selectedOffsetReceiptId.value
	if (!receiptId) {
		uni.showToast({ title: '请先选择冲抵来源', icon: 'none' })
		return
	}
	const targets = buildOffsetAllocationTargets()
	if (!targets.length) {
		uni.showToast({ title: '请先勾选冲抵目标', icon: 'none' })
		return
	}
	const available = selectedOffsetReceiptAvailable.value
	if (!(available > 0)) {
		uni.showToast({ title: '该来源无可用冲抵余额', icon: 'none' })
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
		const res = await allocateOffsetCreditV1({
			customerId: recordId.value,
			receiptId,
			amount,
			allocationTargets: targets
		})
		if (res?.code !== 0) {
			uni.showToast({ title: res?.msg || '冲抵分配失败', icon: 'none' })
			return
		}
		uni.showToast({ title: res?.msg || '冲抵分配成功', icon: 'success' })
		offsetCheckedTargetKeys.value = []
		const selectedId = receiptId
		await refreshAll()
		const latest = offsetPoolRows.value.find((row) => normalizeString(row?._id) === selectedId)
		if (latest) {
			selectedOffsetReceipt.value = { ...latest }
			offsetAllocateForm.amount = formatMoney(latest.unallocated_amount)
		} else {
			selectedOffsetReceipt.value = null
			offsetAllocateForm.amount = ''
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

function onBack() {
	uni.navigateBack({ delta: 1 })
}

watch(
	recordId,
	async (id) => {
		if (!id) return
		quickSceneApplied.value = false
		resetReceiptForm()
		resetPrepayForm()
		resetFlowForm({ preservePrev: false })
		resetOpeningDebtForm()
		resetOffsetAllocateForm()
		offsetPoolRows.value = []
		offsetPoolPager.page = 1
		offsetPoolPager.total = 0
		offsetPoolPager.hasMore = false
		analysisFilters.dateFrom = ''
		analysisFilters.dateTo = ''
		analysisDatePreset.value = 'custom'
		rowsDatePreset.value = detectDatePreset(rowFilters.dateFrom, rowFilters.dateTo, new Date())
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
	if (!flowForm.bizDate) flowForm.bizDate = todayYmd()
	if (!openingDebtForm.bizDate) openingDebtForm.bizDate = todayYmd()
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

.mini-amounts__rounding {
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
