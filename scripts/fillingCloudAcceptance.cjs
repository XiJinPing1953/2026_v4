'use strict'

// Default is an offline plan. This tool has no business-write or deployment method.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { VERSION, operationKey } = require('../uniCloud-alipay/cloudfunctions/crm-filling/fillingOperations')
const { readComplete } = require('../uniCloud-alipay/cloudfunctions/crm-filling/financialReadLocal')
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

function buildFixture(run = '20260908A') {
	if (!/^[A-Z0-9]{6,16}$/.test(run)) throw new Error('run 必须是 6–16 位大写字母或数字')
	const prefix = `SYNFILL${run}`
	const operationId = `acceptance_${run}_batch53`
	const bottles = []; const movements = []
	for (let index = 0; index < 53; index++) {
		const bottleNo = `${prefix}${String(index + 1).padStart(3, '0')}`
		bottles.push({ _id: `${prefix}_b${index}`, bottle_no: bottleNo, is_active: true, status: 'empty' })
		// 32 valid fill → out → back cycles, then neutral events: total 5,189.
		for (let event = 0; event < (index < 48 ? 98 : 97); event++) {
			const type = event < 96 ? ['fill', 'out', 'back'][event % 3] : 'adjust'
			const eventAt = Date.parse('2025-01-01T00:00:00Z') + event * 86400000
			const day = new Date(eventAt).toISOString().slice(0, 10)
			movements.push({ _id: `${prefix}_h${index}_${String(event).padStart(3, '0')}`, bottle_no: bottleNo,
				type, type_order: { back: 10, fill: 20, out: 30, adjust: 40 }[type], date: day, event_day: day,
				event_at: eventAt, created_at: eventAt, source_type: 'manual', source_id: `${prefix}_history`, net_weight: 10 })
		}
	}
	const input = { operation_id: operationId, date: '2026-09-05', record_type: 'normal_fill', input_mode: 'net',
		operator: 'SYNTHETIC ACCEPTANCE', batch_text: bottles.map((row) => `${row.bottle_no} 10`).join('\n') }
	return { run, prefix, operation_id: operationId, input, collections: { crm_bottles: bottles, crm_bottle_movements: movements } }
}

function buildPlan(fixture) {
	return { mode: 'offline_dry_run', provider: 'alipay', required_space: 'explicit isolated non-production space',
		rule_version: VERSION, operation_id: fixture.operation_id, fixture_sha256: hash(fixture.collections),
		expected: { bottles: 53, historical_events: 5189, source_rows: 53, filling_movements: 53, gas_movements: 53, open_anomalies: 0 },
		steps: [
			'主任务先核实隔离支付宝空间、schema/index、权限及禁止监管对外发送的测试配置。',
			'按精确 ID 预检无冲突，保存空间快照；导入本文件生成的合成对象，不导入生产瓶。',
			'用真实 batchCreateV1 预览及同 operation_id 提交；并发和超时重试仍使用原 input。',
			'通过隔离环境故障注入在第 6 个核查后终止；等待真实调度恢复 47 个，回读所有源单/流转数量。',
			'运行本工具的 read-only 检查。随后单独演练事务回滚、陈旧源版本、过期租约、权限与单条监管事件/快照入队。',
			'暂停隔离触发器和写者，确认没有运行任务；导出证据后只按本次精确对象清单清理，或销毁隔离空间。'
		], recovery: { preferred: 'snapshot and disposable isolated space', exact_scope: {
			bottle_ids: fixture.collections.crm_bottles.map((row) => row._id),
			bottle_nos: fixture.collections.crm_bottles.map((row) => row.bottle_no),
			operation_key: operationKey(fixture.operation_id), source_ids: Array.from({ length: 53 }, (_, index) =>
				`fill_${crypto.createHash('sha256').update(`${fixture.operation_id}:${index}`).digest('hex').slice(0, 40)}`)
		} }, unproven_by_this_tool: ['real rollback/conflict semantics', 'timer context and scheduling', 'PDA task completion', 'regulatory transport', 'other writers'] }
}

