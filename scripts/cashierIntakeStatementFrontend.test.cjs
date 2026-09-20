'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const vue = require('vue')

const componentPath = 'src/components/domain/customer/statement/CashierIntakeRecords.vue'
const modulePath = 'src/components/domain/customer/statement/CustomerStatementModule.vue'
const depositPath = 'src/components/domain/customer/statement/CustomerDepositPanel.vue'
const servicePath = 'src/services/customerSettlement.js'
const cashierApiPath = 'src/services/api/cashierIntake.js'
const componentSource = fs.readFileSync(componentPath, 'utf8')
const moduleSource = fs.readFileSync(modulePath, 'utf8')
const depositSource = fs.readFileSync(depositPath, 'utf8')
const serviceSource = fs.readFileSync(servicePath, 'utf8')
const cashierApiSource = fs.readFileSync(cashierApiPath, 'utf8')
const componentScript = componentSource.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')

function pageResult(rows, paging = {}) {
	return {
		code: 0,
		data: rows,
		paging: { total: rows.length, pageSize: 20, hasMore: false, next_cursor: '', snapshot: 's1', ...paging }
	}
}

function intakeRow(overrides = {}) {
	return {
		_id: 'intake-1',
		intake_id: 'intake-1',
		customer_id: 'customer-1',
		biz_date: '2026-09-20',
		amount: 100,
		gas_amount: 80,
		deposit_amount: 20,
		kind: 'mixed',
		purpose: 'settlement',
		payment_method: 'bank',
		status: 'posted',
		receipt_id: 'receipt-1',
		deposit_entry_id: 'deposit-1',
		allocated_amount: 20,
		unallocated_amount: 60,
		proof_images_count: 1,
		created_by_name: '测试出纳',
		note: '到账备注',
		...overrides
	}
}

async function settle() {
	await Promise.resolve()
	await new Promise(resolve => setImmediate(resolve))
	await Promise.resolve()
}

async function harness({ list, detail, release } = {}) {
	const props = vue.reactive({ customerId: 'customer-1', dateFrom: '2026-01-01', dateTo: '2026-09-20' })
	const listCalls = []
	const detailCalls = []
	const events = []
	const previews = []
	const releaseCalls = []
	const toasts = []
	const context = vm.createContext({
		...vue,
		onBeforeUnmount: () => {},
		console,
		setTimeout,
		clearTimeout,
		defineProps: () => props,
		defineEmits: () => (name, payload) => events.push({ name, payload }),
		listReceiptIntakeV2: async params => {
			listCalls.push({ ...params })
			return list ? list(params, listCalls.length) : pageResult([intakeRow()])
		},
		getReceiptIntakeDetailV2: async params => {
			detailCalls.push({ ...params })
			return detail ? detail(params, detailCalls.length) : { code: 0, data: { row: intakeRow(), proof_images: [], allocation_targets: [], deposit_entries: [], receipt: null } }
		},
		releaseReceiptAllocationsV2: async params => {
			releaseCalls.push({ ...params })
			return release ? release(params, releaseCalls.length) : { code: 0, msg: '分配已解除，原到账仍保留', data: { committed: true } }
		},
		normalizeCashierMoneyScale: (value, fallback = 2) => Number(value) === 3 ? 3 : (Number(value) === 2 ? 2 : (Number(fallback) === 3 ? 3 : 2)),
		normalizeCashierMoney: (value, scale = 2) => {
			const digits = Number(scale) === 3 ? 3 : 2
			const text = String(value ?? '').trim()
			if (!/^\d+(?:\.\d+)?$/.test(text)) return ''
			const [integer, decimal = ''] = text.split('.')
			if (decimal.length > digits) return ''
			return `${integer}.${decimal.padEnd(digits, '0')}`
		},
		uni: {
			showToast: options => toasts.push(options),
			showModal: options => options.success({ confirm: true, cancel: false }),
			previewImage: options => previews.push(options)
		}
	})
	vm.runInContext(`${componentScript}\nglobalThis.panel = { rows, loading, listIssue, page, pageCursors, paging, filters, expandedId, details, detailLoading, detailIssues, releaseLoading, releaseOperationIds, loadPage, resetAndLoad, reloadCurrentPage, nextPage, previousPage, ensureDetail, toggleDetail, previewProofs, allocateGas, releaseAllocations, purposeText, hasGasReceipt, canAllocateGas, canReleaseAllocations, hasDepositEntry, moneyText, rowMoneyScale, allocationTargetText };`, context)
	await settle()
	return { panel: context.panel, props, listCalls, detailCalls, releaseCalls, events, previews, toasts }
}

