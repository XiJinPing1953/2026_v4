'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const mapperSource = fs.readFileSync('src/services/mappers/cashierIntake.js', 'utf8')
const mapperUrl = `data:text/javascript;base64,${Buffer.from(mapperSource).toString('base64')}`
const mapperPromise = import(mapperUrl)

async function loadExporter() {
	const source = fs.readFileSync('src/components/domain/customer/exportCashierReceiptIntakeWorkbook.js', 'utf8')
		.replace("from '@/services/mappers/cashierIntake'", `from '${mapperUrl}'`)
	return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

async function loadApi(calls) {
	globalThis.__cashierIntakeCallCloud = async (name, options) => {
		calls.push({ name, options })
		return { code: 0 }
	}
	const source = fs.readFileSync('src/services/api/cashierIntake.js', 'utf8')
		.replace("import { callCloud } from './callCloud'", 'const callCloud = globalThis.__cashierIntakeCallCloud')
	return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Date.now()}${Math.random()}`)
}

function deferred() {
	let resolve
	let reject
	const promise = new Promise((yes, no) => { resolve = yes; reject = no })
	return { promise, resolve, reject }
}

async function settle() {
	await new Promise((resolve) => setImmediate(resolve))
}

async function viewHarness(overrides = {}) {
	const mapper = await mapperPromise
	const source = fs.readFileSync('src/components/domain/customer/CashierReceiptIntakeView.vue', 'utf8')
	const script = source.split('<script setup>')[1].split('</script>')[0]
		.replace(/^import[\s\S]*?\bfrom\s+['"][^'"]+['"]\s*\n/gm, '')
	const storage = overrides.storage || new Map()
	const previews = []
	const saves = []
	const queries = []
	const lists = []
	const uploads = []
	const customerSearches = []
	const exportRequests = []
	const toasts = []
	let saveImpl = overrides.save || (async (submission) => ({ code: 0, data: { intake_id: 'i1', operation_id: submission.operation_id, status: 'committed', version: 1 } }))
	let previewImpl = overrides.preview || (async (input) => ({
		code: 0,
		data: {
			operation_id: input.operation_id,
			before: null,
			after: { ...input },
			submission: { ...input, amount: Number(input.amount), gas_amount: Number(input.gas_amount), deposit_amount: Number(input.deposit_amount), expected_snapshot: 'snap-1' }
		}
	}))
	let queryImpl = overrides.query || (async () => ({ code: 0, data: { found: false } }))
	let listImpl = overrides.list || (async () => ({ code: 0, data: [], paging: { total: 0, pageSize: 20, hasMore: false, next_cursor: null, snapshot: 'list-snap', create_enabled: true } }))
	let uploadImpl = overrides.upload || (async (params) => ({ fileID: `cloud://env/${params.cloudPath}` }))
	let customerListImpl = overrides.customerList || (async () => ({ code: 0, data: [] }))
	let detailImpl = overrides.detail || (async () => ({ code: 0, data: {} }))
	let exportCollectImpl = overrides.collectExport || (async () => [])
	const context = vm.createContext({
		...mapper,
		console,
		Date,
		Math,
		Promise,
		JSON,
		Object,
		Number,
		String,
		Array,
		Set,
		Map,
		setTimeout,
		clearTimeout,
		ref: (value) => ({ value }),
		reactive: (value) => value,
		computed: (getter) => ({ get value() { return getter() } }),
		onShow: (callback) => { context.__onShow = callback },
		useAuthGuard: () => ({ requireLogin: () => true, canPageAction: () => true }),
		getUser: () => ({ _id: 'user-1' }),
		listCustomersV1: async (params) => { customerSearches.push(structuredClone(params)); return customerListImpl(params) },
		downloadWorkbookFile: async () => true,
		buildCashierReceiptIntakeExportFileName: () => 'x.xls',
		buildCashierReceiptIntakeWorkbookXml: () => '<xml/>',
		collectCashierReceiptIntakeExportRows: async (fetchPage, filter, options) => { exportRequests.push({ filter: structuredClone(filter), options }); return exportCollectImpl(fetchPage, filter, options) },
		getReceiptIntakeDetailV2: async (params) => detailImpl(params),
		getReceiptIntakeOperationV2: async (params) => { queries.push(structuredClone(params)); return queryImpl(params) },
		listReceiptIntakeV2: async (params) => { lists.push(structuredClone(params)); return listImpl(params) },
		previewReceiptIntakeV2: async (input) => { previews.push(structuredClone(input)); return previewImpl(input) },
		saveReceiptIntakeV2: async (submission) => { saves.push(structuredClone(submission)); return saveImpl(submission) },
		voidReceiptIntakeV2: async (submission) => { saves.push(structuredClone(submission)); return saveImpl(submission) },
		uni: {
			getStorageSync: (key) => storage.get(key),
			setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
			removeStorageSync: (key) => storage.delete(key),
			showToast: (params) => { toasts.push(structuredClone(params)) },
			showLoading: () => {},
			hideLoading: () => {},
			showModal: ({ success }) => success({ confirm: true }),
			showActionSheet: ({ success }) => success({ tapIndex: 0 }),
			chooseImage: ({ fail }) => fail(),
			previewImage: () => {},
			pageScrollTo: () => {}
		},
		uniCloud: {
			uploadFile: async (params) => { uploads.push(structuredClone(params)); return uploadImpl(params) },
			getTempFileURL: async ({ fileList }) => overrides.resolveTemp ? overrides.resolveTemp(fileList) : ({ fileList: fileList.map((fileID) => ({ fileID, code: 0, tempFileURL: `https://temp/${fileID}` })) })
		}
	})
	vm.runInContext(`${script}\n;globalThis.__view = { canConfirmPrepared, paymentMethodOptions, paymentMethodIndex, purposeText, onBeginVoid, form, proofImages, selectedIntakeCustomerId, selectedIntakeCustomerName, selectedIntakeMoneyScale, editingIntakeId, editingVersion, intakeCustomerKeyword, intakeCustomerOptions, operation, fieldsLocked, currentAmounts, actionIssue, writeFeatureDisabled, createAvailabilityKnown, canPreviewCurrent, detailMap, rows, pager, previewCurrentOperation, submitPreparedOperation, retryPreparedOperation, querySavedOperation, restoreOperation, persistOperation, loadRows, onNextPage, onPrevPage, searchCustomerOptions, ensureDetail, onEdit, onExport };`, context)
	if (!overrides.skipInitialList) await context.__view.loadRows(true)
	return {
		view: context.__view,
		storage,
		previews,
		saves,
		queries,
		lists,
		uploads,
		customerSearches,
		exportRequests,
		toasts,
		setSave: (fn) => { saveImpl = fn },
		setPreview: (fn) => { previewImpl = fn },
		setQuery: (fn) => { queryImpl = fn },
		setList: (fn) => { listImpl = fn },
		setUpload: (fn) => { uploadImpl = fn },
		setCustomerList: (fn) => { customerListImpl = fn },
		setDetail: (fn) => { detailImpl = fn },
		setExportCollect: (fn) => { exportCollectImpl = fn }
	}
}

