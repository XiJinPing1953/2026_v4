'use strict'

// Opt-in, request-local timing. Never records predicates, documents or credentials.
const { AsyncLocalStorage } = require('async_hooks')
const { performance } = require('perf_hooks')
const storage = new AsyncLocalStorage()
const now = () => performance.now()
const rounded = value => Math.round(Math.max(0, value) * 10) / 10
const MAX_CALLS = 120
let invocations = 0

function measureRead(collection, operation, invoke) {
 const state = storage.getStore()
 if (!state) return invoke()
 const start = now()
 if (state.active++ === 0) state.windowStart = start
 state.count++
 const finish = failed => {
  const end = now(), duration = end - start
  state.sum += duration
  if (--state.active === 0) state.wall += end - state.windowStart
  if (state.calls.length < MAX_CALLS) state.calls.push({ collection, operation, start_ms: rounded(start - state.start), duration_ms: rounded(duration), failed })
 }
 try {
  return Promise.resolve(invoke()).then(value => { finish(false); return value }, error => { finish(true); throw error })
 } catch (error) { finish(true); throw error }
}

function wrapDatabase(database) {
 const caches = { database: new WeakMap(), query: new WeakMap(), aggregate: new WeakMap() }
 function wrap(target, kind, collection = '') {
  if (!target || typeof target !== 'object') return target
  const cache = caches[kind]
  if (cache.has(target)) return cache.get(target)
  const methods = new Map()
  const proxy = new Proxy(target, { get(object, key) {
   const value = Reflect.get(object, key, object)
   if (typeof value !== 'function' || key === 'constructor') return value
   if (methods.has(key)) return methods.get(key)
   let fn
   if (kind === 'database' && key === 'collection') fn = (...args) => wrap(value.apply(object, args), 'query', String(args[0]).slice(0, 80))
   else if (kind === 'database' && key === 'startTransaction') fn = (...args) => { const tx = value.apply(object, args); return tx && typeof tx.then === 'function' ? tx.then(value => wrap(value, 'database')) : wrap(tx, 'database') }
   else if ((kind === 'query' && ['get', 'count'].includes(key)) || (kind === 'aggregate' && key === 'end')) fn = (...args) => measureRead(collection, String(key), () => value.apply(object, args))
   else if (kind === 'query' && key === 'aggregate') fn = (...args) => wrap(value.apply(object, args), 'aggregate', collection)
   else if ((kind === 'query' && ['doc', 'where', 'field', 'orderBy', 'skip', 'limit'].includes(key)) || (kind === 'aggregate' && !['then', 'catch', 'finally'].includes(key))) fn = (...args) => wrap(value.apply(object, args), kind, collection)
   else fn = value.bind(object)
   methods.set(key, fn)
   return fn
  } })
  cache.set(target, proxy)
  return proxy
 }
 return wrap(database, 'database')
}

function withPerformanceTrace(handler) {
 return function(event, context) {
  const firstInvocation = invocations++ === 0
  const traceId = event?._performance_trace
  if (typeof traceId !== 'string' || !/^perf_[a-zA-Z0-9_-]{8,80}$/.test(traceId)) return handler.call(this, event, context)
  const state = { start: now(), active: 0, wall: 0, sum: 0, count: 0, calls: [] }
  return storage.run(state, async () => {
   const result = await handler.call(this, event, context)
   // Timing does not change authentication or expose internal details on denial.
   if (!result || typeof result !== 'object' || result.code !== 0) return result
   const end = now()
   return { ...result, _performance: { schema: 1, trace_id: traceId,
    request_id: typeof event.request_id === 'string' ? event.request_id.slice(0, 100) : '',
    function_ms: rounded(end - state.start), first_instance_invocation: firstInvocation,
    db: { wall_ms: rounded(state.wall + (state.active ? end - state.windowStart : 0)), sum_ms: rounded(state.sum),
     count: state.count, pending: state.active, truncated: state.count > state.calls.length, calls: state.calls },
    semantics: 'handler wall time; database SDK read round trips, not database engine CPU time' } }
  })
 }
}

module.exports = { wrapDatabase, withPerformanceTrace }