test('cashier intake stays unopened by default and adds no statement main-load request', () => {
	assert.match(moduleSource, /const activeOperationTab = ref\('receipt'\)/)
	assert.match(moduleSource, /<CashierIntakeRecords[\s\S]*?v-else-if="activeOperationTab === 'cashier_intake'"/)
	assert.doesNotMatch(moduleSource, /listReceiptIntakeV2|getReceiptIntakeDetailV2/)
	assert.match(moduleSource, /@continue-receipt="onContinuePrepayReceipt"/)
	assert.match(moduleSource, /editingReceiptOperationId\.value = normalizeString\(beginRes\?\.data\?\.adjustment_id\)/)
	assert.match(moduleSource, /operationId: editingReceiptOperationId\.value/)
	assert.match(serviceSource, /operation_id: params\.operationId \|\| params\.operation_id \|\| ''/)
	assert.match(cashierApiSource, /expected_receipt: params\.expected_receipt/)
})

test('cashier intake uses independent cursor pages of 20 and can reach later history', async () => {
	const h = await harness({
		list: params => {
			if (params.cursor === 0) return pageResult([intakeRow({ intake_id: 'intake-21', _id: 'intake-21' })], { total: 41, hasMore: true, next_cursor: 'cursor-3' })
			if (params.cursor === 'cursor-3') return pageResult([intakeRow({ intake_id: 'intake-41', _id: 'intake-41' })], { total: 41, hasMore: false, next_cursor: '' })
			return pageResult(Array.from({ length: 20 }, (_, index) => intakeRow({ intake_id: `intake-${index + 1}`, _id: `intake-${index + 1}` })), { total: 41, hasMore: true, next_cursor: 0 })
		}
	})
	assert.equal(h.listCalls.length, 1)
	assert.equal(h.listCalls[0].page_size, 20)
	assert.equal(h.listCalls[0].cursor, '')
	assert.equal(h.panel.rows.value.length, 20)
	await h.panel.nextPage()
	assert.equal(h.panel.page.value, 2)
	assert.equal(h.listCalls[1].cursor, 0)
	await h.panel.nextPage()
	assert.equal(h.panel.page.value, 3)
	assert.equal(h.panel.rows.value[0].intake_id, 'intake-41')
	await h.panel.previousPage()
	assert.equal(h.panel.page.value, 2)
	assert.equal(h.listCalls[3].cursor, 0)
})

test('detail and proof stay lazy; gas allocation emits the existing receipt without creating another', async () => {
	const row = intakeRow()
	const receipt = { _id: 'receipt-1', source_type: 'cashier_intake', amount: 80, allocated_amount: 20, unallocated_amount: 60, biz_date: '2026-09-20', payment_method: 'bank', note: '到账备注' }
	const h = await harness({
		list: () => pageResult([row]),
		detail: () => ({ code: 0, data: { row, receipt, proof_images: ['https://example.test/proof.jpg'], allocation_targets: [{ target_id: 'sale-1', allocated_amount: 20 }], deposit_entries: [{ entry_id: 'deposit-1' }] } })
	})
	assert.equal(h.detailCalls.length, 0)
	await h.panel.allocateGas(h.panel.rows.value[0])
	assert.equal(h.detailCalls.length, 1)
	assert.equal(h.detailCalls[0].intake_id, 'intake-1')
	assert.equal(h.events.length, 1)
	assert.equal(h.events[0].name, 'continue-receipt')
	assert.equal(h.events[0].payload._id, 'receipt-1')
	await h.panel.previewProofs(h.panel.rows.value[0])
	assert.equal(h.detailCalls.length, 1)
	assert.deepEqual(Array.from(h.previews[0].urls), ['https://example.test/proof.jpg'])
	assert.doesNotMatch(componentScript, /createReceipt|saveReceipt|createDeposit/)
})

