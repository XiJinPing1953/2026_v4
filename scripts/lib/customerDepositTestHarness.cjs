'use strict'
const { makeDb, loadHandler } = require('./accountingTestHarness.cjs')
const clone = value => structuredClone(value)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
function depositDb(tables, hooks = {}, transactional = false) {
  const reader = makeDb(tables, { get: hooks.get, count: hooks.count }), writes = []
  function wrap(name, query, docId = null) {
    return new Proxy(query, { get(q, key) {
      if (key === 'get') return async () => {
        const result = await q.get()
        if (transactional && docId && !result.data?.length && hooks.missingTransactionReadThrows !== false) throw Error('Alipay missing transaction document')
        if (transactional && docId && hooks.transactionDocumentObject) return { ...result, data: result.data[0] }
        return result
      }
      if (key === 'add') return async data => {
        if (hooks.txWrite && transactional) await hooks.txWrite('add', name, data, tables)
        const id = data._id
        if (!id || (tables[name] || []).some(row => row._id === id)) throw Error('duplicate deterministic key')
        ;(tables[name] ||= []).push(clone(data)); writes.push({ table: name, id, data: clone(data) }); return { id }
      }
      if (key === 'update') return async patch => {
        if (hooks.txWrite && transactional) await hooks.txWrite('update', name, patch, tables)
        const rows = (await q.get()).data
        for (const row of rows) {
          const doc = tables[name].find(item => item._id === row._id)
          Object.assign(doc, clone(patch)); writes.push({ table: name, id: doc._id, data: clone(doc) })
        }
        return { updated: rows.length }
      }
      if (['where', 'doc', 'field', 'orderBy', 'skip', 'limit'].includes(key)) return (...args) => wrap(name, q[key](...args), key === 'doc' ? args[0] : docId)
      return q[key]
    } })
  }
  const result = { ...reader, writes, collection: name => wrap(name, reader.collection(name)) }
  if (!transactional) result.startTransaction = async () => {
    if (hooks.start) await hooks.start(tables)
    const before = clone(tables), copy = clone(tables), tx = depositDb(copy, hooks, true)
    let ended = false
    return { ...tx,
      rollback: async () => { ended = true; if (hooks.rollback) await hooks.rollback(tables, copy) },
      commit: async () => {
        if (ended) throw Error('transaction ended')
        if (hooks.beforeCommit) await hooks.beforeCommit(tables, copy)
        for (const write of tx.writes) {
          const original = (before[write.table] || []).find(row => row._id === write.id)
          const current = (tables[write.table] || []).find(row => row._id === write.id)
          if (!same(original, current)) throw Error('transaction write conflict')
        }
        for (const write of tx.writes) {
          const rows = tables[write.table] ||= [], position = rows.findIndex(row => row._id === write.id)
          if (position === -1) rows.push(clone(write.data)); else rows[position] = clone(write.data)
        }
        writes.push(...tx.writes); ended = true
        if (hooks.afterCommit) await hooks.afterCommit(tables)
      }
    }
  }
  return result
}
function fixture(extra = {}) {
  return { crm_users: [{ _id: 'admin-1', token: 'test', role: 'superadmin', username: '合成管理员' }],
    crm_customers: [{ _id: 'customer-1', name: '合成押金客户', receivable_balance: 9000,
      net_balance: 9000, default_price_unit: 'kg', untouched: 'retain', updated_at: 1 },
    { _id: 'customer-2', name: '其他客户', receivable_balance: 50, updated_at: 1 }],
    crm_customer_deposit_accounts: [], crm_customer_deposit_entries: [], crm_customer_receipts: [],
    crm_customer_allocations: [], crm_customer_receipt_adjustments: [], ...extra }
}
function harness(extra = {}, hooks = {}) {
  const tables = fixture(extra), db = depositDb(tables, hooks), main = loadHandler('crm-customer-deposit', db)
  const invoke = (action, data = {}, token = 'test') => main({ action, token, data: { customer_id: 'customer-1', ...data } })
  let operation = 0
  const create = (kind, amount, extra = {}) => invoke('createDepositEntryV1', { kind, amount, biz_date: '2026-09-01',
    payment_method: ['opening', 'transfer'].includes(kind) ? 'unknown' : 'cash', note: '合成核实凭据', voucher_ref: 'synthetic',
    operation_id: `operation-${++operation}`, expected_version: tables.crm_customer_deposit_accounts.find(row => row.customer_id === (extra.customer_id || 'customer-1'))?.version || 0,
    ...extra })
  return { tables, db, invoke, create }
}
module.exports = { fixture, depositDb, harness }
