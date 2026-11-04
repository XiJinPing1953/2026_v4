'use strict'
const { withFillingPrintTimes } = require('./fillingPrintTime')
const text = v => String(v || '').trim()
function createService({ db, isAdmin, hiddenIds, amounts, mentionsHidden, project = doc => doc }) {
  function canReadHistory(user) {
    const defaults = user.mobile_sale_defaults || {}
    return isAdmin(user) || Boolean(text(defaults.vehicle_id) && text(defaults.vehicle_no))
  }
  async function list(user, data) {
    if (!canReadHistory(user)) return { code: 403, msg: '账号尚未绑定车辆，请联系管理员' }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) return { code: 400, msg: '请选择日期' }
    const conditions = [{ date: data.date }]
    const hidden = await hiddenIds()
    if (hidden.length) conditions.push({ customer_id: db.command.nin(hidden) }, { delivery_customer_id: db.command.nin(hidden) })
    const keyword = text(data.customer).slice(0, 80)
    if (keyword) {
      const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      conditions.push(db.command.or([{ customer_name: regex }, { delivery_customer_name: regex }]))
    }
    const page = Math.max(1, Math.floor(Number(data.page) || 1))
    const res = await db.collection('crm_sale_records').where(db.command.and(conditions)).orderBy('created_at', 'desc').orderBy('_id', 'desc').skip((page - 1) * 20).limit(21).get()
    return { code: 0, data: { rows: res.data.slice(0,20).map(r => ({ id: r._id, date: r.date, customer: r.delivery_customer_name || r.customer_name, vehicle: r.car_no, out_count: (r.out_items || []).length, back_count: (r.back_items || []).length, created_at: r.created_at, amount: amounts(r).amounts.effective_should_receive })), has_more: res.data.length > 20 } }
  }
  async function get(user, data) {
    if (!canReadHistory(user)) return { code: 403, msg: '账号尚未绑定车辆，请联系管理员' }
    const id = text(data.id)
    if (!id || id.length > 160) return { code: 400, msg: '缺少销售记录' }
    const found = await db.collection('crm_sale_records').doc(id).get()
    const doc = found.data[0]
    if (!doc) return { code:404, msg:'记录不存在' }
    if (mentionsHidden(doc, await hiddenIds())) return { code:404, msg:'记录不存在' }
    // Project the exact authorized snapshot. Do not call getV2: it may reconcile
    // background processing and re-read a sale whose customer changed meanwhile.
    const calculated = amounts(doc)
    const printable = await withFillingPrintTimes(project(doc), db)
    return { code: 0, data: { ...printable, accounting: calculated.accounting, ...calculated.amounts } }
  }
  return { list, get }
}
module.exports = { createService }
