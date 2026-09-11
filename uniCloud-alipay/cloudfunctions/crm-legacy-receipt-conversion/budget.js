'use strict'
// Engineering budgets, not claimed platform document-size limits.
// The documented transaction lifetime is 10 seconds; reserve 4 seconds for commit/rollback.
const LIMITS = Object.freeze({ operation_log_bytes: 512 * 1024, source_rows: 600, parallel_reads: 4, transaction_work_ms: 6000 })
async function mapBounded(rows, work, concurrency = LIMITS.parallel_reads) {
  let next = 0, failure
  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (next < rows.length && !failure) {
      const index = next++
      try { await work(rows[index], index) } catch (error) { failure = error }
    }
  })
  await Promise.all(workers)
  if (failure) throw failure
}
async function withinBudget(work, deadline, signal = {}) {
  const check = () => {
    if (signal.aborted || Date.now() >= deadline) {
      signal.aborted = true
      throw Error('事务工作预算已耗尽，保留回滚余量')
    }
  }
  check()
  // Await every issued request before rollback; a race timeout cannot cancel database work.
  const result = await work()
  check()
  return result
}

module.exports = { LIMITS, mapBounded, withinBudget }
