'use strict'
const accounting = require('./saleAccountingLocal')
const { readComplete } = require('./financialReadLocal')
const fail = message => { throw Object.assign(new Error(message), { code: 409 }) }
function financialIdentity(sale) {
  if (!sale) return null
  const { amounts } = accounting.computeSaleAmountsForDoc(sale)
  return JSON.stringify([sale.customer_id, sale.date, accounting.resolveSettlementMode(sale),
    amounts.effective_should_receive, Number(sale.amount_received || 0), Number(sale.rounding_amount || 0),
    sale.offset_enabled ?? true])
}
async function assertOffsetSourceEditable(db, before, after) {
  if (!before || financialIdentity(before) === financialIdentity(after)) return
  if (!after && before.offset_use_revision && before.offset_use_status !== 'completed') fail('该单使用冲抵款的结果待核，请先查询原操作结果后再删除')
  const targetLinks = await readComplete(db.collection('crm_customer_allocations'), db.command.or([{ target_id: before._id }, { sale_id: before._id }]), { command: db.command, source: 'sale_target_edit_guard' })
  if (targetLinks.some(row => !['void','voided','cancelled'].includes(row.status))) fail('该单已关联收款或冲抵分配，金额变更须先核对关联记录，未修改源单')
  const rows = await readComplete(db.collection('crm_customer_receipts'), { source_id: before._id }, {
    command: db.command, source: 'sale_offset_edit_guard'
  })
  if (rows.some(row => String(row.source_type || '').startsWith('sale_offset_credit'))) {
    fail('该单已有冲抵来源，金额、日期、客户或入池设置变更须先核对关联账务，未修改源单')
  }
  if (!after && before.offset_sync_revision && before.offset_sync_status !== 'completed') {
    fail('该单冲抵同步结果待核，请先确认原操作结果后再删除')
  }
}
module.exports = { assertOffsetSourceEditable, financialIdentity }
