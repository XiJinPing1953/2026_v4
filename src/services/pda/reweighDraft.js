export function createReweighId() {
	const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
	return `reweigh-${random}`
}

export const cloneReweigh = (value) => JSON.parse(JSON.stringify(value))

const HISTORY_KEEP_FROM = '2026-10-21'
const BUSINESS_OFFSET_MS = 8 * 60 * 60 * 1000

export function reweighHistoryTime(entry) {
	for (const value of [entry?.frozen?.payload?.capture?.sampled_at, entry?.capture?.sampled_at]) {
		const timestamp = Number(value)
		const date = new Date(timestamp + BUSINESS_OFFSET_MS)
		if (Number.isFinite(timestamp) && timestamp > 0 && Number.isFinite(date.getTime())) return date.toISOString().slice(0, 19).replace('T', ' ')
	}
	const value = String(entry?.frozen?.payload?.date || entry?.date || '')
	if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
		const date = new Date(value.replace(' ', 'T') + '+08:00')
		if (Number.isFinite(date.getTime()) && new Date(date.getTime() + BUSINESS_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ') === value) return value
	}
	return '—'
}

export function pruneReweighHistory(history) {
	// 固定清理用户指定日期之前的已完成历史，不按“今天”滚动删记录。
	// 未确认/待处理操作和无法确定日期的旧数据保留恢复入口。
	const kept = history.filter(entry => {
		if (entry.receipt?.complete !== true) return true
		const time = reweighHistoryTime(entry)
		const value = time === '—' ? String(entry.frozen?.payload?.date || entry.date || '') : time
		const day = value.slice(0, 10)
		const date = new Date(day + 'T00:00:00+08:00')
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || new Date(date.getTime() + BUSINESS_OFFSET_MS).toISOString().slice(0, 10) !== day) return true
		return day >= HISTORY_KEEP_FROM
	})
	return kept.length === history.length ? history : kept
}

const HISTORY_CHUNK_SIZE = 40
const storageToken = raw => raw ? (typeof raw === 'string' ? raw : JSON.stringify(raw)) : null
export function reweighDraftKey(ownerId, mode = 'filling') {
	return `${mode === 'return' ? 'crm_pda_return_reweigh_v1' : 'crm_pda_reweigh_v1'}:${ownerId}`
}

// Shared read-only decoder: record queries must also understand the chunked format.
export function readReweighDraft(ownerId, storage, mode = 'filling', raw = storage.getStorageSync(reweighDraftKey(ownerId, mode))) {
	if (!raw) return null
	const data = typeof raw === 'string' ? JSON.parse(raw) : raw
	if (![1, 2].includes(data?.version) || data.ownerId !== ownerId) throw new Error('复秤草稿无法读取或识别，原数据已保留')
	let history = data.history
	if (data.version === 2) {
		const prefix = `${reweighDraftKey(ownerId, mode)}:history:`
		if (!Array.isArray(data.historyChunks)) throw new Error('复秤历史索引无法读取，原数据已保留')
		history = data.historyChunks.flatMap(chunk => {
			if (typeof chunk.key !== 'string' || !chunk.key.startsWith(prefix) || !Number.isInteger(chunk.count) || chunk.count < 1 || chunk.count > HISTORY_CHUNK_SIZE) throw new Error('复秤历史索引无法读取，原数据已保留')
			const value = storage.getStorageSync(chunk.key)
			const rows = typeof value === 'string' ? JSON.parse(value) : value
			if (!Array.isArray(rows) || rows.length !== chunk.count) throw new Error('复秤历史分段无法读取，原数据已保留')
			return rows
		})
	}
	if (!Array.isArray(history)) throw new Error('复秤历史无法读取，原数据已保留')
	return { ...data, history }
}

