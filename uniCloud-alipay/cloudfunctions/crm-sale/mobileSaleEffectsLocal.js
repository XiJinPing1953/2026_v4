'use strict'

// A capability is generated inside the winning create request, never returned to clients.
// Each fixed downstream step is claimed once before execution; failures require review.
const crypto = require('crypto')
const OPERATIONS = 'crm_mobile_sale_operations'
const SALES = 'crm_sale_records'
const text = value => String(value == null ? '' : value).trim()
const first = result => Array.isArray(result?.data) ? result.data[0] : result?.data
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex')
const newToken = () => crypto.randomBytes(32).toString('hex')
const denied = () => ({ ok: false, code: 403, msg: '无权执行该手机销售关联处理，或原步骤已执行，请核查原操作' })
const keysEqual = (data, keys) => data && typeof data === 'object' && !Array.isArray(data)
  && Object.keys(data).sort().join('|') === keys.slice().sort().join('|')
const bottleNos = rows => [...new Set((rows || []).map(row => text(row.bottle_no).toUpperCase().replace(/\s+/g, '')).filter(Boolean))].sort()
function sameNos(actual, expected) {
  return Array.isArray(actual) && actual.every(value => typeof value === 'string')
    && JSON.stringify(actual.slice().sort()) === JSON.stringify(expected)
}
function matchesScope(cloudFunction, action, data, sale) {
  if (cloudFunction === 'crm-customer-settlement' && action === 'autoApplyPrepayToSaleV1') {
    return keysEqual(data, ['sale_id', 'exclude_offset_credit'])
      && data.sale_id === sale._id && data.exclude_offset_credit === true
  }
  if (cloudFunction === 'crm-filling' && action === 'syncStartLossAdjustmentsV1') {
    const back = bottleNos(sale.back_items)
    return back.length > 0 && keysEqual(data, ['bottle_nos']) && sameNos(data.bottle_nos, back)
  }
  if (cloudFunction === 'crm-bottle-anomaly' && action === 'touchV2') {
    const all = bottleNos([...(sale.out_items || []), ...(sale.back_items || []), ...(sale.deposit_rows || [])])
    return all.length > 0 && keysEqual(data, ['bottle_nos', 'truck_nos', 'batch_size', 'max_events_per_round', 'max_ms_per_round', 'max_writes_per_round'])
      && sameNos(data.bottle_nos, all) && sameNos(data.truck_nos, [])
      && data.batch_size === 120 && data.max_events_per_round === 800
      && data.max_ms_per_round === 2200 && data.max_writes_per_round === 120
  }
  return false
}
async function authorizeMobileSaleEffect({ db, user, hasPagePermission, cloudFunction, action, data, capability }) {
  if (!capability || !/^[a-f0-9]{24}$/.test(capability.operation_key || '') || !/^[a-f0-9]{64}$/.test(capability.token || '')
    || !text(user?._id) || !hasPagePermission(user, '/pages/pda/sale-create', 'create')) return denied()
  let tx
  try {
    tx = await db.startTransaction()
    const operation = first(await tx.collection(OPERATIONS).where({ _id: capability.operation_key }).limit(1).get())
    if (!operation || operation.processing_state !== 'processing' || operation.created_by !== user._id
      || !/^[a-f0-9]{64}$/.test(operation.side_effect_token_hash || '')
      || !crypto.timingSafeEqual(Buffer.from(operation.side_effect_token_hash, 'hex'), Buffer.from(tokenHash(capability.token), 'hex'))) {
      await tx.rollback(); return denied()
    }
    const sale = first(await tx.collection(SALES).where({ _id: operation.sale_id }).limit(1).get())
    if (!sale || sale._id !== operation.sale_id || sale.created_by !== user._id
      || sale.mobile_create_operation_key !== operation._id || sale.mobile_create_state !== 'processing'
      || sale.source !== 'mobile-sale-v1' || sale.biz_mode !== 'bottle' || sale.price_unit !== 'kg' || sale.settlement_mode !== 'sale'
      || sale.amount_received !== 0 || sale.apply_offset_credit !== false || sale.offset_enabled !== false
      || !text(sale.customer_id) || !matchesScope(cloudFunction, action, data, sale)) {
      await tx.rollback(); return denied()
    }
    const step = `${cloudFunction}:${action}`
    const claims = Array.isArray(operation.side_effect_claims) ? operation.side_effect_claims : []
    if (claims.includes(step)) { await tx.rollback(); return denied() }
    const result = await tx.collection(OPERATIONS).where({ _id: operation._id, processing_state: 'processing',
      side_effect_token_hash: operation.side_effect_token_hash, side_effect_claims: db.command.nin([step])
    }).update({ side_effect_claims: [...claims, step], updated_at: Date.now() })
    if (Number(result.updated) !== 1) throw new Error('Mobile sale effect claim changed')
    await tx.commit()
    return { ok: true, saleId: sale._id, customerId: sale.customer_id }
  } catch (error) {
    if (tx) { try { await tx.rollback() } catch (_) { /* committed/uncertain: never retry the step */ } }
    return { ok: false, code: 503, msg: '手机销售关联处理授权未确认，请核查原操作，勿重复执行' }
  }
}
module.exports = { authorizeMobileSaleEffect, matchesScope, newToken, tokenHash }
