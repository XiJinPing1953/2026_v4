#!/usr/bin/env node
'use strict'

// Read-only inventory. This file has no accounting mutation action or cloud write.
// Raw snapshots and customer reports must stay in a private, ignored output folder.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { computeSaleAmountsForDoc } = require('../uniCloud-alipay/cloudfunctions/common/saleAccounting')
const { isOffsetCreditReceipt } = require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/receiptSource')
const VERSION = 'offset-reliability-audit/2026-10-30.2'
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const text = value => String(value ?? '').trim()
const money = value => Math.round(Number(value || 0) * 1000) / 1000
const sum = rows => money(rows.reduce((total, value) => total + Number(value || 0), 0))
const equal = (a, b) => Math.abs(money(a) - money(b)) < 0.0005
const active = row => !text(row.status) || row.status === 'posted'
const numeric = value => ['number','string'].includes(typeof value) && text(value) !== '' && Number.isFinite(Number(value))
function saleBasisKnown(row) {
  if(row.settlement_mode==='customer_flow')return true
  if(!numeric(row.unit_price))return false
  const unit=row.price_unit||'kg',mode=row.biz_mode||'bottle'
  if(!['kg','bottle','m3'].includes(unit)||!['truck','bottle','agent_sale'].includes(mode))return false
  if(mode==='truck')return ['truck_sale_net','truck_gross_diff'].some(key=>numeric(row[key]))||
    ['truck_out_gross','truck_back_gross'].every(key=>numeric(row[key]))||['truck_settle_gross','truck_settle_tare'].every(key=>numeric(row[key]))
  if(mode==='agent_sale')return Array.isArray(row.agent_sale_items)&&row.agent_sale_items.every(item=>numeric(item.fill_weight))
  if(unit==='m3')return numeric(row.flow_volume_m3)||['flow_index_curr','flow_index_prev'].every(key=>numeric(row[key]))
  // Preserve signed legacy weighing facts; their physical accuracy is outside
  // this funding-link audit, but absent values must not become a zero weight.
  return (Array.isArray(row.out_items)||Array.isArray(row.back_items))&&[row.out_items,row.back_items].filter(value=>value!=null)
    .every(rows=>Array.isArray(rows)&&(unit==='bottle'||rows.every(item=>numeric(item.net))))
}
const enabled = row => {
  const value = row.offset_enabled
  if (value == null || value === '') return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (['true', '1', 'yes', 'y', 'on'].includes(text(value).toLowerCase())) return true
  if (['false', '0', 'no', 'n', 'off'].includes(text(value).toLowerCase())) return false
  return null
}