async function inspectCloud({ adapter, spaceId, fixture }) {
	if (!spaceId || spaceId === 'env-00jxuffegf2n') throw new Error('仅允许显式指定的隔离测试空间，禁止已知生产空间')
	// Verify identity before any cloud call. Adapter is supplied locally by the release owner.
	if (adapter.provider !== 'alipay' || adapter.spaceId !== spaceId || adapter.isolated !== true) throw new Error('adapter 环境声明与显式隔离空间不匹配')
	const capabilities = await adapter.call('crm-filling', { action: 'capabilitiesV1' })
	if (capabilities.code !== 0 || capabilities.data?.rule_version !== VERSION) throw new Error('云端灌装版本不匹配')
	const operation = await adapter.call('crm-filling', { action: 'getOperationV1', data: { operation_id: fixture.operation_id } })
	if (operation.code !== 0) throw new Error(`合成操作查询失败：${operation.code}`)
	const status = operation.data || {}
	const sourceIds = buildPlan(fixture).recovery.exact_scope.source_ids
	const bottleNos = fixture.collections.crm_bottles.map((row) => row.bottle_no)
	const db = adapter.db; const command = db.command
	const sources = await readComplete(db.collection('crm_fillings'), { _id: command.in(sourceIds) }, { command })
	const history = await readComplete(db.collection('crm_bottle_movements'), { bottle_no: command.in(bottleNos) }, { command })
	const gas = await readComplete(db.collection('crm_gas_inventory_movements'), { source_id: command.in(sourceIds) }, { command })
	const anomalies = await readComplete(db.collection('crm_bottle_anomalies'), { bottle_no: command.in(bottleNos), status: 'open' }, { command })
	const fills = history.filter((row) => row.source_type === 'filling' && sourceIds.includes(row.source_id))
	const historyById = new Map(history.map((row) => [row._id, row]))
	const checks = {
		complete: status.complete === true && status.processed_total === 53 && status.remaining_total === 0,
		sources: sources.length === 53 && sources.every((row) => row.operation_id === fixture.operation_id && row.source_version === 1 && row.consistency_status === 'complete'),
		history: history.length === 5242 && fixture.collections.crm_bottle_movements.every((expected) => {
			const actual = historyById.get(expected._id)
			return actual && Object.keys(expected).every((key) => actual[key] === expected[key])
		}),
		fill_movements: fills.length === 53 && new Set(fills.map((row) => row.source_id)).size === 53,
		gas_movements: gas.length === 53 && new Set(gas.map((row) => row.source_id)).size === 53,
		no_false_anomalies: anomalies.length === 0
	}
	return { mode: 'read_only', provider: adapter.provider, space_id: spaceId, checked_at: new Date().toISOString(),
		operation_id: fixture.operation_id, rule_version: capabilities.data.rule_version, checks, passed: Object.values(checks).every(Boolean),
		counts: { sources: sources.length, history: history.length, filling_movements: fills.length, gas_movements: gas.length, open_anomalies: anomalies.length },
		evidence_sha256: hash({ sources, history, gas, anomalies }), last_transaction_ms: status.last_transaction_ms ?? null,
		limits: 'Read-only synthetic final state; not proof of transactions, scheduling, concurrency, PDA or regulator delivery.' }
}

async function main(args) {
	const options = {}
	for (let index = 0; index < args.length; index++) {
		const key = args[index]
		if (!['--run', '--space-id', '--adapter', '--fixture-out'].includes(key)) throw new Error(`未知选项 ${key}`)
		if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`缺少 ${key} 参数`)
		options[key] = args[++index]
	}
	const fixture = buildFixture(options['--run'])
	if (options['--fixture-out']) fs.writeFileSync(path.resolve(options['--fixture-out']), JSON.stringify(fixture, null, 2) + '\n', { flag: 'wx' })
	if (!options['--adapter']) return buildPlan(fixture)
	if (!options['--space-id'] || options['--space-id'] === 'env-00jxuffegf2n') throw new Error('加载 adapter 前必须指定非生产隔离空间')
	const adapter = require(path.resolve(options['--adapter']))
	return inspectCloud({ adapter, spaceId: options['--space-id'], fixture })
}

module.exports = { buildFixture, buildPlan, inspectCloud }
if (require.main === module) main(process.argv.slice(2)).then((result) => {
	console.log(JSON.stringify(result, null, 2)); if (result.passed === false) process.exitCode = 1
}).catch((error) => { console.error(error.message); process.exitCode = 1 })