test('purpose remains display-only while gas and deposit actions follow linked amounts and ids', async () => {
	const h = await harness()
	const base = intakeRow({ purpose: 'prepay' })
	const changedPurpose = { ...base, purpose: 'settlement' }
	assert.equal(h.panel.purposeText(base.purpose), '预付')
	assert.equal(h.panel.purposeText(changedPurpose.purpose), '结账')
	assert.equal(h.panel.canAllocateGas(base), true)
	assert.equal(h.panel.canAllocateGas(changedPurpose), true)
	assert.equal(h.panel.hasDepositEntry(base), true)
	assert.match(componentSource, /来源用途（仅作来源记录）/)
})

test('linked cashier metadata is shown on deposit entries without per-row detail calls', () => {
	for (const field of ['source_type', 'intake_id', 'created_by_name', 'proof_images_count', 'entry.note']) assert.match(depositSource, new RegExp(field.replace('.', '\\.')))
	assert.doesNotMatch(depositSource, /getReceiptIntakeDetailV2|listReceiptIntakeV2/)
	assert.match(depositSource, /来源：出纳到账/)
	assert.match(depositSource, /请从到账原单统一更正/)
	assert.match(depositSource, /isCashierIntakeEntry\(entry\)/)
})

test('three-decimal cashier gas is rendered exactly while deposits remain cents', async () => {
	const h = await harness()
	const row = intakeRow({ money_scale: 3, amount: 100.001, gas_amount: 80.001, deposit_amount: 20 })
	assert.equal(h.panel.rowMoneyScale(row), 3)
	assert.equal(h.panel.moneyText(row.amount, h.panel.rowMoneyScale(row)), '100.001')
	assert.equal(h.panel.moneyText(row.gas_amount, h.panel.rowMoneyScale(row)), '80.001')
	assert.equal(h.panel.moneyText(row.deposit_amount, 2), '20.00')
	assert.equal(h.panel.moneyText('1.0001', 3), '待核')
})

test('release action explicitly preserves arrival, uses one operation id, and distinguishes refresh failure', async () => {
	const allocated = intakeRow({ allocated_amount: 20, rounding_allocated_amount: 0, unallocated_amount: 60 })
	const receipt = { _id: 'receipt-1', customer_id: 'customer-1', source_type: 'cashier_intake', status: 'posted', amount: 80, allocated_amount: 20, rounding_allocated_amount: 0, unallocated_amount: 60, updated_at: 1 }
	const h = await harness({
		list: (_params, call) => call === 1
			? pageResult([allocated])
			: { code: 409, msg: 'synthetic refresh failure' },
		detail: () => ({ code: 0, data: { row: allocated, receipt, proof_images: [], allocation_targets: [], deposit_entries: [] } })
	})
	assert.equal(h.panel.canReleaseAllocations(h.panel.rows.value[0]), true)
	await h.panel.releaseAllocations(h.panel.rows.value[0])
	assert.equal(h.releaseCalls.length, 1)
	assert.equal(h.releaseCalls[0].receipt_id, 'receipt-1')
	assert.equal(h.releaseCalls[0].customer_id, 'customer-1')
	assert.match(h.releaseCalls[0].operation_id, /^account-release-/)
	assert.deepEqual(h.releaseCalls[0].expected_receipt, receipt)
	assert.equal(h.detailCalls.length, 1)
	assert.equal(h.listCalls.length, 2)
	assert.equal(h.toasts.some(item => /原到账仍保留/.test(item.title)), true)
	assert.equal(h.toasts.some(item => /列表刷新失败/.test(item.title)), true)
	assert.match(componentSource, /到账不会被删除或作废/)
})