function auditSnapshot(snapshot) {
  if (snapshot?.complete !== true || !snapshot.tables) throw Error('原始资料未声明完整，不能出具单户盘点结论')
  const tables = snapshot.tables
  for (const table of ['crm_customers','crm_sale_records','crm_customer_receipts','crm_customer_allocations','crm_customer_flow_settlements','crm_customer_opening_debts']) {
    if (!Array.isArray(tables[table])) throw Error(`缺少原始表 ${table}`)
    if (new Set(tables[table].map(row => row._id)).size !== tables[table].length) throw Error(`${table} 存在重复 ID，读取不完整`)
  }
  const customer = tables.crm_customers.find(row => row._id === snapshot.customer_id)
  if (!customer) throw Error('客户范围不符')
  const sales = tables.crm_sale_records, receipts = tables.crm_customer_receipts
  const allocations = tables.crm_customer_allocations.filter(active)
  const posted = receipts.filter(row => row.status === 'posted')
  const credits = posted.filter(isOffsetCreditReceipt)
  const saleMap = new Map(sales.map(row => [row._id, row]))
  const receiptMap = new Map(receipts.map(row => [row._id, row]))
  const targetMap = new Map([...sales, ...tables.crm_customer_flow_settlements, ...tables.crm_customer_opening_debts].map(row => [row._id, row]))
  const issues = [], negativeSales = [], positiveCreditReview = [], normalCredits = [], refundTotals = new Map(), allocationOperations = new Map()
  const add = (kind, classification, row, amount, detail, suggestion, related = []) => issues.push({
    kind, classification, customer_id: customer._id, customer_name: customer.name,
    record_id: row?._id || customer._id, date: row?.date || row?.biz_date || '', amount: money(amount), detail,
    suggestion, related_ids: related, confirmation_required: classification !== '旧规则保留',
    evidence_snapshot_hash: snapshot.snapshot_hash || digest(tables)
  })
  for (const refund of posted.filter(row => ['customer_cash_refund','offset_credit_cash_refund'].includes(row.source_type))) {
    if (refund.refund_source_status === 'pending') continue
    const links = refund.source_type === 'offset_credit_cash_refund'
      ? [{ id: refund.offset_source_receipt_id || refund.source_id, amount: -Number(refund.amount) }]
      : (Array.isArray(refund.refund_sources) ? refund.refund_sources : [])
    if (!(Number(refund.amount) < 0) || !equal(-Number(refund.amount), sum(links.map(row=>row.amount))) || new Set(links.map(row=>row.id)).size !== links.length)
      add('refund_links_mismatch', '明确结构异常', refund, -Number(refund.amount || 0), '正式退款金额、来源分摊或来源唯一性不一致', '核对已发生退款事实与来源背书，不能再次登记退款', links.map(row=>row.id))
    for (const link of links) {
      const source = receiptMap.get(link.id)
      if (!source || source.status !== 'posted' || source.customer_id !== customer._id)
        add('refund_link_source_missing', '明确结构异常', refund, link.amount, '正式退款引用的有效同客户来源缺失', '核查来源是否迁移、作废或跨客户，不根据金额补造来源', [link.id])
      refundTotals.set(link.id, sum([refundTotals.get(link.id) || 0, link.amount]))
    }
  }
  for (const row of allocations) {
    const receipt = receiptMap.get(row.receipt_id)
    if (!receipt) {
      add('allocation_source_missing', '明确结构异常', row, row.allocate_amount, '分配记录引用的来源不存在于完整客户快照', '先核查来源是否已删除、跨客户或缺失，不自动补来源', [row.receipt_id]); continue
    }
    if (!isOffsetCreditReceipt(receipt)) continue
    if(!numeric(row.allocate_amount)||Number(row.allocate_amount)<=0)
      add('offset_allocation_amount_invalid','明确结构异常',row,row.allocate_amount,'有效冲抵分配的金额非正数或无效','核查原操作与撤销链，不用负分配表示退款',[receipt._id])
    if(!['receipt','rounding'].includes(row.allocate_kind||'receipt'))
      add('offset_allocation_kind_unknown','需依据核实',row,row.allocate_amount,'冲抵分配类型不受支持','确认原操作分类后逐笔处理',[receipt._id])
    if (row.request_id) {
      const key=JSON.stringify([row.receipt_id,row.target_type||'sale',row.target_id||row.sale_id,row.allocate_kind||'receipt',row.request_id,row.seq??''])
      if(allocationOperations.has(key)) add('offset_duplicate_operation', '需逐笔确认', row, row.allocate_amount, '同一冲抵来源、目标、操作号和序号存在多条分配', '核实是否同次请求重复写入，不能仅因金额相同删除记录', [allocationOperations.get(key)])
      allocationOperations.set(key,row._id)
    }
    const targetId = row.target_id || row.sale_id, target = targetMap.get(targetId)
    if (row.customer_id !== customer._id || receipt.customer_id !== customer._id || (target && target.customer_id !== customer._id))
      add('offset_cross_customer', '明确结构异常', row, row.allocate_amount, '冲抵分配与来源或目标客户不一致', '核实真实客户归属及原分配依据后单独修正', [receipt._id, targetId])
    if (!target) add('offset_target_missing', '明确结构异常', row, row.allocate_amount, '冲抵分配目标不存在于完整客户快照', '核实目标是否已删除或发生跨客户关联', [receipt._id, targetId])
    if(target&&!active(target))add('offset_target_inactive','需依据核实',row,row.allocate_amount,'有效冲抵分配仍引用非有效目标','核对目标作废及分配撤销链',[receipt._id,targetId])
    if (receipt.status !== 'posted') add('offset_source_not_posted', '明确结构异常', row, row.allocate_amount, '有效冲抵分配仍引用未入账/作废来源', '核实撤销链，禁止直接重建全户', [receipt._id, targetId])
  }
  const offsetTargetIds=new Set(allocations.filter(row=>isOffsetCreditReceipt(receiptMap.get(row.receipt_id))).map(row=>row.target_id||row.sale_id))
  for(const id of offsetTargetIds){
    const target=targetMap.get(id);if(!target||!active(target))continue
    let effective
    try{effective=saleMap.has(id)?(saleBasisKnown(target)?computeSaleAmountsForDoc(target).amounts.effective_should_receive:null):
      numeric(target.should_receive??target.amount)?Number(target.should_receive??target.amount)-Number(target.rounding_amount||0):null}catch{effective=null}
    if(effective==null||!Number.isFinite(effective))continue
    const rows=allocations.filter(row=>(row.target_id||row.sale_id)===id),used=sum(rows.map(row=>row.allocate_amount))
    if(used>Math.max(0,effective)+0.0005)add('offset_target_overallocated','需逐笔确认',target,used-Math.max(0,effective),
      `使用过冲抵款的目标，正式分配及抹零合计 ${used} 超过当前有效应收 ${effective}`,'核查目标修改及各来源分配顺序，不直接把差额退回某一来源',rows.map(row=>row._id))
  }
  for (const receipt of credits) {
    const rows = allocations.filter(row => row.receipt_id === receipt._id)
    const allocated = sum(rows.filter(row => row.allocate_kind !== 'rounding').map(row => row.allocate_amount))
    const rounding = sum(rows.filter(row => row.allocate_kind === 'rounding').map(row => row.allocate_amount))
    const components = sum([receipt.allocated_amount, receipt.rounding_allocated_amount, receipt.unallocated_amount, receipt.offset_cash_refunded_amount])
    if (![receipt.amount, receipt.allocated_amount, receipt.rounding_allocated_amount, receipt.unallocated_amount, receipt.offset_cash_refunded_amount].every(value => value == null || Number.isFinite(Number(value)))) {
      add('offset_non_numeric', '明确结构异常', receipt, 0, '冲抵来源包含无效金额', '取得原始金额依据后修正'); continue
    }
    if (['amount','allocated_amount','unallocated_amount'].some(key=>receipt[key]==null || receipt[key]===''))
      add('offset_required_amount_missing', '需依据核实', receipt, receipt.amount, '来源总额、已分配或可用余额字段缺失', '缺失不能当零，核查原始分配及退款依据后补齐')
    if (!equal(receipt.amount, components)) add('offset_components_mismatch', '明确结构异常', receipt, money(receipt.amount) - components,
      `来源 ${money(receipt.amount)} ≠ 已分配 ${money(receipt.allocated_amount)} + 抹零分配 ${money(receipt.rounding_allocated_amount)} + 可用 ${money(receipt.unallocated_amount)} + 已退款 ${money(receipt.offset_cash_refunded_amount)}`,
      '核实分配、退款与余额原值，不按差额直接补款', rows.map(row => row._id))
    if ([receipt.allocated_amount, receipt.rounding_allocated_amount, receipt.unallocated_amount, receipt.offset_cash_refunded_amount].some(value => Number(value || 0) < 0))
      add('offset_negative_component', '明确结构异常', receipt, receipt.unallocated_amount, '来源的分配/可用/退款分项出现负数', '核查超用或撤销记录后逐笔处理')
    if (!equal(receipt.allocated_amount, allocated) || !equal(receipt.rounding_allocated_amount, rounding))
      add('offset_allocation_sum_mismatch', receipt.receipt_adjustment_status === 'pending' ? '处理中待核' : '明确结构异常', receipt, money(receipt.allocated_amount) - allocated,
        `来源已分配 ${money(receipt.allocated_amount)}，有效分配记录合计 ${allocated}；来源抹零 ${money(receipt.rounding_allocated_amount)}，记录抹零 ${rounding}`,
        '核对有效分配关系及调整中的记录，不能直接覆盖已分配合计', rows.map(row => row._id))
    if (!equal(receipt.offset_cash_refunded_amount,refundTotals.get(receipt._id)||0)) add('offset_refund_sum_mismatch', '需依据核实', receipt, money(receipt.offset_cash_refunded_amount)-(refundTotals.get(receipt._id)||0),
      `来源累计退款 ${money(receipt.offset_cash_refunded_amount)}，正式关联退款合计 ${refundTotals.get(receipt._id)||0}`, '核查历史退款迁移及正式记录，不能据字段差额直接补退款')
    if (text(receipt.source_type).startsWith('sale_offset_credit') && !saleMap.has(receipt.source_id))
      add('offset_sale_missing', '需依据核实', receipt, receipt.amount, '销售冲抵来源未找到对应源销售单', '核实历史迁移、删除或来源链接，不根据备注自动关联', [receipt.source_id])
    if (receipt.receipt_adjustment_status === 'pending') add('offset_adjustment_pending', '处理中待核', receipt, receipt.amount,
      `来源处于未完成调整（已分配 ${money(receipt.allocated_amount)}、可用 ${money(receipt.unallocated_amount)}、策略 ${text(receipt.receipt_adjustment_rollback_strategy)||'未记录'}）；这不是金额丢失的证明`,
      '核实原调整是否仍需继续；确认后完成或取消原操作，不重复分配或直接重建', [receipt.source_id,receipt.receipt_adjustment_id,...rows.map(row=>row._id)].filter(Boolean))
    normalCredits.push({ id: receipt._id, source_id: receipt.source_id || '', source_type: receipt.source_type, entry_kind: receipt.entry_kind, date: receipt.biz_date, note: receipt.note || '', amount: money(receipt.amount), allocated: money(receipt.allocated_amount), available: money(receipt.unallocated_amount), refunded: money(receipt.offset_cash_refunded_amount) })
  }
  const pendingRefunds = posted.filter(row => row.source_type === 'customer_cash_refund' && row.refund_source_status === 'pending')
  for (const refund of pendingRefunds) add('refund_source_pending', '需依据核实', refund, -Number(refund.amount || 0), '实际退款已登记，但来源尚未关联，来源可用余额未扣除', '取得退款对应来源后补关联；不新增退款或推测所属负销售')
  for (const sale of sales) {
    if(!active(sale)){
      add('sale_status_requires_review','需依据核实',sale,0,`源销售状态 ${text(sale.status)} 不在当前有效单据计算范围内`,'先核对单据是否已作废及关联处理，不能按原金额自动补入');continue
    }
    let amounts
    try { amounts = computeSaleAmountsForDoc(sale).amounts } catch (error) {
      add('sale_classification_unresolved', '需依据核实', sale, 0, `销售应收无法确定：${error.message}`, '先确认结算归属，不按重量或旧状态推算入池'); continue
    }
    if (!Number.isFinite(amounts?.effective_should_receive)) {
      add('sale_classification_unresolved', '需依据核实', sale, 0, '销售应收不确定', '先确认结算归属'); continue
    }
    if (!saleBasisKnown(sale)) {
      add('sale_basis_unresolved','需依据核实',sale,0,'源单单价或计价数量字段缺失/无效，不能按零推算额度','先取得原始计价依据，不生成或撤销冲抵来源');continue
    }
    if (!Number.isFinite(Number(sale.amount_received)) || sale.amount_received == null || sale.amount_received === '') {
      add('sale_received_unresolved','需依据核实',sale,0,'源单已收字段缺失或无效，不能按零推算可入池额度','取得原始收款事实后核实');continue
    }
    const received = money(sale.amount_received), expected = money(Math.max(0, received - amounts.effective_should_receive))
    const sourceCredits = credits.filter(row => row.source_id === sale._id && text(row.source_type).startsWith('sale_offset_credit'))
    const issued = sum(sourceCredits.map(row => row.amount)), diff = money(expected - issued), flag = enabled(sale)
    if (amounts.effective_should_receive >= 0) {
      // Old positive sales may contain cumulative receipts or other charges.
      // The difference is a review clue, never authorization to create credit.
      if (diff !== 0 && (sourceCredits.length || expected > 0 && flag !== false)) {
        const note=text(sale.remark || sale.payment_note).slice(0,500)
        const backing=sum(allocations.filter(row=>(row.target_id||row.sale_id)===sale._id&&row.allocate_kind!=='rounding').map(row=>row.allocate_amount))
        const row={customer_id:customer._id,customer_name:customer.name,id:sale._id,date:sale.date,effective_should_receive:amounts.effective_should_receive,embedded_received:received,formal_allocated:backing,expected_under_legacy_formula:expected,issued_credit:issued,offset_enabled:flag,credit_ids:sourceCredits.map(row=>row._id),source_note:note}
        positiveCreditReview.push(row)
        add(sourceCredits.length?'positive_sale_credit_mismatch':'positive_sale_embedded_surplus','需依据核实',sale,Math.abs(diff),
          `正数/零销售有效应收 ${amounts.effective_should_receive}、内嵌已收 ${received}、正式分配 ${backing}、现存池来源 ${issued}、旧公式差额 ${diff}${note?'；原备注：'+note:''}`,
          sourceCredits.length?'先核对源单编辑历史及原入池依据，确认应保留或撤销额度；不可直接删除来源':'核对是否跨单累计收款、运费等其他费用或历史字段；不把内嵌超收差额直接补入池',sourceCredits.map(row=>row._id))
      }
      continue
    }
    negativeSales.push({ id: sale._id, customer_id: customer._id, customer_name: customer.name, date: sale.date,
      effective_should_receive: amounts.effective_should_receive, embedded_received: received, offset_enabled: flag,
      expected_under_legacy_formula: expected, issued_credit: issued, allocated: sum(sourceCredits.map(row => row.allocated_amount)),
      available: sum(sourceCredits.map(row => row.unallocated_amount)), refunded_from_pool: sum(sourceCredits.map(row => row.offset_cash_refunded_amount)),
      credit_ids: sourceCredits.map(row => row._id), classification: received<0?'旧公式包含负实收，退款依据待核':diff === 0 ? '来源金额一致' : flag === false && issued === 0 ? '旧规则关闭' : '待核差额' })
    if(received<0){
      const refunds=posted.filter(row=>['customer_cash_refund','offset_credit_cash_refund'].includes(row.source_type))
      add('legacy_embedded_refund_unverified','需依据核实',sale,-received,
        `负销售有效应收 ${amounts.effective_should_receive}、内嵌已收 ${received}、入池 ${issued}；该户正式现金退款 ${refunds.length} 笔。内嵌负实收不能单独证明现金已退${text(sale.remark)?'；原备注：'+text(sale.remark):''}`,
        '取得原现金退款凭据并确认与本单关系；保留旧值，不重复退款，也不重新补入池',refunds.map(row=>row._id))
    }
    if (received < amounts.effective_should_receive) add('sale_embedded_over_refund', '需依据核实', sale, amounts.effective_should_receive - received,
      '源单内嵌负实收超过有效应退金额；尚未证明该字段对应独立现金退款', '核对真实退款依据、日期及背书，不能凭字段直接认定实际超退')
    if (diff > 0) {
      const off = flag === false && issued === 0
      add(off ? 'legacy_offset_disabled' : 'sale_credit_shortfall', off ? '旧规则保留' : '需逐笔确认', sale, diff,
        `有效应收 ${amounts.effective_should_receive}，源单已收 ${received}，开关 ${flag == null ? '缺失（旧兼容开启）' : flag ? '开启' : '关闭'}，来源总额 ${issued}，旧公式差额 ${diff}${pendingRefunds.length ? '；该户另有来源待核退款，不能认定全部应补入' : ''}`,
        off ? '保留旧规则，不按新默认批量补入；如需处理另行确认' : '核实已退款、迁移、人工调整及关闭意图后，再确认是否补入或修正关联', sourceCredits.map(row => row._id))
    } else if (diff < 0) add('sale_credit_excess', '需逐笔确认', sale, -diff,
      `源销售旧公式额度 ${expected}，有效冲抵来源总额 ${issued}，差额 ${-diff}；多条来源本身不代表重复`,
      '核查历史追加/退款/调整依据及已分配去向，不直接删除来源', sourceCredits.map(row => row._id))
    if (flag === false && issued > 0) add('disabled_sale_has_credit', '需依据核实', sale, issued, '源单关闭入池，但仍有有效冲抵来源', '核查关闭时间、已分配额度及调整链，不自动撤销已发生处理', sourceCredits.map(row => row._id))
  }
  return { customer_id: customer._id, customer_name: customer.name, snapshot_hash: snapshot.snapshot_hash || digest(tables),
    counts: { sales: sales.length, negative_sales: negativeSales.length, posted_offset_sources: credits.length, allocations: allocations.length, pending_refunds: pendingRefunds.length },
    issues, negative_sales: negativeSales, positive_credit_review: positiveCreditReview, credits: normalCredits }
}