function fillDraft(view, overrides = {}) {
	view.selectedIntakeCustomerId.value = 'customer-1'
	view.selectedIntakeCustomerName.value = '精度客户'
	view.selectedIntakeMoneyScale.value = 3
	Object.assign(view.form, { kind: 'mixed', amount: '0.011', gasAmount: '0.001', depositAmount: '0.01', purpose: 'prepay', bizDate: '2026-09-20', paymentMethod: 'bank', note: '一笔到账', reason: '', ...overrides })
	view.proofImages.value = [{ fileId: 'cloud://env/proof-1.jpg', localPath: '', previewUrl: 'cloud://env/proof-1.jpg', draftKey: 'cloud://env/proof-1.jpg' }]
}

function exportRow(intakeId, overrides = {}) {
	return { intake_id: intakeId, kind: 'gas', amount: '1.00', gas_amount: '1.00', deposit_amount: '0.00', money_scale: 2, status: 'posted', ...overrides }
}

test('money mapper keeps mixed 2/3 scale exact and fingerprints content only', async () => {
	const mapper = await mapperPromise
	assert.deepEqual(mapper.buildCashierAmounts({ kind: 'mixed', amount: '0.011', gas_amount: '0.001', deposit_amount: '0.01', money_scale: 3 }), {
		amount: '0.011', gas_amount: '0.001', deposit_amount: '0.01', money_scale: 3
	})
	assert.equal(mapper.buildCashierAmounts({ kind: 'mixed', amount: '0.012', gas_amount: '0.001', deposit_amount: '0.01', money_scale: 3 }), null)
	assert.equal(mapper.buildCashierAmounts({ kind: 'gas', amount: '1.001', money_scale: 2 }), null)
	assert.deepEqual(mapper.buildCashierAmounts({ kind: 'gas', amount: '1.20', money_scale: 2 }), { amount: '1.20', gas_amount: '1.20', deposit_amount: '0.00', money_scale: 2 })
	assert.equal(mapper.normalizeCashierMoney(20.001, 2), '')
	assert.equal(mapper.normalizeCashierMoney(20.01, 2), '20.01')
	assert.equal(mapper.normalizeCashierMoney(1e-7, 3), '')
	assert.equal(mapper.normalizeCashierPurpose('prepay', 'mixed'), 'prepay')
	assert.equal(mapper.normalizeCashierPurpose('prepay', 'deposit'), 'unspecified')
	const input = { command: 'update', intake_id: 'i1', customer_id: 'c1', kind: 'gas', amount: '1.000', gas_amount: '1.000', deposit_amount: '0.00', purpose: 'prepay', biz_date: '2026-09-20', payment_method: 'bank', proof_images: ['cloud://env/a'], note: '', reason: '核对', expected_version: 1, expected_snapshot: 'a' }
	assert.equal(mapper.cashierDraftFingerprint(input), mapper.cashierDraftFingerprint({ ...input, expected_version: 9, expected_snapshot: 'b' }))
	assert.notEqual(mapper.cashierDraftFingerprint(input), mapper.cashierDraftFingerprint({ ...input, note: 'changed' }))
})

