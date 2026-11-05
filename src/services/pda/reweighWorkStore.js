import { createReweighDraftStore, createReweighId, validReweighEntry, readReweighDraft, readReweighDraftAsync, reweighDraftKey } from './reweighDraft'

// Native work chunks are immutable UUID snapshots. Keep only a small, short-lived
// raw-text cache; roots are always read from storage and checked again by the core.
const chunkCache = new Map()
const CACHE_UNITS = 256 * 1024
let cacheOwner = '', cacheUnits = 0
function forgetChunk(key) { const entry = chunkCache.get(key); if (entry) { cacheUnits -= entry.value.length; chunkCache.delete(key) } }
function rememberChunk(key, value, replace = true) {
 forgetChunk(key)
 if (typeof value !== 'string' || value.length > CACHE_UNITS) return
 for (const [name, entry] of chunkCache) if (entry.until <= Date.now()) forgetChunk(name)
 // A large sequential restore must not evict the later chunks it is about to
 // read. Admit misses only into spare space; verified writes can replace old data.
 if (!replace && (cacheUnits + value.length > CACHE_UNITS || chunkCache.size >= 32)) return
 while (chunkCache.size && (cacheUnits + value.length > CACHE_UNITS || chunkCache.size >= 32)) forgetChunk(chunkCache.keys().next().value)
 chunkCache.set(key, { value, until: Date.now() + 60000 }); cacheUnits += value.length
}

// Working records and immutable archives have separate roots. The original v1/v2
// snapshot remains untouched during migration; switching the work root commits it.
const tokenOf = value => typeof value === 'string' ? value : JSON.stringify(value ?? null)
const decode = value => typeof value === 'string' ? JSON.parse(value) : value
const workKey = (owner, mode) => `${reweighDraftKey(owner, mode)}:work-v3`
const entryRound = entry => entry?.roundId || entry?.frozen?.payload?.round_id || ''
const cleanMetadata = metadata => ({ ...metadata, ...(!metadata?.pendingEndRound ? { lastEndedRound: null } : {}) })

function workStorage(owner, mode, storage, reuseChunks = false) {
 const base = reweighDraftKey(owner, mode), key = workKey(owner, mode)
 if (reuseChunks && cacheOwner !== owner) { chunkCache.clear(); cacheUnits = 0; cacheOwner = owner }
 const physical = name => name === base || name.startsWith(`${base}:`) ? key + name.slice(base.length) : name
 const cacheable = name => reuseChunks && cacheOwner === owner && name.startsWith(`${key}:history:`)
 return {
  getStorageSync(name) { const path = physical(name), value = storage.getStorageSync(path); if (cacheable(path)) rememberChunk(path, value); return value },
  async getStorage(name) {
   const path = physical(name), cached = cacheable(path) && chunkCache.get(path)
   if (cached && cached.until > Date.now()) return cached.value
   forgetChunk(path)

   const value = await storage.getStorage(path); if (cacheable(path)) rememberChunk(path, value, false); return value
  },
  setStorageSync(name, value) { const path = physical(name); forgetChunk(path); storage.setStorageSync(path, value) },
  removeStorageSync(name) { const path = physical(name); forgetChunk(path); storage.removeStorageSync?.(path) }
 }
}

// Maintenance never opens a round, migrates a draft or rewrites business history.
export function floorCalibrationWorkIdle(owner, storage) {
	if (!owner) return false
	for (const mode of ['floor', 'floor-return']) {
		const raw = storage.getStorageSync(workKey(owner, mode)) || storage.getStorageSync(reweighDraftKey(owner, mode))
		if (!raw) continue
		const head = typeof raw === 'string' ? JSON.parse(raw) : raw
		if (![1, 2].includes(head?.version) || head.ownerId !== owner || !validReweighEntry(head.current)) throw new Error('地秤草稿无法读取，先返回复秤页核对')
		const unfinished = (head.current.bottleNo || head.current.frozen) && head.current.receipt?.saved !== true
		if (unfinished || head.metadata?.pendingRound || head.metadata?.pendingEndRound) return false
	}
	return true
}

