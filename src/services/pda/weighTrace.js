// 临时现场诊断：与业务草稿分开存储；失败只停诊断，不影响称重。
export function createWeighTrace(owner, storage, notify = () => {}) {
 const key = `pda_weigh_trace_v1_${owner}`
 const limit = 20000, chunkSize = 100
 let meta = { enabled: false, chunks: 0, count: 0, started: 0, error: '' }, buffer = [], timer = null
 try { meta = storage.getStorageSync(key) || meta } catch (_) {}
 function status() { notify({ ...meta, count: meta.count + buffer.length }) }
 function saveMeta() { storage.setStorageSync(key, meta) }
 function flush() {
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
  if (meta.count || buffer.length) throw new Error('已有采样，请先导出；确认新一批会清理旧采样')
  meta = { enabled: true, chunks: 0, count: 0, started: Date.now(), error: '' }; flush(); record('record_start')
 }
 function stop() { record('record_stop'); meta.enabled = false; flush() }
 function clear() {
  stop()
  for (let i = 0; i < meta.chunks; i++) storage.removeStorageSync(`${key}_${meta.started}_${i}`)
  meta = { enabled: false, chunks: 0, count: 0, started: 0, error: '' }; buffer = []; saveMeta(); status()
 }
 function dump() {
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

export function exportWeighTrace(text) {
 return new Promise((resolve, reject) => {
  if (typeof plus === 'undefined' || !plus.io) return reject(new Error('请在PDA导出采样'))
  plus.io.requestFileSystem(plus.io.PUBLIC_DOWNLOADS, fs => {
   fs.root.getFile(`weigh-trace-${Date.now()}.json`, { create: true, exclusive: true }, entry => {
    entry.createWriter(writer => {
     writer.onerror = reject
     writer.onwrite = () => resolve(entry.toLocalURL())
     writer.write(text)
    }, reject)
   }, reject)
  }, reject)
 })
}
