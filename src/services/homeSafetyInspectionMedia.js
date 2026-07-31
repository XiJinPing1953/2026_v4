function normalizeText(value) {
	return value == null ? '' : String(value).trim()
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

export async function resolveInspectionFileUrls(fileIds = []) {
	const normalized = Array.from(
		new Set((fileIds || []).map(normalizeText).filter((item) => item.startsWith('cloud://')))
	)
	if (!normalized.length) return {}
	try {
		const res = await uniCloud.getTempFileURL({ fileList: normalized })
		const map = {}
		for (const item of Array.isArray(res?.fileList) ? res.fileList : []) {
			const fileId = normalizeText(item?.fileID || item?.fileId)
			if (!fileId) continue
			map[fileId] = normalizeText(item?.tempFileURL || item?.tempFileUrl) || fileId
		}
		normalized.forEach((fileId) => {
			if (!map[fileId]) map[fileId] = fileId
		})
		return map
	} catch (_) {
		return Object.fromEntries(normalized.map((fileId) => [fileId, fileId]))
	}
}