function summarize(inventory) {
  const reports = [], failures = []
  for (const customer of inventory.customers) {
    const item = inventory.snapshots[customer._id]
    if (!item?.stable || !item.snapshot?.complete) { failures.push({ customer_id: customer._id, customer_name: customer.name, reason: item?.error || '未完成稳定双读' }); continue }
    try { reports.push(auditSnapshot(item.snapshot)) } catch (error) { failures.push({ customer_id: customer._id, customer_name: customer.name, reason: error.message }) }
  }
  const issues = reports.flatMap(row => row.issues)
  // Check array-based refund links across the available raw customer snapshots.
  // This never claims coverage for missing customers or for records added later.
  const available=Object.values(inventory.snapshots).filter(row=>row.stable&&row.snapshot?.complete).map(row=>row.snapshot)
  const sourceMap=new Map(available.flatMap(row=>row.tables.crm_customer_receipts).map(row=>[row._id,row]))
  const customerNames=new Map(inventory.customers.map(row=>[row._id,row.name]))
  for(const snapshot of available)for(const refund of snapshot.tables.crm_customer_receipts.filter(row=>row.status==='posted'&&row.source_type==='customer_cash_refund')){
    for(const link of refund.refund_sources||[]){const source=sourceMap.get(link.id)
      if(source&&isOffsetCreditReceipt(source)&&source.customer_id!==refund.customer_id)issues.push({kind:'cross_customer_refund_link',classification:'需逐笔确认',customer_id:refund.customer_id,customer_name:customerNames.get(refund.customer_id)||'',record_id:refund._id,date:refund.biz_date||'',amount:money(link.amount),detail:`退款关联到其他客户的冲抵来源 ${source._id}（客户 ${source.customer_id}）`,suggestion:'先核实合并结算归属及退款依据，再确认修正，不改退款金额凑平',related_ids:[source._id],confirmation_required:true,evidence_snapshot_hash:snapshot.snapshot_hash})
    }
  }
  return { version: VERSION, generated_at: new Date().toISOString(), evidence: inventory.evidence,
    complete: inventory.evidence?.customer_inventory_stable === true && failures.length === 0,
    atomic_snapshot: false, customers_total: inventory.customers.length, customers_audited: reports.length,
    counts: { sales:reports.reduce((n,r)=>n+r.counts.sales,0),negative_sales: reports.reduce((n,r) => n + r.counts.negative_sales,0), offset_sources: reports.reduce((n,r)=>n+r.counts.posted_offset_sources,0),
      issue_rows: issues.length, confirmation_rows: issues.filter(r=>r.confirmation_required).length,
      by_kind: Object.fromEntries([...new Set(issues.map(row=>row.kind))].map(kind => [kind, issues.filter(row=>row.kind===kind).length])) },
    failures, issues, customers: reports }
}

