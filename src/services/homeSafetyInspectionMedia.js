function normalizeText(value) {
	return value == null ? '' : String(value).trim()
}

const TEMP_FILE_BATCH_SIZE = 50
const TEMP_FILE_CACHE_TTL_MS = 10 * 60 * 1000
const tempFileUrlCache = new Map()

function resolveBatchSize(value) {
	return Math.min(Math.max(Number(value) || TEMP_FILE_BATCH_SIZE, 1), TEMP_FILE_BATCH_SIZE)
}

function readCachedTempFileUrl(fileId, now = Date.now()) {
	const cached = tempFileUrlCache.get(fileId)
	if (!cached || cached.expiresAt <= now) {
		tempFileUrlCache.delete(fileId)
		return ''
	}
	return cached.url
}

function emitResolvedBatch(callback, resolved, source) {
	if (typeof callback !== 'function' || !Object.keys(resolved).length) return
	try {
		callback({ ...resolved }, { source })
	} catch (_) {
		// A rendering callback must not interrupt resolution of later batches.
	}
}

export function invalidateInspectionFileUrl(fileId) {
	tempFileUrlCache.delete(normalizeText(fileId))
}

function extractChooseImagePaths(res = null) {
	const result = []
	const add = (value) => {
		const path = normalizeText(value)
		if (path && !result.includes(path)) result.push(path)
	}
	;(Array.isArray(res?.tempFilePaths) ? res.tempFilePaths : []).forEach(add)
	;(Array.isArray(res?.apFilePaths) ? res.apFilePaths : []).forEach(add)
	;(Array.isArray(res?.tempFiles) ? res.tempFiles : []).forEach((item) => {
		add(item?.path)
		add(item?.tempFilePath)
		add(item?.apFilePath)
	})
	return result
}

export async function chooseInspectionImages({ count = 1, source = 'camera' } = {}) {
	const res = await uni.chooseImage({
		count: Math.min(Math.max(Number(count) || 1, 1), 3),
		sizeType: ['compressed'],
		sourceType: source === 'album' ? ['album'] : ['camera']
	})
	return extractChooseImagePaths(res)
}

function resolveExt(path) {
	const clean = normalizeText(path).split(/[?#]/)[0]
	const match = clean.match(/(\.[a-zA-Z0-9]{2,5})$/)
	return match ? match[1].toLowerCase() : '.jpg'
}

function resolveUploadFileId(result = null) {
	const direct = normalizeText(result?.fileID || result?.fileId)
	if (direct.startsWith('cloud://')) return direct
	const queue = [result]
	const seen = new Set()
	while (queue.length) {
		const current = queue.shift()
		if (current == null || seen.has(current)) continue
		if (typeof current === 'object') {
			seen.add(current)
			Object.values(current).forEach((value) => queue.push(value))
			continue
		}
		const text = normalizeText(current)
		const match = text.match(/cloud:\/\/[^\s"'`\\]+/)
		if (match) return match[0]
		if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
			try {
				queue.push(JSON.parse(text))
			} catch (_) {
				// Ignore non-JSON upload metadata.
			}
		}
	}
	return ''
}

export async function uploadInspectionImage({
	filePath,
	submissionId,
	scope = 'photo',
	index = 0
} = {}) {
	const localPath = normalizeText(filePath)
	if (!localPath) throw new Error('上传文件路径为空')
	const safeSubmissionId = normalizeText(submissionId).replace(/[^a-zA-Z0-9_-]/g, '') || 'draft'
	const safeScope = normalizeText(scope).replace(/[^a-zA-Z0-9_-]/g, '') || 'photo'
	const cloudPath =
		`home-safety-inspection/${safeSubmissionId}/` +
		`${safeScope}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}${resolveExt(localPath)}`
	const res = await uniCloud.uploadFile({
		fileType: 'image',
		cloudPath,
		filePath: localPath
	})
	const fileId = resolveUploadFileId(res)
	if (!fileId) throw new Error('上传成功但未取得云文件标识')
	return fileId
}

export async function resolveInspectionFileUrls(fileIds = [], options = {}) {
	const normalized = Array.from(
		new Set((fileIds || []).map(normalizeText).filter((item) => item.startsWith('cloud://')))
	)
	if (!normalized.length) return {}
	const map = Object.fromEntries(normalized.map((fileId) => [fileId, fileId]))
	const pending = []
	const cached = {}
	const now = Date.now()
	for (const fileId of normalized) {
		const url = options?.forceRefresh ? '' : readCachedTempFileUrl(fileId, now)
		if (url) {
			map[fileId] = url
			cached[fileId] = url
		} else {
			pending.push(fileId)
		}
	}
	emitResolvedBatch(options?.onBatchResolved, cached, 'cache')
	const batchSize = resolveBatchSize(options?.batchSize)
	for (let start = 0; start < pending.length; start += batchSize) {
		const batch = pending.slice(start, start + batchSize)
		try {
			const res = await uniCloud.getTempFileURL({ fileList: batch })
			const resolved = {}
			for (const item of Array.isArray(res?.fileList) ? res.fileList : []) {
				const fileId = normalizeText(item?.fileID || item?.fileId)
				if (!fileId || !Object.prototype.hasOwnProperty.call(map, fileId)) continue
				const url = normalizeText(item?.tempFileURL || item?.tempFileUrl)
				if (!url || url === fileId) continue
				map[fileId] = url
				resolved[fileId] = url
				tempFileUrlCache.set(fileId, { url, expiresAt: Date.now() + TEMP_FILE_CACHE_TTL_MS })
			}
			emitResolvedBatch(options?.onBatchResolved, resolved, 'network')
		} catch (_) {
			// Keep this batch's original cloud IDs while allowing other batches to resolve.
		}
	}
	return map
}