test('text amount inputs reject illegal characters before preview and invalidate an earlier preview', async () => {
	const invalid = ['12a', '1e2', '-1', '1,000', '12..3', '12.3456']
	for (const field of ['amount', 'gasAmount', 'depositAmount']) {
		for (const value of invalid) {
			const h = await viewHarness()
			fillDraft(h.view, { [field]: value })
			assert.equal(h.view.currentAmounts.value, null, `${field}: ${value}`)
			await h.view.previewCurrentOperation()
			assert.equal(h.previews.length, 0, `${field}: ${value}`)
			assert.equal(h.saves.length, 0, `${field}: ${value}`)
		}
	}
	const h = await viewHarness()
	fillDraft(h.view)
	await h.view.previewCurrentOperation()
	assert.equal(h.view.canConfirmPrepared.value, true)
	h.view.form.amount = '0.011x'
	assert.equal(h.view.canConfirmPrepared.value, false)
})

test('shared V2 API keeps snake_case, opaque cursor, export mode, and prepared submission', async () => {
	const calls = []
	const api = await loadApi(calls)
	const cursor = { token: 'opaque' }
	await api.listReceiptIntakeV2({ customer_id: 'c1', cursor, page_size: 100, export_mode: true })
	assert.equal(calls[0].name, 'crm-customer-settlement')
	assert.equal(calls[0].options.action, 'listReceiptIntakeV2')
	assert.equal(calls[0].options.data.cursor, cursor)
	assert.equal(calls[0].options.data.export_mode, true)
	const submission = { command: 'create', operation_id: 'op-1', amount: 0.011, expected_snapshot: { hash: 'h1' } }
	await api.saveReceiptIntakeV2(submission)
	assert.deepEqual(calls[1].options.data, submission)
	await api.releaseReceiptAllocationsV2({ receipt_id: 'r1', customer_id: 'c1', operation_id: 'op-2' })
	assert.deepEqual(calls[2].options.data, { receipt_id: 'r1', customer_id: 'c1', operation_id: 'op-2', expected_receipt: null })
})

