import { nextTick } from 'vue'
// Off by default. One explicit session lasts at most ten minutes; no business data.
const MAX_EVENTS = 800
let session = null
let sequence = 0
let installed = false
let activePage = null
const visits = new Map()
const clock = () => typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
const routePath = value => String(value || '').split(/[?#]/)[0].replace(/^\//, '')
const round = value => Math.round(Math.max(0, value) * 10) / 10
function enabled() { return Boolean(session && Date.now() < session.until && session.events.length < MAX_EVENTS) }
function emit(event) {
 if (!enabled()) return
 const item = { schema: 1, session: session.id, sequence: ++sequence, at: Date.now(), ...event }
 session.events.push(item)
 const line = JSON.stringify(item)
 // Production Android suppresses console output; a dedicated Logcat tag is readable
 // by the local USB collector and never requires uploading logs to a service.
 try {
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.android) {
   const parts = Math.ceil(line.length / 2400)
   for (let part = 0; part < parts; part++) plus.android.invoke('android.util.Log', 'i', 'CRM_PERF', `part ${item.session}:${item.sequence} ${part + 1}/${parts} ` + line.slice(part * 2400, (part + 1) * 2400))
   return
  }
  // #endif
  console.info('[crm-perf]', line)
 } catch (_) { /* Instrumentation cannot block the application. */ }
}
export function startPerformanceSession() {
 session = { id: `perf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, until: Date.now() + 600000, events: [] }
 visits.clear(); activePage = null; sequence = 0
 emit({ kind: 'session_start', limit_ms: 600000 })
 return session.id
}
export function stopPerformanceSession() { emit({ kind: 'session_end' }); if (session) session.until = 0 }
export function readPerformanceEvents() { return session ? session.events.slice() : [] }
export function performanceSessionActive() { return enabled() }
export function beginPageTrace(route, source = 'navigation') {
 if (!enabled()) return null
 const path = routePath(route)
 if (source !== 'tap' && activePage && activePage.route === path && !activePage.hidden && !activePage.loaded) return activePage
 const visit = (visits.get(path) || 0) + 1
 visits.set(path, visit)
 activePage = { id: `${session.id}_${++sequence}`, route: path, start: clock(), visit, source, hidden: false, loaded: false }
 emit({ kind: 'page_start', page_id: activePage.id, route: path, visit, source })
 return activePage
}
export function markPageTrace(stage, trace = activePage) {
 if (!enabled() || !trace) return
 if (stage === 'onLoad') trace.loaded = true
 emit({ kind: 'page_stage', page_id: trace.id, route: trace.route, visit: trace.visit, stage, elapsed_ms: round(clock() - trace.start) })
}
export async function markPageAfterRender(stage = 'interactive_render') {
 const trace = activePage
 if (!enabled() || !trace) return
 await nextTick()
 try {
  const pages = getCurrentPages(), page = pages[pages.length - 1]
  uni.createSelectorQuery().in(page?.$vm).select('.page').boundingClientRect(rect => {
   if (activePage === trace && !trace.hidden) markPageTrace(rect ? stage : 'render_probe_unavailable', trace)
  }).exec()
 } catch (_) { markPageTrace('render_probe_unavailable', trace) }
}
export function startPerformanceSpan(stage) {
 if (!enabled()) return () => {}
 const trace = activePage, start = clock(), sessionId = session.id
 return () => { if (enabled() && session?.id === sessionId) emit({ kind: 'local_span', page_id: trace?.id, route: trace?.route, stage, duration_ms: round(clock() - start) }) }
}
export function startCloudTrace(name, action, requestId) {
 if (!enabled()) return null
 const trace = activePage
 return { id: session.id, name, action, requestId, page: trace, start: clock() }
}
export function finishCloudTrace(job, result, failed = false) {
 if (!job || !enabled() || job.id !== session.id) return
 const timing = result?._performance
 const sameRequest = timing?.trace_id === job.id && timing?.request_id === job.requestId
 // Backend metadata is collected only when it matches this exact request.
 emit({ kind: 'cloud', page_id: job.page?.id, route: job.page?.route, name: job.name, action: job.action,
  request_id: job.requestId, elapsed_ms: round(clock() - job.start), code: result?.code ?? null, failed,
  server: sameRequest ? timing : null })
}
export function installPerformanceTrace(app) {
 if (installed) return
 installed = true
 for (const method of ['navigateTo', 'redirectTo', 'reLaunch', 'switchTab']) {
  uni.addInterceptor(method, { invoke(args) { beginPageTrace(args?.url) } })
 }
 app.mixin({
  onLoad() { const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []; const route = this.$page?.route || this.route || pages[pages.length - 1]?.route; if (route) { const trace = beginPageTrace(route, 'onLoad'); this.__crmPerfPage = trace; markPageTrace('onLoad', trace) } },
  onShow() { if (this.__crmPerfPage) { if (this.__crmPerfPage.hidden) this.__crmPerfPage = beginPageTrace(this.__crmPerfPage.route, 'return'); activePage = this.__crmPerfPage; activePage.hidden = false; markPageTrace('onShow', activePage) } },
  onReady() { if (this.__crmPerfPage) markPageTrace('first_render', this.__crmPerfPage) },
  onHide() { if (this.__crmPerfPage) this.__crmPerfPage.hidden = true }
 })
 // For an authenticated H5 diagnostic browser; does not run or navigate by itself.
 // #ifdef H5
 if (typeof window !== 'undefined') window.__crmPerformance = { start: startPerformanceSession, stop: stopPerformanceSession, read: readPerformanceEvents }
 // #endif
}