async function readDraftSnapshot(ownerId, storage, mode, shouldContinue, initialRaw) {
	const key = reweighDraftKey(ownerId, mode)
	function assertCurrentReader() {
		if (!ownerId || !shouldContinue()) throw new Error('页面或账号已变化，请重新查询本机记录')
	}

	assertCurrentReader()
	const raw = initialRaw === undefined ? await storage.getStorage(key) : initialRaw
	const source = new Map([[key, raw]])
	if (raw) {
		const head = typeof raw === 'string' ? JSON.parse(raw) : raw
		if (![1, 2].includes(head?.version) || head.ownerId !== ownerId) throw new Error('复秤草稿无法读取或识别，原数据已保留')
		if (head.version === 2) {
			if (!Array.isArray(head.historyChunks)) throw new Error('复秤历史索引无法读取，原数据已保留')
			const prefix = `${key}:history:`
			for (const chunk of head.historyChunks) {
				if (typeof chunk.key !== 'string' || !chunk.key.startsWith(prefix) || !Number.isInteger(chunk.count) || chunk.count < 1 || chunk.count > HISTORY_CHUNK_SIZE) throw new Error('复秤历史索引无法读取，原数据已保留')
			}
			// Bound native requests and yield between batches; all records are kept.
			for (let offset = 0; offset < head.historyChunks.length; offset += 4) {
				assertCurrentReader()
				await Promise.all(head.historyChunks.slice(offset, offset + 4).map(async chunk => source.set(chunk.key, await storage.getStorage(chunk.key))))
			}
		}
	}
	// Another page/account may change while async reads are in flight.
	const latest = await storage.getStorage(key)
	assertCurrentReader()
	if (storageToken(latest) !== storageToken(raw)) throw new Error('复秤草稿已在另一页面更新，请重新进入并恢复最新内容')
	return { raw, source: { getStorageSync: name => source.get(name) } }
}

export async function readReweighDraftAsync(ownerId, storage, mode = 'filling', shouldContinue = () => true, initialRaw) {
	const { raw, source } = await readDraftSnapshot(ownerId, storage, mode, shouldContinue, initialRaw)
	return readReweighDraft(ownerId, source, mode, raw)
}

