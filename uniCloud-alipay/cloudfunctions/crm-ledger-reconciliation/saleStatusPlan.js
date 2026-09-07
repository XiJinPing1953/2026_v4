// Status-only follow-up to an already committed, evidenced reconciliation.
'use strict'
const { digest, scaled } = require('./plan')
const fail = (ok, message) => { if (!ok) throw Error(message) }
const rowsDigest = rows => digest([...rows].sort((a, b) => String(a._id).localeCompare(String(b._id))))
function buildSaleStatusPlan(snapshot, parent, user, now) {
  fail(snapshot.complete === true && parent?.status === 'committed', '缺少完整回读或已完成的核对批次')
  const customerId = snapshot.customer_id
  fail(parent.customer_id === customerId && snapshot.tables.crm_customers[0]?._id === customerId, '客户范围不匹配')
  const original = parent.detail.plan
  const expected = structuredClone(parent.detail.before.tables)
  for (const write of original.writes) {
    const rows = expected[write.table] ||= []
    const index = rows.findIndex(row => row._id === write.id)
    if (index < 0) rows.push(write.after); else rows[index] = write.after
  }
  // Balance-cache refreshes are allowed; all business facts must be unchanged.
  for (const [table, rows] of Object.entries(expected)) {
    if (table === 'crm_customers') continue
    fail(rowsDigest(snapshot.tables[table] || []) === rowsDigest(rows), `核对后业务数据已变化：${table}`)
  }
  const sourceWrites = original.writes.filter(write => write.table === 'crm_sale_records' && write.before)
  fail(sourceWrites.length === original.summary.sales_reclassified && sourceWrites.length > 0, '状态修正范围不匹配')
  const runId = digest({ parent_run_id: parent.request_id, action: 'settle_reconciled_sales_v1' }).slice(0, 24)
  const writes = []; let linked = 0; let zero = 0
  for (const source of sourceWrites) {
    const row = snapshot.tables.crm_sale_records.find(item => item._id === source.id)
    fail(row?.settlement_mode === 'customer_flow' && row.payment_status === 'unpaid', '销售单已不属于本次待修正状态')
    fail(Number(row.amount_received || 0) === 0 && Number(row.rounding_amount || 0) === 0 && Number(row.receipt_rounding_amount || 0) === 0, '销售单存在未预期收款或抹零')
    const flowId = row.accounting_reconciliation?.flow_settlement_id || null
    let reason
    if (Number(row.flow_volume_m3 || 0) > 0) {
      const flow = snapshot.tables.crm_customer_flow_settlements.find(item => item._id === flowId)
      fail(flow?.customer_id === customerId && flow.status === 'posted' && flow.sale_ids?.includes(row._id), '缺少已确认的流量结算关联')
      fail(flow.payment_status === 'paid' && scaled(flow.amount_received || 0, 3) + scaled(flow.receipt_rounding_amount || 0, 3) >= scaled(flow.should_receive, 3), '关联流量账单尚未结清')
      reason = '销售应收已转入已结清的流量账单，本单不重复收款'
      linked++
    } else {
      fail(Number(row.flow_volume_m3 || 0) === 0 && !flowId, '零应收来源不匹配')
      reason = '本单无新增用气应收，无需单独付款'
      zero++
    }
    const patch = { payment_status: 'paid', updated_at: now,
      payment_note: `${row.payment_note || ''}\n状态修正：${reason}。`,
      settlement_status_correction: { run_id: runId, parent_run_id: parent.request_id, previous_payment_status: row.payment_status,
        flow_settlement_id: flowId, reason, confirmed_at: now, operator_id: user._id } }
    writes.push({ table: 'crm_sale_records', id: row._id, before: structuredClone(row), patch, after: { ...row, ...patch } })
  }
  const evidence = { parent_run_id: parent.request_id, parent_plan_hash: original.plan_hash, snapshot_hash: snapshot.snapshot_hash }
  return { run_id: runId, plan_hash: digest({ writes, evidence }), evidence, writes,
    summary: { write_count: writes.length, linked_flow_paid: linked, zero_receivable: zero, financial_amounts_changed: false } }
}
module.exports = { buildSaleStatusPlan }