test('cursor export requires one stable complete snapshot with unique rows', async () => {
	const exporter = await loadExporter()
	const requests = []
	const pages = [
		{ code: 0, data: [exportRow('i1')], paging: { total: 2, hasMore: true, next_cursor: { token: 'c2' }, snapshot: { hash: 's1' } } },
		{ code: 0, data: [exportRow('i2')], paging: { total: 2, hasMore: false, next_cursor: null, snapshot: { hash: 's1' } } }
	]
	const rows = await exporter.collectCashierReceiptIntakeExportRows(async (params) => { requests.push(params); return pages.shift() }, { kind: 'mixed' })
	assert.deepEqual(rows.map((row) => row.intake_id), ['i1', 'i2'])
	assert.equal(requests.every((request) => request.export_mode === true), true)
	assert.deepEqual(requests[1].cursor, { token: 'c2' })
	await assert.rejects(() => exporter.collectCashierReceiptIntakeExportRows(async ({ cursor }) => cursor ? { code: 0, data: [exportRow('i1')], paging: { total: 2, hasMore: false, snapshot: 's1' } } : { code: 0, data: [exportRow('i1')], paging: { total: 2, hasMore: true, next_cursor: 'c2', snapshot: 's1' } }), /重复/)
	await assert.rejects(() => exporter.collectCashierReceiptIntakeExportRows(async ({ cursor }) => cursor ? { code: 0, data: [exportRow('i2')], paging: { total: 2, hasMore: false, snapshot: 'changed' } } : { code: 0, data: [exportRow('i1')], paging: { total: 2, hasMore: true, next_cursor: 'c2', snapshot: 's1' } }), /数据已变化/)
	await assert.rejects(() => exporter.collectCashierReceiptIntakeExportRows(async () => ({ code: 0, data: [], paging: { total: 1, hasMore: true, next_cursor: 'c2', snapshot: 's1' } })), /提前结束/)
	await assert.rejects(() => exporter.collectCashierReceiptIntakeExportRows(async () => ({ code: 0, data: [exportRow('i3', { status: 'pending' })], paging: { total: 1, hasMore: false, snapshot: 's1' } })), /状态待核/)
})

test('workbook totals exclude void rows, preserve 0.001, and keep unknown channel explicit', async () => {
	const exporter = await loadExporter()
	const rows = [
		{ intake_id: 'i1', customer_name: '三位客户', biz_date: '2026-09-20', kind: 'gas', purpose: 'prepay', payment_method: 'unknown', amount: '0.001', gas_amount: '0.001', deposit_amount: '0.00', allocated_amount: '0.000', rounding_allocated_amount: '0.000', unallocated_amount: '0.001', money_scale: 3, status: 'posted' },
		{ intake_id: 'i2', customer_name: '作废客户', biz_date: '2026-09-20', kind: 'deposit', amount: '9.99', gas_amount: '0.00', deposit_amount: '9.99', allocated_amount: '0.00', rounding_allocated_amount: '0.00', unallocated_amount: '0.00', money_scale: 2, status: 'void' }
	]
	assert.deepEqual(exporter.buildCashierReceiptIntakeTotals(rows), { count: 1, total: '0.001', total_scale: 3, gas_total: '0.001', gas_scale: 3, deposit_total: '0.00', deposit_scale: 2 })
	const xml = exporter.buildCashierReceiptIntakeWorkbookXml({ rows, filter: {} })
	assert.match(xml, /ss:ID="sMoney3"/)
	assert.match(xml, />0\.001</)
	assert.match(xml, /渠道待核/)
	assert.match(xml, /有效记录数（不含作废）/)
	const depositOnly = [{ intake_id: 'i3', customer_name: '三位精度押金客户', biz_date: '2026-09-20', kind: 'deposit', purpose: 'unspecified', payment_method: 'cash', amount: '8.88', gas_amount: '0.000', deposit_amount: '8.88', allocated_amount: '0.000', rounding_allocated_amount: '0.000', unallocated_amount: '0.000', money_scale: 3, status: 'posted' }]
	assert.deepEqual(exporter.buildCashierReceiptIntakeTotals(depositOnly), { count: 1, total: '8.88', total_scale: 2, gas_total: '0.00', gas_scale: 2, deposit_total: '8.88', deposit_scale: 2 })
	const depositXml = exporter.buildCashierReceiptIntakeWorkbookXml({ rows: depositOnly, filter: {} })
	assert.doesNotMatch(depositXml, /<Data ss:Type="String">待核<\/Data>/)
	assert.match(depositXml, /出纳登记/)
	assert.doesNotMatch(depositXml, /押金联动/)
})

