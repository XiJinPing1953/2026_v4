/**
 * 在 uniCloud 云数据库控制台（env-00jxuffegf2n）执行
 * 目标：删除本次误插入批次（可撤销批次）
 */

const BATCH_REMARK = 'import:test0314:env-00jxuffegf2n:202603141050'
const CONFIRM_DELETE = false

// 1) 先确认待删数量
const before = await db.collection('crm_bottles').where({ remark: BATCH_REMARK }).count()
console.log('matched_before_delete', before)

if (!CONFIRM_DELETE) {
  console.log('dry-run only, set CONFIRM_DELETE=true to execute deletion')
  return before
}

// 2) 再执行删除
const removed = await db.collection('crm_bottles').where({ remark: BATCH_REMARK }).remove()
console.log('remove_result', removed)

// 3) 删除后复核应为 0
const after = await db.collection('crm_bottles').where({ remark: BATCH_REMARK }).count()
console.log('matched_after_delete', after)

return { before, removed, after }