function renderMarkdown(report) {
  const cell = value => text(value).replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ')
  const positiveKinds=new Set(['positive_sale_credit_mismatch','positive_sale_embedded_surplus'])
  const embeddedRows=report.issues.filter(row=>row.kind==='legacy_embedded_refund_unverified')
  const rows = report.issues.filter(row=>row.confirmation_required&&!positiveKinds.has(row.kind)&&row.kind!=='legacy_embedded_refund_unverified')
  const positiveRows=report.issues.filter(row=>positiveKinds.has(row.kind))
  const disabled = report.issues.filter(row=>!row.confirmation_required)
  const lines = ['# 冲抵款只读盘点与待确认清单','',
    `生成时间：${report.generated_at}。正式环境：${report.evidence?.provider || '未知'} / ${report.evidence?.space_id || '未知'}。`,
    `本轮读取区间：${report.evidence?.read_started_at || '未记录'} 至 ${report.evidence?.read_completed_at || '未记录'}。复用双读资料 ${report.evidence?.reused_customer_count || 0} 户，最早原始读取 ${Number.isFinite(report.evidence?.earliest_source_read_at) ? new Date(report.evidence.earliest_source_read_at).toISOString() : '未记录'}。`,
    '',`客户清单 ${report.customers_total} 户（隐藏 ${report.evidence?.customer_scope_counts?.hidden??'未统计'}、停用 ${report.evidence?.customer_scope_counts?.inactive??'未统计'}）；完成原始快照稳定双读与离线检查 ${report.customers_audited} 户、销售 ${report.counts.sales} 张；未完成 ${report.failures.length} 户。`,
    `已读范围内负销售 ${report.counts.negative_sales} 张、有效冲抵来源 ${report.counts.offset_sources} 笔。负单/池处理待确认 ${rows.length} 条；历史负实收退款缺证 ${embeddedRows.length} 条；正数/零销售相关缺证线索 ${positiveRows.length} 条；旧规则关闭 ${disabled.length} 条单列，不自动视为错账。`,
    '',report.complete ? '客户清单及本报告原始检查范围已完整读取；这不是跨集合或全库同一时点快照，也不代表已取得每笔现金的外部凭据。' : '**本次原始资料覆盖不完整，不能称为全库无遗漏或所有历史账务已核清。覆盖缺口在下方逐户列出。**',
    '', '本次未执行入池、分配、退款、修复、缓存刷新或核准写入。报告只提出待核/待确认事项，不包含可直接执行的修账指令。',
    '', '## 需要逐笔核实或确认', '',
    '| 序号 | 客户 | 日期 | 单据 ID | 分类 / 问题 | 差额或涉及金额（元） | 事实依据 | 建议 |',
    '| --- | --- | --- | --- | --- | ---: | --- | --- |']
  if(!rows.length)lines.push('| — | — | — | — | 已读范围内未发现本脚本识别的待确认事项 | — | 不代表未读范围无问题 | — |')
  rows.forEach((row,index)=>lines.push(`| ${index+1} | ${cell(row.customer_name)} | ${cell(row.date)} | ${cell(row.record_id)} | ${cell(row.classification)} / ${cell(row.kind)} | ${cell(row.amount)} | ${cell(row.detail)} | ${cell(row.suggestion)} |`))
  lines.push('', '上述金额不能直接相加当作总损失或总补款：同一来源可能对应多项检查问题；“旧公式差额”只定位线索，不能代替真实退款、迁移、人工调整的证据。')
  lines.push('', '## 历史负实收：退款凭据待核', '', '以下源单已经填入负实收。旧公式相减为零，不表示有正式退款凭据；缺正式记录也不证明实际未退。本轮保持原值，不能重复退款或补入池。', '',
    '| 客户 | 日期 | 销售 ID | 内嵌退款金额（元） | 现有依据 | 待确认事项 |', '| --- | --- | --- | ---: | --- | --- |')
  if(!embeddedRows.length)lines.push('| — | — | — | — | 已读范围无此类线索 | — |')
  for(const row of embeddedRows)lines.push(`| ${cell(row.customer_name)} | ${cell(row.date)} | ${cell(row.record_id)} | ${row.amount} | ${cell(row.detail)} | ${cell(row.suggestion)} |`)
  lines.push('', '## 正数或零销售的来源依据待核', '', '以下单列历史正数销售。内嵌已收可能含累计历史款或其他费用；不能套用负数单据自动入池规则，也不能直接按差额生成可用额度。', '',
    '| 客户 | 日期 | 销售 ID | 差额线索（元） | 当前事实及原备注 | 待确认事项 |', '| --- | --- | --- | ---: | --- | --- |')
  if(!positiveRows.length)lines.push('| — | — | — | — | 已读范围无此类线索 | — |')
  for(const row of positiveRows)lines.push(`| ${cell(row.customer_name)} | ${cell(row.date)} | ${cell(row.record_id)} | ${row.amount} | ${cell(row.detail)} | ${cell(row.suggestion)} |`)
  lines.push('', '## 已核对的重点单据', '', '| 客户 | 日期 / 销售 ID | 有效应退 | 已入池 | 已分配 | 池内已退付 | 可用 |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |')
  for(const row of report.customers.flatMap(row=>row.negative_sales).filter(row=>['6ae4055d3668715da1f7ddf9','6ae40d1dcfbac0cba8d79db4'].includes(row.id)))
    lines.push(`| ${cell(row.customer_name)} | ${row.date} / ${row.id} | ${-row.effective_should_receive} | ${row.issued_credit} | ${row.allocated} | ${row.refunded_from_pool} | ${row.available} |`)
  lines.push('', '## 旧规则关闭，保留原账务', '', '| 客户 | 日期 | 销售 ID | 旧公式差额（元） | 处理边界 |', '| --- | --- | --- | ---: | --- |')
  if(!disabled.length)lines.push('| — | — | — | — | 已读范围未发现 |')
  for(const row of disabled)lines.push(`| ${cell(row.customer_name)} | ${cell(row.date)} | ${cell(row.record_id)} | ${row.amount} | 不按新默认值补入；先核对当时退款或保留意图 |`)
  lines.push('', '## 原始资料覆盖缺口', '', '| 客户 | 客户 ID | 未完成原因 |', '| --- | --- | --- |')
  if(!report.failures.length)lines.push('| — | — | 本批原始盘点无读取缺口 |')
  for(const row of report.failures)lines.push(`| ${cell(row.customer_name)} | ${row.customer_id} | ${cell(row.reason)} |`)
  if(report.existing_audit){
    const supplement=report.existing_audit
    const rawCovered=new Set(report.customers.map(row=>row.customer_id))
    lines.push('', '## 现有对账自检补充（只读）', '',
      `对客户清单中的 ${supplement.total} 户调用现有 inspectReconciliationCustomerV1；读取完成 ${supplement.read_complete} 户，未完成 ${supplement.failed.length} 户。该接口自行检查跨客户反向关联、退款关联数组、调整关系及双读哈希。`,
      '“读取完成”不等于原始账务全部通过；其原始回包另存 existing-audit.json。以下只列退抵或范围相关问题，可能与上面的原始检查指向同一记录，不重复计算金额。', '',
      '合并子户自己名下无销售/收款，不表示主户账务为空或已经核清。原始接口拒绝范围仍保留，不能用摘要自检代替原始完整盘点。', '',
      '| 客户 | 来源 ID | 自检问题 | 金额依据 |', '| --- | --- | --- | --- |')
    for(const row of supplement.relevant_issues)lines.push(`| ${cell(row.customer_name)} | ${cell(row.source_id)} | ${cell(row.message)}（${cell(row.code)}） | ${cell(JSON.stringify(row.details||{}))} |`)
    if(!supplement.relevant_issues.length)lines.push('| — | — | 补充读取范围内无相关问题 | — |')
    for(const row of supplement.failed)lines.push(`\n- ${cell(row.customer_name)}（${row.customer_id}）：补充自检未完成，${/Function Run Timeout/.test(row.reason)?'云函数超时（原错误与请求编号保留于 JSON）':cell(row.reason)}。${rawCovered.has(row.customer_id)?'该户原始快照已在后续重试补齐；补充自检的全局反向关系仍不能据此认定全数覆盖。':'原始范围缺口仍保留。'}`)
  }
  lines.push('', '## 范围与证据', '',
    '- 客户列表使用 visibility=all，不按停用或隐藏状态过滤；原始快照按客户读取全部日期及状态，原接口拒绝的客户不被静默省略。',
    '- 每户相邻两次原始读取，校验服务端哈希及原始表内容一致；客户清单再读校验 ID、结算归属、隐藏和启用范围。',
    '- 原始接口含销售、收款/退款、分配、流量结算、历史欠款及调整、押金等资料，并校验部分反向关联。跨客户退款数组等全局反向关系仍需现有对账自检补充，不能凭单户原始快照断言不存在。',
    '- 检查包含：负销售与入池额度差额、来源金额守恒、分配合计与关联、同操作分配重复、正式退款关联及来源累计退款、待核退款。未知分类不按零计算，多笔来源本身不当作重复。',
    '- 现金真实性、历史手工迁移与调整的商业依据仍需凭据；不从 payment_status=paid 推导现金已退，不从入池推导额度已使用。',
    '- inventory_source.json 指明本报告使用的原始 inventory.json 路径；report.json 保留每条问题的证据哈希及关联 ID；原始目录单户 first/second 文件保留回包。', '')
  return lines.join('\n')
}

