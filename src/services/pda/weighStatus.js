// Display only: capture eligibility remains with the existing weighing algorithm.
export function pdaWeighStatus(snapshot = {}, { selected = false, captured = false, gross = null, tare = null, positiveNet = false, minimumWeight = 0 } = {}) {
 if (!snapshot.is_connected) return { tone: 'waiting', text: '未连接吊秤' }
 if (!snapshot.is_online || snapshot.weight_kg == null) return { tone: 'waiting', text: '等待秤数据' }
 if (!selected) return { tone: 'waiting', text: '请扫码选瓶' }
 const live = Number(snapshot.weight_kg), empty = Number(tare)
 if (!Number.isFinite(live) || live <= 0 || live < Number(minimumWeight) || (Number.isFinite(empty) && (live < empty * 0.5 || (positiveNet && live <= empty)))) {
  return { tone: 'warning', text: captured ? '重量已保留' : '重量偏小，请检查是否完全吊起' }
 }
 if (!snapshot.is_stable) return { tone: 'warning', text: '晃动中' }
 if (captured && gross != null && Math.abs(live - Number(gross)) < 0.001) return { tone: 'ready', text: '这瓶称好了' }
 return { tone: 'waiting', text: '等待称重' }
}
