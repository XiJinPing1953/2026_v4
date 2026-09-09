'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { run } = require('./importFillingsFromJson.cjs')
const {
	FILLING_OPERATION_VERSION,
	OPERATION_ID_PATTERN,
	frozenPayloadHash
} = require('./lib/fillingImportRecovery.cjs')

const quietLogger = { log() {} }

function makeStatus(operation) {
	const sourceRecord = operation.saved
		? {
			_id: operation.sourceRecordId,
			bottle_no: operation.data.bottle_no,
			saved: true,
			version_matches: true,
			consistency_status: operation.complete ? 'complete' : 'anomaly_pending'
		}
		: {
			_id: operation.sourceRecordId,
			bottle_no: operation.data.bottle_no,
			saved: false,
			version_matches: false,
			consistency_status: 'not_saved'
		}
	return {
		code: 0,
		msg: operation.status === 'failed' ? '提交已受理，处理遇到问题' : '提交已受理',
		data: {
			operation_id: operation.operationId,
			input_hash: operation.payloadHash,
			rule_version: FILLING_OPERATION_VERSION,
			status: operation.status,
			complete: operation.complete,
			accepted_total: 1,
			saved_total: operation.savedCursor,
			source_saved_total: operation.saved ? 1 : 0,
			source_records: [sourceRecord],
			last_error: operation.lastError || ''
		}
	}
}

function createControlledTransport(resolveMode) {
	const operations = new Map()
	const calls = []
	let createdBusinessTotal = 0
	return {
		operations,
		calls,
		get createdBusinessTotal() { return createdBusinessTotal },
		async callFunction(name, event) {
			calls.push({ name, action: event && event.action, operation_id: event?.data?.operation_id || '' })
			assert.equal(name, 'crm-filling')
			if (event.action === 'capabilitiesV1') {
				return { code: 0, data: {
					rule_version: FILLING_OPERATION_VERSION,
					durable_operations: true,
					source_status_query: true,
					source_payload_hash: true
				} }
			}
			if (event.action === 'listV1') return { code: 0, data: [], paging: { hasMore: false } }
			if (event.action === 'getOperationV1') {
				const operation = operations.get(event.data.operation_id)
				return operation ? makeStatus(operation) : { code: 404, msg: 'not found' }
			}
			if (event.action === 'retryOperationV1') {
				const operation = operations.get(event.data.operation_id)
				if (!operation) return { code: 404, msg: 'not found' }
				operation.saved = true
				operation.savedCursor = 1
				operation.complete = true
				operation.status = 'complete'
				operation.lastError = ''
				return { code: 0, data: { complete: true } }
			}
			if (event.action !== 'createV1') throw new Error(`unexpected action ${event.action}`)

			const operationId = event.data.operation_id
			assert.match(operationId, OPERATION_ID_PATTERN)
			const payload = { ...event.data }
			delete payload.operation_id
			delete payload.ignore_bottle_flow_warning
			const payloadHash = frozenPayloadHash(payload)
			const previous = operations.get(operationId)
			if (previous) {
				if (previous.payloadHash !== payloadHash) return { code: 409, msg: 'same operation changed input' }
				return { code: 0, data: {
					operation_id: operationId,
					rule_version: FILLING_OPERATION_VERSION,
					complete: previous.complete
				} }
			}

			const mode = resolveMode(event.data)
			const operation = {
				operationId,
				payloadHash,
				data: payload,
				sourceRecordId: `fill_${operationId.slice(-16)}`,
				saved: mode !== 'pending_unsaved' && mode !== 'failed_unsaved',
				savedCursor: mode === 'ack_lost_after_save' ? 0 : (mode === 'pending_unsaved' || mode === 'failed_unsaved' ? 0 : 1),
				complete: mode === 'complete' || mode === 'ack_lost_after_save',
				status: mode.startsWith('failed') ? 'failed' : (mode === 'complete' || mode === 'ack_lost_after_save' ? 'complete' : 'pending'),
				lastError: mode.startsWith('failed') ? 'controlled downstream failure' : ''
			}
			operations.set(operationId, operation)
			createdBusinessTotal += 1
			if (mode === 'ack_lost_after_save') throw new Error('controlled response loss token=transport-secret')
			return {
				code: 0,
				msg: 'accepted',
				data: {
					operation_id: operationId,
					rule_version: FILLING_OPERATION_VERSION,
					complete: operation.complete
				}
			}
		}
	}
}

