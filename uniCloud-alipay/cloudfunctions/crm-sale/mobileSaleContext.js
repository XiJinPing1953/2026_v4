'use strict'

const { createHash } = require('crypto')
const PAGE = '/pages/pda/sale-create'
const text = value => String(value || '').trim()
const first = response => Array.isArray(response?.data) ? response.data[0] : response?.data
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// One foreground subscription covers the account and its selected customer's entire
// settlement chain. Return only after a relevant value changes or the watch expires.
function createMobileSaleContext({ db, resolveCustomerRefs, resolvePricing, hasPermission, isAdmin, wait = pause }) {
  function authorized(actor, token) {
    return actor && actor.token === token && actor.is_active !== false && hasPermission(actor, PAGE, 'create')
  }
  async function snapshot(user, customerId) {
    const defaults = user.mobile_sale_defaults || {}
    const data = {
      bound: !isAdmin(user), vehicleId: text(defaults.vehicle_id), vehicleNo: text(defaults.vehicle_no),
      pendingVehicleNo: text(user.mobile_sale_pending_vehicle?.vehicle_no),
      delivery1: text(defaults.delivery1), delivery2: text(defaults.delivery2),
      customerId, customer: null, issue: ''
    }
    if (customerId) {
      const refs = await resolveCustomerRefs(customerId)
      if (!refs.ok || refs.chain.some(row => row.is_active === false)) data.issue = '客户或结算客户已停用或不可用'
      else {
        const price = resolvePricing(refs)
        data.customer = {
          _id: customerId, name: refs.deliveryCustomer.name,
          effective_settlement_customer_id: refs.billingCustomer._id, effective_settlement_customer_name: refs.billingCustomer.name,
          default_price_unit: price.priceUnit, default_unit_price: price.unitPrice, is_active: true
        }
      }
    }
    const version = createHash('sha256').update(JSON.stringify(data)).digest('hex')
    return { ...data, version }
  }
  function transfer(defaults, pending) {
    return { mobile_sale_vehicle_ticket: null, mobile_sale_pending_vehicle: null,
      mobile_sale_defaults: { ...defaults, vehicle_id: pending.vehicle_id, vehicle_no: pending.vehicle_no } }
  }
  const due = actor => actor?.mobile_sale_pending_vehicle?.apply_by > 0 && actor.mobile_sale_pending_vehicle.apply_by <= Date.now()

  async function resolveDue(actor) {
    if (!due(actor)) return actor
    const tx = await db.startTransaction()
    try {
      const ref = tx.collection('crm_users').doc(actor._id)
      const fresh = first(await ref.get())
      if (!authorized(fresh, actor.token) || !due(fresh)) { await tx.rollback(); return fresh }
      const patch = transfer(fresh.mobile_sale_defaults, fresh.mobile_sale_pending_vehicle)
      await ref.update(patch)
      await tx.commit()
      return { ...fresh, ...patch }
    } catch (error) {
      try { await tx.rollback() } catch (_) {}
      throw error
    }
  }

  async function watch(user, data) {
    const customerId = text(data.customerId)
    if (customerId.length > 128) return { code: 400, msg: '客户标识无效' }
    for (let attempt = 0; ; attempt++) {
      const actor = attempt === 0 ? user : first(await db.collection('crm_users').doc(user._id).get())
      if (!authorized(actor, user.token)) return { code: 403, msg: '销售权限已变化' }
      const current = await resolveDue(actor)
      if (!authorized(current, user.token)) return { code: 403, msg: '销售权限已变化' }
      const result = await snapshot(current, customerId)
      if (result.version !== data.version || attempt >= 5) return { code: 0, data: result }
      await wait(2000)
    }
  }

  // Serialize first-bottle selection, office rebind and ticket completion on the
  // same account document. An ordinary rebind takes effect at the ticket boundary.
  async function vehicleTicket(user, data) {
    const ticket = text(data.ticket)
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(ticket) || !['claim','release'].includes(data.mode)) return { code: 400, msg: '销售草稿标识无效' }
    const tx = await db.startTransaction()
    try {
      const ref = tx.collection('crm_users').doc(user._id)
      const actor = first(await ref.get())
      if (!authorized(actor, user.token)) throw Object.assign(Error('销售权限已变化'), { code: 403 })
      const defaults = actor.mobile_sale_defaults || {}
      const active = actor.mobile_sale_vehicle_ticket
      const pending = actor.mobile_sale_pending_vehicle
      let patch = null
      if (data.mode === 'release') {
        if (active?.id === ticket) {
          patch = { mobile_sale_vehicle_ticket: null, mobile_sale_pending_vehicle: null }
          if (pending) patch = transfer(defaults, pending)
        }
      } else if (!isAdmin(actor)) {
        const occupied = active && active.id !== ticket && !active.saved && !(active.expires_at > 0 && active.expires_at <= Date.now())
        if (occupied && !due(actor)) throw Error('本车另一张销售草稿仍在录入')
        if (due(actor) || (active?.id !== ticket && pending)) {
          // The previous ticket is saved. Switch ownership before accepting a new bottle.
          patch = transfer(defaults, pending)
        } else {
          if (!defaults.vehicle_id || defaults.vehicle_id !== data.vehicleId || defaults.vehicle_no !== data.vehicleNo) throw Error('车辆绑定已更新，请等车辆资料同步后再扫码')
          if (active?.id !== ticket) patch = { mobile_sale_vehicle_ticket: { id: ticket, vehicle_id: defaults.vehicle_id, saved: false, expires_at: Date.now() + 12 * 60 * 60 * 1000 } }
        }
      }
      if (patch) await ref.update(patch)
      await tx.commit()
      if (data.mode === 'claim' && patch?.mobile_sale_defaults) return { code: 409, msg: '新车绑定已生效，请重新扫码' }
      return { code: 0 }
    } catch (err) {
      try { await tx.rollback() } catch (_) {}
      return { code: err.code === 403 ? 403 : 409, msg: err.message || '车辆资料正在更新，请稍后重试' }
    }
  }
  return { watch, vehicleTicket }
}
module.exports = { createMobileSaleContext }
