import { getBottleV1, resolveBottleNoV1, resolveBottlePdaQrCodeV1, searchBottlesV1 } from '@/services/bottle'
import { normalizeBottleNo, normalizeQrCode, normalizeText } from './shared'

const BOTTLE_CACHE_TTL_MS = 30 * 1000
const bottleQrCache = new Map()
const bottleNoCache = new Map()

function readCache(cache, key) {
	if (!key || !cache.has(key)) return null
	const cached = cache.get(key)
	if (!cached || Number(cached.expireAt || 0) <= Date.now()) {
		cache.delete(key)
		return null
	}
	return cached.data || null
}

function writeCache(cache, key, data, ttlMs) {
	if (!key || !data) return data
	cache.set(key, {
		data,
		expireAt: Date.now() + Math.max(Number(ttlMs) || 0, 1000)
	})
	return data
}

function buildPaging(res, page, pageSize) {
	return res?.paging || {
		page,
		pageSize,
		total: Array.isArray(res?.data) ? res.data.length : 0,
		hasMore: false
	}
}

function normalizePdaBottleSummary(bottle = null) {
	if (!bottle || typeof bottle !== 'object') return null
	const suggestedFillWeightKg = Number(bottle.suggested_fill_weight_kg ?? bottle.suggestedFillWeightKg)
	return {
		_id: normalizeText(bottle._id || bottle.bottle_id),
		bottle_no: normalizeBottleNo(bottle.bottle_no || bottle.bottleNo),
		tare_weight: bottle.tare_weight == null ? null : Number(bottle.tare_weight),
		suggested_fill_weight_kg: Number.isFinite(suggestedFillWeightKg) ? suggestedFillWeightKg : null,
		status: normalizeText(bottle.status),
		current_customer_id: normalizeText(bottle.current_customer_id),
		current_customer_name: normalizeText(bottle.current_customer_name),
		is_active: bottle.is_active !== false
	}
}

export async function listPdaBottles(params = {}) {
	const page = Number(params.page || 1)
	const pageSize = Number(params.pageSize || 20)
	const res = await searchBottlesV1({
		keyword: normalizeText(params.keyword),
		status: normalizeText(params.status),
		page,
		pageSize
	})
	return {
		code: res?.code ?? -1,
		msg: res?.msg || '',
		data: Array.isArray(res?.data) ? res.data : [],
		paging: buildPaging(res, page, pageSize)
	}
}

export async function getPdaBottleById(id) {
	const res = await getBottleV1({ id })
	return {
		code: res?.code ?? -1,
		msg: res?.msg || '',
		data: res?.data || null
	}
}

export async function findPdaBottleByNo(bottleNo) {
	const normalized = normalizeBottleNo(bottleNo)
	if (!normalized) return { code: 400, msg: '瓶号必填', data: null }
	const cached = readCache(bottleNoCache, normalized)
	if (cached) return { code: 0, msg: '', data: cached }
	const res = await resolveBottleNoV1({ bottle_no: normalized })
	if (res?.code !== 0) return { code: res?.code ?? -1, msg: res?.msg || '钢瓶查询失败', data: null }
	const summary = normalizePdaBottleSummary(res?.data?.bottle || null)
	if (summary?.bottle_no) writeCache(bottleNoCache, summary.bottle_no, summary, BOTTLE_CACHE_TTL_MS)
	return { code: 0, msg: '', data: summary }
}

export async function resolvePdaBottleByQrCode(qrCode) {
	const normalized = normalizeQrCode(qrCode)
	if (!normalized) return { code: 400, msg: '钢瓶PDA二维码必填', data: null }
	const cached = readCache(bottleQrCache, normalized)
	if (cached) return { code: 0, msg: '', data: cached }
	const res = await resolveBottlePdaQrCodeV1({ pda_qr_code: normalized })
	if (res?.code !== 0) return { code: res?.code ?? -1, msg: res?.msg || '钢瓶PDA扫码失败', data: null }
	const summary = normalizePdaBottleSummary(res?.data?.bottle || null)
	if (summary?.bottle_no) writeCache(bottleNoCache, summary.bottle_no, summary, BOTTLE_CACHE_TTL_MS)
	return {
		code: 0,
		msg: '',
		data: writeCache(bottleQrCache, normalized, summary, BOTTLE_CACHE_TTL_MS)
	}
}

export function buildPdaMovementQueryUrl(bottleNo = '') {
	const normalized = normalizeBottleNo(bottleNo)
	return normalized ? `/pages/pda/movement-query?bottle_no=${encodeURIComponent(normalized)}` : '/pages/pda/movement-query'
}

export function buildPdaFillingCreateUrl(bottleNo = '') {
	void bottleNo
	return '/pages/pda/filling-board'
}
