'use strict'
const crypto = require('crypto')
const HOST = 'https://env-00jxuffegf2n-static.normal.cloudstatic.cn'
const first = r => (r?.data || [])[0]
const fields = ['tare_weight', 'gross_weight', 'net_weight']
function minute(value) {
 if (typeof value === 'number' && Number.isFinite(value)) return new Date(value + 8*3600000).toISOString().slice(0,16).replace('T',' ')
 const text = String(value || '').replace('T',' ')
 return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) ? text.slice(0,16) : ''
}
function snapshot(row) {
 const l = row?.reweigh?.label
 if (row?.entry_source !== 'pda_reweigh' || !l || l.company !== '新拓能源' || !/^[A-Za-z0-9_-]{1,48}$/.test(l.bottle_no || '') || l.bottle_no !== row.bottle_no || fields.some(k => typeof l[k] !== 'number' || !Number.isFinite(l[k]) || l[k] <= 0) || Math.abs(l.gross_weight-l.tare_weight-l.net_weight) > 0.001) throw new Error('缺少原始标签资料，不能打印')
 return { company: l.company, bottle_no: l.bottle_no, ...Object.fromEntries(fields.map(k => [k, l[k]])), operator: String(row.operator || ''), weighed_at: minute(row.reweigh.measured_at || row.filling_time) }
}
function qrUrl(doc) {
 const s = doc.snapshot
 return `${HOST}/#/pages/public/filling-label?t=${doc._id}&c=${encodeURIComponent(s.company)}&b=${encodeURIComponent(s.bottle_no)}&p=${s.tare_weight.toFixed(1)}&g=${s.gross_weight.toFixed(1)}&n=${s.net_weight.toFixed(1)}`
}
function createFillingLabels({ db }) {
 const labels = db.collection('crm_filling_labels'), fillings = db.collection('crm_fillings')
 async function current(doc) {
  const row = first(await fillings.doc(doc.filling_id).get())
  if (!row || row.operation_id !== doc.operation_id || Number(row.source_version || 0) !== doc.source_version) return false
  try { if (JSON.stringify(snapshot(row)) !== JSON.stringify(doc.snapshot)) return false } catch (_) { return false }
  // A later filling invalidates this weight for sale, even when its old source still exists.
  const later = first(await fillings.where({ bottle_no: doc.snapshot.bottle_no, created_at: db.command.gt(row.created_at) }).limit(1).get())
  return !later
 }
 async function lookup(token) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return null
  return first(await labels.doc(token).get())
 }
 return {
  async issue(user, data) {
   const row = first(await fillings.doc(String(data.filling_id || '')).get())
   if (!row || row.operation_id !== data.operation_id) return { code:409, msg:'记录已变化，请刷新后补打' }
   const s = snapshot(row), version = Number(row.source_version || 0)
   let doc = first(await labels.where({ filling_id:row._id, operation_id:row.operation_id, source_version:version }).limit(1).get())
   if (!doc) { doc = { _id:crypto.randomBytes(24).toString('hex'), filling_id:row._id, operation_id:row.operation_id, source_version:version, snapshot:s, created_at:Date.now(), created_by:user._id }; await labels.add(doc) }
   if (!await current(doc)) return { code:409, msg:'这笔充装信息已失效，请使用最新记录' }
   return { code:0, data:{ qr_url:qrUrl(doc) } }
  },
  async read(data, authenticated = false) {
   const doc = await lookup(data.token)
   if (!doc) return { code:404, msg:'没有找到这张充装标签' }
   const valid = await current(doc)
   if (authenticated && !valid) return { code:409, msg:'这张标签已有更正或新的充装，请重新称重' }
   if (authenticated && (String(data.bottle_no) !== doc.snapshot.bottle_no || fields.some(k => Number(data[k]) !== doc.snapshot[k]))) return { code:409, msg:'二维码内容与原记录不一致，请重新称重' }
   return { code:0, data:{ ...doc.snapshot, valid, ...(authenticated ? { filling_id:doc.filling_id, operation_id:doc.operation_id, source_version:doc.source_version, label_token:doc._id } : {}) } }
  }
 }
}
module.exports = { createFillingLabels, snapshot, qrUrl }
