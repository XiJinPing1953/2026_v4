'use strict'

const db = uniCloud.database()
const dbCmd = db.command

const users = db.collection('crm_users')
const logs = db.collection('crm_operation_logs')
const sales = db.collection('crm_sale_records')
const customers = db.collection('crm_customers')
const bottles = db.collection('crm_bottles')
const movements = db.collection('crm_bottle_movements')
const vouchers = db.collection('crm_vouchers')
const voucherEntries = db.collection('crm_voucher_entries')

async function getUserByToken(token) {
	if (!token) return null
	const res = await users.where({ token }).limit(1).get()
	return (res.data && res.data[0]) || null
}

async function recordLog(user, action, detail = {}, requestId = '') {
	try {
		await logs.add({
			user_id: user?._id || null,
			username: user?.username || '',
			role: user?.role || '',
			action,
			detail,
			request_id: requestId,
			created_at: Date.now()
		})
	} catch (err) {
		console.error('[crm-sale] recordLog failed', action, err)
	}
}

async function appendMovementRecords(user, saleDoc, outRows, backRows) {
	const date = normalizeString(saleDoc.date)
	const customerId = normalizeString(saleDoc.customer_id)
	const customerName = normalizeString(saleDoc.customer_name)
	const now = Date.now()
	const eventDay = normalizeEventDay(date, now)
	const eventAt = parseEventAt(date, now)

	const toMovement = (type, row) => ({
		bottle_no: normalizeString(row.bottle_no).toUpperCase(),
		type,
		date,
		event_day: eventDay,
		event_at: eventAt,
		type_order: movementTypeOrder(type),
		source_type: 'sale',
		source_id: saleDoc._id,
		customer_id: customerId || null,
		customer_name: customerName,
		net_weight: toNumber(row.net, null),
		loss_weight: null,
		note: '',
		created_at: now,
		created_by: user?._id || null,
		created_by_name: user?.username || ''
	})

	const inserts = []
	outRows.forEach((row) => {
		if (row?.bottle_no) inserts.push(toMovement('out', row))
	})
	backRows.forEach((row) => {
		if (row?.bottle_no) inserts.push(toMovement('back', row))
	})

	if (!inserts.length) return
	await movements.add(inserts)
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function toTimestamp(value, fallback = Date.now()) {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
	if (typeof value === 'string' && value.trim()) {
		const asNum = Number(value)
		if (Number.isFinite(asNum) && asNum > 0) return asNum
		const asDate = Date.parse(value)
		if (Number.isFinite(asDate) && asDate > 0) return asDate
	}
	return fallback
}

function pad2(value) {
	return String(value).padStart(2, '0')
}

function formatDayByTs(ts) {
	const d = new Date(ts)
	const y = d.getFullYear()
	const m = pad2(d.getMonth() + 1)
	const day = pad2(d.getDate())
	return `${y}-${m}-${day}`
}

function normalizeEventDay(dateText, fallbackTs) {
	const text = normalizeString(dateText)
	const m = text.match(/^(\d{4}-\d{2}-\d{2})/)
	if (m) return m[1]
	return formatDayByTs(toTimestamp(fallbackTs, Date.now()))
}

function parseEventAt(dateText, fallbackTs) {
	const text = normalizeString(dateText)
	const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
	if (m) {
		const y = m[1]
		const mon = m[2]
		const d = m[3]
		const hh = pad2(m[4] || '00')
		const mm = pad2(m[5] || '00')
		const ss = pad2(m[6] || '00')
		const ts = Date.parse(`${y}-${mon}-${d}T${hh}:${mm}:${ss}+08:00`)
		if (Number.isFinite(ts) && ts > 0) return ts
	}
	const parsed = Date.parse(text)
	if (Number.isFinite(parsed) && parsed > 0) return parsed
	return toTimestamp(fallbackTs, Date.now())
}

function movementTypeOrder(type) {
	if (type === 'back') return 10
	if (type === 'fill') return 20
	if (type === 'out') return 30
	if (type === 'adjust') return 40
	return 99
}

function generateRequestId() {
	const now = Date.now().toString(36)
	const rand = Math.random().toString(36).slice(2, 8)
	return `req_${now}_${rand}`
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

function normalizeBottleNoForCreate(value) {
	return normalizeString(value).toUpperCase()
}

function isDuplicateKeyError(err) {
	const msg = String(err?.message || err || '')
	return msg.includes('duplicate key') || msg.includes('E11000')
}

async function ensureBottlesExist({ customerId, customerName, outRows = [], backRows = [] }) {
	const outNos = outRows
		.map((row) => normalizeBottleNoForCreate(row?.bottle_no))
		.filter(Boolean)
	const backNos = backRows
		.map((row) => normalizeBottleNoForCreate(row?.bottle_no))
		.filter(Boolean)

	const allNos = Array.from(new Set([...outNos, ...backNos]))
	if (!allNos.length) return { ok: true }

	const existingRes = await bottles
		.where({ bottle_no: dbCmd.in(allNos) })
		.field({ bottle_no: true })
		.get()
	const existingSet = new Set(
		(existingRes.data || []).map((item) => normalizeBottleNoForCreate(item.bottle_no))
	)
	const missing = allNos.filter((no) => !existingSet.has(no))
	if (!missing.length) return { ok: true }

	const tareMap = new Map()
	const collectTare = (rows) => {
		rows.forEach((row) => {
			const no = normalizeBottleNoForCreate(row?.bottle_no)
			if (!no || tareMap.has(no)) return
			const tare = toNumber(row?.tare, null)
			if (tare != null && Number.isFinite(tare)) tareMap.set(no, tare)
		})
	}
	collectTare(outRows)
	collectTare(backRows)

	const backSet = new Set(backNos)
	const now = Date.now()

	try {
		await Promise.all(
			missing.map(async (no) => {
				const status = backSet.has(no) ? 'in_station' : 'at_customer'
				const doc = {
					bottle_no: no,
					tare_weight: tareMap.has(no) ? tareMap.get(no) : null,
					status,
					current_customer_id: status === 'at_customer' ? customerId : null,
					current_customer_name: status === 'at_customer' ? customerName : '',
					remark: '',
					is_active: true,
					created_at: now,
					updated_at: now
				}
				try {
					await bottles.add(doc)
				} catch (err) {
					if (isDuplicateKeyError(err)) return
					throw err
				}
			})
		)
		return { ok: true }
	} catch (err) {
		return { ok: false, msg: `自动建瓶失败: ${err?.message || '未知错误'}` }
	}
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

function collectBottleNosFromRows(rows = []) {
	const set = new Set()
	for (const row of rows || []) {
		const no = normalizeBottleNoForCreate(row && row.bottle_no)
		if (no) set.add(no)
	}
	return Array.from(set)
}

function collectSaleBottleNosFromDoc(doc) {
	const outRows = Array.isArray(doc && doc.out_items) ? doc.out_items : []
	const backRows = Array.isArray(doc && doc.back_items) ? doc.back_items : []
	const agentRows = Array.isArray(doc && doc.agent_sale_items) ? doc.agent_sale_items : []
	const set = new Set([
		...collectBottleNosFromRows(outRows),
		...collectBottleNosFromRows(backRows),
		...collectBottleNosFromRows(agentRows)
	])
	return Array.from(set)
}

async function getCustomerById(customerId) {
	const id = normalizeString(customerId)
	if (!id) return null
	const res = await customers.doc(id).get()
	return (res.data && res.data[0]) || null
}

function inferBizMode(base, outRows, backRows, agentRows) {
	const bizMode = normalizeString(base.bizMode)
	if (bizMode) return bizMode
	if (agentRows.length > 0) return 'agent_sale'
	if (normalizeString(base.truckNo)) return 'truck'
	if (outRows.length > 0 || backRows.length > 0) return 'bottle'
	return 'bottle'
}

function computeFlow(base, priceUnit) {
	let flowIndexPrev = toNumber(base.flow_index_prev, null)
	let flowIndexCurr = toNumber(base.flow_index_curr, null)
	let flowVolumeM3 = toNumber(base.flow_volume_m3, null)
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

	return {
		flow_index_prev: flowIndexPrev,
		flow_index_curr: flowIndexCurr,
		flow_volume_m3: flowVolumeM3,
		flow_theory_ratio: flowTheoryRatio
	}
}

function computeAmounts({ bizMode, priceUnit, unitPrice, outItems, backItems, agentRows, truckSaleNet, flow, roundingAmount }) {
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
		shouldReceive = totalNetWeight * unitPrice
	} else if (priceUnit === 'bottle') {
		outAmount = outItems.length * unitPrice
		shouldReceive = outAmount
	} else if (priceUnit === 'm3') {
		const flowVolume = flow.flow_volume_m3 || 0
		outAmount = flowVolume * unitPrice
		shouldReceive = outAmount
	}

	const rounding = Math.max(toNumber(roundingAmount, 0), 0)
	let finalShouldReceive = shouldReceive
	if (shouldReceive > 0) finalShouldReceive = shouldReceive - rounding
	else if (shouldReceive < 0) finalShouldReceive = shouldReceive + rounding
	else finalShouldReceive = 0

	return {
		out_net_total: outNetTotal,
		back_net_total: backNetTotal,
		total_net_weight: totalNetWeight,
		out_amount: fix2(outAmount),
		back_amount: fix2(backAmount),
		rounding_amount: fix2(rounding),
		should_receive: fix2(finalShouldReceive),
		amount: fix2(finalShouldReceive)
	}
}

function normalizePaymentStatus(value) {
	const text = normalizeString(value)
	if (!text) return 'unpaid'
	if (text === '已结清' || text === 'paid') return 'paid'
	if (text === '部分付' || text === 'partial') return 'partial'
	if (text === '未付款' || text === 'unpaid' || text === '挂账') return 'unpaid'
	return text
}

function nearlyEqual(a, b, eps = 0.01) {
	return Math.abs(a - b) < eps
}

function validateSettlement({ shouldReceive, paymentStatus, amountReceived, roundingAmount }) {
	const should = fix2(toNumber(shouldReceive, 0))
	const rounding = Math.max(toNumber(roundingAmount, 0), 0)
	let baseShould = should
	if (should > 0) baseShould = should + rounding
	else if (should < 0) baseShould = should - rounding
	else baseShould = 0

	if (rounding < 0) return { ok: false, msg: '抹零金额不能为负数' }
	if (Math.abs(rounding) > Math.abs(baseShould || 0)) return { ok: false, msg: '抹零金额不能超过应收/应退金额' }

	const received = toNumber(amountReceived, 0)
	if (should < 0 && received > 0) return { ok: false, msg: '退款场景实收需为负数' }

	const status = normalizePaymentStatus(paymentStatus)
	if (status === 'unpaid') {
		if (!nearlyEqual(received, 0)) return { ok: false, msg: '结算金额与付款状态不一致' }
	} else if (status === 'partial') {
		if (should > 0) {
			if (!(received > 0 && received < should)) return { ok: false, msg: '结算金额与付款状态不一致' }
		} else if (should < 0) {
			if (!(received < 0 && received > should)) return { ok: false, msg: '结算金额与付款状态不一致' }
		} else {
			return { ok: false, msg: '结算金额与付款状态不一致' }
		}
	} else if (status === 'paid') {
		if (!nearlyEqual(received, should)) return { ok: false, msg: '结算金额与付款状态不一致' }
	}

	return { ok: true }
}

const RECEIVABLE_ACCOUNT = { code: '1122', name: '应收账款' }
const REVENUE_ACCOUNT = { code: '6001', name: '主营业务收入' }
const PAYMENT_ACCOUNTS = {
	cash: { code: '1001', name: '库存现金' },
	bank: { code: '1002', name: '银行存款' },
	wechat: { code: '1002-WECHAT', name: '银行存款-微信' },
	alipay: { code: '1002-ALIPAY', name: '银行存款-支付宝' }
}

function normalizePeriod(date) {
	const value = normalizeString(date)
	const parts = value.split('-')
	if (parts.length < 2) return ''
	return `${parts[0]}-${parts[1]}`
}

function generateVoucherNo(date) {
	const day = String(date || '').replace(/-/g, '')
	const suffix = String(Date.now() % 100000).padStart(5, '0')
	return `V-${day || '00000000'}-${suffix}`
}

function resolvePaymentAccount(method) {
	const key = normalizeString(method)
	if (!key || key === 'on_account') return null
	return PAYMENT_ACCOUNTS[key] || null
}

function buildSaleVoucherEntries(saleDoc, shouldReceive, amountReceived) {
	const summary = normalizeString(saleDoc.customer_name) + ' 销售收入'
	const receivedRaw = toNumber(amountReceived, 0)
	const total = fix2(shouldReceive)
	if (total === 0) return []

	const paymentAccount = resolvePaymentAccount(saleDoc.payment_method)

	if (total < 0) {
		const refundTotal = fix2(Math.abs(total))
		const refundPaid = paymentAccount && receivedRaw < 0
			? fix2(Math.min(Math.abs(receivedRaw), refundTotal))
			: 0
		const refundRemain = fix2(refundTotal - refundPaid)
		const entries = []

		if (refundPaid > 0 && paymentAccount) {
			entries.push({
				account_code: paymentAccount.code,
				account_name: paymentAccount.name,
				direction: 'credit',
				amount: refundPaid,
				summary
			})
		}
		if (refundRemain > 0) {
			entries.push({
				account_code: RECEIVABLE_ACCOUNT.code,
				account_name: RECEIVABLE_ACCOUNT.name,
				direction: 'credit',
				amount: refundRemain,
				summary
			})
		}
		entries.push({
			account_code: REVENUE_ACCOUNT.code,
			account_name: REVENUE_ACCOUNT.name,
			direction: 'debit',
			amount: refundTotal,
			summary
		})
		return entries
	}

	let received = fix2(Math.min(receivedRaw, total))
	let receivable = fix2(total - received)
	if (!paymentAccount) {
		received = 0
		receivable = total
	}

	const entries = []
	if (received > 0 && paymentAccount) {
		entries.push({
			account_code: paymentAccount.code,
			account_name: paymentAccount.name,
			direction: 'debit',
			amount: received,
			summary
		})
	}
	if (receivable > 0) {
		entries.push({
			account_code: RECEIVABLE_ACCOUNT.code,
			account_name: RECEIVABLE_ACCOUNT.name,
			direction: 'debit',
			amount: receivable,
			summary
		})
	}
	entries.push({
		account_code: REVENUE_ACCOUNT.code,
		account_name: REVENUE_ACCOUNT.name,
		direction: 'credit',
		amount: total,
		summary
	})
	return entries
}

async function syncSaleVoucher(user, saleDoc, amounts, requestId) {
	const shouldReceive = toNumber(amounts.should_receive, 0)
	if (!shouldReceive) return

	const entriesRows = buildSaleVoucherEntries(saleDoc, shouldReceive, saleDoc.amount_received)
	if (!entriesRows.length) return

	const totals = entriesRows.reduce(
		(acc, row) => {
			if (row.direction === 'debit') acc.debit += row.amount
			else acc.credit += row.amount
			return acc
		},
		{ debit: 0, credit: 0 }
	)

	const period = normalizePeriod(saleDoc.date)
	const source = `sale:${saleDoc._id}`
	const now = Date.now()
	const summary = normalizeString(saleDoc.customer_name) + ' 销售收入'

	const existRes = await vouchers.where({ source }).limit(1).get()
	const exist = (existRes.data && existRes.data[0]) || null
	if (exist && exist.status === 'posted') return

	const voucherNo = exist?.voucher_no || generateVoucherNo(saleDoc.date)
	const header = {
		date: saleDoc.date,
		period,
		voucher_no: voucherNo,
		summary,
		status: 'draft',
		total_debit: fix2(totals.debit),
		total_credit: fix2(totals.credit),
		created_at: exist?.created_at || now,
		created_by: exist?.created_by || user?._id || null,
		created_by_name: exist?.created_by_name || user?.username || '',
		updated_at: now,
		posted_at: null,
		posted_by: null,
		posted_by_name: '',
		source
	}

	let voucherId = exist?._id || null
	if (voucherId) {
		await vouchers.doc(voucherId).update(header)
		await voucherEntries.where({ voucher_id: voucherId }).remove()
	} else {
		const res = await vouchers.add(header)
		voucherId = res.id
	}

	const entryDocs = entriesRows.map((row) => ({
		voucher_id: voucherId,
		voucher_no: voucherNo,
		date: saleDoc.date,
		period,
		account_code: row.account_code,
		account_name: row.account_name,
		direction: row.direction,
		amount: row.amount,
		summary: row.summary,
		aux: {
			customer_id: saleDoc.customer_id || null,
			customer_name: saleDoc.customer_name || '',
			source_type: 'sale',
			source_id: saleDoc._id
		},
		created_at: now
	}))

	if (entryDocs.length) await voucherEntries.add(entryDocs)
	await recordLog(user, 'sale_voucher_sync_v1', { sale_id: saleDoc._id, voucher_id: voucherId }, requestId)
}

async function triggerAnomalyTouchV2(user, token, bottleNos, requestId) {
	const normalizedNos = Array.from(
		new Set(
			(bottleNos || [])
				.map((item) => normalizeBottleNoForCreate(item))
				.filter(Boolean)
		)
	)
	if (!normalizedNos.length) return { ok: true, warning: '' }

	try {
		const res = await uniCloud.callFunction({
			name: 'crm-bottle-anomaly',
			data: {
				action: 'touchV2',
				token,
				request_id: requestId,
				data: {
					bottle_nos: normalizedNos,
					batch_size: 120,
					max_events_per_round: 800,
					max_ms_per_round: 2200,
					max_writes_per_round: 120
				}
			}
		})
		const result = res && res.result ? res.result : {}
		if (result.code === 0) {
			if (result.data && result.data.done === false) {
				return { ok: true, warning: '异常增量扫描未完成，请在异常页继续扫描' }
			}
			return { ok: true, warning: '' }
		}
		const warning = normalizeString(result.msg) || '异常增量扫描触发失败'
		await recordLog(
			user,
			'sale_anomaly_touch_v2_failed',
			{ bottle_nos: normalizedNos, msg: warning },
			requestId
		)
		return { ok: false, warning }
	} catch (err) {
		const warning = normalizeString(err && err.message) || '异常增量扫描触发失败'
		await recordLog(
			user,
			'sale_anomaly_touch_v2_failed',
			{ bottle_nos: normalizedNos, msg: warning },
			requestId
		)
		return { ok: false, warning }
	}
}

async function createV2(user, payload, requestId, token) {
	const base = payload.base || {}
	const outRows = normalizeBottleRows(payload.outRows || [])
	const backRows = normalizeBottleRows(payload.backRows || [])
	const depositRows = normalizeDepositRows(payload.depositRows || [])
	const agentRows = normalizeAgentRows(payload.agentSaleRows || [])

	const date = normalizeString(base.date)
	if (!date) return { code: 400, msg: '日期必填' }

	const customerId = normalizeString(base.customerId)
	if (!customerId) return { code: 400, msg: '客户必选' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 400, msg: '客户不存在' }
	const deliveryMan = joinDelivery(base.delivery1, base.delivery2)

	const bizMode = inferBizMode(base, outRows, backRows, agentRows)
	const priceUnit = normalizeString(base.priceUnit) || 'kg'
	const unitPrice = toNumber(base.unitPrice, 0)

	const truckNo = normalizeString(base.truckNo)
	const truckOutGross = toNumber(base.truckOutGross, 0)
	const truckBackGross = toNumber(base.truckBackGross, 0)
	const truckSaleNet = toNumber(base.truckSaleNet, 0)

	const flowIndexPrev = priceUnit === 'm3' ? toNumber(base.flowIndexPrev, null) : null
	const flowIndexCurr = priceUnit === 'm3' ? toNumber(base.flowIndexCurr, null) : null
	const flowVolumeM3 = priceUnit === 'm3' ? toNumber(base.flowVolumeM3, null) : null
	const flowTheoryRatio = priceUnit === 'm3' ? toNumber(base.flowTheoryRatio, null) : null

	if (bizMode === 'bottle') {
		const ensureRes = await ensureBottlesExist({
			customerId: customer._id,
			customerName: customer.name,
			outRows,
			backRows
		})
		if (!ensureRes.ok) return { code: 400, msg: ensureRes.msg }
	}

	const flowForCheck = computeFlow(
		{
			flow_index_prev: flowIndexPrev,
			flow_index_curr: flowIndexCurr,
			flow_volume_m3: flowVolumeM3,
			flow_theory_ratio: flowTheoryRatio
		},
		priceUnit
	)
	const amountsForCheck = computeAmounts({
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outRows,
		backItems: bizMode === 'agent_sale' ? [] : backRows,
		agentRows,
		truckSaleNet,
		flow: flowForCheck,
		roundingAmount: toNumber(base.roundingAmount, 0)
	})
	const settlementCheck = validateSettlement({
		shouldReceive: amountsForCheck.should_receive,
		paymentStatus: base.paymentStatus,
		amountReceived: base.amountReceived,
		roundingAmount: base.roundingAmount
	})
	if (!settlementCheck.ok) return { code: 400, msg: settlementCheck.msg }

	const doc = {
		date,
		customer_id: customer._id,
		customer_name: customer.name,
		delivery_man: deliveryMan,
		vehicle_id: normalizeString(base.vehicleId),
		car_no: normalizeString(base.carNo),
		biz_mode: bizMode,
		unit_price: unitPrice,
		price_unit: priceUnit,
		remark: normalizeString(base.remark),
		payment_status: normalizeString(base.paymentStatus),
		amount_received: toNumber(base.amountReceived, 0),
		rounding_amount: Math.max(toNumber(base.roundingAmount, 0), 0),
		payment_note: normalizeString(base.paymentNote),
		payment_method: normalizeString(base.paymentMethod),
		created_at: Date.now(),
		created_by: user._id,
		source: normalizeString(payload.source || 'manual-v4'),
		updated_at: Date.now()
	}

	if (bizMode === 'truck') {
		doc.truck_no = truckNo
		doc.truck_out_gross = truckOutGross
		doc.truck_back_gross = truckBackGross
		doc.truck_sale_net = truckSaleNet
	} else if (bizMode === 'agent_sale') {
		doc.agent_sale_items = agentRows
	} else {
		doc.out_items = outRows
		doc.back_items = backRows
		doc.deposit_rows = depositRows
	}

	if (priceUnit === 'm3') {
		doc.flow_index_prev = flowIndexPrev
		doc.flow_index_curr = flowIndexCurr
		doc.flow_volume_m3 = flowVolumeM3
		doc.flow_theory_ratio = flowTheoryRatio
	}

	const res = await sales.add(doc)
	const saleDoc = { ...doc, _id: res.id }
	if (bizMode === 'bottle') {
		await appendMovementRecords(user, saleDoc, outRows, backRows)
	}
	const flow = computeFlow(saleDoc, priceUnit)
	const amounts = computeAmounts({
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outRows,
		backItems: bizMode === 'agent_sale' ? [] : backRows,
		agentRows,
		truckSaleNet,
		flow,
		roundingAmount: toNumber(base.roundingAmount, 0)
	})
	await syncSaleVoucher(user, saleDoc, amounts, requestId)
	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		collectSaleBottleNosFromDoc(saleDoc),
		requestId
	)
	await recordLog(
		user,
		'sale_create_v2',
		{ id: res.id, biz_mode: bizMode, touch_warning: touchRes.warning || '' },
		requestId
	)
	return {
		code: 0,
		msg: touchRes.warning ? `创建成功（${touchRes.warning}）` : '创建成功',
		data: { _id: res.id, warning: touchRes.warning || '' }
	}
}

async function listV2(user, data) {
	void user
	const page = Math.max(toNumber(data.page, 1), 1)
	const pageSize = Math.min(Math.max(toNumber(data.pageSize, 20), 1), 50)

	const keyword = normalizeString(data.keyword)
	const priceUnit = normalizeString(data.priceUnit)
	const bizMode = normalizeString(data.bizMode)
	const dateStart = normalizeString(data.dateStart)
	const dateEnd = normalizeString(data.dateEnd)

	const conditions = []

	if (keyword) {
		const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		const rx = db.RegExp({ regexp: escaped, options: 'i' })
		conditions.push(dbCmd.or([{ customer_name: rx }, { car_no: rx }]))
	}
	if (priceUnit) conditions.push({ price_unit: priceUnit })
	if (bizMode) conditions.push({ biz_mode: bizMode })
	if (dateStart) conditions.push({ date: dbCmd.gte(dateStart) })
	if (dateEnd) conditions.push({ date: dbCmd.lte(dateEnd) })

	const where =
		conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0] : dbCmd.and(conditions)

	const res = await sales
		.where(where)
		.orderBy('date', 'desc')
		.orderBy('created_at', 'desc')
		.skip((page - 1) * pageSize)
		.limit(pageSize)
		.get()

	const dataList = (res.data || []).map((doc) => {
		const bizMode = normalizeString(doc.biz_mode) || 'bottle'
		const priceUnit = normalizeString(doc.price_unit) || 'kg'
		const unitPrice = toNumber(doc.unit_price, 0)

		const outItems = Array.isArray(doc.out_items) ? doc.out_items : []
		const backItems = Array.isArray(doc.back_items) ? doc.back_items : []
		const agentRows = Array.isArray(doc.agent_sale_items) ? doc.agent_sale_items : []
		const truckSaleNet = toNumber(doc.truck_sale_net, 0)

		const flow = computeFlow(doc, priceUnit)
		const amounts = computeAmounts({
			bizMode,
			priceUnit,
			unitPrice,
			outItems: bizMode === 'agent_sale' ? [] : outItems,
			backItems: bizMode === 'agent_sale' ? [] : backItems,
			agentRows,
			truckSaleNet,
			flow,
			roundingAmount: toNumber(doc.rounding_amount, 0)
		})

		return {
			...doc,
			out_net_total: amounts.out_net_total,
			back_net_total: amounts.back_net_total,
			total_net_weight: amounts.total_net_weight,
			out_amount: amounts.out_amount,
			back_amount: amounts.back_amount,
			rounding_amount: amounts.rounding_amount,
			should_receive: amounts.should_receive
		}
	})

	const totalRes = await sales.where(where).count()
	const total = Number(totalRes.total || 0)
	const hasMore = page * pageSize < total

	const buildStatusWhere = (statusList) => {
		const statusCond =
			statusList.length === 1
				? { payment_status: statusList[0] }
				: dbCmd.or(statusList.map((statusText) => ({ payment_status: statusText })))
		if (conditions.length === 0) return statusCond
		return dbCmd.and([where, statusCond])
	}

	const paidRes = await sales.where(buildStatusWhere(['paid', '已结清'])).count()
	const partialRes = await sales.where(buildStatusWhere(['partial', '部分付'])).count()
	const unpaidRes = await sales.where(buildStatusWhere(['unpaid', '未付款'])).count()

	return {
		code: 0,
		data: dataList,
		total,
		paging: {
			page,
			pageSize,
			total,
			hasMore
		},
		summary: {
			total,
			paid: Number(paidRes.total || 0),
			partial: Number(partialRes.total || 0),
			unpaid: Number(unpaidRes.total || 0)
		}
	}
}

