'use strict'
async function readComplete(collection, where, { command, source, pageSize = 100, maxRows = 10000 } = {}) {
  const query = where ? collection.where(where) : collection
  const count = await query.count()
  if (!Number.isSafeInteger(count.total) || count.total < 0 || count.total > maxRows) throw Error(`${source || 'collection'}读取数量异常或超过保护上限`)
  const rows = []
  for (let skip = 0; skip < count.total; skip += pageSize) {
    const result = await query.orderBy('_id', 'asc').skip(skip).limit(pageSize).get()
    const page = Array.isArray(result.data) ? result.data : []
    rows.push(...page)
  }
  if (rows.length !== count.total || new Set(rows.map(row => row._id)).size !== rows.length) throw Error(`${source || 'collection'}读取不完整或编号重复`)
  return rows
}
module.exports = { readComplete }
