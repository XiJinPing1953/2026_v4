'use strict'

const crypto = require('crypto')
const text = value => String(value ?? '').trim()
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  return value
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
const sourceVersion = row => digest(row)
const operationKey = (customerId, operationId) => 'offset-' + digest([customerId, operationId]).slice(0, 40)
function identity(data) {
  const customerId = text(data.customer_id || data.customerId)
  const operationId = text(data.operation_id || data.operationId)
  if (!customerId || !operationId || operationId.length > 100) throw Object.assign(new Error('缺少有效冲抵操作号，请刷新网页后重试'), { code: 409 })
  return { customerId, operationId, key: operationKey(customerId, operationId) }
}
function fingerprint(data) {
  return digest({
    customer_id: text(data.customer_id || data.customerId), receipt_id: text(data.receipt_id || data.receiptId),
    amount: data.amount == null ? null : Number(data.amount),
    expected_source_version: text(data.expected_source_version),
    allocation_mode: text(data.allocation_mode || data.allocationMode),
    allocation_start_date: text(data.allocation_start_date || data.allocationStartDate),
    allocation_end_date: text(data.allocation_end_date || data.allocationEndDate),
    allocation_targets: (data.allocation_targets || data.allocationTargets || []).map(row => ({
      target_type: text(row.target_type || row.targetType), target_id: text(row.target_id || row.targetId)
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  })
}
async function read(database, data, expectedFingerprint) {
  const { customerId, operationId, key } = identity(data)
  const res = await database.collection('crm_operation_logs').where({ _id: key }).limit(1).get()
  const row = Array.isArray(res.data) ? res.data[0] : res.data
  if (!row) return { status: 'not_found', operation_id: operationId }
  if (row.action !== 'offset_allocation_committed_v1' || row.detail?.customer_id !== customerId ||
    (expectedFingerprint && row.detail.fingerprint !== expectedFingerprint)) {
    throw Object.assign(new Error('该操作号已用于其他冲抵内容，请查询原操作结果'), { code: 409 })
  }
  return { status: 'saved', operation_id: operationId, result: row.detail.result }
}
module.exports = { digest, sourceVersion, operationKey, identity, fingerprint, read }