function attachExistingAudit(report, audit) {
  const known=new Set([...report.customers.map(row=>row.customer_id),...report.failures.map(row=>row.customer_id)])
  if(new Set(audit.customers.map(row=>row._id)).size!==audit.customers.length||audit.customers.some(row=>!known.has(row._id)))throw Error('补充自检不是原始盘点客户清单的无重复子集')
  const relevant=[],failed=[];let readComplete=0
  for(const customer of audit.customers){
    const result=audit.results[customer._id]
    if(!result?.read_complete||!result.source_hash){failed.push({customer_id:customer._id,customer_name:customer.name,reason:result?.error||result?.issues?.find(row=>row.code==='source_read_incomplete')?.details?.reason||'读取不完整'});continue}
    readComplete++
    const offsetIds=new Set((result.sources?.receipts||[]).filter(row=>text(row.source_type).startsWith('sale_offset_credit')).map(row=>row.id))
    for(const issue of result.issues||[]){
      if(/offset|refund/.test(issue.code)||offsetIds.has(issue.source_id)||['cross_customer_reference','settlement_scope_requires_review','hidden_delivery_scope'].includes(issue.code))
        relevant.push({...issue,customer_id:customer._id,customer_name:customer.name,evidence_hash:result.source_hash})
    }
  }
  report.existing_audit={total:audit.customers.length,read_complete:readComplete,failed,relevant_issues:relevant,evidence:audit.evidence}
  return report
}