async function getV2(user, data) {
	void user
	const id = normalizeString(data._id || data.id)
	if (!id) return { code: 400, msg: '缺少记录 ID' }
	const res = await sales.doc(id).get()
	const doc = (res.data && res.data[0]) || null
	if (!doc) return { code: 404, msg: '记录不存在' }
	const bizMode = normalizeString(doc.biz_mode) || 'bottle'
	const priceUnit = normalizeString(doc.price_unit) || 'kg'
	const unitPrice = toNumber(doc.unit_price, 0)

	const outItems = Array.isArray(doc.out_items) ? doc.out_items : []
	const backItems = Array.isArray(doc.back_items) ? doc.back_items : []
	const agentRows = Array.isArray(doc.agent_sale_items) ? doc.agent_sale_items : []
	const truckSaleNet = toNumber(doc.truck_sale_net, 0)

	const flow = computeFlow(doc, priceUnit)
	const amounts = computeAmounts({
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outItems,
		backItems: bizMode === 'agent_sale' ? [] : backItems,
		agentRows,
		truckSaleNet,
		flow,
		roundingAmount: toNumber(doc.rounding_amount, 0)
	})

	return {
		code: 0,
		data: {
			...doc,
			out_net_total: amounts.out_net_total,
			back_net_total: amounts.back_net_total,
			total_net_weight: amounts.total_net_weight,
			out_amount: amounts.out_amount,
			back_amount: amounts.back_amount,
			rounding_amount: amounts.rounding_amount,
			should_receive: amounts.should_receive
		}
	}
}

