'use strict'
// Fixed scope requested on 2026-10-24. Historical inspection dates remain intact.
const crypto = require('crypto')
const RUN = 'bottle_suspend_yznj_20261024'
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
const digest = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
const first = r => Array.isArray(r?.data) ? r.data[0] : r?.data
const eligible = row => /^[YZNJ]/.test(String(row?.bottle_no || '').trim().toUpperCase())

async function run({ db, data, user }) {
 if (user?.role !== 'superadmin') throw Error('仅超级管理员可执行')
 if (data.phase === 'preview') {
  const where = { bottle_no: db.RegExp({ regexp: '^\\s*[YZNJ]', options: 'i' }) }
  const q = db.collection('crm_bottles').where(where), total = Number((await q.count()).total), rows = []
  if (!Number.isInteger(total) || total < 0 || total > 5000) throw Error('气瓶数量异常')
  while (rows.length < total) {
   const chunk = (await q.orderBy('_id', 'asc').skip(rows.length).limit(100).get()).data || []
   if (!chunk.length) throw Error('气瓶读取不完整')
   rows.push(...chunk)
  }
  if (rows.length !== total || new Set(rows.map(r => r._id)).size !== total || Number((await q.count()).total) !== total) throw Error('气瓶范围已变化')
  return { code: 0, data: { run_id: RUN, total, rows, plan: rows.filter(r => r.is_active !== false).map(r => ({ id: r._id, expected_hash: digest(r) })) } }
 }
 if (!['rehearse', 'execute', 'status'].includes(data.phase)) throw Error('无效阶段')
 const items = data.items
 if (!Array.isArray(items) || !items.length || items.length > 20 || new Set(items.map(r => r.id)).size !== items.length || items.some(r => typeof r.id !== 'string' || !r.id || !/^[a-f0-9]{64}$/.test(r.expected_hash))) throw Error('每批须为1至20个不重复气瓶及原值摘要')
 const plan = items.map(r => ({ id: r.id, expected_hash: r.expected_hash })).sort((a, b) => a.id.localeCompare(b.id))
 const planHash = digest(plan), batchId = RUN + '_' + digest(plan.map(r => r.id)).slice(0, 24)
 const prior = first(await db.collection('crm_operation_logs').doc(batchId).get())
 if (prior) {
  if (prior.plan_hash !== planHash) throw Error('固定批次原值摘要不符')
  return { code: 0, data: { batch_id: batchId, status: prior.status, updated: prior.updated, idempotent: true } }
 }
 if (data.phase === 'status') return { code: 0, data: { batch_id: batchId, status: 'not_applied' } }
 const tx = await db.startTransaction(), before = []
 try {
  if (first(await tx.collection('crm_operation_logs').doc(batchId).get())) throw Error('批次状态已变化，请查询结果')
  // Validate every original before any write. The transaction also protects concurrent edits.
  for (const item of plan) {
   const row = first(await tx.collection('crm_bottles').doc(item.id).get())
   if (!row || !eligible(row) || digest(row) !== item.expected_hash) throw Error('气瓶范围或原值已变化：' + item.id)
   if (row.is_active === false) throw Error('气瓶已停用，请重新预览')
   before.push(row)
  }
  const now = Date.now()
  for (const row of before) {
   const result = await tx.collection('crm_bottles').doc(row._id).update({ is_active: false, updated_at: now })
   if (Number(result.updated) !== 1) throw Error('气瓶更新数量不符')
  }
  await tx.collection('crm_operation_logs').add({ _id: batchId, action: RUN, status: 'committed', user_id: user._id, created_at: now, plan_hash: planHash, before, updated: before.length })
  if (data.phase === 'rehearse') await tx.rollback()
  else await tx.commit()
  return { code: 0, data: { batch_id: batchId, status: data.phase === 'rehearse' ? 'rolled_back' : 'committed', updated: before.length } }
 } catch (error) { await tx.rollback().catch(() => {}); throw error }
}
module.exports = { run, digest, eligible }