const writePrivate = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
async function collect({ client, token, spaceId, out, concurrency = 3, requestId, reuseFrom }) {
  const allow = new Set(['crm-customer/listV1', 'crm-accounting-correction/inspectV1'])
  let authenticationFailed=false
  const call = async (name, action, data) => {
    if (!allow.has(name + '/' + action)) throw Error('只读盘点拒绝非白名单动作')
    if(authenticationFailed)throw Object.assign(Error('会话不可用，本批已停止'),{code:401})
    const result = await client.callFunction(name, { action, data, token, request_id: requestId() })
    if(result?.code===401||result?.code===403)authenticationFailed=true
    if (result?.code !== 0) throw Object.assign(Error(`${action}: ${result?.code} ${result?.msg || '读取失败'}`),{code:result?.code})
    return result
  }
  const listAll = async () => {
    const rows = []; let expected = null
    for (let page=1;page<=100;page++) {
      const r = await call('crm-customer','listV1',{visibility:'all',page,pageSize:50,include_summary:false,include_deposit:false})
      if (!Array.isArray(r.data) || !Number.isInteger(r.total) || r.total < 0) throw Error('客户分页缺少完整性依据')
      if (expected == null) expected = r.total
      if (expected !== r.total) throw Error('客户总数在分页期间变化')
      rows.push(...r.data)
      if (rows.length === expected && !r.paging?.hasMore) {
        if (new Set(rows.map(row=>row._id)).size !== expected) throw Error('客户分页存在重复')
        return rows
      }
      if (!r.data.length || rows.length > expected) throw Error('客户分页缺失或超出总数')
    }
    throw Error('客户分页超过上限')
  }
  const started = new Date().toISOString(), customers = await listAll(), snapshots = {}
  writePrivate(path.join(out,'customers-before.json'),customers)
  let next=0, completed=0
  async function worker() {
    while(next < customers.length&&!authenticationFailed) {
      const customer = customers[next++]
      try {
        const priorA=reuseFrom&&path.join(reuseFrom,`${customer._id}-first.json`),priorB=reuseFrom&&path.join(reuseFrom,`${customer._id}-second.json`)
        if(priorA&&fs.existsSync(priorA)&&fs.existsSync(priorB)){
          const a=JSON.parse(fs.readFileSync(priorA,'utf8')),b=JSON.parse(fs.readFileSync(priorB,'utf8'))
          if(a.data?.complete&&b.data?.complete&&a.data.snapshot_hash===b.data.snapshot_hash&&digest(a.data.tables)===digest(b.data.tables)){
            writePrivate(path.join(out,`${customer._id}-first.json`),a);writePrivate(path.join(out,`${customer._id}-second.json`),b)
            snapshots[customer._id]={stable:true,snapshot:b.data,first_read_started_at:a.data.read_started_at,first_read_completed_at:a.data.read_completed_at,reused_from:path.resolve(reuseFrom)}
            completed++;continue
          }
        }
        const a = await call('crm-accounting-correction','inspectV1',{customer_id:customer._id})
        writePrivate(path.join(out,`${customer._id}-first.json`),a)
        const b = await call('crm-accounting-correction','inspectV1',{customer_id:customer._id})
        writePrivate(path.join(out,`${customer._id}-second.json`),b)
        if (!a.data?.complete || !b.data?.complete || !a.data?.snapshot_hash || a.data.snapshot_hash !== b.data.snapshot_hash || digest(a.data.tables)!==digest(b.data.tables)) throw Error('客户原始资料双读不一致或不完整')
        snapshots[customer._id]={stable:true,snapshot:b.data,first_read_started_at:a.data.read_started_at,first_read_completed_at:a.data.read_completed_at}
      } catch(error) { snapshots[customer._id]={stable:false,error:String(error.message).slice(0,240)}; writePrivate(path.join(out,`${customer._id}-error.json`),snapshots[customer._id]);if(error.code===401||error.code===403)throw Error('认证或权限失败，已停止本批；请复用有效会话后恢复，不能继续把失败当资料缺失') }
      completed++
      if(completed%10===0||completed===customers.length) console.log(JSON.stringify({stage:'read_only_snapshots',completed,total:customers.length,failed:Object.values(snapshots).filter(row=>!row.stable).length}))
    }
  }
  await Promise.all(Array.from({length:Math.max(1,Math.min(4,concurrency))},worker))
  const after = await listAll();writePrivate(path.join(out,'customers-after.json'),after)
  const fingerprint = rows => digest(rows.map(row=>[row._id,row.settlement_customer_id||'',row.is_hidden===true,row.is_active!==false]).sort((a,b)=>a[0].localeCompare(b[0])))
  return {customers,snapshots,evidence:{provider:'alipay',space_id:spaceId,read_started_at:started,earliest_source_read_at:Math.min(...Object.values(snapshots).filter(r=>r.stable).map(r=>r.first_read_started_at)),read_completed_at:new Date().toISOString(),customer_inventory_stable:fingerprint(customers)===fingerprint(after),reused_customer_count:Object.values(snapshots).filter(row=>row.reused_from).length,visibility:'all',includes_hidden_and_inactive:true,period:'all records returned by customer-scoped raw snapshot; no date filter',atomic_snapshot:false,limitation:'逐户相邻双读只能检测可见变化，非全库同一时点快照；合并结算户或反向关联异常可能被现有原始接口拒绝，拒绝范围单列。'}}
}

