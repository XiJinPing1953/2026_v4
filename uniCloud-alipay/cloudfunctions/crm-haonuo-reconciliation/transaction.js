'use strict'
const { digest } = require('./plan')
const first = res => Array.isArray(res?.data) ? res.data[0] : res?.data
async function executePrepared({db,logId,run,rehearse=false,failAfterWrites=0,checkMembership}) {
  const plan=run.detail.plan
  if(digest({...plan,plan_hash:undefined})!==plan.plan_hash) throw Error('保存的计划校验值不符')
  const tx=await db.startTransaction(), started=Date.now()
  let count=0
  try {
    const lock=first(await tx.collection('crm_operation_logs').doc(logId).get())
    if(lock?.status!=='prepared' || lock.detail?.plan?.plan_hash!==plan.plan_hash) throw Error('批次状态已变化')
    // Acquire customer/version locks before changes; no external source is reconstructed from a projection.
    for(const [table,rows] of Object.entries(run.detail.before.tables)) for(const before of rows) {
      const row=first(await tx.collection(table).doc(before._id).get())
      if(digest(row)!==digest(before)) throw Error(`源单版本冲突：${table}/${before._id}`)
    }
    for(const write of plan.writes.filter(w=>!w.before)) {
      if(first(await tx.collection(write.table).doc(write.id).get())?._id) throw Error(`确定编号已存在：${write.id}`)
    }
    const ordered=[...plan.writes.filter(w=>w.table==='crm_customers'),...plan.writes.filter(w=>w.table!=='crm_customers')]
    for(const write of ordered) {
      if(write.before) {
        const result=await tx.collection(write.table).doc(write.id).update(write.patch)
        if(Number(result.updated)!==1) throw Error(`未更新预期源单：${write.id}`)
      } else await tx.collection(write.table).add(write.after)
      count++
      if(rehearse && failAfterWrites && count===failAfterWrites) throw Object.assign(Error('预定中断演练'),{rehearsal:true})
    }
    // Transaction mutations are not yet visible to the ordinary database handle.
    // Detect additions/removals in scope since preview as well as per-document version conflicts.
    if(checkMembership) await checkMembership()
    await tx.collection('crm_operation_logs').doc(logId).update({status:'committed',committed_at:Date.now()})
    if(rehearse) await tx.rollback(); else await tx.commit()
    return {run_id:plan.run_id,status:rehearse?'rehearsed_rolled_back':'committed',transaction_ms:Date.now()-started,writes:count,summary:plan.summary}
  } catch(e) {
    await tx.rollback().catch(()=>{})
    if(rehearse && e.rehearsal) return {run_id:plan.run_id,status:'interruption_rolled_back',writes:count,transaction_ms:Date.now()-started}
    throw e
  }
}
module.exports={executePrepared}