test('view freezes before upload and saves the exact server submission', async () => {
	const upload = deferred()
	const h = await viewHarness({ upload: () => upload.promise })
	fillDraft(h.view)
	h.view.proofImages.value = [{ fileId: '', localPath: '/tmp/proof.jpg', previewUrl: '/tmp/proof.jpg', draftKey: 'local:proof' }]
	const previewPromise = h.view.previewCurrentOperation()
	await settle()
	assert.equal(h.view.operation.value.status, 'uploading')
	assert.equal(h.view.fieldsLocked.value, true)
	const stored = [...h.storage.values()][0]
	assert.equal(stored.operation.operation_id, h.view.operation.value.operation_id)
	assert.equal(stored.operation.frozen_draft.note, '一笔到账')
	upload.resolve({ fileID: 'cloud://env/frozen-proof.jpg' })
	await previewPromise
	const prepared = structuredClone(h.view.operation.value.submission)
	assert.equal(h.view.operation.value.status, 'previewed')
	await h.view.submitPreparedOperation(h.view.operation.value)
	assert.deepEqual(h.saves[0], prepared)
	assert.equal(h.previews[0].amount, '0.011')
	assert.equal(h.previews[0].proof_images[0], 'cloud://env/frozen-proof.jpg')
})

test('unknown save queries first, then retries the same prepared operation', async () => {
	const h = await viewHarness({ save: async () => { throw new Error('request timeout') }, query: async () => ({ code: 0, data: { found: false } }) })
	fillDraft(h.view)
	await h.view.previewCurrentOperation()
	const op = h.view.operation.value
	const operationId = op.operation_id
	const submission = structuredClone(op.submission)
	await h.view.submitPreparedOperation(op)
	assert.equal(h.queries[0].operation_id, operationId)
	assert.equal(h.view.operation.value.status, 'retryable')
	assert.equal(h.view.fieldsLocked.value, true)
	h.setSave(async (value) => ({ code: 0, data: { intake_id: 'i1', operation_id: value.operation_id, status: 'committed', version: 1 } }))
	await h.view.retryPreparedOperation()
	assert.deepEqual(h.saves[1], submission)
})

test('explicit rejection unlocks fields and reuses the operation until content changes', async () => {
	const h = await viewHarness({ save: async () => ({ code: 409, msg: '版本已变化' }) })
	fillDraft(h.view)
	await h.view.previewCurrentOperation()
	const firstId = h.view.operation.value.operation_id
	await h.view.submitPreparedOperation(h.view.operation.value)
	assert.equal(h.view.operation.value.status, 'rejected')
	assert.equal(h.view.fieldsLocked.value, false)
	await h.view.previewCurrentOperation()
	assert.equal(h.view.operation.value.operation_id, firstId)
	h.view.form.note = '内容变化'
	await h.view.previewCurrentOperation()
	assert.notEqual(h.view.operation.value.operation_id, firstId)
})

test('mixed total mismatch blocks preview and an already committed preview finishes without save', async () => {
	const mismatch = await viewHarness()
	fillDraft(mismatch.view, { amount: '0.012' })
	await mismatch.view.previewCurrentOperation()
	assert.equal(mismatch.previews.length, 0)
	assert.equal(mismatch.view.operation.value, null)

	const committed = await viewHarness({ preview: async (input) => ({ code: 0, data: { committed: true, result: { intake_id: 'i-existing', operation_id: input.operation_id, status: 'committed', idempotent: true, version: 1 } } }) })
	fillDraft(committed.view)
	await committed.view.previewCurrentOperation()
	assert.equal(committed.previews.length, 1)
	assert.equal(committed.saves.length, 0)
	assert.equal(committed.view.operation.value, null)
})

test('upload failure preserves the frozen draft and reuses its operation id', async () => {
	const h = await viewHarness({
		upload: async () => { throw new Error('upload failed') },
		resolveTemp: async (fileList) => ({ fileList: fileList.map((fileID) => ({ fileID, code: -1 })) })
	})
	fillDraft(h.view)
	h.view.proofImages.value = [{ fileId: '', localPath: '/tmp/retain.jpg', previewUrl: '/tmp/retain.jpg', draftKey: 'local:retain' }]
	await h.view.previewCurrentOperation()
	const operationId = h.view.operation.value.operation_id
	assert.equal(h.view.operation.value.status, 'rejected')
	assert.equal(h.view.fieldsLocked.value, false)
	assert.equal(h.view.operation.value.frozen_draft.proof_images[0].local_path, '/tmp/retain.jpg')
	h.setUpload(async (params) => ({ fileID: `cloud://env/${params.cloudPath}` }))
	await h.view.previewCurrentOperation()
	assert.equal(h.view.operation.value.operation_id, operationId)
	assert.equal(h.view.operation.value.status, 'previewed')
})

