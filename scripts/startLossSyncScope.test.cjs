'use strict'

// Real crm-filling start-loss code (vm-loaded) against an in-memory database:
// atomic/idempotent per-filling replacement, legacy completion/truncation flags,
// and date-bounded jobs producing the same derived adjustments as a full sync.
const test = require('node:test')
const assert = require('node:assert/strict')
const { createFakeDb } = require('./fakeCloudDb.cjs')
const { loadCrmFilling } = require('./loadCrmFillingInternals.cjs')
const { auditBottle } = require('./lib/startLossAudit.cjs')

const REASON = 'filling_start_weight_loss'
const user = { _id: 'u1', token: 'tok', role: 'superadmin', username: 'tester' }

// One bottle cycle every 3 days from 2026-01-01: sale return (gross) then filling.
function seed(fake, { bottles = ['25'], from = '2026-01-01', to = '2026-11-12', every = 3 } = {}) {
	fake.table('crm_users').push({ ...user })
	const sales = fake.table('crm_sale_records')
	const movements = fake.table('crm_bottle_movements')
	const fillings = fake.table('crm_fillings')
	let i = 0
	for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += every * 86400000) {
		const day = new Date(t).toISOString().slice(0, 10)
		for (const bottle of bottles) {
			i += 1
			const back = 120 + (i % 7) * 0.5
			sales.push({ _id: `s${bottle}_${i}`, date: day, updated_at: i, created_at: i, back_items: [{ bottle_no: bottle, gross: back }] })
			movements.push({ _id: `m${bottle}_${i}`, type: 'back', source_type: 'sale', source_id: `s${bottle}_${i}`, bottle_no: bottle,
				date: day, updated_at: i, created_at: i })
			// every 5th filling has zero start loss (no adjustment expected)
			const start = i % 5 === 0 ? back : back - 1.5
			fillings.push({ _id: `f${bottle}_${String(i).padStart(5, '0')}`, bottle_no: bottle, date: day, record_type: 'normal_fill',
				weight_start: start, weight_end: start + 48, fill_weight: 48, created_at: 1e6 + i })
		}
	}
}

const adjustments = (fake) => fake.table('crm_bottle_movements').filter((r) => r.adjust_reason === REASON)
const snapshot = (fake) => adjustments(fake)
	.map((r) => `${r.source_id}|${r.loss_weight}|${r.context.basis_ref}|${r.context.basis_value}|${r.note}`).sort()
const fresh = (opts) => { const fake = createFakeDb(); seed(fake, opts); return { fake, fn: loadCrmFilling(fake.db) } }
const call = (fn, action, data) => fn.main({ action, token: 'tok', data, request_id: 'r' }, {})

async function runJob(fn, data, maxCalls = 500) {
	let res
	for (let i = 0; i < maxCalls; i += 1) {
		res = await call(fn, 'syncStartLossJobV1', { max_ms: 6000, ...data })
		assert.equal(res.code, 0, JSON.stringify(res))
		if (!['partial', 'busy'].includes(res.data.completion)) return { res, calls: i + 1 }
	}
	throw new Error('job did not finish')
}

function addReturn(fake, { id, bottle = '25', date, gross }) {
	fake.table('crm_sale_records').push({ _id: id, date, updated_at: 9e9, created_at: 9e9, back_items: [{ bottle_no: bottle, gross }] })
	fake.table('crm_bottle_movements').push({ _id: `m_${id}`, type: 'back', source_type: 'sale', source_id: id, bottle_no: bottle,
		date, updated_at: 9e9, created_at: 9e9 })
}

