'use strict'
// Fixed, administrator-only identity correction requested on 2026-10-19.
const crypto = require('crypto')
const PAIRS = ['46', '37', '34', '11', '57', '59', '61', '63'].map(n => ['X' + n, 'X0' + n])
const RUN = 'bottle_alias_x_padding_20261019'
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
const digest = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v)) ?? "undefined").digest('hex')
const first = r => Array.isArray(r?.data) ? r.data[0] : r?.data
const saleArrays = ['out_items', 'back_items', 'deposit_rows', 'deposit_items', 'agent_sale_items']
const names = PAIRS.flat()
const specs = {
  crm_bottles: ['bottle_no'],
  crm_sale_records: saleArrays.flatMap(k => [k + '.bottle_no', k + '.bottle_id']),
  crm_fillings: ['bottle_no', 'bottle_id'],
  crm_bottle_movements: ['bottle_no', 'bottle_id'],
  crm_bottle_anomalies: ['bottle_no'],
  crm_pda_filling_tasks: ['bottle_no', 'bottle_id'],
  crm_filling_slots: ['bottle_no', 'bottle_id'],
  crm_customer_loss_daily: ['bottle_nos'],
  crm_anomaly_refresh_jobs: ['bottle_nos'],
  crm_rfid_bindings: ['entity_id', 'entity_no'],
  crm_rfid_gate_sessions: ['bottles.entity_id', 'bottles.entity_no'],
  crm_reg_outbox: ['bottle_no', 'payload.bottle_no'],
  crm_reg_bottle_current: ['bottle_no']
}
async function readAll(db, table, where, field) {
  let q = db.collection(table).where(where)
  if (field) q = q.field(field)
  const total = Number((await q.count()).total)
  if (!Number.isInteger(total) || total > 20000) throw Error('读取范围超限: ' + table)
  const rows = []
  while (rows.length < total) {
    const chunk = (await q.orderBy('_id', 'asc').skip(rows.length).limit(200).get()).data || []
    if (!chunk.length) throw Error('分页不完整: ' + table)
    rows.push(...chunk)
  }
  if (rows.length !== total || new Set(rows.map(x => x._id)).size !== total || Number((await q.count()).total) !== total) throw Error('读取范围变化: ' + table)
  return rows
}
async function snapshot(db) {
  const tables = {}, absent = []
  tables.crm_bottles = await readAll(db, 'crm_bottles', { bottle_no: db.command.in(names) })
  const ids = tables.crm_bottles.map(x => x._id)
  for (const [table, fields] of Object.entries(specs)) {
    if (['crm_bottles', 'crm_sale_records'].includes(table)) continue
    const where = db.command.or(fields.map(field => ({ [field]: db.command.in(/(?:bottle_id|entity_id)$/.test(field) ? ids : names) })))
    try { tables[table] = await readAll(db, table, where) }
    catch (e) { if (String(e.message).trim() !== 'not found collection') throw e; tables[table] = []; absent.push(table) }
  }
  // Alipay nested array predicates do not reliably return sale rows. Scan the complete
  // identity projection and fetch exact original documents, including reverse movement links.
  const saleIds = new Set(tables.crm_bottle_movements.filter(x => x.source_type === 'sale').map(x => x.source_id))
  const tokens = new Set([...names, ...ids])
  const contains = v => Array.isArray(v) ? v.some(contains) : v && typeof v === 'object' ? Object.values(v).some(contains) : tokens.has(v)
  const rows = await readAll(db, 'crm_sale_records', {}, Object.fromEntries(['_id', ...saleArrays].map(k => [k, true])))
  for (const row of rows) if (contains(row)) saleIds.add(row._id)
  tables.crm_sale_records = saleIds.size ? await readAll(db, 'crm_sale_records', { _id: db.command.in([...saleIds]) }) : []
  if (tables.crm_sale_records.length !== saleIds.size) throw Error('流转源销售单缺失')
  return { tables, absent, hash: digest({ tables, absent }) }
}
function replaceRefs(value, noMap, idMap, key = '') {
  if (Array.isArray(value)) return value.map(v => replaceRefs(v, noMap, idMap, key))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceRefs(v, noMap, idMap, k)]))
  if (['bottle_no', 'bottle_nos', 'entity_no'].includes(key)) return noMap[value] || value
  if (['bottle_id', 'entity_id'].includes(key)) return idMap[value] || value
  return value
}
function plan(before, helpers) {
  const tables = before.tables, writes = [], summaries = [], conflicts = [], noMap = {}, idMap = {}
  for (const [short, padded] of PAIRS) {
    const a = tables.crm_bottles.filter(x => x.bottle_no === short), b = tables.crm_bottles.filter(x => x.bottle_no === padded)
    if (a.length !== 1 || b.length !== 1) throw Error('档案数不符: ' + short)
    const keep = b[0], drop = a[0]
    if (!tables.crm_bottle_movements.some(x => x.bottle_no === short)) throw Error('短号无流转，需要重新确定保留对象: ' + short)
    if (['lost', 'scrapped'].includes(keep.status) || ['lost', 'scrapped'].includes(drop.status)) throw Error('特殊状态不得合并: ' + short)
    for (const field of helpers.mergeFields) {
      const meaningful = v => v !== undefined && v !== null && v !== ''
      if (meaningful(keep[field]) && meaningful(drop[field]) && digest(keep[field]) !== digest(drop[field])) conflicts.push({ short, padded, field, kept: keep[field], duplicate: drop[field] })
    }
    noMap[short] = padded; idMap[drop._id] = keep._id
    const patch = { ...helpers.merge(keep, [drop]), bottle_no: padded, ...helpers.sort(padded) }
    const moves = tables.crm_bottle_movements.filter(x => [short, padded].includes(x.bottle_no)).map(x => ({ ...x, bottle_no: padded }))
    const state = helpers.state(keep, moves)
    if (!state.skip_reason) Object.assign(patch, { status: state.status, current_customer_id: state.current_customer_id, current_customer_name: state.current_customer_name })
    const after = { ...keep, ...patch }
    writes.push({ table: 'crm_bottles', id: drop._id, before: drop, after: null })
    writes.push({ table: 'crm_bottles', id: keep._id, before: keep, after })
    summaries.push({ from: short, to: padded, kept_id: keep._id, removed_id: drop._id, movement_count: moves.length, status: after.status, pending: state.skip_reason || '' })
  }
  if (tables.crm_reg_outbox.some(x => noMap[x.bottle_no] && ['pending', 'retrying'].includes(x.status))) conflicts.push({ field: 'regulator_queue', message: '短号存在未发送监管任务，需先处理' })
  // Sent payloads remain immutable historical evidence; remove only obsolete current projections.
  for (const row of tables.crm_reg_bottle_current) if (noMap[row.bottle_no]) {
    if (!tables.crm_reg_bottle_current.some(x => x.station_id === row.station_id && x.bottle_no === noMap[row.bottle_no])) throw Error('补零监管当前档案缺失')
    writes.push({ table: 'crm_reg_bottle_current', id: row._id, before: row, after: null })
  }
  for (const [table, rows] of Object.entries(tables)) {
    if (['crm_bottles', 'crm_reg_outbox', 'crm_reg_bottle_current'].includes(table)) continue
    for (const row of rows) {
      const after = replaceRefs(row, noMap, idMap)
      if (digest(row) !== digest(after)) writes.push({ table, id: row._id, before: row, after })
    }
  }
  const result = { run_id: RUN, before_hash: before.hash, writes, summaries, conflicts }
  return { ...result, hash: digest(result) }
}
function expected(before, p) {
  const tables = JSON.parse(JSON.stringify(before.tables))
  for (const w of p.writes) { tables[w.table] = tables[w.table].filter(x => x._id !== w.id); if (w.after) tables[w.table].push(w.after) }
  for (const rows of Object.values(tables)) rows.sort((a, b) => a._id.localeCompare(b._id))
  return digest({ tables, absent: before.absent })
}
async function repair({ db, data, user, helpers }) {
  const logs = db.collection('crm_operation_logs'), existing = first(await logs.doc(RUN).get())
  if (data.phase === 'status') return { code: 0, data: existing || { status: 'not_prepared' } }
  if (data.phase === 'inspect') { const before = await snapshot(db); return { code: 0, data: { before, plan: existing?.status === 'committed' ? null : plan(before, helpers) } } }
  if (data.phase === 'prepare') {
    if (existing) { if (existing.plan_hash !== data.plan_hash) throw Error('固定批次计划不符'); return { code: 0, data: existing } }
    const before = await snapshot(db), p = plan(before, helpers)
    if (p.hash !== data.plan_hash || p.conflicts.length) throw Error('计划变化或字段冲突，未写入业务数据')
    const run = { _id: RUN, action: 'bottle_alias_repair', status: 'prepared', user_id: user._id, created_at: Date.now(), plan_hash: p.hash, before, plan: p, expected_hash: expected(before, p) }
    await logs.add(run) // Full original documents and exact plan; failure aborts the operation.
    return { code: 0, data: run }
  }
  if (!['rehearse', 'execute'].includes(data.phase)) throw Error('无效阶段')
  if (!existing || existing.plan_hash !== data.plan_hash) throw Error('备份或计划不符')
  if (existing.status === 'committed') return { code: 0, data: { status: 'committed', idempotent: true, hash: (await snapshot(db)).hash } }
  if (existing.status !== 'prepared' || (data.phase === 'execute' && !existing.rehearsed_at)) throw Error('尚未通过事务回滚演练')
  if ((await snapshot(db)).hash !== existing.before.hash) throw Error('原值或范围变化，拒绝执行')
  const tx = await db.startTransaction(); let count = 0
  try {
    const lock = first(await tx.collection('crm_operation_logs').doc(RUN).get())
    if (lock.status !== 'prepared' || lock.plan_hash !== data.plan_hash) throw Error('批次状态变化')
    for (const [table, rows] of Object.entries(existing.before.tables)) for (const row of rows) {
      if (digest(first(await tx.collection(table).doc(row._id).get())) !== digest(row)) throw Error('源版本冲突: ' + table + '/' + row._id)
    }
    for (const w of existing.plan.writes) {
      const col = tx.collection(w.table).doc(w.id)
      if (!w.after) { const r = await col.remove(); if (Number(r.deleted) !== 1) throw Error('删除数不符') }
      else { const patch = Object.fromEntries(Object.entries(w.after).filter(([k, v]) => k !== '_id' && digest(v) !== digest(w.before[k]))); const r = await col.update(patch); if (Number(r.updated) !== 1) throw Error('更新数不符') }
      count++
      if (data.phase === 'rehearse' && data.fail_after === count) throw Object.assign(Error('预定中断'), { rehearsal: true })
    }
    if ((await snapshot(db)).hash !== existing.before.hash) throw Error('事务期间范围变化')
    await tx.collection('crm_operation_logs').doc(RUN).update({ status: 'committed', committed_at: Date.now() })
    if (data.phase === 'rehearse') await tx.rollback(); else await tx.commit()
  } catch (e) { await tx.rollback().catch(() => {}); if (!e.rehearsal) throw e }
  const after = await snapshot(db), wanted = data.phase === 'rehearse' ? existing.before.hash : existing.expected_hash
  if (after.hash !== wanted) throw Error('完整回读与预期不符，禁止重跑')
  if (data.phase === 'rehearse' && !data.fail_after) await logs.doc(RUN).update({ rehearsed_at: Date.now() })
  return { code: 0, data: { status: data.phase === 'rehearse' ? 'rolled_back' : 'committed', writes: count, hash: after.hash, summaries: existing.plan.summaries } }
}
module.exports = { repair, plan, replaceRefs, digest, expected, snapshot, PAIRS }
