'use strict'
const M = require('./depositModel')
const { readComplete } = require('./financialReadLocal')
const first = result => Array.isArray(result?.data) ? result.data[0] || null : null
async function complete(db, table, where) {
  return readComplete(db.collection(table), where, { command: db.command, source: table, maxRows: 50000 })
}
function verifyCustomer(customer, customerId) {
  if (!customer || customer._id !== customerId || customer.is_hidden === true) M.fail('客户不存在或不可访问', 403)
  if (customer.settlement_customer_id && customer.settlement_customer_id !== customerId) M.fail('请进入所属独立结算客户登记押金，送气地点不单独建押金账', 400)
}
function verifyLedger(account, rows, customerId) {
  if (!account && rows.length) M.fail('押金账户缺失但已有流水，请先核对；本次未返回可信余额')
  if (account && (account._id !== M.accountId(customerId) || account.customer_id !== customerId ||
      account.rule_version !== M.RULE_VERSION || !Number.isSafeInteger(account.version) || account.version !== rows.length || account.version < 1 ||
      !Number.isSafeInteger(account.balance_cents))) M.fail('押金账户版本或金额不完整，请先核对')
  const byId = new Map(rows.map(row => [row._id, row])), versions = new Set()
  for (const row of rows) {
    if (row.customer_id !== customerId || row._id !== M.entryId(customerId, row.operation_id) ||
        row.rule_version !== M.RULE_VERSION || ![...M.KINDS, 'void'].includes(row.kind) ||
        !['posted', 'void'].includes(row.status) || !Number.isSafeInteger(row.amount_cents) || row.amount_cents <= 0 ||
        !Number.isSafeInteger(row.account_version) || row.account_version < 1 || row.account_version > rows.length || versions.has(row.account_version) ||
        !row.command || M.digest(row.command) !== row.fingerprint || row.command.customer_id !== customerId ||
        !row.operation_result || row.operation_result.version !== row.account_version || !Number.isSafeInteger(row.operation_result.balance_cents)) M.fail('押金流水原值或版本链不完整，请先核对')
    versions.add(row.account_version)
    M.date(row.biz_date)
    if (row.kind === 'void') {
      const original = byId.get(row.original_entry_id)
      if (row.command.action !== 'void' || row.command.entry_id !== row.original_entry_id || row.reason !== row.command.reason ||
          row.status !== 'posted' || !original || original.kind === 'void' || original.status !== 'void' ||
          original.void_entry_id !== row._id || original.amount_cents !== row.amount_cents || original.account_version >= row.account_version ||
          original.biz_date !== row.biz_date || original.void_reason !== row.reason) M.fail('押金作废链不完整，请先核对')
    } else {
      for (const key of ['kind', 'amount_cents', 'biz_date', 'payment_method', 'voucher_ref', 'note']) {
        if (row[key] !== row.command[key]) M.fail('押金原单与登记内容不符，请先核对')
      }
      if (row.command.action !== 'create') M.fail('押金操作类型不符')
      if (row.status === 'void' && (!row.void_entry_id || byId.get(row.void_entry_id)?.original_entry_id !== row._id)) M.fail('押金作废凭据缺失')
      if (row.kind === 'transfer' && row.receipt_id !== M.receiptId(row._id)) M.fail('押金转气款来源编号不符')
    }
  }
  let operationBalance = 0
  for (const row of [...rows].sort((left, right) => left.account_version - right.account_version)) {
    const source = row.kind === 'void' ? byId.get(row.original_entry_id) : row
    const originalDirection = ['receive', 'opening'].includes(source.kind) ? 1 : -1
    operationBalance = M.checkedSum([operationBalance, source.amount_cents * originalDirection * (row.kind === 'void' ? -1 : 1)])
    if (operationBalance < 0 || row.operation_result.balance_cents !== operationBalance) M.fail('押金操作保存结果与完整版本链不符，请先核对')
  }
  if (account && account.last_entry_id !== rows.find(row => row.account_version === account.version)?._id) M.fail('押金账户最后操作编号与完整版本链不符')
  const balance = M.historyBalance(rows)
  if (account && account.balance_cents !== balance) M.fail('押金账户与完整流水余额不符，本次未返回可信合计')
  return balance
}
async function readDepositSnapshot(db, rawCustomerId) {
  const customerId = M.customerId(rawCustomerId)
  const customer = first(await db.collection(M.TABLES.customers).doc(customerId).get())
  verifyCustomer(customer, customerId)
  const accounts = await complete(db, M.TABLES.accounts, { customer_id: customerId })
  if (accounts.length > 1) M.fail('客户存在重复押金账户，请先核对')
  const rows = await complete(db, M.TABLES.entries, { customer_id: customerId })
  const transfers = rows.filter(row => row.kind === 'transfer'), transferReceipts = []
  for (let offset = 0; offset < transfers.length; offset += 100) {
    transferReceipts.push(...await complete(db, M.TABLES.receipts, { _id: db.command.in(transfers.slice(offset, offset + 100).map(row => row.receipt_id)) }))
  }
  for (const entry of transfers) {
    const receipt = transferReceipts.find(row => row._id === entry.receipt_id)
    if (!receipt || receipt.customer_id !== customerId || receipt.source_type !== 'deposit_transfer' || receipt.source_id !== entry._id ||
        receipt.status !== entry.status || receipt.entry_kind !== 'prepay' || receipt.payment_method !== 'unknown' ||
        receipt.biz_date !== entry.biz_date || M.toScaled(receipt.amount) !== entry.amount_cents ||
        M.checkedSum([M.toScaled(receipt.allocated_amount, 3, { allowZero: true }), M.toScaled(receipt.unallocated_amount, 3, { allowZero: true })]) !== entry.amount_cents * 10 ||
        M.toScaled(receipt.rounding_amount ?? 0, 3, { allowZero: true }) !== 0 || M.toScaled(receipt.rounding_allocated_amount ?? 0, 3, { allowZero: true }) !== 0) {
      M.fail('押金转气款与预付款来源的金额、归属或状态不一致，请先核对')
    }
  }
  const accountAfter = await complete(db, M.TABLES.accounts, { customer_id: customerId })
  if (M.digest(accounts) !== M.digest(accountAfter)) M.fail('押金读取期间账户已变化，请重新查询')
  const account = accounts[0] || null
  const balance = verifyLedger(account, rows, customerId)
  return { customer_id: customerId, customer, account, entries: rows, balance_cents: balance,
    version: account?.version || 0, transfer_receipts: transferReceipts,
    snapshot_hash: M.digest({ customer, account, entries: rows, transfer_receipts: transferReceipts }) }
}
function statementFromSnapshot(snapshot, { dateFrom = '', dateTo = '' } = {}) {
  const from = M.date(dateFrom, false), to = M.date(dateTo, false)
  if (from && to && from > to) M.fail('开始日期不能晚于结束日期', 400)
  const rows = snapshot.entries, active = rows.filter(row => row.status === 'posted' && row.kind !== 'void')
  const inPeriod = rows.filter(row => (!from || row.biz_date >= from) && (!to || row.biz_date <= to))
  const sumKind = kind => M.checkedSum(inPeriod.filter(row => row.status === 'posted' && row.kind === kind).map(row => row.amount_cents)) / 100
  return { rule_version: M.RULE_VERSION, read_complete: true, money_scale: 2, customer_id: snapshot.customer_id,
    date_from: from, date_to: to, version: snapshot.version, current_balance: snapshot.balance_cents / 100,
    account_initialized: Boolean(snapshot.account), history_status: !snapshot.account ? 'not_initialized' : active.some(row => row.kind === 'opening') ? 'opening_recorded' : 'not_confirmed',
    history_note: '仅反映已登记押金；历史押金须凭原始依据核实并登记期初转入。',
    opening_balance: M.checkedSum(active.filter(row => from && row.biz_date < from).map(M.delta)) / 100,
    received_total: sumKind('receive'), refunded_total: sumKind('refund'), transferred_total: sumKind('transfer'), opening_transferred_total: sumKind('opening'),
    closing_balance: M.checkedSum(active.filter(row => !to || row.biz_date <= to).map(M.delta)) / 100,
    entries: M.ordered(inPeriod).map(M.publicEntry) }
}
async function readDepositStatement(db, customerId, options = {}) {
  return statementFromSnapshot(await readDepositSnapshot(db, customerId), options)
}
module.exports = { complete, first, verifyCustomer, verifyLedger, readDepositSnapshot, statementFromSnapshot, readDepositStatement }
