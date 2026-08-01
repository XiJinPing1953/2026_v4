import { chooseInspectionImages, resolveInspectionFileUrls } from '@/services/homeSafetyInspectionMedia'

function normalizeText(value) {
	return value == null ? '' : String(value).trim()
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
		const match = normalizeText(current).match(/cloud:\/\/[^\s"'`\\]+/)
		if (match) return match[0]
	}
	return ''
}

export async function uploadStationSafetyImage({ filePath, submissionId, scope = 'photo', index = 0 } = {}) {
	const localPath = normalizeText(filePath)
	if (!localPath) throw new Error('上传文件路径为空')
	const safeSubmissionId = normalizeText(submissionId).replace(/[^a-zA-Z0-9_-]/g, '') || 'draft'
	const safeScope = normalizeText(scope).replace(/[^a-zA-Z0-9_-]/g, '') || 'photo'
	const cloudPath =
		`station-safety-inspection/${safeSubmissionId}/` +
		`${safeScope}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}${resolveExt(localPath)}`
	const res = await uniCloud.uploadFile({ fileType: 'image', cloudPath, filePath: localPath })
	const fileId = resolveUploadFileId(res)
	if (!fileId) throw new Error('上传成功但未取得云文件标识')
	return fileId
}

export { chooseInspectionImages, resolveInspectionFileUrls }