async function existingAudit({client,token,customers,spaceId,out,requestId,reuseFrom}) {
  // This existing endpoint performs its own complete scope/reverse-link reads and
  // repeat hash check. Do not replace it with refreshReconciliationCacheV1.
  const results={},started=new Date().toISOString();let next=0,completed=0,authenticationFailed=false
  async function worker(){while(next<customers.length&&!authenticationFailed){const customer=customers[next++]
    try {
      const prior=reuseFrom&&path.join(reuseFrom,customer._id+'.json')
      if(prior&&fs.existsSync(prior)){
        const response=JSON.parse(fs.readFileSync(prior,'utf8'))
        if(response.code===0&&response.data?.read_complete&&response.data?.source_hash){
          writePrivate(path.join(out,customer._id+'.json'),response);results[customer._id]=response.data;completed++;continue
        }
      }
      const response=await client.callFunction('crm-customer-settlement',{action:'inspectReconciliationCustomerV1',token,data:{customer_id:customer._id},request_id:requestId()})
      writePrivate(path.join(out,customer._id+'.json'),response)
      if(response?.code===401||response?.code===403){authenticationFailed=true;throw Object.assign(Error('会话或权限失效，停止补充自检'),{authenticationFailed:true})}
      if(response?.code!==0)throw Error(`${response?.code} ${response?.msg||'自检失败'}`)
      results[customer._id]=response.data
    }catch(error){results[customer._id]={read_complete:false,error:String(error.message).slice(0,240)};if(error.authenticationFailed)throw error}
    completed++;if(completed%10===0||completed===customers.length)console.log(JSON.stringify({stage:'existing_read_only_audit',completed,total:customers.length}))
  }}
  await Promise.all(Array.from({length:3},worker))
  return {customers,results,evidence:{provider:'alipay',space_id:spaceId,action:'inspectReconciliationCustomerV1',read_started_at:started,read_completed_at:new Date().toISOString(),atomic_snapshot:false,source_customer_inventory:'visibility=all; external full inventory'}}
}

