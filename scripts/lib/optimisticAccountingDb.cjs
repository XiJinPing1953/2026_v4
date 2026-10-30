'use strict'
const { makeDb } = require('./accountingTestHarness.cjs')
const canonical = value => JSON.stringify(value)
// Isolation model for deterministic concurrency tests, not evidence of cloud isolation.
function optimisticDb(state, hooks = {}) {
  const db = makeDb(state, { mutate: true })
  db.startTransaction = async () => {
    const initial = structuredClone(state), snapshot = structuredClone(state), read = new Map()
    const local = makeDb(snapshot, { mutate: true, txWrite: hooks.txWrite })
    let ended = false
    function wrap(name, query) {
      return new Proxy(query, { get(target, key) {
        if (['where','doc','field','orderBy','skip','limit'].includes(key)) return (...args) => wrap(name, target[key](...args))
        if (key === 'get') return async () => {
          const result = await target.get()
          for (const row of result.data || []) read.set(name + '\0' + row._id, structuredClone((initial[name] || []).find(x => x._id === row._id)))
          return result
        }
        if (['add','update','remove'].includes(key)) return async (...args) => { if (hooks.txWrite) hooks.txWrite(key, name, args[0]); return target[key](...args) }
        return target[key]
      } })
    }
    return {
      collection: name => wrap(name, local.collection(name)),
      rollback: async () => { ended = true },
      commit: async () => {
        if (ended) throw Error('transaction ended')
        if (hooks.beforeCommit) await hooks.beforeCommit(state, snapshot)
        const changed = []
        for (const name of new Set([...Object.keys(initial), ...Object.keys(snapshot)])) {
          for (const id of new Set([...(initial[name] || []).map(x=>x._id), ...(snapshot[name] || []).map(x=>x._id)])) {
            const before = (initial[name] || []).find(x=>x._id===id), after=(snapshot[name] || []).find(x=>x._id===id)
            if (canonical(before)!==canonical(after)) { read.set(name+'\0'+id,before); changed.push({name,id,after}) }
          }
        }
        for (const [key,before] of read) {
          const [name,id] = key.split('\0'), current = (state[name] || []).find(x=>x._id===id)
          if (canonical(current)!==canonical(before)) throw Object.assign(Error('transaction conflict'),{code:500})
        }
        for (const {name,id,after} of changed) {
          state[name] = (state[name] || []).filter(x=>x._id!==id)
          if (after) state[name].push(structuredClone(after))
        }
        ended = true
      }
    }
  }
  return db
}
module.exports={optimisticDb}