test('persisted saving and saved states recover without allowing a duplicate draft', async () => {
	const storage = new Map()
	const first = await viewHarness({ storage })
	fillDraft(first.view)
	await first.view.previewCurrentOperation()
	const operationId = first.view.operation.value.operation_id
	first.view.operation.value.status = 'saving'
	first.view.persistOperation()

	const restored = await viewHarness({ storage, query: async () => ({ code: 0, data: { found: false } }) })
	restored.view.restoreOperation()
	assert.equal(restored.view.operation.value.operation_id, operationId)
	assert.equal(restored.view.operation.value.status, 'unknown')
	assert.equal(restored.view.fieldsLocked.value, true)
	await restored.view.querySavedOperation()
	assert.equal(restored.view.operation.value.status, 'retryable')

	restored.view.operation.value.status = 'saved'
	restored.view.operation.value.result = { intake_id: 'i1', operation_id: operationId, status: 'committed', version: 1 }
	restored.view.persistOperation()
	const completed = await viewHarness({ storage })
	completed.view.restoreOperation()
	assert.equal(completed.view.operation.value, null)
	assert.equal(storage.size, 0)
})

test('create gate is fail closed and export always includes void rows', async () => {
	const gate = deferred()
	const h = await viewHarness({ skipInitialList: true, list: async () => gate.promise })
	fillDraft(h.view)
	assert.equal(h.view.writeFeatureDisabled.value, true)
	assert.equal(h.view.canPreviewCurrent.value, false)
	const loading = h.view.loadRows(true)
	gate.resolve({ code: 0, data: [], paging: { total: 0, pageSize: 20, hasMore: false, snapshot: 's1', create_enabled: true } })
	await loading
	assert.equal(h.view.writeFeatureDisabled.value, false)
	h.setList(async () => ({ code: 0, data: [], paging: { total: 0, pageSize: 20, hasMore: false, snapshot: 's2' } }))
	await h.view.loadRows(true)
	assert.equal(h.view.writeFeatureDisabled.value, true)
	await h.view.onExport()
	assert.equal(h.exportRequests[0].filter.include_void, true)
	assert.equal(h.exportRequests[0].options.is_current(), true)
})

test('latest customer search wins and detail row authorizes edit while unrelated deposits stay hidden', async () => {
	const first = deferred()
	const second = deferred()
	const h = await viewHarness({
		customerList: async ({ keyword }) => keyword === 'a' ? first.promise : second.promise,
		detail: async () => ({ code: 0, data: {
			row: { intake_id: 'i-auth', customer_id: 'c1', customer_name: '权威客户', kind: 'deposit', purpose: 'unspecified', amount: '8.88', gas_amount: '0.00', deposit_amount: '8.88', money_scale: 2, biz_date: '2026-09-20', payment_method: 'cash', note: '', version: 1, deposit_entry_id: 'dep-linked', editable: true, removable: true },
			proof_images: ['cloud://env/proof'], allocation_targets: [], deposit_entries: [{ _id: 'dep-old', amount: '1.00', account_version: 1 }, { _id: 'dep-linked', amount: '8.88', account_version: 2 }, { _id: 'dep-refund', kind: 'refund', amount: '2.00', account_version: 3 }]
		} })
	})
	h.view.intakeCustomerKeyword.value = 'a'
	const searchA = h.view.searchCustomerOptions('intake', 'a')
	h.view.intakeCustomerKeyword.value = 'ab'
	const searchB = h.view.searchCustomerOptions('intake', 'ab')
	first.resolve({ code: 0, data: [{ _id: 'old', name: '旧结果' }] })
	second.resolve({ code: 0, data: [{ _id: 'new', name: '最新结果' }] })
	await Promise.all([searchA, searchB])
	assert.equal(h.view.intakeCustomerOptions.value[0].value, 'new')

	const conservative = { intake_id: 'i-auth', editable: false, removable: false }
	const detail = await h.view.ensureDetail(conservative, true)
	assert.deepEqual(detail.deposit_entries.map((entry) => entry._id), ['dep-linked', 'dep-refund'])
	await h.view.onEdit(conservative)
	assert.equal(h.view.editingIntakeId.value, 'i-auth')
})

