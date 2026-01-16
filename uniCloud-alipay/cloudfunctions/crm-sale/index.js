'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const sales = db.collection('crm_sale_records')
const customers = db.collection('crm_customers')

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data && res.data[0]) || null
}

async function recordLog(user, action, detail = {}) {
	try {
		await logs.add({
			user_id: user?._id || null,
			username: user?.username || '',
			role: user?.role || '',
			action,
			detail,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-sale] recordLog failed', action, err)
	}
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toNumber(value, fallback = 0) {
	if (value === '' || value == null) return fallback
	const num = Number(value)
	return Number.isNaN(num) ? fallback : num
}

function fix2(value) {
	const num = Number(value)
	return Number.isFinite(num) ? Number(num.toFixed(2)) : 0
}

function joinDelivery(delivery1, delivery2) {
	const a = normalizeString(delivery1)
	const b = normalizeString(delivery2)
	if (a && b) return `${a} / ${b}`
	return a || b || ''
}

function normalizeBottleRows(rows = []) {
	return (rows || [])
		.map((row) => {
			const bottleNo = normalizeString(row?.bottle_no ?? row?.bottleInput)
			if (!bottleNo) return null
			return {
				bottle_no: bottleNo,
				bottle_id: row?.bottle_id ?? row?.bottleId ?? null,
				gross: toNumber(row?.gross, 0),
				tare: toNumber(row?.tare, 0),
				net: toNumber(row?.net, 0)
			}
		})
		.filter(Boolean)
}

function normalizeDepositRows(rows = []) {
	return (rows || [])
		.map((row) => {
			const bottleNo = normalizeString(row?.bottle_no ?? row?.bottleNo)
			if (!bottleNo) return null
			return { bottle_no: bottleNo, bottle_id: row?.bottle_id ?? row?.bottleId ?? null }
		})
		.filter(Boolean)
}

function normalizeAgentRows(rows = []) {
	return (rows || [])
		.map((row) => {
			const bottleNo = normalizeString(row?.bottle_no ?? row?.bottleNo)
			if (!bottleNo) return null
			return {
				bottle_no: bottleNo,
				bottle_id: row?.bottle_id ?? row?.bottleId ?? null,
				fill_weight: toNumber(row?.fill_weight ?? row?.fillWeight, 0),
				address: normalizeString(row?.address)
			}
		})
		.filter((row) => row && row.fill_weight > 0)
}

function buildDepositRaw(outItems, backItems, explicitDepositNos, bizMode) {
	if (bizMode === 'truck' || bizMode === 'agent_sale') return ''
	const backSet = new Set(backItems.map((item) => item.bottle_no))
	const explicitSet = new Set(explicitDepositNos)
	const implicit = []
	outItems.forEach((item) => {
		if (!item?.bottle_no) return
		if (backSet.has(item.bottle_no)) return
		if (explicitSet.has(item.bottle_no)) return
		implicit.push(item.bottle_no)
	})
	const all = Array.from(new Set([...explicitDepositNos, ...implicit]))
	return all.join(' / ')
}

async function ensureCustomerId(customerId, customerName) {
	let id = normalizeString(customerId)
	let name = normalizeString(customerName)
	if (id || !name) return { id, name }
	const res = await customers.where({ name }).limit(1).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { id: '', name }
	return { id: doc._id, name: doc.name }
}

function inferBizMode(base, outRows, backRows, agentRows) {
	const bizMode = normalizeString(base.bizMode)
	if (bizMode) return bizMode
	if (agentRows.length > 0) return 'agent_sale'
	if (normalizeString(base.truckNo)) return 'truck'
	if (outRows.length > 0 || backRows.length > 0) return 'bottle'
	return 'bottle'
}

function computeFlow(base, priceUnit, totalNetWeight, unitPrice) {
	let flowIndexPrev = toNumber(base.flow_index_prev, null)
	let flowIndexCurr = toNumber(base.flow_index_curr, null)
	let flowVolumeM3 = toNumber(base.flow_volume_m3 ?? base.flow_volume, null)
	const flowTheoryRatio = toNumber(base.flow_theory_ratio, null)

	if (flowVolumeM3 == null && flowIndexPrev != null && flowIndexCurr != null) {
		const diff = flowIndexCurr - flowIndexPrev
		flowVolumeM3 = diff >= 0 ? diff : 0
	}

	if (priceUnit !== 'm3') {
		flowIndexPrev = null
		flowIndexCurr = null
		flowVolumeM3 = null
	}

	const flowTheoreticalVolumeM3 = (flowTheoryRatio && totalNetWeight)
		? Number((totalNetWeight * flowTheoryRatio).toFixed(3))
		: null

	const flowAmountShould = priceUnit === 'm3' && flowVolumeM3 != null
		? fix2(flowVolumeM3 * unitPrice)
		: null

	return {
		flow_index_prev: flowIndexPrev,
		flow_index_curr: flowIndexCurr,
		flow_volume_m3: flowVolumeM3,
		flow_theory_ratio: flowTheoryRatio,
		flow_conversion_ratio: flowTheoryRatio,
		flow_theoretical_volume_m3: flowTheoreticalVolumeM3,
		flow_unit_price: unitPrice,
		flow_amount_should: flowAmountShould,
		flow_amount_received: toNumber(base.flow_amount_received ?? base.amountReceived, 0),
		flow_payment_status: normalizeString(base.flow_payment_status ?? base.paymentStatus),
		flow_remark: normalizeString(base.flow_remark)
	}
}

function computeAmounts({ bizMode, priceUnit, unitPrice, outItems, backItems, agentRows, truckSaleNet, flow }) {
	const outNetTotal = outItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)
	const backNetTotal = backItems.reduce((sum, item) => sum + toNumber(item.net, 0), 0)

	let totalNetWeight = outNetTotal - backNetTotal
	if (bizMode === 'truck') {
		totalNetWeight = toNumber(truckSaleNet, 0)
	}

	let outAmount = 0
	let backAmount = 0
	let shouldReceive = 0

	if (bizMode === 'agent_sale') {
		const totalWeight = agentRows.reduce((sum, row) => sum + toNumber(row.fill_weight, 0), 0)
		outAmount = totalWeight * unitPrice
		shouldReceive = outAmount
	} else if (priceUnit === 'kg') {
		outAmount = outNetTotal * unitPrice
		backAmount = backNetTotal * unitPrice
		shouldReceive = outAmount - backAmount
	} else if (priceUnit === 'bottle') {
		outAmount = outItems.length * unitPrice
		shouldReceive = outAmount
	} else if (priceUnit === 'm3') {
		const flowVolume = flow.flow_volume_m3 || 0
		outAmount = flowVolume * unitPrice
		shouldReceive = outAmount
	}

	return {
		out_net_total: outNetTotal,
		back_net_total: backNetTotal,
		total_net_weight: totalNetWeight,
		out_amount: fix2(outAmount),
		back_amount: fix2(backAmount),
		should_receive: fix2(shouldReceive),
		amount: fix2(shouldReceive)
	}
}

async function createV2(user, payload) {
	const base = payload.base || {}
	const outRows = normalizeBottleRows(payload.outRows || payload.outItems || [])
	const backRows = normalizeBottleRows(payload.backRows || payload.backItems || [])
	const depositRows = normalizeDepositRows(payload.depositRows || [])
	const agentRows = normalizeAgentRows(payload.agentSaleRows || payload.agent_sale_items || [])

	const date = normalizeString(base.date)
	if (!date) return { code: 400, msg: '日期必填' }

	const customerName = normalizeString(base.customerName)
	const customerId = normalizeString(base.customerId)
	if (!customerId && !customerName) return { code: 400, msg: '客户必填' }

	const customer = await ensureCustomerId(customerId, customerName)
	const deliveryMan = joinDelivery(base.delivery1, base.delivery2)

	const bizMode = inferBizMode(base, outRows, backRows, agentRows)
	const priceUnit = normalizeString(base.priceUnit) || 'kg'
	const unitPrice = toNumber(base.unitPrice, 0)

	const truckNo = normalizeString(base.truckNo)
	const truckOutGross = toNumber(base.truckOutGross ?? base.truck_out_gross, 0)
	const truckBackGross = toNumber(base.truckBackGross ?? base.truck_back_gross, 0)
	const truckSaleNet = toNumber(base.truckSaleNet ?? base.truck_sale_net, 0)

	const flow = computeFlow(base, priceUnit, 0, unitPrice)
	const amounts = computeAmounts({
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outRows,
		backItems: bizMode === 'agent_sale' ? [] : backRows,
		agentRows,
		truckSaleNet,
		flow
	})
	const flowFinal = computeFlow(base, priceUnit, amounts.total_net_weight, unitPrice)

	const explicitDepositNos = depositRows.map((row) => row.bottle_no)
	const depositRaw = buildDepositRaw(outRows, backRows, explicitDepositNos, bizMode)

	const doc = {
		date,
		customer_id: customer.id,
		customer_name: customer.name,
		delivery_man: deliveryMan,
		vehicle_id: normalizeString(base.vehicleId),
		car_no: normalizeString(base.car_no ?? base.carNo),
		truck_no: bizMode === 'truck' ? truckNo : '',
		biz_mode: bizMode,
		unit_price: unitPrice,
		price_unit: priceUnit,
		remark: normalizeString(base.remark),
		amount_received: toNumber(base.amountReceived, 0),
		payment_status: normalizeString(base.paymentStatus),
		payment_note: normalizeString(base.paymentNote),
		out_items: outRows,
		back_items: backRows,
		deposit_rows: depositRows,
		agent_sale_items: agentRows,
		deposit_bottles_raw: depositRaw,
		truck_out_gross: truckOutGross,
		truck_back_gross: truckBackGross,
		truck_sale_net: truckSaleNet,
		...amounts,
		...flowFinal,
		created_at: Date.now(),
		created_by: user._id,
		source: normalizeString(payload.source || 'manual-v4'),
		updated_at: Date.now()
	}

	const res = await sales.add(doc)
	await recordLog(user, 'sale_create_v2', { id: res.id, biz_mode: bizMode })
	return { code: 0, msg: '创建成功', data: { _id: res.id } }
}

async function listV2(user, data) {
	const page = Math.max(toNumber(data.page, 1), 1)
	const pageSize = Math.min(Math.max(toNumber(data.pageSize, 20), 1), 50)

	const keyword = normalizeString(data.keyword)
	const priceUnit = normalizeString(data.priceUnit)
	const dateStart = normalizeString(data.dateStart)
	const dateEnd = normalizeString(data.dateEnd)

	const where = {}
	const and = []

	if (keyword) {
		and.push(dbCmd.or({ customer_name: new RegExp(keyword) }, { car_no: new RegExp(keyword) }))
	}
	if (priceUnit) and.push({ price_unit: priceUnit })
	if (dateStart) and.push({ date: dbCmd.gte(dateStart) })
	if (dateEnd) and.push({ date: dbCmd.lte(dateEnd) })
	if (and.length) where._and = and

	const res = await sales
		.where(where)
		.orderBy('date', 'desc')
		.orderBy('created_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	return { code: 0, data: res.data || [] }
}

async function updateV2(user, data) {
	const recordId = normalizeString(data.recordId || data._id)
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }
	const payload = data.payload || data

	const base = payload.base || {}
	const outRows = normalizeBottleRows(payload.outRows || payload.outItems || [])
	const backRows = normalizeBottleRows(payload.backRows || payload.backItems || [])
	const depositRows = normalizeDepositRows(payload.depositRows || [])
	const agentRows = normalizeAgentRows(payload.agentSaleRows || payload.agent_sale_items || [])

	const date = normalizeString(base.date)
	if (!date) return { code: 400, msg: '日期必填' }

	const customerName = normalizeString(base.customerName)
	const customerId = normalizeString(base.customerId)
	if (!customerId && !customerName) return { code: 400, msg: '客户必填' }

	const customer = await ensureCustomerId(customerId, customerName)
	const deliveryMan = joinDelivery(base.delivery1, base.delivery2)

	const bizMode = inferBizMode(base, outRows, backRows, agentRows)
	const priceUnit = normalizeString(base.priceUnit) || 'kg'
	const unitPrice = toNumber(base.unitPrice, 0)

	const truckNo = normalizeString(base.truckNo)
	const truckOutGross = toNumber(base.truckOutGross ?? base.truck_out_gross, 0)
	const truckBackGross = toNumber(base.truckBackGross ?? base.truck_back_gross, 0)
	const truckSaleNet = toNumber(base.truckSaleNet ?? base.truck_sale_net, 0)

	const flow = computeFlow(base, priceUnit, 0, unitPrice)
	const amounts = computeAmounts({
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outRows,
		backItems: bizMode === 'agent_sale' ? [] : backRows,
		agentRows,
		truckSaleNet,
		flow
	})
	const flowFinal = computeFlow(base, priceUnit, amounts.total_net_weight, unitPrice)

	const explicitDepositNos = depositRows.map((row) => row.bottle_no)
	const depositRaw = buildDepositRaw(outRows, backRows, explicitDepositNos, bizMode)

	const updateDoc = {
		date,
		customer_id: customer.id,
		customer_name: customer.name,
		delivery_man: deliveryMan,
		vehicle_id: normalizeString(base.vehicleId),
		car_no: normalizeString(base.car_no ?? base.carNo),
		truck_no: bizMode === 'truck' ? truckNo : '',
		biz_mode: bizMode,
		unit_price: unitPrice,
		price_unit: priceUnit,
		remark: normalizeString(base.remark),
		amount_received: toNumber(base.amountReceived, 0),
		payment_status: normalizeString(base.paymentStatus),
		payment_note: normalizeString(base.paymentNote),
		out_items: outRows,
		back_items: backRows,
		deposit_rows: depositRows,
		agent_sale_items: agentRows,
		deposit_bottles_raw: depositRaw,
		truck_out_gross: truckOutGross,
		truck_back_gross: truckBackGross,
		truck_sale_net: truckSaleNet,
		...amounts,
		...flowFinal,
		updated_at: Date.now()
	}

	await sales.doc(recordId).update(updateDoc)
	await recordLog(user, 'sale_update_v2', { id: recordId, biz_mode: bizMode })
	return { code: 0, msg: '更新成功' }
}

exports.main = async (event, context) => {
	const { action, data = {}, token } = event

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }

	if (action === 'createV2') return createV2(user, data)
	if (action === 'updateV2') return updateV2(user, data)
	if (action === 'listV2') return listV2(user, data)

	return { code: 400, msg: '未知 action' }
}
