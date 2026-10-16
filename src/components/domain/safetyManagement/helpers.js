export const resultLabels = { normal: '已检查正常', abnormal: '发现问题', not_conducted: '截至核查时未开展', not_running: '未运行', not_applicable: '不适用', pending: '待核实' }
export function categoryPending(category) {
  if (category.coverage) return category.coverage.pending || []
  return (category.checks || []).filter(check => !check.result_code || check.result_code === 'pending' || check.result_code.startsWith('not_') && !check.reason && check.result_code !== 'not_running').map(check => ({ item_code: check.item_code, label: check.label, messages: [`${check.label}待核对`] }))
}
export function categoryProgressText(category) {
  const coverage = category.coverage
  const checks = category.checks || [], originals = checks.filter(check => check.source_type === 'station_inspection')
  const itemCount = coverage?.inspection_item_count ?? new Set(originals.map(check => check.item_code)).size
  const recordCount = coverage?.inspection_record_count ?? originals.length
  const groups = coverage?.supplement_group_count ?? new Set(checks.filter(check => check.source_type !== 'station_inspection').map(check => check.item_code)).size
  const counts = coverage?.result_counts || checks.reduce((result, check) => { if (!check.covered_by_inspection) { const code = check.result_code || 'pending'; result[code] = (result[code] || 0) + 1 } return result }, {})
  const results = Object.entries(counts).filter(([,count]) => count > 0).map(([code,count]) => `${resultLabels[code] || '待核实'} ${count} 条`).join('；')
  return `原巡检 ${itemCount} 项（${recordCount} 条记录）；补充范围 ${groups} 组${coverage?.covered_group_count ? `，其中 ${coverage.covered_group_count} 组已引用原巡检` : ''}\n结果按记录条次列示：${results || '尚无检查事实'}\n待核对 ${categoryPending(category).length} 项`
}
export const signatureLabel = '待签认'
export function beijingDate(value = Date.now()) { return new Date(Number(value) + 8 * 3600000).toISOString().slice(0, 10) }
export function formatDateTime(value) { if (!value) return '未记录'; const time = Number(value); if (!Number.isFinite(time)) return String(value); return new Date(time + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') }
export function localDateTime(value) { return value ? formatDateTime(value).replace(' ', 'T') : '' }
export function parseDateTime(value) { return value ? new Date(String(value).replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(value) ? '' : '+08:00')).getTime() : 0 }
export function requestId(prefix = 'sm') { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}` }
export function clone(value) { return JSON.parse(JSON.stringify(value)) }
export function showError(error) { uni.showModal({ title: '未能完成', content: error?.message || '请稍后重试', showCancel: false }) }
export function openPage(path, query = {}) { const search = Object.entries(query).filter(([,value]) => value !== '' && value != null).map(([key,value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&'); uni.navigateTo({ url: `${path}${search ? `?${search}` : ''}` }) }
export function openSafetyPage(page, query) { openPage(`/pages/safety-management/${page}`, query) }
export function openInspection(id) { if (id) openPage('/pages/station-safety-inspection/detail', { id }) }
export function openHazards() { openPage('/pages/station-safety-inspection/hazards') }
export function downloadFile(data) {
  const url = data?.temp_url || data?.url
  if (!url) throw new Error('未取得文件下载地址')
  // #ifdef H5
  const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.download = data.file_name || ''; link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove()
  // #endif
  // #ifndef H5
  uni.setClipboardData({ data: url }); uni.showToast({ title: '下载链接已复制', icon: 'none' })
  // #endif
}