test('list refresh invalidates cached detail authorization', async () => {
	let editable = false
	const row = { intake_id: 'i-refresh', customer_id: 'c1', customer_name: '刷新客户', kind: 'gas', purpose: 'unspecified', amount: '1.00', gas_amount: '1.00', deposit_amount: '0.00', money_scale: 2, biz_date: '2026-09-20', payment_method: 'cash', note: '', version: 1, editable: false, removable: false }
	const h = await viewHarness({ detail: async () => ({ code: 0, data: { row: { ...row, editable, removable: editable }, proof_images: [], allocation_targets: [], deposit_entries: [] } }) })
	await h.view.ensureDetail(row, true)
	assert.equal(h.view.detailMap.value['i-refresh'].data.row.editable, false)
	editable = true
	h.setList(async () => ({ code: 0, data: [row], paging: { total: 1, pageSize: 20, hasMore: false, snapshot: 'changed', create_enabled: true } }))
	await h.view.loadRows(true)
	assert.equal(h.view.detailMap.value['i-refresh'], undefined)
	const refreshed = await h.view.ensureDetail(row)
	assert.equal(refreshed.row.editable, true)
})

test('detail fails closed on a missing or mismatched authority row and ignores stale responses', async () => {
	const row = { intake_id: 'i-authority', editable: false, removable: false }
	const h = await viewHarness({ detail: async () => ({ code: 0, data: { proof_images: [], allocation_targets: [], deposit_entries: [] } }) })
	assert.equal(await h.view.ensureDetail(row, true), null)
	assert.match(h.view.detailMap.value['i-authority'].error, /权威/)
	h.setDetail(async () => ({ code: 0, data: { row: { intake_id: 'i-other', editable: true }, proof_images: [], allocation_targets: [], deposit_entries: [] } }))
	assert.equal(await h.view.ensureDetail(row, true), null)
	assert.match(h.view.detailMap.value['i-authority'].error, /不一致/)

	const pending = deferred()
	h.setDetail(async () => pending.promise)
	const oldRequest = h.view.ensureDetail(row, true)
	h.setList(async () => ({ code: 0, data: [row], paging: { total: 1, pageSize: 20, hasMore: false, snapshot: 'new', create_enabled: true } }))
	await h.view.loadRows(true)
	pending.resolve({ code: 0, data: { row: { ...row, editable: false }, proof_images: [], allocation_targets: [], deposit_entries: [] } })
	assert.equal(await oldRequest, null)
	assert.equal(h.view.detailMap.value['i-authority'], undefined)
})

test('pagination failure rolls back cursor state and keeps the previous page rows', async () => {
	let calls = 0
	const row = { intake_id: 'i-page-1' }
	const h = await viewHarness({ list: async () => {
		calls += 1
		if (calls === 1) return { code: 0, data: [row], paging: { total: 21, pageSize: 20, hasMore: true, next_cursor: 'cursor-2', snapshot: 's1', create_enabled: true } }
		throw new Error('network down')
	} })
	await h.view.onNextPage()
	assert.equal(h.view.pager.page, 1)
	assert.equal(h.view.pager.cursor, '')
	assert.equal(h.view.pager.cursorStack.length, 0)
	assert.equal(h.view.rows.value[0].intake_id, 'i-page-1')
})

test('committed save unlocks before background list refresh and reports refresh failure as saved', async () => {
	let listCalls = 0
	const refresh = deferred()
	const h = await viewHarness({ list: async () => {
		listCalls += 1
		if (listCalls === 1) return { code: 0, data: [], paging: { total: 0, pageSize: 20, hasMore: false, snapshot: 's1', create_enabled: true } }
		return refresh.promise
	} })
	fillDraft(h.view)
	await h.view.previewCurrentOperation()
	await h.view.submitPreparedOperation(h.view.operation.value)
	assert.equal(h.view.operation.value, null)
	assert.equal(h.view.fieldsLocked.value, false)
	refresh.reject(new Error('refresh unavailable'))
	await settle()
	assert.match(h.toasts.at(-1).title, /操作已保存，但列表刷新失败/)
})

