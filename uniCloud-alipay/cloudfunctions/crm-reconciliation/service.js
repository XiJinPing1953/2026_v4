'use strict'
const crypto = require('crypto')
const { decodeSource, MAX_BYTES } = require('./source')
const core = require('./customerReconciliationLocal')
const VERSION = 'reconciliation-center/2026-10-13.1'
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const first = value => Array.isArray(value?.data) ? value.data[0] : value?.data
const fail = (condition, message, code = 409) => { if (!condition) throw Object.assign(Error(message), { code }) }
const text = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const id = value => { fail(/^[a-f0-9]{24}$/.test(value || ''), '记录编号无效', 400); return value }
const operation = value => { fail(/^[A-Za-z0-9_-]{8,80}$/.test(value || ''), '请保留有效操作号', 400); return value }
const independent = row => !row.settlement_customer_id || row.settlement_customer_id === row._id
const errorIssue = message => ({ type: 'evidence', code: 'read_incomplete', message })
const COL = { batches: 'crm_reconciliation_batches', sources: 'crm_reconciliation_sources', mappings: 'crm_reconciliation_mappings', results: 'crm_reconciliation_results', logs: 'crm_operation_logs' }
const sourceMeta = source => ({ source_id: source._id, name: source.name, sha256: source.sha256, bytes: source.bytes, kind: source.kind, accountant_code: source.accountant_code || '' })
const fields = ({ _id, ...rest }) => rest
const blocking = issue => issue.blocking !== false && issue.severity !== 'info'
const normalizeIssue = issue => ({ ...issue, type: ({ evidence_missing: 'evidence', amount_difference: 'amount',
  classification_difference: 'classification', suspected_duplicate: 'duplicate', cache_stale: 'evidence' })[issue.type] || issue.type })

