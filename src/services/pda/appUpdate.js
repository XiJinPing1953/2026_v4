// WGT 只更新资源；原生插件/权限变化须重新安装 APK。
export const PDA_UPDATE_ROOT = 'https://env-00jxuffegf2n-static.normal.cloudstatic.cn/pda-updates/'
export const PDA_APP_ID = '__UNI__756A841'
export function compareAppVersion(a, b) {
 const valid = v => /^\d+\.\d+\.\d+$/.test(String(v || ''))
 if (!valid(a) || !valid(b)) throw new Error('应用版本格式不正确')
 const x = a.split('.').map(Number), y = b.split('.').map(Number)
 for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1
 return 0
}
export function validatePdaUpdate(meta, installed, nativeVersion) {
 if (!meta || meta.schema !== 1 || meta.appid !== PDA_APP_ID || meta.platform !== 'android') throw new Error('更新信息不匹配本应用')
 if (compareAppVersion(meta.version, installed) <= 0) return null
 if (compareAppVersion(nativeVersion, meta.minNativeVersion) < 0 || compareAppVersion(nativeVersion, meta.maxNativeVersion) > 0) throw new Error('请先安装新版 PDA 安装包，再检查更新')
 if (!/^crm-pda-\d+\.\d+\.\d+-[a-f0-9]{12}\.wgt$/.test(meta.file || '') || !/^[a-f0-9]{40}$/.test(meta.sha1 || '') || !Number.isSafeInteger(meta.size) || meta.size <= 0 || meta.size > 50 * 1024 * 1024) throw new Error('更新包信息不完整')
 return meta
}
export function readPdaAppVersion() {
 return new Promise((resolve, reject) => {
  if (typeof plus === 'undefined' || !plus.android) return reject(new Error('仅支持 Android PDA'))
  plus.runtime.getProperty(plus.runtime.appid, info => resolve({ resource: info.version, native: plus.runtime.version, appid: plus.runtime.appid }))
 })
}
let updating = false
const modal = options => new Promise(resolve => uni.showModal({ ...options, success: r => resolve(r.confirm), fail: () => resolve(false) }))
const onHome = () => { const pages = getCurrentPages(); return pages[pages.length - 1]?.route === 'pages/pda/home' }
export async function checkPdaAppUpdate() {
 if (updating) return
 updating = true
 let downloadPath = ''
 try {
  const version = await readPdaAppVersion()
  if (version.appid !== PDA_APP_ID) throw new Error('请使用正式 PDA 安装包检查更新')
  const response = await new Promise((resolve, reject) => uni.request({ url: `${PDA_UPDATE_ROOT}latest.json?t=${Date.now()}`, timeout: 30000, firstIpv4: true, success: resolve, fail: reject }))
  if (response.statusCode !== 200) throw new Error('暂时无法获取更新，请稍后重试')
  const update = validatePdaUpdate(response.data, version.resource, version.native)
  if (!onHome()) return
  if (!update) { uni.showToast({ title: '已是最新版本', icon: 'none' }); return }
  if (!await modal({ title: `更新至 ${update.version}`, content: `${String(update.notes || '改进应用功能').slice(0, 300)}\n更新完成后将重启应用，已保存的数据保留。`, confirmText: '更新并重启' }) || !onHome()) return
  uni.showLoading({ title: '下载更新中', mask: true })
  // 使用应用私有路径；uni.downloadFile返回的临时绝对路径在部分Android上
  // 无法被plus.io/runtime访问，下载到_doc后转换为同一文件的绝对路径。
  downloadPath = `_doc/pda-updates/${update.file}`
  await new Promise((resolve, reject) => {
   const task = plus.downloader.createDownload(PDA_UPDATE_ROOT + update.file, { filename: downloadPath, timeout: 120, retry: 0 }, (completed, status) => {
    // 同名残留会另存带序号的文件；Android校验接口要求先转绝对路径。
    downloadPath = plus.io.convertLocalFileSystemURL(completed.filename || downloadPath)
    status === 200 ? resolve() : reject(new Error('更新下载失败，请重试'))
   })
   task.start()
  })
  const info = await new Promise((resolve, reject) => plus.io.getFileInfo({ filePath: downloadPath, digestAlgorithm: 'sha1', success: resolve, fail: reject }))
  if (Number(info.size) !== update.size || String(info.digest).toLowerCase() !== update.sha1) throw new Error('更新包不完整，请重新下载')
  if (!onHome()) return
  uni.showLoading({ title: '安装更新中', mask: true })
  // 不使用 force；由运行时再次校验 appid 和版本，失败保留现有资源。
  await new Promise((resolve, reject) => plus.runtime.install(downloadPath, { force: false }, resolve, reject))
  uni.hideLoading()
  if (onHome()) plus.runtime.restart()
  else await modal({ title: '更新已安装', content: '下次重启应用后生效。', showCancel: false })
 } catch (cause) {
  uni.hideLoading()
  await modal({ title: '更新未完成', content: cause instanceof Error ? cause.message : '请检查网络后重试，已有数据保持不变。', showCancel: false })
 } finally {
  uni.hideLoading(); updating = false
  if (downloadPath) plus.io.resolveLocalFileSystemURL(downloadPath, entry => entry.remove(() => {}, () => {}), () => {})
 }
}
