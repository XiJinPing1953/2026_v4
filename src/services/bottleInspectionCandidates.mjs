const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
const text = value => String(value ?? '').trim().toUpperCase()
export function compareInspectionBottles(a, b) {
 const left = text(a.bottle_no), right = text(b.bottle_no)
 if (!left !== !right) return left ? -1 : 1
 const ln = /^\d+$/.test(left), rn = /^\d+$/.test(right)
 if (ln !== rn) return ln ? -1 : 1
 return collator.compare(left, right) || left.localeCompare(right) || String(a._id).localeCompare(String(b._id))
}

// Sort the complete filtered result before slicing pages; never present a partial load as complete.
export async function loadInspectionCandidates(search, filters) {
 const pageSize = 50, limit = 20000
 const rows = [], ids = new Set()
 let total = null
 for (let page = 1; ; page++) {
  const res = await search({ ...filters, page, pageSize, include_summary: false, include_deposit: false })
  if (res?.code !== 0) throw new Error(res?.msg || '查询失败')
  const count = Number(res.paging?.total ?? res.total)
  if (!Number.isInteger(count) || count < 0) throw new Error('未取得完整钢瓶数量，请重试')
  if (count > limit) throw new Error('筛选结果超过20000瓶，请缩小范围')
  if (total !== null && total !== count) throw new Error('钢瓶列表已变化，请重新查询')
  total = count
  const batch = res.data
  if (!Array.isArray(batch)) throw new Error('钢瓶列表返回异常，请重试')
  for (const row of batch) {
   if (!row?._id || ids.has(String(row._id))) throw new Error('钢瓶分页重复或已变化，请重新查询')
   ids.add(String(row._id)); rows.push(row)
  }
  if (rows.length > total) throw new Error('钢瓶数量不一致，请重新查询')
  if (rows.length === total) return rows.sort(compareInspectionBottles)
  if (!batch.length || res.paging?.hasMore === false || page >= Math.ceil(limit / pageSize)) throw new Error('钢瓶列表未加载完整，请重试')
 }
}
