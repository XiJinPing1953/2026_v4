'use strict'
const crypto = require('crypto')
const fs = require('fs')
const scope = require('./scope.json')
const BATCH = 'return_release_20261105_v1'
const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v
const hash = v => crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')
const one = r => Array.isArray(r.data) ? r.data[0] || null : r.data || null
// Match the existing bottleKey/fingerprint(string) encoding exactly.
const headKey = no => 'bottle_' + hash({ ...no })
const reject = msg => Object.assign(new Error(msg), { code: 409 })
async function snapshot(db, item) {
  const head = one(await db.collection('crm_return_reweigh_state').doc(headKey(item.bottle_no)).get())
  const record = head?.record_id ? one(await db.collection('crm_return_reweighs').doc(head.record_id).get()) : null
  const old = one(await db.collection('crm_fillings').doc(item.filling_id).get())
  return { head, record, old }
}
function eligible(item, s) {
  if (s.old) throw reject('原灌装仍存在，拒绝解除占用')
  if (!s.head || s.head.bottle_no !== item.bottle_no || s.head.record_id !== item.basis.return_reweigh_id) throw reject('本轮回瓶已变化，拒绝覆盖')
  if (s.head.consumed_filling_id !== item.filling_id) throw reject('当前占用已变化，拒绝覆盖')
  if (!s.record || s.record.bottle_no !== item.bottle_no || s.record._id !== item.basis.return_reweigh_id || s.record.gross_weight !== item.basis.gross_weight || s.record.date !== item.basis.date || s.record.round_id !== item.basis.round_id) throw reject('回瓶实测依据不匹配')
}
exports.main = async event => {
  const db = uniCloud.database()
  const user = event?.token ? one(await db.collection('crm_users').where({ token: event.token }).limit(1).get()) : null
  if (!user || user.role !== 'superadmin') return { code: 403, msg: '仅超级管理员可执行固定批次修复' }
  const data = event.data || {}
  if (data.batch !== BATCH || !['preview', 'apply', 'verify'].includes(event.action)) return { code: 400, msg: '修复批次或动作无效' }
  const item = scope.find(x => x.bottle_no === data.bottle_no)
  if (!item) return { code: 400, msg: '瓶号不在固定范围内' }
  const logId = BATCH + '_' + item.bottle_no
  let tx = null
  try {
    if (event.action !== 'apply') {
      const s = await snapshot(db, item)
      let problem = ''; try { eligible(item, s) } catch (e) { problem = e.message }
      const receipt = one(await db.collection('crm_operation_logs').doc(logId).get())
      return { code: 0, data: { ...s, eligible: !problem, problem, expected: hash(s), receipt,
        code_hashes: Object.fromEntries(['index.js', 'repair.js', 'scope.json'].map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(__dirname + '/' + f)).digest('hex')])) } }
    }
    // This endpoint is deliberately time-limited and disabled after this repair.
    if (Date.now() > Date.parse('2026-11-06T16:00:00Z')) return { code: 410, msg: '修复窗口已关闭' }
    tx = await db.startTransaction()
    const prior = one(await tx.collection('crm_operation_logs').doc(logId).get())
    if (prior) { await tx.rollback(); tx = null; return { code: 0, data: { complete: true, duplicate: true, receipt: prior } } }
    const s = await snapshot(tx, item)
    eligible(item, s)
    if (!data.expected || hash(s) !== data.expected) throw reject('原值已变化，请重新核查')
    const time = Date.now()
    const changed = await tx.collection('crm_return_reweigh_state').where({ _id: s.head._id, record_id: s.head.record_id, consumed_filling_id: item.filling_id, updated_at: s.head.updated_at }).update({ consumed_filling_id: '', updated_at: time })
    if (Number(changed.updated) !== 1) throw reject('占用条件已变化，未执行')
    const receipt = { _id: logId, action: BATCH, user_id: user._id, username: user.username, role: user.role, created_at: time,
      detail: { bottle_no: item.bottle_no, removed_filling_id: item.filling_id, before_head: s.head, after_head: { ...s.head, consumed_filling_id: '', updated_at: time }, return_record_hash: hash(s.record), expected: data.expected } }
    await tx.collection('crm_operation_logs').add(receipt)
    await tx.commit(); tx = null
    return { code: 0, data: { complete: true, receipt } }
  } catch (e) { if (tx) await tx.rollback().catch(() => {}); return { code: e.code || 500, msg: e.message } }
}
