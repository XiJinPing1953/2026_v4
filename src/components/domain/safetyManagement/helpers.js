export const resultLabels = { normal: '已检查正常', abnormal: '发现问题', not_conducted: '当日未开展', not_running: '未运行', not_applicable: '不适用' }
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
