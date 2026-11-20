'use strict'

const { vehicleScope } = require('./pdaSaleRecords')
const text = value => String(value == null ? '' : value).trim()
const first = result => Array.isArray(result?.data) ? result.data[0] : result?.data
function changed(message, errorCode = 'MOBILE_SALE_MASTER_CHANGED') {
  throw Object.assign(new Error(message), { code: 409, error_code: errorCode })
}

// Reuse the sale resolver, including delivery/customer pricing inheritance and
// hidden-customer rules. Only mobile creation requires these frozen defaults.
function createGuard({ db, resolveCustomerRefs, resolvePricing, isAdmin }) {
  async function read(database, user, payload) {
    const refs = await resolveCustomerRefs(payload.base.customerId, database)
    if (!refs.ok) changed(refs.msg)
    // Preserve historical archive semantics: only explicit false disables a customer.
    if (refs.chain.some(customer => customer.is_active === false)) changed('客户或结算客户已停用，请重新选择客户')
    const pricing = resolvePricing(refs)
    if (pricing.priceUnit !== 'kg' || !(pricing.unitPrice > 0) || pricing.unitPrice !== payload.base.unitPrice) {
      changed('客户单价已更新', 'MOBILE_SALE_PRICING_CHANGED')
    }
    if (!payload.base.settlementCustomerId || payload.base.settlementCustomerId !== text(refs.billingCustomer._id)) {
      changed('客户结算归属已更新', 'MOBILE_SALE_PRICING_CHANGED')
    }
    const currentUser = first(await database.collection('crm_users').doc(user._id).get())
    if (!currentUser || currentUser.is_active === false) changed('账号已停用或不存在，请重新登录')
    const authorization = row => JSON.stringify([row.role, row.role_template, row.page_permissions])
    if (currentUser.token !== user.token || authorization(currentUser) !== authorization(user)) changed('账号登录或权限已变化，请重新登录核对')
    let scope
    try { scope = vehicleScope(currentUser, isAdmin) } catch (error) { changed(error.message) }
    if (scope && (payload.base.carNo !== scope.car_no || (payload.base.vehicleId && payload.base.vehicleId !== text(currentUser.mobile_sale_defaults?.vehicle_id)))) {
      changed('销售车辆与账号绑定车辆不一致，请使用本车录单')
    }
    const active = currentUser.mobile_sale_vehicle_ticket
    const scheduled = currentUser.mobile_sale_pending_vehicle
    if (scope && scheduled?.apply_by > 0 && scheduled.apply_by <= Date.now()) changed('换车已生效，本单称重已保留')
    const expired = active?.expires_at > 0 && active.expires_at <= Date.now()
    const reserved = active && ((!active.saved && !expired) || scheduled)
    if (scope && (reserved || payload.base.vehicleTicket) && (active?.saved || !active || active.id !== payload.base.vehicleTicket || active.vehicle_id !== currentUser.mobile_sale_defaults?.vehicle_id)) {
      changed('本车销售草稿与当前绑定不一致，请联系办公室')
    }
    return { refs, currentUser, signature: JSON.stringify({
      customers: refs.chain.map(row => [text(row._id), text(row.settlement_customer_id), row.is_active !== false]),
      pricing, vehicle: scope, vehicleId: scope ? text(currentUser.mobile_sale_defaults?.vehicle_id) : '',
      authorization: authorization(currentUser)
    }) }
  }
  async function capture(user, payload) { return (await read(db, user, payload)).signature }
  async function lock(tx, user, payload, signature, doc) {
    const current = await read(tx, user, payload)
    if (current.signature !== signature || text(doc.customer_id) !== text(current.refs.billingCustomer._id)
      || text(doc.delivery_customer_id || doc.customer_id) !== text(current.refs.deliveryCustomer._id)) {
      changed('客户归属或账号资料在保存期间发生变化，请重新核对')
    }
    // A genuine write on each document acquires the same conflict boundary as
    // ordinary profile updates/deletes. A snapshot read alone is insufficient.
    // Use the existing updated_at field, as bottleSourceGuard already does.
    for (const [table, rows] of [['crm_customers', current.refs.chain], ['crm_users', [current.currentUser]]]) {
      for (const row of [...rows].sort((a, b) => String(a._id).localeCompare(String(b._id)))) {
        const patch = { updated_at: Math.max(Date.now(), Number(row.updated_at || 0) + 1) }
        if (table === 'crm_users' && payload.base.vehicleTicket && row.mobile_sale_vehicle_ticket) {
          const savedAt = Date.now()
          patch.mobile_sale_vehicle_ticket = { ...row.mobile_sale_vehicle_ticket, saved: true, saved_at: savedAt }
          if (row.mobile_sale_pending_vehicle) patch.mobile_sale_pending_vehicle = {
            ...row.mobile_sale_pending_vehicle, apply_by: Math.min(row.mobile_sale_pending_vehicle.apply_by || Infinity, savedAt + 90000)
          }
        }
        if (table === 'crm_users' && !payload.base.vehicleTicket && row.mobile_sale_vehicle_ticket?.expires_at <= Date.now()) {
          patch.mobile_sale_vehicle_ticket = null
        }
        const result = await tx.collection(table).doc(row._id).update(patch)
        if (Number(result.updated) !== 1) changed('档案在保存期间发生变化，请重新核对')
      }
    }
  }
  return { capture, lock }
}

module.exports = { createGuard }