function createService({ db, readComplete, invoke, parseSource = decodeSource, now = Date.now }) {
  const collection = key => db.collection(COL[key])
  const get = async (key, keyId) => first(await collection(key).where({ _id: keyId }).limit(1).get())
  const all = (key, where = {}, opts = {}) => readComplete(collection(key), where, { command: db.command, maxRows: 10000, source: `reconciliation.${key}`, ...opts })
  const inventory = () => readComplete(db.collection('crm_customers'), {}, { command: db.command, maxRows: 5000, source: 'reconciliation.customer_inventory',
    field: { _id: true, name: true, is_hidden: true, is_active: true, settlement_customer_id: true } })
  const mapping = async company => await get('mappings', digest(company).slice(0, 24)) || { _id: digest(company).slice(0, 24), company, version: 0, items: [] }
  async function transact(work) {
    const tx = await db.startTransaction()
    try { const result = await work(tx); await tx.commit(); return result } catch (error) { await tx.rollback().catch(() => {}); throw error }
  }
  async function addOnce(key, document) {
    const existing = await get(key, document._id)
    if (existing) return existing
    try { await collection(key).add(document); return document } catch (error) {
      const saved = await get(key, document._id); if (saved) return saved; throw error
    }
  }
  async function persistedMapping(company) {
    const current = await mapping(company)
    // Old batches may predate the empty mapping record. Initializing metadata
    // with its deterministic key is safe even if another caller wins the add.
    return addOnce('mappings', current)
  }
  async function loadBatch(batchId) {
    const batch = await get('batches', id(batchId)); fail(batch, '对账批次不存在', 404); return batch
  }
  async function requireCustomer(customerId) {
    const customer = first(await db.collection('crm_customers').doc(id(customerId)).get())
    fail(customer && independent(customer), '请选择独立结算客户'); return customer
  }
  async function loadDetails(batch) {
    return all('sources', { batch_id: batch._id, kind: 'detail' })
  }
  const latestDetails = rows => {
    const byCode = new Map()
    for (const row of [...rows].sort((a, b) => a.created_at - b.created_at || a._id.localeCompare(b._id))) byCode.set(row.accountant_code, row)
    return [...byCode.values()]
  }
  const resultId = (batchId, customerId) => digest([batchId, customerId]).slice(0, 24)
  const repairId = (customerId, operationId) => 'reconcile_repair_' + digest([id(customerId), operation(operationId)]).slice(0, 24)
  async function repairState(data) {
    const saved = await get('logs', repairId(data.customer_id, data.operation_id))
    if (!saved) return { operation_id: data.operation_id, status: 'not_prepared' }
    fail(saved.batch_id === data.batch_id, '操作号属于其他对账批次')
    const underlyingId = 'accounting_correction_' + digest({ customerId: data.customer_id, operationId: data.operation_id }).slice(0, 24)
    const underlying = await get('logs', underlyingId)
    const plan = underlying?.detail?.plan
    return { operation_id: data.operation_id, status: underlying?.status || (saved.preparation_status === 'rejected' ? 'rejected' : 'not_prepared'), rejection_reason: saved.rejection_reason || '', plan_hash: plan?.plan_hash,
      summary: plan?.summary, writes: plan?.writes || [], after_snapshot_hash: underlying?.after_snapshot_hash || null, verification: saved.verification || null }
  }
  async function checkCustomer(data, user) {
    const batch = await loadBatch(data.batch_id), customer = await requireCustomer(data.customer_id)
    const customers = await inventory(), mappings = await persistedMapping(batch.company), detailFiles = latestDetails(await loadDetails(batch))
    const ownMap = mappings.items.find(item => item.crm_customer_id === customer._id)
    const ownDetails = detailFiles.filter(row => ownMap?.accountant_codes.includes(row.accountant_code))
    let internal, ledger, cacheRefresh = null
    try {
      internal = await invoke('crm-customer-settlement', 'inspectReconciliationCustomerV1', { customer_id: customer._id })
      ledger = await invoke('crm-customer-settlement', 'exportCustomerAccountingLedgerV1', { customer_id: customer._id, date_from: batch.date_from, date_to: batch.cutoff })
      const after = await invoke('crm-customer-settlement', 'inspectReconciliationCustomerV1', { customer_id: customer._id })
      fail(internal.source_hash && internal.source_hash === after.source_hash, '读取期间原单发生变化，请重新核查')
      internal = after
      if (data.auto_refresh === true && internal.complete === true && !(internal.issues || []).some(blocking) && internal.cache?.stale) {
        cacheRefresh = await invoke('crm-customer-settlement', 'refreshReconciliationCacheV1', { customer_id: customer._id,
          expected_source_hash: internal.source_hash, operation_id: 'recon_' + digest([customer._id, internal.source_hash, internal.cache.before, internal.cache.expected]).slice(0, 40) })
        const refreshed = await invoke('crm-customer-settlement', 'inspectReconciliationCustomerV1', { customer_id: customer._id })
        fail(refreshed.source_hash === internal.source_hash, '刷新期间原始账务变化，须重新核查')
        internal = refreshed
        fail(cacheRefresh.verified === true && !internal.cache?.stale, '缓存刷新结果尚未验证，请按原操作号复查')
      }
    } catch (error) {
      internal = { ...internal, complete: false, issues: [...(internal?.issues || []), errorIssue(error.message)] }
      if (!ledger) ledger = { error: error.message }
    }
    fail((await mapping(batch.company)).version === mappings.version, '读取期间客户对应关系变化，请重新核查')
    fail(digest(latestDetails(await loadDetails(batch)).map(row => [row._id, row.sha256])) === digest(detailFiles.map(row => [row._id, row.sha256])), '读取期间明细资料变化，请重新核查')
    let compared
    try { compared = core.compareCustomer({ accounting: batch.accounting, customer, customers, ledger, mapping: mappings.items,
      details: ownDetails.map(row => ({ ...row.parsed, account_code: row.accountant_code })), internal }) }
    catch (error) { compared = { summary_match: false, detail_match: null, evidence_level: 'incomplete', issues: [errorIssue(error.message)], comparison: null } }
    compared.issues = (compared.issues || []).map(normalizeIssue)
    const resultHash = digest({ rule: VERSION, source_hash: internal.source_hash || null, mapping: ownMap || null,
      accounting: batch.source.sha256, details: ownDetails.map(row => row.sha256), compared: { ...compared, period_summary: undefined } })
    const keyId = resultId(batch._id, customer._id), previous = await get('results', keyId)
    const result = { _id: keyId, batch_id: batch._id, company: batch.company, customer_id: customer._id, customer_name: customer.name,
      ...compared, source_hash: internal.source_hash || '', result_hash: resultHash, checked_at: now(), rule_version: VERSION,
      mapping_version: mappings.version, details_revision: batch.details_revision || 0, detail_hash: digest(ownDetails.map(row => row.sha256)), stale: false,
      internal: { ...internal, sources: undefined }, cache_refresh: cacheRefresh,
      review: previous?.review ? { ...previous.review, valid: previous.review.kind === 'manual_approval' && previous.review.result_hash === resultHash && internal.complete === true } : null }
    const persistable = JSON.parse(JSON.stringify(result))
    const logId = 'reconcile_result_' + digest([keyId, resultHash]).slice(0, 24)
    const previousLog = !previous || previous.result_hash !== resultHash ? await get('logs', logId) : null
    await transact(async tx => {
      // Alipay transaction.doc.get throws for missing IDs. For absent records,
      // the deterministic add below provides the concurrent creation guard.
      const current = previous ? first(await tx.collection(COL.results).doc(keyId).get()) : null
      fail(digest(current || null) === digest(previous || null), '另一个核查已更新此客户，请刷新')
      const latestMap = first(await tx.collection(COL.mappings).doc(mappings._id).get())
      fail((latestMap?.version || 0) === mappings.version, '客户对应关系已变化')
      const latestBatch = first(await tx.collection(COL.batches).doc(batch._id).get())
      fail((latestBatch?.details_revision || 0) === (batch.details_revision || 0), '明细资料版本已变化，请重新核查')
      if (current) await tx.collection(COL.results).doc(keyId).update(fields(persistable))
      else await tx.collection(COL.results).add(persistable)
      if (!current || current.result_hash !== resultHash) {
        if (!previousLog) await tx.collection(COL.logs).add({ _id: logId, action: 'reconciliation_check',
          customer_id: customer._id, batch_id: batch._id, user_id: user._id, created_at: now(), detail: { previous_result_hash: current?.result_hash || '', result: persistable, ledger } })
      }
    })
    return persistable
  }
  async function requireFresh(data, user) {
    const result = await checkCustomer({ batch_id: data.batch_id, customer_id: data.customer_id, auto_refresh: false }, user)
    fail(result.result_hash === data.expected_result_hash, '账务或对账资料已变化，请查看最新核查结果后重新预览')
    return result
  }
  async function run(action, data, user) {
    if (action === 'contextV1') {
      const batches = await all('batches', {}, { maxRows: 5000 })
      return { customers: await inventory(), mappings: await mapping(text(data.company)), batches: batches.sort((a, b) => b.created_at - a.created_at).map(({ accounting, customer_inventory, ...row }) => row), max_file_bytes: MAX_BYTES }
    }
    if (action === 'importBatchV1') {
      operation(data.operation_id)
      const source = parseSource(data.source, 'summary'), company = text(data.company, 180), cutoff = text(data.cutoff, 10)
      fail(company && source.parsed.company === company, '账套名称与原始报表不一致，请核对编制单位', 400)
      const dateFrom = cutoff.slice(0, 4) + '-01-01'; core.validatePeriod(dateFrom, cutoff, source.parsed.month)
      const batchId = digest([company, cutoff, source.sha256]).slice(0, 24), operationId = 'reconcile_import_' + digest([user._id, data.operation_id]).slice(0, 24)
      const requestHash = digest([company, cutoff, source.sha256]), previous = await get('logs', operationId)
      fail(!previous || previous.request_hash === requestHash, '该操作号已用于其他文件或期间')
      const existing = await get('batches', batchId)
      if (existing) {
        await persistedMapping(company)
        const bound = await addOnce('logs', { _id: operationId, action: 'reconciliation_import', request_hash: requestHash, batch_id: batchId, created_at: now(), user_id: user._id })
        fail(bound.request_hash === requestHash, '该操作号已用于其他文件或期间')
        return { batch: { ...existing, accounting: undefined, customer_inventory: undefined }, reused: true }
      }
      const customers = await inventory(); core.validateCustomerInventory(customers, customers.length)
      const sourceId = digest([batchId, 'summary', source.sha256]).slice(0, 24), createdAt = now()
      const savedSource = { _id: sourceId, batch_id: batchId, company, kind: 'summary', ...source, created_at: createdAt, created_by: user._id }
      const batch = { _id: batchId, company, cutoff, date_from: dateFrom, created_at: createdAt, created_by: user._id,
        source: sourceMeta(savedSource), accounting: source.parsed, customer_inventory: customers, details_revision: 0, status: 'ready', rule_version: VERSION }
      const mappingId = digest(company).slice(0, 24), existingMapping = await get('mappings', mappingId)
      const operationLog = { _id: operationId, action: 'reconciliation_import', request_hash: requestHash, batch_id: batchId, created_at: createdAt, user_id: user._id }
      try { await transact(async tx => {
        const oldOp = previous ? first(await tx.collection(COL.logs).doc(operationId).get()) : null
        fail(!oldOp || oldOp.request_hash === requestHash, '操作号已被使用')
        if (!existingMapping) await tx.collection(COL.mappings).add({ _id: mappingId, company, version: 0, items: [] })
        // Absence was read outside the transaction. All three unique IDs are
        // created atomically; a racing import rolls back on duplicate add.
          await tx.collection(COL.sources).add(savedSource); await tx.collection(COL.batches).add(batch)
        if (!oldOp) await tx.collection(COL.logs).add(operationLog)
      }) } catch (error) {
        // A duplicate race or an unknown commit outcome can only reuse a fully
        // saved batch with the exact same original file and operation binding.
        const saved = await get('batches', batchId), savedOriginal = saved && await get('sources', sourceId)
        if (!saved || saved.company !== company || saved.cutoff !== cutoff || saved.source?.sha256 !== source.sha256 || savedOriginal?.sha256 !== source.sha256) throw error
        const bound = await addOnce('logs', operationLog)
        fail(bound.request_hash === requestHash && bound.batch_id === batchId, '该操作号已用于其他文件或期间')
        await persistedMapping(company)
        return { batch: { ...saved, accounting: undefined, customer_inventory: undefined }, reused: true }
      }
      return { batch: { ...batch, accounting: undefined, customer_inventory: undefined }, reused: false }
    }
    if (action === 'getBatchV1') {
      const batch = await loadBatch(data.batch_id), mappings = await mapping(batch.company), sources = latestDetails(await loadDetails(batch))
      const results = (await all('results', { batch_id: batch._id })).map(row => ({ ...row,
        // Saved evidence is a historical observation. A reopened screen must
        // recheck raw sources before presenting a current approval.
        stale: true, review: row.review ? { ...row.review, valid: false } : null }))
      const used = new Set(mappings.items.flatMap(row => row.accountant_codes))
      return { batch: { ...batch, accounting: undefined, customer_inventory: undefined }, accounts: batch.accounting.rows, customers: await inventory(), mappings, results,
        detail_sources: sources.map(sourceMeta), unmatched_accounts: batch.accounting.rows.filter(row => !used.has(row.code)) }
    }
    if (action === 'downloadSourceV1') {
      const source = await get('sources', id(data.source_id)); fail(source, '原始文件不存在', 404)
      return { ...sourceMeta(source), base64: source.base64 }
    }
    if (action === 'saveMappingV1') {
      const company = text(data.company, 180), customer = await requireCustomer(data.customer_id), basis = text(data.basis)
      fail(company && basis, '账套及确认依据必填', 400)
      const codes = [...new Set((Array.isArray(data.accountant_codes) ? data.accountant_codes : []).map(code => text(code, 80)))].sort()
      fail(Array.isArray(data.accountant_codes) && codes.every(Boolean), '请选择好会计科目或明确解除对应关系', 400)
      const old = await mapping(company); fail(old.version === data.expected_version, '对应关系已变化，请刷新')
      fail(!old.items.some(row => row.crm_customer_id !== customer._id && row.accountant_codes.some(code => codes.includes(code))), '同一科目不能分配给多个客户')
      const batches = await all('batches', { company }); fail(batches.some(batch => codes.every(code => batch.accounting.rows.some(row => row.code === code))), '科目必须来自该账套的已导入统计表')
      const stored = await persistedMapping(company)
      fail(stored.version === old.version, '对应关系已变化，请刷新')
      const updated = { ...old, version: old.version + 1, updated_at: now(), updated_by: user._id,
        items: [...old.items.filter(row => row.crm_customer_id !== customer._id), ...(codes.length ? [{ crm_customer_id: customer._id, accountant_codes: codes, basis }] : [])].sort((a, b) => a.crm_customer_id.localeCompare(b.crm_customer_id)) }
      await transact(async tx => {
        const current = first(await tx.collection(COL.mappings).doc(old._id).get()); fail((current?.version || 0) === old.version, '对应关系被其他人员修改')
        fail(current, '对应关系已移除，请刷新')
        await tx.collection(COL.mappings).doc(old._id).update(fields(updated))
        await tx.collection(COL.logs).add({ _id: 'reconcile_mapping_' + digest([old._id, updated.version]).slice(0, 24), action: 'reconciliation_mapping', user_id: user._id, created_at: now(), detail: { before: old, after: updated } })
      }); return updated
    }
    if (action === 'importDetailV1') {
      const batch = await loadBatch(data.batch_id), code = text(data.accountant_code, 80), source = parseSource(data.source, 'detail')
      fail(batch.accounting.rows.some(row => row.code === code), '科目不属于本批统计表', 400)
      fail(!source.parsed.account_code || source.parsed.account_code === code, '原文件科目编码与所选科目不一致', 400)
      const parsed = { ...source.parsed, account_code: source.parsed.account_code || code }
      core.validateAccountingDetails({ accounting: batch.accounting, details: [parsed], codes: [code], dateFrom: batch.date_from, cutoff: batch.cutoff })
      const sourceId = digest([batch._id, code, source.sha256]).slice(0, 24)
      const existing = await get('sources', sourceId)
      if (existing) return sourceMeta(existing)
      let saved
      try { saved = await transact(async tx => {
        const currentBatch = first(await tx.collection(COL.batches).doc(batch._id).get())
        fail(currentBatch, '对账批次不存在')
        const row = { _id: sourceId, ...source, parsed, company: batch.company, batch_id: batch._id,
          kind: 'detail', accountant_code: code, created_at: now(), created_by: user._id }
        await tx.collection(COL.sources).add(row)
        await tx.collection(COL.batches).doc(batch._id).update({ details_revision: (currentBatch.details_revision || 0) + 1 })
        return row
      }) } catch (error) {
        const concurrent = await get('sources', sourceId)
        if (!concurrent || concurrent.batch_id !== batch._id || concurrent.accountant_code !== code || concurrent.sha256 !== source.sha256) throw error
        saved = concurrent
      }
      return sourceMeta(saved)
    }
    if (action === 'checkCustomerV1') return checkCustomer(data, user)
    if (action === 'reviewCustomerV1') {
      fail(['manual_approval', 'accounting_followup'].includes(data.kind) && text(data.basis), '请填写核准或好会计处理依据', 400)
      const result = await requireFresh(data, user)
      if (data.kind === 'manual_approval') fail(result.summary_match && result.detail_match !== false && result.internal?.complete && !(result.issues || []).some(blocking), '仍有待核差异，不能标为人工核准')
      const review = { kind: data.kind, basis: text(data.basis), by: user._id, at: now(), result_hash: result.result_hash, evidence_level: result.evidence_level, valid: data.kind === 'manual_approval' }
      const fresh = await invoke('crm-customer-settlement', 'inspectReconciliationCustomerV1', { customer_id: result.customer_id })
      fail(fresh.source_hash && fresh.source_hash === result.source_hash, '核准前原始账务已变化，请重新核查')
      await transact(async tx => {
        const current = first(await tx.collection(COL.results).doc(result._id).get()); fail(current?.result_hash === result.result_hash, '核查结果已变化')
        const currentMap = first(await tx.collection(COL.mappings).doc(digest(result.company).slice(0, 24)).get())
        const currentBatch = first(await tx.collection(COL.batches).doc(result.batch_id).get())
        fail((currentMap?.version || 0) === result.mapping_version && (currentBatch?.details_revision || 0) === result.details_revision, '对应关系或明细版本已变化，请重新核查')
        await tx.collection(COL.results).doc(result._id).update({ review })
        await tx.collection(COL.logs).add({ _id: 'reconcile_review_' + digest([result._id, review]).slice(0, 24), action: 'reconciliation_review', customer_id: result.customer_id, batch_id: result.batch_id, user_id: user._id, created_at: review.at, detail: { previous: current.review || null, review } })
      }); return review
    }
    if (['repairSourcesV1', 'prepareRepairV1', 'executeRepairV1', 'repairStatusV1'].includes(action)) {
      fail(user.role === 'superadmin', '原始收款修正沿用超级管理员权限', 403)
      await loadBatch(data.batch_id); await requireCustomer(data.customer_id)
      if (action === 'repairSourcesV1') {
        const snapshot = await invoke('crm-accounting-correction', 'inspectV1', { customer_id: data.customer_id })
        return { snapshot_hash: snapshot.snapshot_hash, receipts: snapshot.tables.crm_customer_receipts, sales: snapshot.tables.crm_sale_records }
      }
      if (action === 'repairStatusV1') return repairState(data)
      const keyId = repairId(data.customer_id, data.operation_id), prior = await get('logs', keyId)
      if (action === 'prepareRepairV1') {
        fail(['correct_receipt_date', 'complete_receipt_backing'].includes(data.correction?.type) && text(data.basis), '请选择支持的修正类型并填写原始依据', 400)
        const requestHash = digest(data)
        fail(!prior || prior.request_hash === requestHash, '操作号已用于其他修复方案')
        if (prior) { const state = await repairState(data); if (state.status !== 'not_prepared') return state }
        const result = await requireFresh(data, user)
        const before = await invoke('crm-accounting-correction', 'inspectV1', { customer_id: data.customer_id })
        const request = { customer_id: data.customer_id, operation_id: data.operation_id, expected_snapshot_hash: before.snapshot_hash,
          evidence: { confirmed_by_user: true, approval_sha256: digest({ basis: text(data.basis), correction: data.correction, source_hash: result.source_hash }),
            source_sha256: digest({ version: VERSION, implementation: require('fs').readFileSync(__filename, 'utf8') }) }, corrections: [data.correction] }
        const prepared = prior || await addOnce('logs', { _id: keyId, action: 'reconciliation_repair', customer_id: data.customer_id, batch_id: data.batch_id,
          user_id: user._id, created_at: now(), request_hash: requestHash, expected_result_hash: result.result_hash, request, basis: text(data.basis) })
        fail(prepared.request_hash === requestHash, '操作号冲突')
        try { await invoke('crm-accounting-correction', 'prepareV1', prepared.request) }
        catch (error) {
          if ([400, 403, 409].includes(error.code) && (await repairState(data)).status === 'not_prepared') {
            await collection('logs').doc(keyId).update({ preparation_status: 'rejected', rejection_reason: error.message })
          }
          throw error
        }
        return repairState(data)
      }
      fail(prior, '请先预览修复', 404)
      let state = await repairState(data)
      fail(state.plan_hash === data.plan_hash, '计划版本不一致，请重新读取')
      if (state.status !== 'committed') {
        await requireFresh({ ...data, expected_result_hash: prior.expected_result_hash }, user)
        await invoke('crm-accounting-correction', 'rehearseV1', { customer_id: data.customer_id, operation_id: data.operation_id, plan_hash: data.plan_hash })
        await invoke('crm-accounting-correction', 'executeV1', { customer_id: data.customer_id, operation_id: data.operation_id, plan_hash: data.plan_hash })
        state = await repairState(data)
      }
      // A committed repair remains committed even if the following read fails.
      // The same operation can resume verification without applying it again.
      let verification = state.verification
      const alreadyVerified = verification?.complete === true
      if (verification?.complete !== true) {
        const after = await invoke('crm-accounting-correction', 'inspectV1', { customer_id: data.customer_id })
        verification = { checked_at: now(), complete: Boolean(after.complete && state.after_snapshot_hash && after.snapshot_hash === state.after_snapshot_hash),
          expected_snapshot_hash: state.after_snapshot_hash, observed_snapshot_hash: after.snapshot_hash,
          scope: 'repair_operation', reason: after.snapshot_hash === state.after_snapshot_hash ? '' : '提交后的来源与计划不一致，须核实后续变更；不重复执行原修复' }
        await collection('logs').doc(keyId).update({ verification })
      }
      const result = await checkCustomer({ batch_id: data.batch_id, customer_id: data.customer_id, auto_refresh: false }, user)
      if (!alreadyVerified) {
        verification = { ...verification, result_hash: result.result_hash, customer_complete: result.internal?.complete === true, summary_match: result.summary_match, detail_match: result.detail_match }
        await collection('logs').doc(keyId).update({ verification })
      }
      return { ...state, verification, result }
    }
    throw Object.assign(Error('未知对账操作'), { code: 400 })
  }
  return { run }
}
module.exports = { createService, digest, VERSION, COL }
