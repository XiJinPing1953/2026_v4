'use strict'

const crypto = require('crypto')
const RULE_VERSION = 'customer-deposit/2026-09-12.1'
const TABLES = { accounts: 'crm_customer_deposit_accounts', entries: 'crm_customer_deposit_entries',
  customers: 'crm_customers', receipts: 'crm_customer_receipts', allocations: 'crm_customer_allocations',
  adjustments: 'crm_customer_receipt_adjustments' }
const KINDS = ['receive', 'refund', 'opening', 'transfer']
const METHODS = ['cash', 'bank', 'wechat', 'alipay', 'check', 'unknown']
const fail = (message, code = 409, details = {}) => { throw Object.assign(new Error(message), { code, details }) }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]))
  return value
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const accountId = customerId => digest(['deposit-account-v1', customerId]).slice(0, 24)
const entryId = (customerId, operationId) => digest(['deposit-operation-v1', customerId, operationId]).slice(0, 24)
const receiptId = id => digest(['deposit-transfer-receipt-v1', id]).slice(0, 24)
function text(value, label, { required = false, max = 1000 } = {}) {
  if (value != null && typeof value !== 'string') fail(`${label}格式无效`, 400)
  const result = String(value || '').trim()
  if ((required && !result) || result.length > max) fail(`${label}${!result ? '必填' : '过长'}`, 400)
  return result
}
function customerId(value) { return text(value, '客户编号', { required: true, max: 120 }) }
function operationId(value) {
  const result = text(value, '操作号', { required: true, max: 120 })
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{7,119}$/.test(result)) fail('操作号须为8至120位字母、数字或连接符', 400)
  return result
}
function date(value, required = true) {
  const result = text(value, '业务日期', { required, max: 10 })
  if (!result && !required) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result < '1900-01-01' || result > '9999-12-31') fail('请填写真实业务日期（YYYY-MM-DD）', 400)
  const parsed = new Date(`${result}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) fail('业务日期不存在', 400)
  return result
}
function toScaled(value, scale = 2, { allowZero = false, label = '金额' } = {}) {
  if (!['number', 'string'].includes(typeof value)) fail(`${label}格式无效`, 400)
  const source = String(value).trim(), match = source.match(new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${scale}}))?$`))
  if (!match) fail(`${label}须为非负数且最多${scale}位小数`, 400)
  const result = Number(match[1]) * (10 ** scale) + Number((match[2] || '').padEnd(scale, '0'))
  if (!Number.isSafeInteger(result) || result > 9000000000000 || (!allowZero && result === 0)) fail(`${label}必须大于0且不超过允许范围`, 400)
  return result
}
function checkedSum(values) {
  return values.reduce((sum, value) => {
    const next = sum + value
    if (!Number.isSafeInteger(next) || Math.abs(next) > 9000000000000) fail('押金余额超过安全计算范围')
    return next
  }, 0)
}
function version(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('请重新预览取得有效账户版本', 400)
  return value
}
function normalizeCreate(data) {
  const kind = text(data.kind, '押金类型', { required: true, max: 12 })
  if (!KINDS.includes(kind)) fail('押金类型无效', 400)
  const method = text(data.payment_method, '收付款渠道', { required: true, max: 20 })
  if (!METHODS.includes(method)) fail('收付款渠道无效', 400)
  if (['opening', 'transfer'].includes(kind) && method !== 'unknown') fail('期初转入和转气款不产生新现金收付，渠道应为unknown', 400)
  const normalized = { customer_id: customerId(data.customer_id), kind, amount_cents: toScaled(data.amount),
    biz_date: date(data.biz_date), payment_method: method, voucher_ref: text(data.voucher_ref, '凭据编号', { max: 200 }),
    note: text(data.note, '说明', { max: 1000 }) }
  if (kind === 'opening' && !normalized.voucher_ref && !normalized.note) fail('期初转入须填写原始凭据或核实说明', 400)
  if (kind === 'transfer' && !normalized.note) fail('押金转气款须填写经确认的转款说明', 400)
  return { command: { action: 'create', ...normalized }, operation_id: operationId(data.operation_id), expected_version: version(data.expected_version) }
}
function normalizeVoid(data) {
  return { command: { action: 'void', customer_id: customerId(data.customer_id),
    entry_id: text(data.entry_id, '押金流水编号', { required: true, max: 120 }),
    reason: text(data.reason, '作废原因', { required: true, max: 1000 }) },
  operation_id: operationId(data.operation_id), expected_version: version(data.expected_version) }
}
const delta = row => row.status === 'posted' && KINDS.includes(row.kind)
  ? (['receive', 'opening'].includes(row.kind) ? row.amount_cents : -row.amount_cents) : 0
const ordered = rows => [...rows].sort((a, b) => a.biz_date.localeCompare(b.biz_date) || a.account_version - b.account_version)
function historyBalance(rows) {
  let balance = 0
  for (const row of ordered(rows)) {
    balance = checkedSum([balance, delta(row)])
    if (balance < 0) fail(`该操作会使${row.biz_date}的押金余额为负，请核对业务日期和原始押金`, 409,
      { reason: 'negative_history', biz_date: row.biz_date })
  }
  return balance
}
function publicEntry(row) {
  const keys = ['_id', 'customer_id', 'kind', 'biz_date', 'payment_method', 'voucher_ref', 'note', 'status',
    'operation_id', 'account_version', 'created_at', 'created_by', 'created_by_name', 'updated_at',
    'receipt_id', 'original_entry_id', 'reason', 'void_reason', 'voided_at', 'voided_by', 'voided_by_name', 'void_entry_id']
  return { ...Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]])),
    amount: row.amount_cents / 100, amount_cents: row.amount_cents,
    cash_direction: row.kind === 'receive' ? 'in' : row.kind === 'refund' ? 'out' : 'none' }
}
module.exports = { RULE_VERSION, TABLES, KINDS, METHODS, fail, digest, accountId, entryId, receiptId,
  text, customerId, operationId, date, toScaled, checkedSum, version, normalizeCreate, normalizeVoid, delta, ordered, historyBalance, publicEntry }
