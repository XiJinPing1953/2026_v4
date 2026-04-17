import { getBottleV1, searchBottlesV1 } from '@/services/bottle'
import { normalizeBottleNo, normalizeText } from './shared'

function buildPaging(res, page, pageSize) {
	return res?.paging || {
		page,
		pageSize,
		total: Array.isArray(res?.data) ? res.data.length : 0,
		hasMore: false
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
	const res = await searchBottlesV1({
		keyword: normalized,
		page: 1,
		pageSize: 20
	})
	if (res?.code !== 0) {
		return { code: res?.code ?? -1, msg: res?.msg || '钢瓶查询失败', data: null }
	}
	const list = Array.isArray(res?.data) ? res.data : []
	const exact = list.find((item) => normalizeBottleNo(item?.bottle_no) === normalized) || null
	if (!exact) return { code: 404, msg: '未找到钢瓶', data: null }
	return { code: 0, msg: '', data: exact }
}

export function buildPdaMovementQueryUrl(bottleNo = '') {
	const normalized = normalizeBottleNo(bottleNo)
	return normalized ? `/pages/pda/movement-query?bottle_no=${encodeURIComponent(normalized)}` : '/pages/pda/movement-query'
}

export function buildPdaFillingCreateUrl(bottleNo = '') {
	const normalized = normalizeBottleNo(bottleNo)
	return normalized ? `/pages/pda/filling-create?bottle_no=${encodeURIComponent(normalized)}` : '/pages/pda/filling-create'
}
