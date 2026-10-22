import { savedLabel, isSuperseded } from './fillingPrint'
import { reweighHistoryTime } from './reweighDraft'

// Read only: never call the draft store's migration/save path while browsing history.
export function localFillingRounds(owner, storage) {
 const raw = storage.getStorageSync(`crm_pda_reweigh_v1:${owner}`)
 if (!raw) return []
 const data = typeof raw === 'string' ? JSON.parse(raw) : raw
 if (data?.version !== 1 || data.ownerId !== owner || !Array.isArray(data.history)) throw new Error('本机历史无法读取，原数据已保留')
 const entries = [...new Map([...data.history, data.current].filter(Boolean).map(row => [row.operationId, row])).values()]
 const rounds = new Map()
 for (const entry of entries) {
  if (!entry.receipt?.saved || !entry.roundId || isSuperseded(entry, entries)) continue
  let group = rounds.get(entry.roundId)
  if (!group) { group = { id: entry.roundId, first_time: '', rows: [] }; rounds.set(entry.roundId, group) }
  const time = reweighHistoryTime(entry)
  if (time !== '—' && (!group.first_time || time < group.first_time)) group.first_time = time
  let label = null
  try { label = savedLabel(entry) } catch (_) {}
  group.rows.push({ id: entry.operationId, bottle_no: entry.bottleNo, weighed_at: time, time_label: '称重时间',
   status: entry.receipt.complete ? 'complete' : 'pending', gross_weight: label?.gross_weight ?? entry.grossWeight,
   tare_weight: label?.tare_weight ?? null, net_weight: label?.net_weight ?? null, print_entry: entry })
 }
 return [...rounds.values()].map(group => ({ ...group, bottle_count: new Set(group.rows.map(row => row.bottle_no)).size }))
  .sort((a, b) => b.first_time.localeCompare(a.first_time))
}
export function historyPrintEntry(row) {
 if (row.print_entry) return row.print_entry
 if (!row.operation_id || !row.label) return null
 return { operationId: row.operation_id, bottleNo: row.bottle_no,
  receipt: { saved: true, fillingId: row.id }, frozen: { mode: 'create', label: row.label,
   payload: { operation_id: row.operation_id, bottle_no: row.bottle_no, gross_weight: row.gross_weight } } }
}
