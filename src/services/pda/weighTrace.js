// 临时现场诊断：与业务草稿分开存储；失败只停诊断，不影响称重。
export function createWeighTrace(owner, storage, notify = () => {}) {
 const key = `pda_weigh_trace_v1_${owner}`
 const limit = 20000, chunkSize = 100
 let meta = { enabled: false, chunks: 0, count: 0, started: 0, error: '' }, buffer = [], timer = null, unreadable = false
 try { meta = storage.getStorageSync(key) || meta } catch (_) { unreadable = true; meta.error = '读取采样索引失败，请退出页面后重进，原记录保持不变' }
 function status() { notify({ ...meta, count: meta.count + buffer.length }) }
 function saveMeta() { storage.setStorageSync(key, meta) }
 function flush() {
  if (unreadable) { status(); return }
  clearTimeout(timer); timer = null
  try {
   if (buffer.length) {
    storage.setStorageSync(`${key}_${meta.started}_${meta.chunks}`, buffer)
    meta = { ...meta, chunks: meta.chunks + 1, count: meta.count + buffer.length }; buffer = []
   }
   saveMeta()
  } catch (_) { meta.enabled = false; meta.error = '采样存储失败，请停止并导出已有记录' }
  status()
 }
 function record(type, data = {}) {
  if (!meta.enabled) return
  try {
   buffer.push({ at: Date.now(), type, ...data })
   if (meta.count + buffer.length >= limit) { meta.enabled = false; meta.error = '采样已达20000条上限，请导出'; flush() }
   else if (buffer.length >= chunkSize) flush()
   else if (!timer) timer = setTimeout(flush, 2000)
  } catch (_) { meta.enabled = false; meta.error = '采样记录失败'; status() }
 }
 function start() {
  if (unreadable) throw new Error(meta.error)
  if (meta.count || buffer.length) throw new Error('已有采样，请先导出；确认新一批会清理旧采样')
  meta = { enabled: true, chunks: 0, count: 0, started: Date.now(), error: '' }; flush(); record('record_start')
 }
 function stop() { record('record_stop'); meta.enabled = false; flush() }
 function clear() {
  if (unreadable) throw new Error(meta.error)
  stop()
  for (let i = 0; i < meta.chunks; i++) storage.removeStorageSync(`${key}_${meta.started}_${i}`)
  meta = { enabled: false, chunks: 0, count: 0, started: 0, error: '' }; buffer = []; saveMeta(); status()
 }
 function dump() {
  if (unreadable) throw new Error(meta.error)
  flush()
  const rows = []
  for (let i = 0; i < meta.chunks; i++) {
   const chunk = storage.getStorageSync(`${key}_${meta.started}_${i}`)
   if (!Array.isArray(chunk)) throw new Error(`采样分段${i}缺失，不能导出完整记录`)
   rows.push(...chunk)
  }
  rows.push(...buffer)
  return JSON.stringify({ schema: 1, started: meta.started, exported: Date.now(), count: rows.length, error: meta.error, records: rows })
 }
 status()
 return { record, flush, start, stop, clear, dump }
}

export async function exportWeighTrace(text) {
 if (typeof plus === 'undefined' || !plus.android) throw new Error('请在Android PDA导出采样')
 const android = plus.android
 const sdk = Number(android.importClass('android.os.Build$VERSION').SDK_INT)
 const filename = `weigh-trace-${Date.now()}.json`
 if (sdk >= 29) {
  // MediaStore Downloads 对应系统下载目录；无需访问其他应用的私有目录。
  const activity = android.runtimeMainActivity()
  const resolver = android.invoke(activity, 'getContentResolver')
  const Values = android.importClass('android.content.ContentValues')
  const Uri = android.importClass('android.net.Uri')
  const values = new Values()
  android.invoke(values, 'put', '_display_name', filename)
  android.invoke(values, 'put', 'mime_type', 'application/json')
  android.invoke(values, 'put', 'relative_path', 'Download/')
  const uri = android.invoke(resolver, 'insert', Uri.parse('content://media/external/downloads'), values)
  if (!uri) throw new Error('无法创建下载文件')
  let stream
  try {
   stream = android.invoke(resolver, 'openOutputStream', uri)
   const JavaString = android.importClass('java.lang.String')
   const bytes = android.invoke(new JavaString(text), 'getBytes', 'UTF-8')
   android.invoke(stream, 'write', bytes)
   android.invoke(stream, 'close'); stream = null
   return `Download/${filename}`
  } catch (error) {
   if (stream) { try { android.invoke(stream, 'close') } catch (_) {} }
   try { android.invoke(resolver, 'delete', uri, null, null) } catch (_) {}
   throw error
  }
 }
 return new Promise((resolve, reject) => {
  plus.io.requestFileSystem(plus.io.PUBLIC_DOWNLOADS, fs => {
   fs.root.getFile(filename, { create: true, exclusive: true }, entry => {
    entry.createWriter(writer => {
     writer.onerror = reject
     writer.onwrite = () => resolve(plus.io.convertLocalFileSystemURL(entry.toLocalURL()))
     writer.write(text)
    }, reject)
   }, reject)
  }, reject)
 })
}