test('重复执行不产生写入：派生流水未变化时零写入', async () => {
	const { fake, fn } = fresh()
	assert.equal((await call(fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25'] })).data.completion, 'complete')
	const before = snapshot(fake)
	const writes = fake.stats.writes
	const again = await call(fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25'] })
	assert.equal(again.data.adjust_removed_total, 0)
	assert.equal(again.data.adjust_created_total, 0)
	assert.equal(again.data.adjust_unchanged_total, again.data.scanned_total)
	assert.deepEqual(snapshot(fake), before)
	assert.equal(fake.stats.writes - writes, 1, 'only the operation log is written')
})

test('回瓶销售改到灌装日之后：旧/分批接口均回退或删除，流水尚未同步也不能选未来依据', async (t) => {
	for (const hasEarlierReturn of [true, false]) {
		for (const movementUpdated of [true, false]) {
			for (const resumable of [true, false]) {
				await t.test(`${hasEarlierReturn ? '回退到旧回瓶' : '无依据删除'} / 流水${movementUpdated ? '已' : '未'}更新 / ${resumable ? '分批' : '旧'}接口`, async () => {
					const fake = createFakeDb(), fn = loadCrmFilling(fake.db)
					fake.table('crm_users').push({ ...user })
					const filling = { _id: 'date-fill', bottle_no: '25', date: '2026-11-12', record_type: 'normal_fill',
						weight_start: 120, weight_end: 170, fill_weight: 50, created_at: 1000, updated_at: 1000 }
					fake.table('crm_fillings').push(filling)
					for (const [id, date, gross, stamp] of [
						...(hasEarlierReturn ? [['older', '2026-11-11', 125, 1]] : []),
						['newer', '2026-11-12', 130, 2]
					]) {
						fake.table('crm_sale_records').push({ _id: id, date, created_at: stamp, updated_at: stamp, back_items: [{ bottle_no: '25', gross }] })
						fake.table('crm_bottle_movements').push({ _id: `m_${id}`, date, type: 'back', source_type: 'sale', source_id: id,
							bottle_no: '25', created_at: stamp, updated_at: stamp })
					}
					await fn.replaceFillingStartLossAdjustmentForDoc(filling, user)
					assert.equal(adjustments(fake)[0].loss_weight, 10)
					await fake.db.collection('crm_sale_records').doc('newer').update({ date: '2026-11-13', updated_at: 3 })
					if (movementUpdated) await fake.db.collection('crm_bottle_movements').doc('m_newer').update({ date: '2026-11-13', updated_at: 3 })
					const res = resumable
						? (await runJob(fn, { job_key: 'wsl_date_eligibility_test', bottle_nos: ['25'], date_from: filling.date })).res
						: await call(fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25'], date_from: filling.date })
					assert.equal(res.code, 0)
					assert.equal(res.data.completion, hasEarlierReturn ? 'complete' : 'complete_with_review')
					assert.equal(adjustments(fake).length, hasEarlierReturn ? 1 : 0)
					if (hasEarlierReturn) {
						assert.equal(adjustments(fake)[0].loss_weight, 5)
						assert.equal(adjustments(fake)[0].context.basis_ref, 'older')
					}
					const audit = auditBottle({ bottleNo: '25', fillings: fake.table('crm_fillings'), movements: fake.table('crm_bottle_movements'),
						salesById: new Map(fake.table('crm_sale_records').map(row => [row._id, row])) })
					assert.equal(audit.rows[0].class, hasEarlierReturn ? 'ok' : 'no_basis', 'independent audit uses the current sale date too')
					assert.equal(audit.issues.movement_date_differs.length, movementUpdated ? 0 : 1)
				})
			}
		}
	}
})

test('派生流水版本字段损坏：以事务内当前灌装为准，允许修正错误流水', async () => {
	const { fake, fn } = fresh({ from: '2026-11-12' })
	const filling = fake.table('crm_fillings')[0]
	await fn.replaceFillingStartLossAdjustmentForDoc(filling, user)
	const expected = adjustments(fake)[0].loss_weight
	adjustments(fake)[0].context.filling_generation = filling.created_at + 99999
	adjustments(fake)[0].loss_weight = 999
	const result = await fn.replaceFillingStartLossAdjustmentForDoc(filling, user)
	assert.equal(result.stale, undefined)
	assert.equal(adjustments(fake).length, 1)
	assert.equal(adjustments(fake)[0].loss_weight, expected)
	assert.equal(adjustments(fake)[0].context.filling_generation, filling.created_at)
})

test('旧灌装缺少版本号：源单更新后，旧请求仍不能覆盖或删除新上秤差', async (t) => {
	for (const oldStart of [120, 125]) await t.test(oldStart === 125 ? '旧请求算出零差' : '旧请求算出不同差值', async () => {
		const fake = createFakeDb(), fn = loadCrmFilling(fake.db)
		const original = { _id: 'old-unversioned', bottle_no: '25', date: '2026-11-12', record_type: 'normal_fill', weight_start: oldStart }
		fake.table('crm_fillings').push({ ...original })
		addReturn(fake, { id: 'return', date: original.date, gross: 125 })
		await fake.db.collection('crm_fillings').doc(original._id).update({ weight_start: 122, updated_at: 2 })
		await fn.replaceFillingStartLossAdjustmentForDoc({ ...original, weight_start: 122, updated_at: 2 }, user)
		assert.equal(adjustments(fake)[0].loss_weight, 3)
		const result = await fn.replaceFillingStartLossAdjustmentForDoc(original, user)
		assert.equal(result.stale, true)
		assert.equal(result.reason, 'filling_input_stale')
		assert.equal(adjustments(fake).length, 1)
		assert.equal(adjustments(fake)[0].loss_weight, 3)
	})
})

test('删除成功、创建失败：事务回滚保留原流水，重试后收敛', async () => {
	const { fake, fn } = fresh({ from: '2026-11-01' })
	await call(fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25'] })
	const target = adjustments(fake).at(-1)
	target._id = 'legacy_random_id' // written by the old code: remove + add path
	const filling = fake.table('crm_fillings').find((f) => f._id === target.source_id)
	filling.weight_start -= 2 // source change -> adjustment must be replaced
	fake.failures.push({ op: 'add', table: 'crm_bottle_movements', message: 'injected add failure' })
	await assert.rejects(fn.replaceFillingStartLossAdjustmentForDoc(filling, user), /injected add failure/)
	const kept = adjustments(fake).filter((r) => r.source_id === filling._id)
	assert.equal(kept.length, 1)
	assert.deepEqual(kept[0], target, 'the original adjustment is untouched after rollback')
	const ok = await fn.replaceFillingStartLossAdjustmentForDoc(filling, user)
	assert.equal(ok.write, 'replaced')
	const now = adjustments(fake).filter((r) => r.source_id === filling._id)
	assert.equal(now.length, 1)
	assert.equal(now[0].loss_weight, target.loss_weight + 2)
	assert.equal(now[0]._id, fn.startLossAdjustId(filling._id))
})

test('原地更新失败：事务回滚，原值保持', async () => {
	const { fake, fn } = fresh({ from: '2026-11-01' })
	await call(fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25'] })
	const target = structuredClone(adjustments(fake).at(-1))
	const filling = fake.table('crm_fillings').find((f) => f._id === target.source_id)
	filling.weight_start -= 2
	fake.failures.push({ op: 'update', table: 'crm_bottle_movements', message: 'injected update failure' })
	await assert.rejects(fn.replaceFillingStartLossAdjustmentForDoc(filling, user), /injected update failure/)
	assert.deepEqual(adjustments(fake).find((r) => r.source_id === filling._id), target)
	assert.equal((await fn.replaceFillingStartLossAdjustmentForDoc(filling, user)).write, 'replaced')
	assert.equal(adjustments(fake).find((r) => r.source_id === filling._id).loss_weight, target.loss_weight + 2)
})

test('提交失败（调用方超时类）同样不留下半成品', async () => {
	const { fake, fn } = fresh({ from: '2026-11-01' })
	const filling = fake.table('crm_fillings')[0]
	fake.failures.push({ op: 'commit', message: 'connection reset during commit' })
	await assert.rejects(fn.replaceFillingStartLossAdjustmentForDoc(filling, user), /connection reset/)
	assert.equal(adjustments(fake).length, 0)
	assert.equal((await fn.replaceFillingStartLossAdjustmentForDoc(filling, user)).write, 'created')
	assert.equal(adjustments(fake).length, 1)
})

test('并发处理同一灌装：最终仅一条正确流水，冲突方报错后重试为无变化', async () => {
	const { fake, fn } = fresh({ from: '2026-11-01' })
	const filling = fake.table('crm_fillings')[1]
	const results = await Promise.allSettled([
		fn.replaceFillingStartLossAdjustmentForDoc(filling, user),
		fn.replaceFillingStartLossAdjustmentForDoc(filling, user),
		fn.replaceFillingStartLossAdjustmentForDoc(filling, user)
	])
	assert.ok(results.some((r) => r.status === 'fulfilled'))
	assert.equal(adjustments(fake).filter((r) => r.source_id === filling._id).length, 1)
	for (const r of results.filter((x) => x.status === 'rejected')) assert.match(String(r.reason.message), /duplicate|并发|WriteConflict/)
	assert.equal((await fn.replaceFillingStartLossAdjustmentForDoc(filling, user)).write, 'unchanged')
})

test('原本已有重复、缺失与数值错误的流水：一次补算后逐条修正为唯一正确值', async () => {
	const good = fresh()
	await call(good.fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25'] })
	const expected = snapshot(good.fake)

	const { fake, fn } = fresh()
	await call(fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25'] })
	const rows = adjustments(fake)
	// legacy damage: duplicate with random id, a missing one, a wrong value, an orphan for a zero-diff filling
	fake.table('crm_bottle_movements').push({ ...rows[0], _id: 'legacy_dup_1' })
	fake.table('crm_bottle_movements').splice(fake.table('crm_bottle_movements').indexOf(rows[1]), 1)
	rows[2].loss_weight = 99
	const zero = fake.table('crm_fillings').find((f) => f._id.endsWith('_00005'))
	fake.table('crm_bottle_movements').push({ ...rows[3], _id: 'legacy_zero', source_id: zero._id })
	const res = await call(fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25'] })
	assert.equal(res.data.error_total, 0)
	assert.deepEqual(snapshot(fake), expected)
	const perFilling = {}
	for (const r of adjustments(fake)) perFilling[r.source_id] = (perFilling[r.source_id] || 0) + 1
	assert.ok(Object.values(perFilling).every((n) => n === 1))
	assert.equal(res.data.adjust_removed_total, 2, 'random-id duplicate + stale zero-diff adjustment')
	assert.equal(res.data.adjust_created_total, 1, 'the missing adjustment')
})

test('旧补算接口：单条异常不报完成；截断时如实标记 partial', async () => {
	const { fake, fn } = fresh({ from: '2026-10-01' })
	const total = fake.table('crm_fillings').length
	fake.failures.push({ op: 'get', table: 'crm_bottle_anomalies', message: 'transient read failure' })
	const failed = await call(fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25'] })
	assert.equal(failed.code, 0)
	assert.equal(failed.data.error_total, 1)
	assert.equal(failed.data.completion, 'error')
	assert.equal(failed.data.items[0].status, 'error')

	assert.equal((await call(fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25'], limit: total })).data.scan_truncated, false)
	const over = await call(fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25'], limit: total - 1 })
	assert.equal(over.data.scan_truncated, true)
	assert.equal(over.data.completion, 'partial')
	assert.equal(over.data.scanned_total, total - 1)
	const ids = fake.table('crm_fillings').map((f) => f._id)
	assert.equal((await call(fn, 'syncStartLossAdjustmentsV1', { filling_ids: ids, limit: ids.length })).data.scan_truncated, false)
	assert.equal((await call(fn, 'syncStartLossAdjustmentsV1', { filling_ids: ids, limit: 3 })).data.completion, 'partial')
})

test('按日期下界的分批任务与完整历史补算结果逐条一致（新增回瓶、修改销售日期、无法解析日期）', async (t) => {
	const cases = [
		{ name: '新增当日回瓶', apply: (fake) => addReturn(fake, { id: 'new1', date: '2026-11-10', gross: 131 }), dateFrom: '2026-11-10' },
		{ name: '改单把日期从 10-04 改到 11-10（下界取较早日期）', apply: (fake) => {
			const sale = fake.table('crm_sale_records').find((s) => s.date === '2026-10-04')
			sale.date = '2026-11-10'
			fake.table('crm_bottle_movements').find((m) => m.source_id === sale._id).date = '2026-11-10'
		}, dateFrom: '2026-10-04' },
		{ name: '日期无法解析：不设下界，分批完整补算', apply: (fake) => addReturn(fake, { id: 'new2', date: '2026-11-11', gross: 128 }), dateFrom: '' }
	]
	for (const c of cases) {
		await t.test(c.name, async () => {
			const full = fresh({ bottles: ['25', '26'] })
			const job = fresh({ bottles: ['25', '26'] })
			await call(full.fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25', '26'] })
			await call(job.fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25', '26'] })
			c.apply(full.fake); c.apply(job.fake)
			await call(full.fn, 'syncStartLossAdjustmentsV1', { bottle_nos: ['25', '26'] })
			job.fake.stats.readsByTable = {}
			const { res, calls } = await runJob(job.fn, { job_key: `wsl_case_${c.dateFrom || 'none'}_0001`, bottle_nos: ['25', '26'], date_from: c.dateFrom })
			assert.ok(['complete', 'complete_with_review'].includes(res.data.completion))
			assert.deepEqual(snapshot(job.fake), snapshot(full.fake))
			if (c.dateFrom) {
				const inScope = job.fake.table('crm_fillings').filter((f) => f.date >= c.dateFrom).length
				assert.equal(res.data.counts.scanned, inScope)
				assert.ok(job.fake.stats.readsByTable.crm_fillings <= inScope + 5, 'history before the bound is not read')
			} else {
				assert.equal(res.data.counts.scanned, job.fake.table('crm_fillings').length)
				assert.ok(calls >= 1)
			}
		})
	}
})

test('历史多、回瓶多：当日销售只处理当日及以后灌装，一次调用完成', async () => {
	const { fake, fn } = fresh({ bottles: ['1', '2', '3', '4', '5', '6', '7', '8'], every: 1 })
	assert.ok(fake.table('crm_fillings').length > 2500)
	for (const b of ['1', '2', '3', '4', '5', '6', '7', '8']) addReturn(fake, { id: `today_${b}`, bottle: b, date: '2026-11-12', gross: 125 })
	fake.stats.readsByTable = {}
	const { res, calls } = await runJob(fn, { job_key: 'wsl_many_bottles_00001', bottle_nos: ['1', '2', '3', '4', '5', '6', '7', '8'], date_from: '2026-11-12' })
	assert.equal(calls, 1)
	assert.equal(res.data.counts.scanned, 8)
	assert.ok(fake.stats.readsByTable.crm_fillings <= 8)
})