async function getCustomerDepositV1(user, data) {
	void user
	const customerId = normalizeString(data.customerId)
	if (!customerId) return { code: 400, msg: 'customerId 必填', data: { bottles: [], raw: '', count: 0 } }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 400, msg: '客户不存在', data: { bottles: [], raw: '', count: 0 } }

	const resolvedId = customer._id
	const resolvedName = customer.name

	const dateEnd = normalizeString(data.dateEnd || data.date)
	const where = { customer_id: resolvedId }
	if (dateEnd) where.date = dbCmd.lte(dateEnd)

	const res = await sales
		.where(where)
		.field({ out_items: true, back_items: true, deposit_rows: true, date: true, created_at: true })
		.orderBy('date', 'asc')
		.orderBy('created_at', 'asc')
		.limit(5000)
		.get()

	const set = new Set()
	;(res.data || []).forEach((row) => {
		const outs = Array.isArray(row.out_items) ? row.out_items : []
		const backs = Array.isArray(row.back_items) ? row.back_items : []
		const deposits = Array.isArray(row.deposit_rows) ? row.deposit_rows : []

		outs.forEach((it) => {
			const no = normalizeString(it && it.bottle_no)
			if (no) set.add(no)
		})
		deposits.forEach((it) => {
			const no = normalizeString(it && it.bottle_no)
			if (no) set.add(no)
		})
		backs.forEach((it) => {
			const no = normalizeString(it && it.bottle_no)
			if (no) set.delete(no)
		})
	})

	const bottles = Array.from(set).sort()
	return {
		code: 0,
		data: {
			customer_id: resolvedId,
			customer_name: resolvedName,
			bottles,
			raw: bottles.join(' / '),
			count: bottles.length
		}
	}
}