async function permissionInventory({client,token,spaceId,requestId}) {
  const started=new Date().toISOString()
  // Normal user-management read emits its existing read audit log. It never
  // changes users or permissions; only whitelisted nonsecret fields are kept.
  const result=await client.callFunction('crm-user',{action:'listManageV1',token,data:{},request_id:requestId()})
  if(result?.code!==0||!Array.isArray(result.data))throw Error(`账号读取失败：${result?.code} ${result?.msg||''}`)
  const {hasPagePermission,isSuperAdmin}=require('../uniCloud-alipay/cloudfunctions/crm-customer-settlement/pageAclLocal')
  const rows=result.data.map(user=>{
    const permitted=(page,action)=>hasPagePermission(user,page,action)
    const create=permitted('/pages/sale/edit','create'),edit=permitted('/pages/sale/edit','update'),settle=permitted('/pages/sale/settlement','update'),statement=permitted('/pages/customer/statement','update'),useCredit=permitted('/pages/sale/apply-offset-credit','update')
    const sync=['superadmin','admin','finance','user'].includes(user.role)&&(isSuperAdmin(user)||statement||create||edit||permitted('/pages/sale/detail','update'))
    return {username:text(user.username),role:text(user.role),role_template:text(user.role_template||user.role),sale_create:create,sale_edit:edit,sale_settlement_update:settle,customer_statement_update:statement,apply_offset_credit_permission:useCredit,sale_apply_offset_credit_allowed:settle&&useCredit,legacy_offset_sync_allowed:sync,settlement_update_without_sync_permission:settle&&!sync,pda_sale_create:permitted('/pages/pda/sale-create','create')}
  }).sort((a,b)=>a.username.localeCompare(b.username))
  return {provider:'alipay',space_id:spaceId,read_started_at:started,read_completed_at:new Date().toISOString(),action:'crm-user.listManageV1',normal_read_audit_log:true,users_or_permissions_written:false,complete:false,limitation:'接口无count或分页完成依据；仅证明本次返回列表。effective按服务端规范化用户权限与本地pageAcl helper解析，不能证明未返回账号。',rows,
    summary:{returned:rows.length,settlement_update_without_sync:rows.filter(row=>row.settlement_update_without_sync_permission).length,can_use_credit:rows.filter(row=>row.sale_apply_offset_credit_allowed).length,can_update_statement:rows.filter(row=>row.customer_statement_update).length}}
}

async function main() {
  const arg = name => process.argv.find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3)
  const out=path.resolve(arg('out')||'')
  if(!arg('out')) throw Error('必须指定 --out=受控输出目录')
  if(fs.existsSync(out)&&fs.readdirSync(out).length) throw Error('输出目录非空，不能覆盖证据')
  fs.mkdirSync(out,{recursive:true,mode:0o700});fs.chmodSync(out,0o700)
  let inventory
  if(arg('input')) inventory=JSON.parse(fs.readFileSync(path.resolve(arg('input')),'utf8'))
  else {
    if(!arg('space-id'))throw Error('必须明确 --space-id=正式空间')
    const lib=require('./lib/qrImportCommon.cjs'),options=lib.parseStandardArgs(['node','audit','--space-id',arg('space-id')])
    const {client}=await lib.prepareClientOptions(options)
    if(arg('token-file'))options.crmToken=fs.readFileSync(path.resolve(arg('token-file')),'utf8').trim()
    if(!options.crmToken&&!process.argv.includes('--use-configured-login'))throw Error('必须提供已有 token-file 或明确使用既有登录配置')
    const token=options.crmToken||await lib.ensureCrmToken(client,options)
    if(arg('save-token-to')) fs.writeFileSync(path.resolve(arg('save-token-to')),token,{flag:'wx',mode:0o600})
    if(process.argv.includes('--permissions')) {
      const result=await permissionInventory({client,token,spaceId:options.spaceId,requestId:lib.generateRequestId})
      writePrivate(path.join(out,'permissions.json'),result)
      console.log(JSON.stringify({stage:'permissions_read',out,summary:result.summary,complete:result.complete}));return
    }
    if(arg('existing-audit-customers')) {
      const customers=JSON.parse(fs.readFileSync(path.resolve(arg('existing-audit-customers')),'utf8'))
      if(!Array.isArray(customers)||new Set(customers.map(row=>row._id)).size!==customers.length)throw Error('客户清单不完整或重复')
      const result=await existingAudit({client,token,customers,spaceId:options.spaceId,out,requestId:lib.generateRequestId,reuseFrom:arg('resume-from')&&path.resolve(arg('resume-from'))})
      writePrivate(path.join(out,'existing-audit.json'),result)
      console.log(JSON.stringify({stage:'existing_audit_complete',total:customers.length,read_complete:Object.values(result.results).filter(row=>row.read_complete).length,out}));return
    }
    inventory=await collect({client,token,spaceId:options.spaceId,out,requestId:lib.generateRequestId,reuseFrom:arg('resume-from')&&path.resolve(arg('resume-from'))})
    writePrivate(path.join(out,'inventory.json'),inventory)
  }
  const report=summarize(inventory)
  report.evidence.customer_scope_counts={hidden:inventory.customers.filter(row=>row.is_hidden===true).length,inactive:inventory.customers.filter(row=>row.is_active===false).length}
  if(arg('existing-audit-file'))attachExistingAudit(report,JSON.parse(fs.readFileSync(path.resolve(arg('existing-audit-file')),'utf8')))
  writePrivate(path.join(out,'report.json'),report)
  writePrivate(path.join(out,'inventory_source.json'),{inventory_path:path.resolve(arg('input')||path.join(out,'inventory.json')),inventory_sha256:digest(inventory),existing_audit_path:arg('existing-audit-file')?path.resolve(arg('existing-audit-file')):null,script_version:VERSION})
  fs.writeFileSync(path.join(out,'待确认清单.md'),renderMarkdown(report),{flag:'wx',mode:0o600})
  console.log(JSON.stringify({stage:'inventory_report',out,complete:report.complete,customers_total:report.customers_total,customers_audited:report.customers_audited,failures:report.failures.length,counts:report.counts}))
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1})
module.exports={auditSnapshot,summarize,collect,existingAudit,permissionInventory,attachExistingAudit,digest,renderMarkdown,VERSION}