export function createReweighWorkStore(owner, storage, currentOwner = () => owner, mode = 'filling', { reuseImmutableChunks = false } = {}) {
 const key = workKey(owner, mode), legacyKey = reweighDraftKey(owner, mode)
 let archiveHead = null, lastHistory = null, lastRound = null, migrationToken
 const mapped = workStorage(owner, mode, {
  ...storage,
  setStorageSync(name, value) {
   if (name === key && migrationToken !== undefined && tokenOf(storage.getStorageSync(legacyKey)) !== migrationToken) throw new Error('复秤草稿已在另一页面更新，请重新进入并恢复最新内容')
   storage.setStorageSync(name, value)
  }
 }, reuseImmutableChunks)
 const core = createReweighDraftStore(owner, mapped, currentOwner, mode)
 function writeArchive(rows) {
  if (currentOwner() !== owner) throw new Error('登录账号已变化，请使用原账号恢复复秤草稿')
  const chunks = []
  const write = (name, value) => {
   const encoded = JSON.stringify(value)
   storage.setStorageSync(name, encoded)
   if (tokenOf(storage.getStorageSync(name)) !== encoded) throw new Error('复秤归档写入核对失败，原记录已保留')
  }
  const prefix = `${key}:archive:${createReweighId()}`
  for (let offset = 0; offset < rows.length; offset += 40) {
   const values = rows.slice(offset, offset + 40), name = `${prefix}:${offset / 40}`
   write(name, values); chunks.push({ key: name, count: values.length })
  }
  const name = `${prefix}:index`
  write(name, { version: 1, ownerId: owner, previous: archiveHead, chunks })
  return name
 }
 function save(current, history, metadata = null) {
  const roundId = metadata?.round?._id || metadata?.pendingEndRound?.round_id || ''
  let kept = history, archived = []
  if (history !== lastHistory || roundId !== lastRound) {
   kept = []
   for (const row of history) {
    if (row?.receipt?.saved === true && (!roundId || entryRound(row) !== roundId)) archived.push(row)
    else kept.push(row)
   }
   if (!archived.length) kept = history
  }
  const nextHead = archived.length ? writeArchive(archived) : archiveHead
  // Archive chunks are retained on an ambiguous native write. A restart can
  // resolve either committed root; never delete source records to hide failure.
  const result = core.save(current, kept, { ...cleanMetadata(metadata), archiveHead: nextHead })
  archiveHead = nextHead; lastHistory = result; lastRound = roundId; migrationToken = undefined
  return result
 }
 function accept(data) {
  if (!data) return null
  archiveHead = data.metadata?.archiveHead || null
  lastHistory = data.history; lastRound = data.metadata?.round?._id || ''
  // Upgrade existing work roots once: saved old rounds belong to query history,
  // even when downstream work is pending. Unknown saves stay in the work root.
  const roundId = data.metadata?.round?._id || data.metadata?.pendingEndRound?.round_id || ''
  const history = data.history.some(row => row?.receipt?.saved === true && (!roundId || entryRound(row) !== roundId))
   ? save(data.current, [...data.history], data.metadata) : data.history
  return { ...data, history, metadata: { ...cleanMetadata(data.metadata), archiveHead } }
 }
 function migrate(data, raw) {
  if (!data) return null
  if (!validReweighEntry(data.current) || !data.history.every(validReweighEntry)) throw new Error('复秤草稿无法读取或识别，原数据已保留')
  migrationToken = tokenOf(raw)
  const history = save(data.current, data.history, data.metadata)
  return { ...data, history, metadata: { ...cleanMetadata(data.metadata), archiveHead } }
 }
 return {
  load() {
   const existing = core.load()
   if (existing) return accept(existing)
   const raw = storage.getStorageSync(legacyKey)
   return migrate(readReweighDraft(owner, storage, mode, raw), raw)
  },
  async loadAsync() {
   const existing = await core.loadAsync()
   if (existing) return accept(existing)

   const raw = await storage.getStorage(legacyKey)
   const data = await readReweighDraftAsync(owner, storage, mode, () => currentOwner() === owner, raw)
   return migrate(data, raw)
  },
  save
 }
}

export async function readReweighHistoryRoot(owner, storage, mode = 'filling') {
 const key = workKey(owner, mode), raw = await storage.getStorage(key)
 if (raw) return { key, raw, work: true }
 const legacyKey = reweighDraftKey(owner, mode)
 return { key: legacyKey, raw: await storage.getStorage(legacyKey), work: false }
}

export async function readReweighHistorySnapshot(owner, storage, mode = 'filling', shouldContinue = () => true, root) {
 const control = root || await readReweighHistoryRoot(owner, storage, mode)
 const source = control.work ? workStorage(owner, mode, storage) : storage
 const data = await readReweighDraftAsync(owner, source, mode, shouldContinue, control.raw)
 if (!data || !control.work) return data
 const rows = [], seen = new Set(), prefix = `${workKey(owner, mode)}:archive:`
 let next = data.metadata?.archiveHead || null
 function valid() { if (!shouldContinue()) throw new Error('页面或账号已变化，请重新查询本机记录') }
 while (next) {
  valid()
  if (typeof next !== 'string' || !next.startsWith(prefix) || seen.has(next)) throw new Error('复秤归档索引异常，原记录已保留')
  seen.add(next)
  const node = decode(await storage.getStorage(next))
  if (node?.version !== 1 || node.ownerId !== owner || !Array.isArray(node.chunks)) throw new Error('复秤归档无法读取，原记录已保留')
  for (let offset = 0; offset < node.chunks.length; offset += 4) {
   valid()
   const parts = await Promise.all(node.chunks.slice(offset, offset + 4).map(async chunk => {
    if (typeof chunk.key !== 'string' || !chunk.key.startsWith(prefix) || !Number.isInteger(chunk.count) || chunk.count < 1 || chunk.count > 40) throw new Error('复秤归档分段索引异常')
    const values = decode(await storage.getStorage(chunk.key))
    if (!Array.isArray(values) || values.length !== chunk.count || !values.every(validReweighEntry)) throw new Error('复秤归档分段无法读取，原记录已保留')
    return values
   }))
   rows.push(...parts.flat())
  }
  next = node.previous
 }
 valid()
 if (tokenOf(await storage.getStorage(control.key)) !== tokenOf(control.raw)) throw new Error('本机记录已更新，请重新查询')
 return { ...data, history: [...rows, ...data.history] }
}