async function updateV2(user, data, requestId, token) {
	const recordId = normalizeString(data.recordId || data._id)
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }
	const payload = data.payload
	if (!payload) return { code: 400, msg: 'payload 必填' }
	const existingRes = await sales.doc(recordId).get()
	const existing = (existingRes.data && existingRes.data[0]) || null
	if (!existing) return { code: 404, msg: '记录不存在' }

	const base = payload.base || {}
	const outRows = normalizeBottleRows(payload.outRows || [])
	const backRows = normalizeBottleRows(payload.backRows || [])
	const depositRows = normalizeDepositRows(payload.depositRows || [])
	const agentRows = normalizeAgentRows(payload.agentSaleRows || [])

	const date = normalizeString(base.date)
	if (!date) return { code: 400, msg: '日期必填' }

	const customerId = normalizeString(base.customerId)
	if (!customerId) return { code: 400, msg: '客户必选' }

	const customer = await getCustomerById(customerId)
	if (!customer) return { code: 400, msg: '客户不存在' }
	const deliveryMan = joinDelivery(base.delivery1, base.delivery2)

	const bizMode = inferBizMode(base, outRows, backRows, agentRows)
	const priceUnit = normalizeString(base.priceUnit) || 'kg'
	const unitPrice = toNumber(base.unitPrice, 0)

	const truckNo = normalizeString(base.truckNo)
	const truckOutGross = toNumber(base.truckOutGross, 0)
	const truckBackGross = toNumber(base.truckBackGross, 0)
	const truckSaleNet = toNumber(base.truckSaleNet, 0)

	const flowIndexPrev = priceUnit === 'm3' ? toNumber(base.flowIndexPrev, null) : null
	const flowIndexCurr = priceUnit === 'm3' ? toNumber(base.flowIndexCurr, null) : null
	const flowVolumeM3 = priceUnit === 'm3' ? toNumber(base.flowVolumeM3, null) : null
	const flowTheoryRatio = priceUnit === 'm3' ? toNumber(base.flowTheoryRatio, null) : null

	if (bizMode === 'bottle') {
		const ensureRes = await ensureBottlesExist({
			customerId: customer._id,
			customerName: customer.name,
			outRows,
			backRows
		})
		if (!ensureRes.ok) return { code: 400, msg: ensureRes.msg }
	}

	const flowForCheck = computeFlow(
		{
			flow_index_prev: flowIndexPrev,
			flow_index_curr: flowIndexCurr,
			flow_volume_m3: flowVolumeM3,
			flow_theory_ratio: flowTheoryRatio
		},
		priceUnit
	)
	const amountsForCheck = computeAmounts({
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outRows,
		backItems: bizMode === 'agent_sale' ? [] : backRows,
		agentRows,
		truckSaleNet,
		flow: flowForCheck,
		roundingAmount: toNumber(base.roundingAmount, 0)
	})
	const settlementCheck = validateSettlement({
		shouldReceive: amountsForCheck.should_receive,
		paymentStatus: base.paymentStatus,
		amountReceived: base.amountReceived,
		roundingAmount: base.roundingAmount
	})
	if (!settlementCheck.ok) return { code: 400, msg: settlementCheck.msg }

	const updateDoc = {
		date,
		customer_id: customer._id,
		customer_name: customer.name,
		delivery_man: deliveryMan,
		vehicle_id: normalizeString(base.vehicleId),
		car_no: normalizeString(base.carNo),
		biz_mode: bizMode,
		unit_price: unitPrice,
		price_unit: priceUnit,
		remark: normalizeString(base.remark),
		payment_status: normalizeString(base.paymentStatus),
		amount_received: toNumber(base.amountReceived, 0),
		rounding_amount: Math.max(toNumber(base.roundingAmount, 0), 0),
		payment_note: normalizeString(base.paymentNote),
		payment_method: normalizeString(base.paymentMethod),
		updated_at: Date.now()
	}

	if (bizMode === 'truck') {
		updateDoc.truck_no = truckNo
		updateDoc.truck_out_gross = truckOutGross
		updateDoc.truck_back_gross = truckBackGross
		updateDoc.truck_sale_net = truckSaleNet
		updateDoc.out_items = []
		updateDoc.back_items = []
		updateDoc.deposit_rows = []
		updateDoc.agent_sale_items = []
	} else if (bizMode === 'agent_sale') {
		updateDoc.truck_no = ''
		updateDoc.truck_out_gross = null
		updateDoc.truck_back_gross = null
		updateDoc.truck_sale_net = null
		updateDoc.agent_sale_items = agentRows
		updateDoc.out_items = []
		updateDoc.back_items = []
		updateDoc.deposit_rows = []
	} else {
		updateDoc.truck_no = ''
		updateDoc.truck_out_gross = null
		updateDoc.truck_back_gross = null
		updateDoc.truck_sale_net = null
		updateDoc.agent_sale_items = []
		updateDoc.out_items = outRows
		updateDoc.back_items = backRows
		updateDoc.deposit_rows = depositRows
	}

	if (priceUnit === 'm3') {
		updateDoc.flow_index_prev = flowIndexPrev
		updateDoc.flow_index_curr = flowIndexCurr
		updateDoc.flow_volume_m3 = flowVolumeM3
		updateDoc.flow_theory_ratio = flowTheoryRatio
	} else {
		updateDoc.flow_index_prev = null
		updateDoc.flow_index_curr = null
		updateDoc.flow_volume_m3 = null
		updateDoc.flow_theory_ratio = null
	}

	await sales.doc(recordId).update(updateDoc)
	if (normalizeString(existing.biz_mode) === 'bottle' || bizMode === 'bottle') {
		await movements
			.where({ source_type: 'sale', source_id: recordId })
			.remove()
	}
	if (bizMode === 'bottle') {
		await appendMovementRecords(user, { ...updateDoc, _id: recordId }, outRows, backRows)
	}
	const flow = computeFlow(updateDoc, priceUnit)
	const amounts = computeAmounts({
		bizMode,
		priceUnit,
		unitPrice,
		outItems: bizMode === 'agent_sale' ? [] : outRows,
		backItems: bizMode === 'agent_sale' ? [] : backRows,
		agentRows,
		truckSaleNet,
		flow,
		roundingAmount: toNumber(base.roundingAmount, 0)
	})
	await syncSaleVoucher(user, { ...updateDoc, _id: recordId }, amounts, requestId)
	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		[
			...collectSaleBottleNosFromDoc(existing),
			...collectSaleBottleNosFromDoc({ out_items: outRows, back_items: backRows, agent_sale_items: agentRows })
		],
		requestId
	)
	await recordLog(
		user,
		'sale_update_v2',
		{ id: recordId, biz_mode: bizMode, touch_warning: touchRes.warning || '' },
		requestId
	)
	return {
		code: 0,
		msg: touchRes.warning ? `更新成功（${touchRes.warning}）` : '更新成功',
		data: { warning: touchRes.warning || '' }
	}
}

