'use strict'

const DEFAULT_PAGE_SIZE = 500
const DEFAULT_CONCURRENCY = 10
const DEFAULT_MAX_PAGES_PER_KEY = 200

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function normalizeUniqueKeys(keys) {
	const result = []
	const seen = new Set()
	for (const raw of Array.isArray(keys) ? keys : []) {
		const key = normalizeString(raw)
		if (!key || seen.has(key)) continue
		seen.add(key)
		result.push(key)
	}
	return result
}

function createPagingError(message, detail = {}) {
	const err = new Error(message || '流转历史分页读取失败')
	err.code = 'BOTTLE_FLOW_HISTORY_INCOMPLETE'
	err.detail = detail && typeof detail === 'object' ? detail : {}
	return err
}

async function fetchRowsForKey({ key, fetchPage, pageSize, maxPagesPerKey, includeRow }) {
	const rows = []
	const seenIds = new Set()
	let skip = 0
	let page = 0
	while (true) {
		page += 1
		if (page > maxPagesPerKey) {
			throw createPagingError(`瓶号 ${key} 的流转历史超过分页安全上限`, {
				key,
				page,
				skip,
				page_size: pageSize
			})
		}
		let pageRows = null
		try {
			pageRows = await fetchPage({ key, skip, limit: pageSize, page })
		} catch (err) {
			throw createPagingError(`瓶号 ${key} 的流转历史第 ${page} 页读取失败`, {
				key,
				page,
				skip,
				page_size: pageSize,
				cause: normalizeString(err && err.message)
			})
		}
		if (!Array.isArray(pageRows)) {
			throw createPagingError(`瓶号 ${key} 的流转历史第 ${page} 页返回格式异常`, {
				key,
				page,
				skip,
				page_size: pageSize
			})
		}
		if (pageRows.length > pageSize) {
			throw createPagingError(`瓶号 ${key} 的流转历史第 ${page} 页超出预期大小`, {
				key,
				page,
				skip,
				page_size: pageSize,
				returned: pageRows.length
			})
		}

		for (const row of pageRows) {
			if (typeof includeRow === 'function' && !includeRow(row, key)) continue
			const id = normalizeString(row && row._id)
			if (id && seenIds.has(id)) continue
			if (id) seenIds.add(id)
			rows.push(row)
		}

		if (pageRows.length < pageSize) break
		skip += pageRows.length
	}
	return rows
}

async function fetchRowsByKeysPaginated(options = {}) {
	const keys = normalizeUniqueKeys(options.keys)
	if (!keys.length) return []
	if (typeof options.fetchPage !== 'function') {
		throw createPagingError('缺少流转历史分页读取器')
	}
	const pageSize = Math.min(Math.max(Number(options.pageSize) || DEFAULT_PAGE_SIZE, 1), 5000)
	const concurrency = Math.min(Math.max(Number(options.concurrency) || DEFAULT_CONCURRENCY, 1), 50)
	const maxPagesPerKey = Math.min(
		Math.max(Number(options.maxPagesPerKey) || DEFAULT_MAX_PAGES_PER_KEY, 1),
		1000
	)
	const groupedRows = new Array(keys.length)
	let nextIndex = 0

	const worker = async () => {
		while (true) {
			const index = nextIndex
			nextIndex += 1
			if (index >= keys.length) return
			groupedRows[index] = await fetchRowsForKey({
				key: keys[index],
				fetchPage: options.fetchPage,
				pageSize,
				maxPagesPerKey,
				includeRow: options.includeRow
			})
		}
	}

	const workerCount = Math.min(concurrency, keys.length)
	await Promise.all(Array.from({ length: workerCount }, () => worker()))
	return groupedRows.flat()
}

module.exports = {
	DEFAULT_PAGE_SIZE,
	DEFAULT_CONCURRENCY,
	DEFAULT_MAX_PAGES_PER_KEY,
	createPagingError,
	fetchRowsByKeysPaginated
}
