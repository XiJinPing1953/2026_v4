'use strict'
const { digest, expectedAfter } = require('./plan')
const first = result => Array.isArray(result?.data) ? result.data[0] : result?.data
async function executePrepared({ db, logId, run, rehearse = false, failAfterWrites = 0, readSnapshot, checkMembership }) {
  const plan = run.detail.plan
  if (digest({ ...plan, plan_hash: undefined }) !== plan.plan_hash) throw Error('保存的计划校验值不符')
  for (const write of plan.writes.filter(item => !item.before)) {
    if (first(await db.collection(write.table).doc(write.id).get())) throw Error(`确定编号已存在：${write.id}`)
  }
  const tx = await db.startTransaction(); let count = 0, commitAttempted = false
  try {
    const lock = first(await tx.collection('crm_operation_logs').doc(logId).get())
    if (lock?.status !== 'prepared' || lock.detail?.plan?.plan_hash !== plan.plan_hash) throw Error('批次状态或计划版本已变化')
    for (const [table, rows] of Object.entries(run.detail.before.tables)) for (const before of rows) {
      const current = first(await tx.collection(table).doc(before._id).get())
      if (digest(current) !== digest(before)) throw Error(`源版本冲突：${table}/${before._id}`)
    }
    for (const write of plan.writes) {
      if (write.before) {
        const result = await tx.collection(write.table).doc(write.id).update(write.patch)
        if (Number(result.updated) !== 1) throw Error(`未更新预期原单：${write.table}/${write.id}`)
      } else await tx.collection(write.table).add(write.after)
      count += 1
      if (rehearse && failAfterWrites && count === failAfterWrites) throw Object.assign(Error('预定中断演练'), { rehearsal: true })
    }
    if (checkMembership) await checkMembership()
    await tx.collection('crm_operation_logs').doc(logId).update({ status: 'committed', committed_at: Date.now(), after_snapshot_hash: expectedAfter(run.detail.before, plan) })
    if (rehearse) await tx.rollback(); else { commitAttempted = true; await tx.commit() }
  } catch (error) {
    await tx.rollback().catch(() => {})
    if (rehearse && error.rehearsal) return { run_id: plan.run_id, status: 'interruption_rolled_back', writes: count }
    if (commitAttempted) { error.committed = true; error.message = '提交结果待回查，不可新建批次：' + error.message }
    throw error
  }
  if (rehearse) return { run_id: plan.run_id, status: 'rehearsed_rolled_back', writes: count }
  const after = await readSnapshot()
  const wanted = expectedAfter(run.detail.before, plan)
  if (after.snapshot_hash !== wanted) throw Object.assign(Error('事务已提交，但完整回读与计划结果不符'), { committed: true })
  return { run_id: plan.run_id, status: 'committed', writes: count, after_snapshot_hash: after.snapshot_hash, summary: plan.summary }
}
module.exports = { executePrepared }