async function removeV2(user, data, requestId, token) {
	const recordId = normalizeString(data.recordId || data._id || data.id)
	if (!recordId) return { code: 400, msg: '缺少记录 ID' }

	const saleRes = await sales.doc(recordId).get()
	const saleDoc = (saleRes.data && saleRes.data[0]) || null
	if (!saleDoc) return { code: 404, msg: '记录不存在' }

	const source = `sale:${recordId}`
	const voucherRes = await vouchers.where({ source }).limit(1).get()
	const voucher = (voucherRes.data && voucherRes.data[0]) || null
	if (voucher && normalizeString(voucher.status) === 'posted') {
		return { code: 400, msg: '凭证已过账，禁止删除销售单' }
	}
	if (voucher) {
		await voucherEntries.where({ voucher_id: voucher._id }).remove()
		await vouchers.doc(voucher._id).remove()
	}

	await movements.where({ source_type: 'sale', source_id: recordId }).remove()
	await sales.doc(recordId).remove()

	const touchRes = await triggerAnomalyTouchV2(
		user,
		token,
		collectSaleBottleNosFromDoc(saleDoc),
		requestId
	)
	await recordLog(
		user,
		'sale_remove_v2',
		{
			id: recordId,
			biz_mode: normalizeString(saleDoc.biz_mode),
			touch_warning: touchRes.warning || ''
		},
		requestId
	)
	return {
		code: 0,
		msg: touchRes.warning ? `删除成功（${touchRes.warning}）` : '删除成功',
		data: { warning: touchRes.warning || '' }
	}
}

exports.main = async (event, context) => {
	void context
	const { action, data = {}, token } = event
	const requestId =
		normalizeString(event.request_id || event.requestId || context?.requestId || context?.request_id || '') ||
		generateRequestId()

	const user = await getUserByToken(token)
	if (!user) return { code: 401, msg: '未登录或登录已过期' }

	if (action === 'createV2') return createV2(user, data, requestId, token)
	if (action === 'updateV2') return updateV2(user, data, requestId, token)
	if (action === 'removeV2') return removeV2(user, data, requestId, token)
	if (action === 'listV2') return listV2(user, data)
	if (action === 'getV2') return getV2(user, data)
	if (action === 'getCustomerDepositV1') return getCustomerDepositV1(user, data)

	return { code: 400, msg: '未知 action' }
}
