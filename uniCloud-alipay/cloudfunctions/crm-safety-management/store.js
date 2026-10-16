'use strict'
const { fail, fingerprint, identity } = require('./policy')

async function readOne(database, collection, id, transaction = false) {
  const result = transaction ? await database.collection(collection).doc(id).get() : await database.collection(collection).where({ _id: id }).limit(1).get()
  const data = result?.data
  if (Array.isArray(data) && data.length <= 1) return data[0] || null
  if (data && typeof data === 'object' && typeof data._id === 'string') return data
  fail(`读取 ${collection} 记录未取得有效响应，未将读取失败当作空记录`, 503)
}

// The server fetches every page; UI pagination must never determine a ledger total.
async function readAll(database, collection, where = {}) {
  const result = []
  const size = 100
  const count = async () => { const value = (await database.collection(collection).where(where).count()).total; if (!Number.isSafeInteger(Number(value)) || value == null || Number(value) < 0) fail(`读取 ${collection} 数量未完成`, 503); return Number(value) }
  const expected = await count()
  for (let offset = 0; ; offset += size) {
    const page = await database.collection(collection).where(where).orderBy('_id', 'asc').skip(offset).limit(size).get()
    if (!Array.isArray(page?.data)) fail(`读取 ${collection} 分页未取得有效响应`, 503)
    const rows = page.data
    result.push(...rows)
    if (rows.length < size) break
    if (offset > 1000000) fail('来源数据过多，请联系管理员处理；未生成不完整汇总', 503)
  }
  if (result.length !== expected || new Set(result.map(row => row._id)).size !== expected || await count() !== expected) fail(`读取 ${collection} 期间来源变化或分页不完整，请刷新后重试`, 409)
  return result
}

async function inTransaction(database, work) {
  const transaction = await database.startTransaction()
  try { const result = await work(transaction); await transaction.commit(); return result } catch (error) { try { await transaction.rollback() } catch (_) { /* Keep the original failure. */ } throw error }
}

async function saveRevision(database, { collection, kind, id, expected_revision, revision_reason, actor, payload, now = Date.now() }) {
  if (!Number.isInteger(expected_revision) || expected_revision < 0) fail('请提供当前修订版本；新记录为 0')
  const fingerprintPayload = { ...payload }
  delete fingerprintPayload.checked_at
  const requestFingerprint = fingerprint(fingerprintPayload)
  const before = await readOne(database, collection, id)
  return inTransaction(database, async transaction => {
    // Alipay transaction.doc.get throws on absent IDs. A proven ordinary pre-read
    // plus unique deterministic add protects first creation without a missing-doc read.
    const current = before ? await readOne(transaction, collection, id, true) : null
    if (before && !current) fail('原记录在保存前已变化，请刷新', 409)
    const revision = current?.revision || 0
    if (current?.request_fingerprint === requestFingerprint && current.updated_by === actor._id && [revision, revision - 1].includes(expected_revision)) return { ...current, duplicate: true }
    if (expected_revision !== revision) fail('记录已被其他人修改，请刷新后核对再保存', 409)
    if (current && !revision_reason) fail('请填写修订原因')
    if (current) {
      await transaction.collection('crm_safety_revisions').add({
        _id: identity('revision', `${kind}:${id}`, String(revision)), kind, record_id: id, station_id: current.station_id,
        revision, snapshot: current, replaced_at: now, replaced_by: actor._id, revision_reason
      })
    }
    const next = {
      ...payload, _id: id, revision: revision + 1, revision_reason: revision_reason || '首次记录',
      request_fingerprint: requestFingerprint, signature_status: 'pending_signature',
      created_at: current?.created_at || now, created_by: current?.created_by || actor._id,
      updated_at: now, updated_by: actor._id, updated_by_name: actor.nickname || actor.username || ''
    }
    if (current) { const { _id, ...patch } = next; await transaction.collection(collection).doc(id).update(patch) }
    else await transaction.collection(collection).add(next)
    return next
  })
}

module.exports = { readOne, readAll, inTransaction, saveRevision }