function createOldProtocolTransport() {
	const calls = []
	return {
		calls,
		async callFunction(name, event) {
			calls.push({ name, action: event.action })
			if (event.action === 'capabilitiesV1') {
				return { code: 0, data: { rule_version: 'old', durable_operations: false } }
			}
			throw new Error('must stop after capability probe')
		}
	}
}

function makeWorkspace(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filling-import-test-'))
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
	return {
		dir,
		inputPath: path.join(dir, 'input.json'),
		reportPath: path.join(dir, 'report.json')
	}
}

function writeRows(inputPath, rows) {
	fs.writeFileSync(inputPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
}

function argvFor({ inputPath, reportPath, execute = true, token = 'crm-token-should-never-be-in-report' }) {
	return [
		'node',
		'scripts/importFillingsFromJson.cjs',
		'--input', inputPath,
		'--report', reportPath,
		'--space-id', 'isolated-test-space',
		'--crm-token', token,
		'--concurrency', '1',
		...(execute ? ['--execute'] : [])
	]
}

const row = (overrides = {}) => ({
	_id: 'legacy-fill-1',
	date: '2026-01-02',
	bottle_no: 'B001',
	record_type: 'normal_fill',
	operator: 'tester',
	fill_weight: 10,
	remark: 'legacy import',
	...overrides
})

test('actual import entry recovers a lost create response, reuses the operation, and rejects changed source input', async (t) => {
	const workspace = makeWorkspace(t)
	const transport = createControlledTransport(() => 'ack_lost_after_save')
	writeRows(workspace.inputPath, [row()])

	const first = await run({
		argv: argvFor(workspace),
		client: transport,
		logger: quietLogger
	})
	assert.equal(first.accepted_total, 1)
	assert.equal(first.saved_total, 1)
	assert.equal(first.success_total, 1)
	assert.equal(first.completed_total, 1)
	assert.equal(first.confirmation_required_total, 0)
	assert.equal(transport.createdBusinessTotal, 1)
	const operationId = first.operation_records[0].operation_id
	assert.equal(first.operation_records[0].source_record_id.startsWith('fill_'), true)
	assert.match(first.operation_records[0].recovery_note, /原 operation_id/)

	const second = await run({
		argv: argvFor(workspace),
		client: transport,
		logger: quietLogger
	})
	assert.equal(second.operation_records[0].operation_id, operationId)
	assert.equal(second.completed_total, 1)
	assert.equal(transport.createdBusinessTotal, 1)
	assert.equal(transport.calls.filter((call) => call.action === 'createV1').length, 1)

	writeRows(workspace.inputPath, [row({ fill_weight: 11 })])
	const changed = await run({
		argv: argvFor(workspace),
		client: transport,
		logger: quietLogger
	})
	assert.equal(changed.conflict_total, 1)
	assert.match(changed.operation_records[0].message, /实质变化/)
	assert.equal(changed.operation_records[0].operation_id, operationId)
	assert.equal(transport.createdBusinessTotal, 1)

	const persisted = fs.readFileSync(workspace.reportPath, 'utf8')
	const recoveryLog = fs.readFileSync(`${workspace.reportPath}.recovery.ndjson`, 'utf8')
	assert.equal(persisted.includes('crm-token-should-never-be-in-report'), false)
	assert.equal(persisted.includes('transport-secret'), false)
	assert.equal(recoveryLog.includes('crm-token-should-never-be-in-report'), false)
	assert.equal(recoveryLog.includes('transport-secret'), false)
})

test('code zero without a saved source id remains accepted and pending instead of successful', async (t) => {
	const workspace = makeWorkspace(t)
	const transport = createControlledTransport(() => 'pending_unsaved')
	writeRows(workspace.inputPath, [row({ _id: undefined })])

	const report = await run({ argv: argvFor(workspace), client: transport, logger: quietLogger })
	assert.equal(report.accepted_total, 1)
	assert.equal(report.saved_total, 0)
	assert.equal(report.success_total, 0)
	assert.equal(report.completed_total, 0)
	assert.equal(report.pending_save_total, 1)
	assert.equal(report.processing_total, 1)
	assert.equal(report.operation_records[0].state, 'accepted_pending_save')
	assert.equal(report.operation_records[0].source_id, '')
	assert.equal(report.operation_records[0].source_record_id, '')
})

test('saved failure and fully completed operation are reported on separate status axes', async (t) => {
	const workspace = makeWorkspace(t)
	const transport = createControlledTransport((data) => data.bottle_no === 'B-FAIL' ? 'failed_saved' : 'complete')
	writeRows(workspace.inputPath, [
		row({ _id: 'legacy-complete', bottle_no: 'B-COMPLETE' }),
		row({ _id: 'legacy-failed', bottle_no: 'B-FAIL', fill_weight: 12 })
	])

	const report = await run({ argv: argvFor(workspace), client: transport, logger: quietLogger })
	assert.equal(report.accepted_total, 2)
	assert.equal(report.saved_total, 2)
	assert.equal(report.completed_total, 1)
	assert.equal(report.operation_failed_total, 1)
	assert.equal(report.failed_total, 1)
	const failed = report.operation_records.find((record) => record.operation_status === 'failed')
	assert.equal(failed.source_saved, true)
	assert.equal(failed.post_processing_complete, false)
	assert.match(failed.message, /controlled downstream failure/)
})

test('dry-run performs no create or retry write and does not freeze an attempted operation', async (t) => {
	const workspace = makeWorkspace(t)
	const transport = createControlledTransport(() => 'complete')
	writeRows(workspace.inputPath, [row()])

	const report = await run({
		argv: argvFor({ ...workspace, execute: false }),
		client: transport,
		logger: quietLogger
	})
	assert.equal(report.mode, 'dry-run')
	assert.equal(report.target_total, 1)
	assert.equal(report.operation_records[0].dispatched, false)
	assert.deepEqual(
		transport.calls.filter((call) => ['createV1', 'retryOperationV1', 'updateV1', 'removeV1'].includes(call.action)),
		[]
	)
	assert.equal(transport.createdBusinessTotal, 0)
	assert.equal(fs.existsSync(`${workspace.reportPath}.recovery.ndjson`), false)
})

test('existing date/bottle signature is still skipped and never converted into an implicit update', async (t) => {
	const workspace = makeWorkspace(t)
	const transport = createControlledTransport(() => 'complete')
	const originalCall = transport.callFunction.bind(transport)
	transport.callFunction = async (name, event) => {
		if (event.action === 'listV1' && event.data.record_type === 'normal_fill') {
			transport.calls.push({ name, action: event.action, operation_id: '' })
			return { code: 0, data: [{
				date: '2026-01-02',
				bottle_no: 'B001',
				record_type: 'normal_fill',
				operator: 'tester',
				fill_weight: 10,
				remark: 'legacy import'
			}], paging: { hasMore: false } }
		}
		return originalCall(name, event)
	}
	writeRows(workspace.inputPath, [row()])

	const report = await run({ argv: argvFor(workspace), client: transport, logger: quietLogger })
	assert.equal(report.already_exists_total, 1)
	assert.equal(report.target_total, 0)
	assert.equal(report.operation_records[0].state, 'already_exists')
	assert.equal(transport.createdBusinessTotal, 0)
	assert.deepEqual(
		transport.calls.filter((call) => ['createV1', 'updateV1'].includes(call.action)),
		[]
	)
})

test('execute stops before any business write when the durable source-query protocol is absent', async (t) => {
	const workspace = makeWorkspace(t)
	const transport = createOldProtocolTransport()
	writeRows(workspace.inputPath, [row()])

	await assert.rejects(
		run({ argv: argvFor(workspace), client: transport, logger: quietLogger }),
		/不具备所需的可恢复保存协议/
	)
	assert.deepEqual(transport.calls.map((call) => call.action), ['capabilitiesV1'])
})

test('rerun retries a failed existing operation with the same id and confirms its source without another create', async (t) => {
	const workspace = makeWorkspace(t)
	const transport = createControlledTransport(() => 'failed_saved')
	writeRows(workspace.inputPath, [row()])
	const first = await run({ argv: argvFor(workspace), client: transport, logger: quietLogger })
	assert.equal(first.operation_failed_total, 1)
	const originalId = first.operation_records[0].operation_id
	const second = await run({ argv: argvFor(workspace), client: transport, logger: quietLogger })
	assert.equal(second.completed_total, 1)
	assert.equal(second.operation_failed_total, 0)
	assert.equal(second.operation_records[0].operation_id, originalId)
	assert.deepEqual(transport.calls.filter((call) => call.action === 'retryOperationV1').map((call) => call.operation_id), [originalId])
	assert.equal(transport.calls.filter((call) => call.action === 'createV1').length, 1)
	assert.equal(transport.createdBusinessTotal, 1)
})

test('actual importer and filling handler recover failed downstream work even when retry acknowledgement is lost', async (t) => {
	const { makeApp } = require('./lib/pdaCompletionHarness.cjs')
	let scanBlocked = true
	const app = makeApp({ scan: async () => scanBlocked
		? { code: 409, msg: 'controlled source check failure' }
		: { code: 0, data: { done: true, read_complete: true, rule_version: 'bottle-flow-2026-09-05-v1' } }
	})
	const workspace = makeWorkspace(t)
	writeRows(workspace.inputPath, [row({ date: '2026-09-08', bottle_no: 'B1', operator: 'operator' })])
	const calls = []
	const client = { async callFunction(name, event) {
		assert.equal(name, 'crm-filling')
		calls.push(event.action)
		const result = await app.filling(event.action, event.data, event.token)
		if (event.action === 'retryOperationV1') throw new Error('controlled retry acknowledgement loss')
		return result
	} }
	const argv = argvFor({ ...workspace, token: 'good' })
	const first = await run({ argv, client, logger: quietLogger })
	assert.equal(first.operation_failed_total, 1)
	assert.equal(first.saved_total, 1)
	const sourceId = first.operation_records[0].source_record_id
	const operationId = first.operation_records[0].operation_id
	scanBlocked = false
	const recovered = await run({ argv, client, logger: quietLogger })
	assert.equal(recovered.completed_total, 1)
	assert.equal(recovered.operation_records[0].operation_id, operationId)
	assert.equal(recovered.operation_records[0].source_record_id, sourceId)
	assert.equal(recovered.confirmation_required_total, 0)
	const again = await run({ argv, client, logger: quietLogger })
	assert.equal(again.completed_total, 1)
	assert.equal(calls.filter((action) => action === 'createV1').length, 1)
	assert.equal(calls.filter((action) => action === 'retryOperationV1').length, 1)
	for (const name of ['crm_fillings', 'crm_bottle_movements', 'crm_gas_inventory_movements', 'crm_filling_operations']) {
		assert.equal(app.db.data(name).size, 1, name)
	}
})

test('import recovery rejects another payload occupying the frozen operation id', async (t) => {
	const { makeApp } = require('./lib/pdaCompletionHarness.cjs')
	const app = makeApp()
	const workspace = makeWorkspace(t)
	writeRows(workspace.inputPath, [row({ date: '2026-09-08', bottle_no: 'B1', operator: 'operator' })])
	const calls = []
	const client = { async callFunction(name, event) {
		calls.push(event.action)
		if (event.action === 'createV1') throw new Error('controlled failure before acceptance')
		return app.filling(event.action, event.data, event.token)
	} }
	const argv = argvFor({ ...workspace, token: 'good' })
	const first = await run({ argv, client, logger: quietLogger })
	assert.equal(first.confirmation_required_total, 1)
	const record = first.operation_records[0]
	const unrelated = await app.filling('createV1', { ...record.frozen_payload, operation_id: record.operation_id, fill_weight: 99 })
	assert.equal(unrelated.code, 0)
	const recovered = await run({ argv, client, logger: quietLogger })
	assert.equal(recovered.saved_total, 0)
	assert.equal(recovered.completed_total, 0)
	assert.equal(recovered.confirmation_required_total, 1)
	assert.match(recovered.operation_records[0].message, /摘要/)
	assert.equal(calls.filter((action) => action === 'retryOperationV1').length, 0)
	assert.equal(app.db.data('crm_fillings').size, 1)
	assert.equal([...app.db.data('crm_fillings').values()][0].fill_weight, 99)
})