export function createReweighDraftStore(ownerId, storage, currentOwner = () => ownerId, mode = 'filling') {
	const key = reweighDraftKey(ownerId, mode)
	let expected = null, previousHistory = null, chunks = [], lastContent = null
	const contentToken = (data, parts) => JSON.stringify({ ownerId: data.ownerId, current: data.current, metadata: data.metadata ?? null, historyChunks: parts })
	function assertWritable() {
		if (!ownerId || currentOwner() !== ownerId) throw new Error('登录账号已变化，请使用原账号恢复复秤草稿')
		if (storageToken(storage.getStorageSync(key)) !== expected) throw new Error('复秤草稿已在另一页面更新，请重新进入并恢复最新内容')
	}
	function verifiedWrite(name, value) {
		storage.setStorageSync(name, value)
		if (storageToken(storage.getStorageSync(name)) !== value) throw new Error('复秤草稿写入核对失败')
	}
	function backup(name, value) {
		if (!storage.getStorageSync(name)) verifiedWrite(name, value)
	}
	function write(data) {
		assertWritable()
		// Hiding/unmounting an unchanged page still checks ownership and conflicts,
		// but does not rewrite SQLite or advance savedAt.
		if (data.history === previousHistory && contentToken(data, chunks) === lastContent) return data
		const history = data.history === previousHistory ? data.history : pruneReweighHistory(data.history)
		if (history.length !== data.history.length) backup(`${key}:history-backup-before-20261021`, JSON.stringify(data))
		// Keep a verified original before the first format upgrade. Never truncate history.
		if (expected && JSON.parse(expected).version === 1) backup(`${key}:before-chunked-v2`, expected)
		const nextChunks = [], created = []
		let committed = false
		try {
			if (history === previousHistory) nextChunks.push(...chunks)
			else for (let start = 0; start < history.length; start += HISTORY_CHUNK_SIZE) {
				const rows = history.slice(start, start + HISTORY_CHUNK_SIZE), old = chunks[start / HISTORY_CHUNK_SIZE]
				if (old && rows.length === old.count && rows.every((row, index) => row === previousHistory?.[start + index])) nextChunks.push(old)
				else {
					const name = `${key}:history:${createReweighId()}`
					created.push(name)
					verifiedWrite(name, JSON.stringify(rows))
					nextChunks.push({ key: name, count: rows.length })
				}
			}
			assertWritable()
			const { history: ignored, ...head } = data
			const value = JSON.stringify({ ...head, version: 2, historyChunks: nextChunks })
			// Once root commit starts, retain chunks even if the native write reports an error.
			committed = true
			storage.setStorageSync(key, value)
			expected = value
			if (storageToken(storage.getStorageSync(key)) !== value) throw new Error('复秤草稿写入核对失败')
			const retained = new Set(nextChunks.map(chunk => chunk.key))
			for (const chunk of chunks) if (!retained.has(chunk.key)) { try { storage.removeStorageSync?.(chunk.key) } catch (_) {} }
			chunks = nextChunks; previousHistory = history; lastContent = contentToken(data, nextChunks)
			return { ...data, history }
		} catch (cause) {
			if (!committed) for (const name of created) { try { storage.removeStorageSync?.(name) } catch (_) {} }
			throw cause
		}
	}
	function finishLoad(raw, source = storage) {
		expected = storageToken(raw)
		if (!raw) return null
		const data = readReweighDraft(ownerId, source, mode, raw)
		const valid = entry => entry && typeof entry.operationId === 'string' && entry.operationId && typeof entry.bottleNo === 'string'
			&& (!entry.frozen || (['create', 'correct'].includes(entry.frozen.mode) && entry.frozen.payload?.operation_id === entry.operationId && entry.frozen.payload?.bottle_no === entry.bottleNo))
		if (!valid(data.current) || !data.history.every(valid)) throw new Error('复秤草稿无法读取或识别，原数据已保留')
		// Loaded records and history replacements are immutable snapshots.
		const result = cloneReweigh(data)
		chunks = result.historyChunks || []; previousHistory = result.version === 2 ? result.history : null
		lastContent = result.version === 2 ? contentToken(result, chunks) : null
		return pruneReweighHistory(result.history).length !== result.history.length ? write(result) : result
	}
	function assertOwner() {
		if (!ownerId || currentOwner() !== ownerId) throw new Error('登录账号已变化，请使用原账号恢复复秤草稿')
	}
	return {
		load() {
			assertOwner()
			return finishLoad(storage.getStorageSync(key))
		},
		async loadAsync() {
			assertOwner()
			const { raw, source } = await readDraftSnapshot(ownerId, storage, mode, () => { assertOwner(); return true })
			return finishLoad(raw, source)
		},
		save(current, history, metadata = null) {
			return write({ ownerId, savedAt: Date.now(), current, history, metadata }).history
		}
	}
}

export function reweighPreviousNotice(preview, isReturn) {
	if (!isReturn) return preview?.mode === 'correct' ? '这瓶已有罐装记录，保存后更正原记录' : ''
	if (!preview?.previous) return ''
	const previousRound = preview.previous.round_id
	const currentRound = preview.round?._id
	return previousRound && currentRound && previousRound === currentRound
		? '这瓶本轮已称过，保存后采用本次重量'
		: ''
}

export function reweighReceipt(response, operationId, previous = null) {
	const data = response?.data || {}
	const matched = !data.operation_id || data.operation_id === operationId
	const savedSource = (data.source_records || []).find((row) => row.saved === true)
	const saved = matched && (data.complete === true || Number(data.saved_total) > 0 || Boolean(savedSource))
	if (!saved && previous?.saved) return { ...previous, message: response?.msg || '状态暂未更新，已确认的保存结果保留' }
	return {
		operationId,
		saved,
		complete: saved && data.complete === true,
		status: saved ? (data.complete ? 'complete' : 'pending') : 'unknown',
		fillingId: saved ? (savedSource?._id || data._id || previous?.fillingId || '') : '',
		message: response?.msg || data.last_error || (saved ? (data.complete ? '灌装记录已保存，后续处理已完成' : '灌装记录已保存，后续处理待完成') : '保存结果待确认，请查询或重试原操作')
	}
}
