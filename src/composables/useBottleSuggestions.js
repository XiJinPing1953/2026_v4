import { searchBottlesV1 } from '@/services/bottle'
import { normalizeBottleNo } from '@/services/models/bottle'

const STATUS_LABEL_MAP = {
	unknown: '未知',
	in_station: '在站',
	at_customer: '在客户',
	scrapped: '报废',
	lost: '丢失'
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function getBottleSuggestionStatusLabel(value) {
	const key = normalizeString(value)
	return STATUS_LABEL_MAP[key] || '未知'
}

function formatBottleSuggestionSub(item = {}) {
	const status = getBottleSuggestionStatusLabel(item?.status)
	const customer = normalizeString(item?.current_customer_name)
	return customer ? `${status} · ${customer}` : status
}

function dedupeSuggestions(items = []) {
	const map = new Map()
	for (let i = 0; i < items.length; i += 1) {
		const item = items[i]
		if (!item) continue
		const bottleNo = normalizeBottleNo(item.bottle_no)
		if (!bottleNo) continue
		const id = normalizeString(item._id)
		const key = id || bottleNo
		if (map.has(key)) continue
		map.set(key, {
			...item,
			bottle_no: bottleNo
		})
	}
	return Array.from(map.values())
}

function scoreSuggestion(item = {}, targetBottleNo = '', targetKeywordLower = '') {
	const bottleNo = normalizeBottleNo(item.bottle_no)
	if (!bottleNo) return -1
	let score = 0
	if (targetBottleNo && bottleNo === targetBottleNo) score += 1000
	else if (targetBottleNo && bottleNo.startsWith(targetBottleNo)) score += 600
	else if (targetBottleNo && bottleNo.includes(targetBottleNo)) score += 300
	const customer = normalizeString(item.current_customer_name).toLowerCase()
	if (targetKeywordLower && customer && customer.includes(targetKeywordLower)) score += 120
	return score
}

function compareSuggestion(a, b, targetBottleNo, targetKeywordLower) {
	const scoreDiff = scoreSuggestion(b, targetBottleNo, targetKeywordLower) - scoreSuggestion(a, targetBottleNo, targetKeywordLower)
	if (scoreDiff !== 0) return scoreDiff
	const aNo = normalizeBottleNo(a?.bottle_no)
	const bNo = normalizeBottleNo(b?.bottle_no)
	return aNo.localeCompare(bNo, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

async function searchBottleSuggestions(keyword, { limit = 20 } = {}) {
	const targetKeyword = normalizeString(keyword)
	if (!targetKeyword) return []
	const targetBottleNo = normalizeBottleNo(targetKeyword)
	const targetKeywordLower = targetKeyword.toLowerCase()
	const pageSize = 50
	const maxScanRows = targetBottleNo.length <= 1 ? 800 : targetBottleNo.length <= 2 ? 500 : 200
	const maxPages = Math.max(3, Math.ceil(maxScanRows / pageSize))
	const merged = []
	let scanned = 0
	let total = 0
	for (let page = 1; page <= maxPages; page += 1) {
		const res = await searchBottlesV1({
			keyword: targetKeyword,
			page,
			pageSize,
			is_active: true
		})
		if (res?.code !== 0 || !Array.isArray(res.data)) break
		const rows = res.data.filter((item) => Boolean(item && item.is_active !== false))
		merged.push(...rows)
		scanned += rows.length
		total = Number(res.total || 0)
		const hasExact = merged.some((item) => normalizeBottleNo(item?.bottle_no) === targetBottleNo)
		const noMore = rows.length < pageSize || (total > 0 && scanned >= total)
		const reachedScanCap = scanned >= maxScanRows
		if (hasExact || noMore || reachedScanCap) break
	}
	const deduped = dedupeSuggestions(merged)
	deduped.sort((a, b) => compareSuggestion(a, b, targetBottleNo, targetKeywordLower))
	const safeLimit = Math.max(Number(limit || 20), 1)
	return deduped.slice(0, safeLimit)
}

export {
	formatBottleSuggestionSub,
	getBottleSuggestionStatusLabel,
	normalizeBottleNo,
	searchBottleSuggestions
}
