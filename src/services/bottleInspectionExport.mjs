const fields = [
 { key:'bottle', label:'瓶检', check:'bottle_check_date', next:'bottle_next_check_date' },
 { key:'gauge', label:'表检', check:'pressure_gauge_check_date', next:'pressure_gauge_next_check_date' },
 { key:'valve', label:'阀检', check:'safety_valve_check_date', next:'safety_valve_next_check_date' }
]
const csvCell = value => {
 let text = value == null ? '' : String(value)
 if (/^[\t\r\n ]*[=+\-@\t\r]/.test(text)) text = "'" + text
 return /[",\n\r]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text
}
const dateAt = timestamp => new Date(timestamp + 8 * 3600000).toISOString().slice(0,10)
function dateStatus(value, today, end) {
 const s = String(value || '')
 if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
 const parsed = new Date(`${s}T00:00:00Z`)
 if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== s) return ''
 return s < today ? '已过期' : s <= end ? '60天内到期' : ''
}
export function buildInspectionExportCsv(rows, filters, now = Date.now()) {
 const today = dateAt(now), end = dateAt(now + 60 * 86400000)
 const columns = [
  ['瓶号', r=>r.bottle_no], ['流向状态', r=>({in_station:'在站',at_customer:'在客户',scrapped:'报废',lost:'丢失',unknown:'未知'}[r.status] || r.status || '')],
  ['启用状态', r=>r.is_active === false ? '停用' : '在用'], ['当前客户', r=>r.current_customer_name || ''],
  ['符合筛选的检验项目', r=>fields.filter(f => (!filters.inspection_due_module || filters.inspection_due_module === 'all' || filters.inspection_due_module === f.key) && (()=>{const status=dateStatus(r[f.next],today,end); return filters.inspection_due_state==='overdue' ? status==='已过期' : filters.inspection_due_state==='due_60d' ? status==='60天内到期' : filters.inspection_due_state==='overdue_or_due_60d' ? !!status : false})()).map(f=>`${f.label}（${dateStatus(r[f.next],today,end)}）`).join('、')]
 ]
 for (const f of fields) columns.push([`${f.label}检验日期`,r=>r[f.check]], [`${f.label}下次检验日期`,r=>r[f.next]])
 return [columns.map(([name])=>csvCell(name)).join(','),...rows.map(r=>columns.map(([,get])=>csvCell(get(r))).join(','))].join('\r\n')
}
export function downloadInspectionCsv(text, name) {
 if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Blob === 'undefined') return false
 const url=window.URL.createObjectURL(new Blob(['\uFEFF',text],{type:'text/csv;charset=utf-8;'}))
 const a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();window.URL.revokeObjectURL(url)
 return true
}