test('restored creates cannot confirm or retry while the server create gate is unknown or closed',async()=>{
 const h=await viewHarness();fillDraft(h.view);await h.view.previewCurrentOperation()
 const op=h.view.operation.value
 h.view.writeFeatureDisabled.value=true
 assert.equal(h.view.canConfirmPrepared.value,false)
 await h.view.submitPreparedOperation(op)
 assert.equal(h.saves.length,0)
 op.status='retryable';await h.view.retryPreparedOperation();assert.equal(h.saves.length,0)
 h.view.writeFeatureDisabled.value=false;h.view.createAvailabilityKnown.value=false
 await h.view.retryPreparedOperation();assert.equal(h.saves.length,0)
 h.view.createAvailabilityKnown.value=true;await h.view.retryPreparedOperation();assert.equal(h.saves.length,1)
})
test('incomplete committed replies remain unknown and durable instead of clearing the operation',async()=>{
 const h=await viewHarness({save:async input=>({code:0,data:{status:'committed',operation_id:input.operation_id}}),query:async()=>({code:0,data:{found:true,result:{status:'committed'}}})})
 fillDraft(h.view);await h.view.previewCurrentOperation();const op=h.view.operation.value
 await h.view.submitPreparedOperation(op)
 assert.equal(h.view.operation.value.status,'unknown');assert.equal(h.storage.size,1)
 op.status='saved';op.result={status:'committed',operation_id:op.operation_id,intake_id:'i1',version:0}
 h.view.persistOperation();h.view.restoreOperation()
 assert.equal(h.view.operation.value.status,'unknown');assert.equal(h.storage.size,1)
})
function editableDetail(id,patch={}) {return {code:0,data:{row:{intake_id:id,customer_id:'c1',customer_name:id,kind:'gas',purpose:'unspecified',amount:1,gas_amount:1,deposit_amount:0,money_scale:2,biz_date:'2026-09-20',payment_method:'cash',version:1,editable:true,removable:true,...patch},proof_images:['cloud://proof'],allocation_targets:[],deposit_entries:[]}}}
test('slower edit or void intent cannot overwrite the newest selected row',async()=>{
 const a=deferred(),b=deferred(),h=await viewHarness({detail:async({intake_id})=>intake_id==='a'?a.promise:b.promise})
 const first=h.view.onEdit({intake_id:'a'}),second=h.view.onEdit({intake_id:'b'})
 b.resolve(editableDetail('b'));await second;a.resolve(editableDetail('a'));await first
 assert.equal(h.view.editingIntakeId.value,'b')
 const c=deferred(),d=deferred();h.setDetail(async({intake_id})=>intake_id==='c'?c.promise:d.promise)
 const oldVoid=h.view.onBeginVoid({intake_id:'c'}),newEdit=h.view.onEdit({intake_id:'d'})
 d.resolve(editableDetail('d'));await newEdit;c.resolve(editableDetail('c'));await oldVoid
 assert.equal(h.view.editingIntakeId.value,'d');assert.equal(h.previews.length,0)
})
test('unknown historical channel and invalid purpose remain explicit and require a selection',async()=>{
 const h=await viewHarness({detail:async()=>editableDetail('legacy',{payment_method:'unknown',purpose:'corrupt-purpose'})})
 await h.view.onEdit({intake_id:'legacy'})
 assert.match(h.view.paymentMethodOptions[h.view.paymentMethodIndex.value].label,/待核/)
 assert.equal(h.view.purposeText('corrupt-purpose','gas'),'用途待核')
 h.view.form.reason='核对';await h.view.previewCurrentOperation();assert.equal(h.previews.length,0)
 h.view.form.paymentMethod='bank';await h.view.previewCurrentOperation();assert.equal(h.previews.length,0)
 assert.match(h.toasts.at(-1).title,/用途/)
 const exporter=await loadExporter()
 assert.throws(()=>exporter.buildCashierReceiptIntakeTotals([exportRow('bad-purpose',{purpose:'corrupt-purpose'})]),/用途待核/)
})
