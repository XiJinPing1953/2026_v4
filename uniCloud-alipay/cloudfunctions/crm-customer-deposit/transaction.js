'use strict'
const M = require('./depositModel')
const R = require('./report')
const { isOffsetCreditReceipt, isNonCashPrepayReceipt } = require('./receiptSource')

function savedResult(row, snapshot) {
  return { rule_version: M.RULE_VERSION, money_scale: 2, customer_id: row.customer_id,
    operation_id: row.operation_id, entry: M.publicEntry(row), receipt_id: row.receipt_id || '',
    version: row.operation_result.version, balance: row.operation_result.balance_cents / 100,
    current_version: snapshot.version, current_balance: snapshot.balance_cents / 100,
    cache_status: row.operation_result.cache_status, idempotent: true }
}
function findDuplicate(snapshot, input) {
  const row = snapshot.entries.find(item => item._id === M.entryId(input.command.customer_id, input.operation_id))
  if (!row) return null
  if (row.fingerprint !== M.digest(input.command)) M.fail('此操作号已用于不同登记内容，请查询原结果，不可覆盖或重复登记')
  return savedResult(row, snapshot)
}
function buildChange(snapshot, input, user, now = Date.now()) {
  if (snapshot.version !== input.expected_version) M.fail('押金余额已变化，请重新预览后确认', 409,
    { reason: 'version_conflict', current_version: snapshot.version, current_balance: snapshot.balance_cents / 100 })
  const command = input.command, id = M.entryId(command.customer_id, input.operation_id), nextVersion = snapshot.version + 1
  const base = { _id: id, customer_id: command.customer_id, rule_version: M.RULE_VERSION,
    operation_id: input.operation_id, fingerprint: M.digest(command), command,
    account_version: nextVersion, created_at: now, updated_at: now, created_by: user._id,
    created_by_name: String(user.name || user.username || ''), status: 'posted' }
  let entry, original = null, originalAfter = null, balance
  if (command.action === 'create') {
    const { action, ...values } = command
    entry = { ...base, ...values }
    if (entry.kind === 'transfer') entry.receipt_id = M.receiptId(id)
    balance = M.historyBalance([...snapshot.entries, entry])
  } else {
    original = snapshot.entries.find(row => row._id === command.entry_id)
    if (!original || original.customer_id !== command.customer_id) M.fail('押金流水不属于当前客户或不存在', 403)
    if (original.kind === 'void' || original.status !== 'posted') M.fail('该押金流水已作废或不允许再次作废')
    entry = { ...base, kind: 'void', original_entry_id: original._id, reason: command.reason,
      amount_cents: original.amount_cents, biz_date: original.biz_date, payment_method: 'unknown',
      voucher_ref: original.voucher_ref, note: command.reason, ...(original.receipt_id ? { receipt_id: original.receipt_id } : {}) }
    originalAfter = { ...original, status: 'void', void_entry_id: id, void_reason: command.reason,
      voided_at: now, voided_by: user._id, voided_by_name: base.created_by_name, updated_at: now }
    balance = M.historyBalance([...snapshot.entries.filter(row => row._id !== original._id), originalAfter, entry])
  }
  const account = { ...(snapshot.account || { _id: M.accountId(command.customer_id), customer_id: command.customer_id,
    rule_version: M.RULE_VERSION, created_at: now }), version: nextVersion, balance_cents: balance,
  last_entry_id: id, updated_at: now }
  const cacheStatus = entry.kind === 'transfer' || original?.kind === 'transfer'
    ? 'prepay_rebuilt_receivable_not_rebuilt' : 'unchanged'
  entry.operation_result = { version: nextVersion, balance_cents: balance, cache_status: cacheStatus }
  return { entry, original, originalAfter, account, before_balance: snapshot.balance_cents / 100,
    after_balance: balance / 100, current_version: snapshot.version, cache_status: cacheStatus }
}
function transferReceipt(change, snapshot, user, now) {
  const entry = change.entry
  return { _id: entry.receipt_id, customer_id: entry.customer_id, customer_name: String(snapshot.customer.name || ''),
    biz_date: entry.biz_date, amount: entry.amount_cents / 100, allocated_amount: 0,
    unallocated_amount: entry.amount_cents / 100, rounding_amount: 0, rounding_allocated_amount: 0,
    entry_kind: 'prepay', payment_method: 'unknown', allocation_mode: 'none',
    allocation_start_date: '', allocation_end_date: '', source_type: 'deposit_transfer', source_id: entry._id,
    note: `【押金转气款】${entry.note}${entry.voucher_ref ? `；凭据：${entry.voucher_ref}` : ''}`,
    status: 'posted', request_id: entry.operation_id, created_at: now, updated_at: now,
    created_by: user._id, created_by_name: String(user.name || user.username || '') }
}
async function readReceiptScope(db, customerId, receiptId) {
  const receipts = await R.complete(db, M.TABLES.receipts, { customer_id: customerId })
  // Reverse-link queries deliberately omit customer_id: foreign links must also block a void.
  const [allocations, adjustments, references, fixed] = await Promise.all([
    R.complete(db, M.TABLES.allocations, { receipt_id: receiptId }),
    R.complete(db, M.TABLES.adjustments, { receipt_id: receiptId }),
    R.complete(db, M.TABLES.receipts, { source_id: receiptId }),
    db.collection(M.TABLES.receipts).doc(receiptId).get()
  ])
  const receipt = R.first(fixed)
  return { receipts, allocations, adjustments, references, receipt,
    snapshot_hash: M.digest({ receipts, allocations, adjustments, references, receipt }) }
}
function ensureVoidTransfer(change, scope) {
  const original = change.original, receipt = scope.receipt
  if (!receipt || receipt._id !== original.receipt_id || receipt.customer_id !== original.customer_id ||
      receipt.source_type !== 'deposit_transfer' || receipt.source_id !== original._id || receipt.entry_kind !== 'prepay' ||
      receipt.payment_method !== 'unknown' || receipt.status !== 'posted' || receipt.biz_date !== original.biz_date ||
      M.toScaled(receipt.amount) !== original.amount_cents || M.toScaled(receipt.unallocated_amount, 3, { allowZero: true }) !== original.amount_cents * 10 ||
      M.toScaled(receipt.allocated_amount, 3, { allowZero: true }) !== 0 ||
      M.toScaled(receipt.rounding_amount ?? 0, 3, { allowZero: true }) !== 0 ||
      M.toScaled(receipt.rounding_allocated_amount ?? 0, 3, { allowZero: true }) !== 0 ||
      scope.allocations.length || scope.adjustments.length || scope.references.length ||
      receipt.receipt_adjustment_status || receipt.receipt_adjustment_id ||
      !original.receipt_original || M.digest({ ...receipt, updated_at: original.receipt_original.updated_at }) !== M.digest(original.receipt_original)) {
    M.fail('转气款已有分配、关联、抹零或原值变化，不能直接作废，请先核对')
  }
}
function prepayPatch(receipts) {
  const sums = { prepay_balance: 0, prepay_manual_balance: 0, receipt_unallocated_balance: 0, offset_credit_balance: 0 }
  for (const receipt of receipts) {
    if (!['posted', 'void'].includes(receipt.status)) M.fail('现有预付款来源状态不完整，未执行押金转款')
    if (receipt.status !== 'posted') continue
    let amount
    try { amount = M.toScaled(receipt.unallocated_amount, 3, { allowZero: true, label: '预付可用金额' }) }
    catch (_) { M.fail('现有预付款来源金额不完整，未执行押金转款') }
    const category = isOffsetCreditReceipt(receipt) ? 'offset_credit_balance'
      : receipt.source_type === 'customer_prepay_manual' || isNonCashPrepayReceipt(receipt) ? 'prepay_manual_balance' : 'receipt_unallocated_balance'
    sums.prepay_balance = M.checkedSum([sums.prepay_balance, amount])
    sums[category] = M.checkedSum([sums[category], amount])
  }
  return Object.fromEntries(Object.entries(sums).map(([key, amount]) => [key, amount / 1000]))
}
async function prepare(db, snapshot, input, user, { rehearsalSeedAmount } = {}) {
  let seed = null, changeSnapshot = snapshot, changeInput = input
  if (rehearsalSeedAmount !== undefined) {
    if (snapshot.version !== 0 || snapshot.entries.length || input.command.action !== 'create') M.fail('临时演练期初仅用于无押金流水的账户创建演练', 400)
    if (input.expected_version !== snapshot.version) M.fail('演练账户版本已变化，请重新查询')
    const seedInput = { operation_id: `rehearsal-seed-${M.digest(input.operation_id).slice(0, 32)}`, expected_version: 0,
      command: { action: 'create', customer_id: snapshot.customer_id, kind: 'opening', amount_cents: M.toScaled(rehearsalSeedAmount),
        biz_date: input.command.biz_date, payment_method: 'unknown', voucher_ref: '', note: '临时事务回滚演练期初；不得提交' } }
    seed = buildChange(snapshot, seedInput, user)
    changeSnapshot = { ...snapshot, account: seed.account, entries: [seed.entry], balance_cents: seed.account.balance_cents, version: 1 }
    changeInput = { ...input, expected_version: 1 }
  }
  const change = buildChange(changeSnapshot, changeInput, user)
  const isTransfer = change.entry.kind === 'transfer' || change.original?.kind === 'transfer'
  let receiptScope = null, receipt = null, customerPatch = null
  if (isTransfer) {
    const id = change.entry.receipt_id
    receiptScope = await readReceiptScope(db, snapshot.customer_id, id)
    if (change.entry.kind === 'transfer') {
      if (receiptScope.receipt || receiptScope.allocations.length || receiptScope.adjustments.length || receiptScope.references.length) M.fail('确定转气款编号或关联已存在，请先核对')
      receipt = transferReceipt(change, snapshot, user, change.entry.created_at)
      change.entry.receipt_original = receipt
      customerPatch = prepayPatch([...receiptScope.receipts, receipt])
    } else {
      ensureVoidTransfer(change, receiptScope)
      receipt = { ...receiptScope.receipt, status: 'void', updated_at: change.entry.created_at }
      customerPatch = prepayPatch(receiptScope.receipts.map(row => row._id === receipt._id ? receipt : row))
    }
    const receivable = snapshot.customer.receivable_balance
    if (typeof receivable === 'number' && Number.isFinite(receivable) && receivable >= 0) {
      try {
        const receivableMills = M.toScaled(receivable, 3, { allowZero: true })
        customerPatch.net_balance = M.checkedSum([receivableMills, -M.toScaled(customerPatch.prepay_balance, 3, { allowZero: true })]) / 1000
        change.cache_status = 'prepay_rebuilt_net_derived_from_existing_receivable'
        change.entry.operation_result.cache_status = change.cache_status
      } catch (_) { M.fail('客户气款余额尚未核实，请先刷新气款余额再转款') }
    } else M.fail('客户气款余额尚未核实，请先刷新气款余额再转款')
  }
  return { snapshot, input, change, receiptScope, receipt, customerPatch, seed, rehearsal_only: Boolean(seed) }
}
async function execute(db, prepared, { rehearse = false, failAfterWrites = 0 } = {}) {
  if (prepared.rehearsal_only && !rehearse) M.fail('临时演练期初禁止提交', 403)
  if (typeof db.startTransaction !== 'function') M.fail('当前数据库不支持事务，押金尚未登记')
  const { snapshot, change, receiptScope, receipt, customerPatch, seed } = prepared
  const tx = await db.startTransaction(), started = Date.now(), deadline = started + 8500
  let writes = 0, commitAttempted = false, outcome = '', stage = 'begin'
  const within = async (label, action) => {
    stage = label
    if (Date.now() >= deadline) M.fail('押金事务预算不足，已停止后续请求')
    return await action()
  }
  const write = async (label, action) => {
    const result = await within(label, action)
    if (result && result.updated !== undefined && Number(result.updated) !== 1) M.fail('押金原值保护未更新预期记录')
    writes++
    if (rehearse && failAfterWrites > 0 && writes === failAfterWrites) throw Object.assign(Error('预定押金事务中断演练'), { rehearsal_interruption: true })
    return result
  }
  try {
    // Alipay may throw when transaction.get targets a missing deterministic ID.
    // Complete pre-reads prove absence; add uniqueness and account write contention protect races.
    const customer = R.first(await within('read customer', () => tx.collection(M.TABLES.customers).doc(snapshot.customer_id).get()))
    if (M.digest(customer) !== M.digest(snapshot.customer)) M.fail('客户原值版本已变化，请重新预览')
    if (snapshot.account) {
      const current = R.first(await within('read account', () => tx.collection(M.TABLES.accounts).doc(snapshot.account._id).get()))
      if (M.digest(current) !== M.digest(snapshot.account)) M.fail('押金账户版本冲突，请重新预览')
    }
    if (change.original) {
      const original = R.first(await within('read source entry', () => tx.collection(M.TABLES.entries).doc(change.original._id).get()))
      if (M.digest(original) !== M.digest(change.original)) M.fail('原押金流水版本冲突，请重新预览')
    }
    if (receiptScope?.receipt) {
      const current = R.first(await within('read transfer receipt', () => tx.collection(M.TABLES.receipts).doc(receipt._id).get()))
      if (M.digest(current) !== M.digest(receiptScope.receipt)) M.fail('转气款分配状态已变化，请重新预览')
    }
    // Update patches preserve every unrelated customer field and create contention with allocation writers.
    await write('lock customer and update verified prepay', () => tx.collection(M.TABLES.customers).doc(snapshot.customer_id).update({
      ...(customerPatch || {}), updated_at: change.entry.created_at
    }))
    if (snapshot.account) {
      const { _id, ...patch } = change.account
      await write('update account', () => tx.collection(M.TABLES.accounts).doc(_id).update(patch))
    } else await write('create account', () => tx.collection(M.TABLES.accounts).add(change.account))
    if (seed) await write('create temporary rehearsal opening', () => tx.collection(M.TABLES.entries).add(seed.entry))
    await write('create operation entry', () => tx.collection(M.TABLES.entries).add(change.entry))
    if (change.originalAfter) {
      const { _id, ...patch } = change.originalAfter
      await write('void original entry', () => tx.collection(M.TABLES.entries).doc(_id).update(patch))
    }
    if (receipt) {
      if (receiptScope.receipt) await write('void unallocated transfer', () => tx.collection(M.TABLES.receipts).doc(receipt._id).update({ status: 'void', updated_at: receipt.updated_at }))
      else await write('create transfer receipt', () => tx.collection(M.TABLES.receipts).add(receipt))
    }
    const outside = await within('verify deposit scope', () => R.readDepositSnapshot(db, snapshot.customer_id))
    if (outside.snapshot_hash !== snapshot.snapshot_hash) M.fail('登记期间押金原值或范围发生变化，请重新查询')
    if (receiptScope) {
      const outsideReceipts = await within('verify transfer scope', () => readReceiptScope(db, snapshot.customer_id, receipt._id))
      if (outsideReceipts.snapshot_hash !== receiptScope.snapshot_hash) M.fail('登记期间预付款或关联范围发生变化，请重新查询')
    }
    if (rehearse) { await tx.rollback(); outcome = 'rehearsed_rolled_back' }
    else { await within('commit', async () => { commitAttempted = true; await tx.commit() }); outcome = 'committed' }
  } catch (error) {
    await tx.rollback().catch(() => {})
    if (rehearse && error.rehearsal_interruption) outcome = 'interruption_rolled_back'
    else {
      error.message = `${stage}: ${error.message}`
      if (commitAttempted) {
        error.message = '提交结果待查询，请保留同一操作号回查，勿重复登记：' + error.message
        error.details = { ...(error.details || {}), operation_id: change.entry.operation_id, commit_status_unknown: true }
      }
      throw error
    }
  }
  const after = await R.readDepositSnapshot(db, snapshot.customer_id).catch(error => {
    if (!rehearse) {
      error.message = '事务已提交，回读未完成，请保留原操作号查询：' + error.message
      error.details = { ...(error.details || {}), operation_id: change.entry.operation_id, commit_status_unknown: true }
    }
    throw error
  })
  if (rehearse) {
    if (after.snapshot_hash !== snapshot.snapshot_hash) M.fail('押金事务演练回滚后的原值不符，请停止登记')
    if (receiptScope) {
      const afterReceipts = await readReceiptScope(db, snapshot.customer_id, receipt._id)
      if (afterReceipts.snapshot_hash !== receiptScope.snapshot_hash) M.fail('押金事务演练回滚后的预付原值不符')
    }
    return { rule_version: M.RULE_VERSION, customer_id: snapshot.customer_id, operation_id: change.entry.operation_id,
      status: outcome, rehearsed: true, committed: false, snapshot_verified: true, writes,
      transaction_ms: Date.now() - started, before_balance: change.before_balance, after_balance: change.after_balance,
      rehearsal_seed_amount: seed ? seed.entry.amount_cents / 100 : 0,
      version: snapshot.version, balance: snapshot.balance_cents / 100 }
  }
  const saved = after.entries.find(row => row._id === change.entry._id)
  if (!saved || saved.fingerprint !== change.entry.fingerprint) M.fail('已提交但押金操作结果回读不符，请使用原操作号核对', 409,
    { operation_id: change.entry.operation_id, commit_status_unknown: true })
  return { ...savedResult(saved, after), idempotent: false, status: 'committed' }
}
module.exports = { savedResult, findDuplicate, buildChange, transferReceipt, readReceiptScope, ensureVoidTransfer, prepayPatch, prepare, execute }
